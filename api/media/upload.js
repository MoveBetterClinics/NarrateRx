import { spawn } from 'node:child_process'
import { withSentry } from '../_lib/sentry.js'
import { handleUpload } from '@vercel/blob/client'
import { waitUntil } from '@vercel/functions'
import { tagAndPersist } from '../_lib/tagAsset.js'
import sharp from 'sharp'
import ffmpegStaticPath from 'ffmpeg-static'
import { segmentAndPersist } from '../_lib/segmentInterview.js'
import { generateAndPersistThumbnail } from '../_lib/thumbnail.js'
import { recordAudit, snapshot } from '../_lib/audit.js'
import { requireRole } from '../_lib/auth.js'
import { ALL_KNOWN_ROLES } from '../_lib/roles.js'
import { workspaceScope } from '../_lib/workspaceScope.js'
import { workspaceById } from '../_lib/workspaceContext.js'
import { enforceLimit } from '../_lib/ratelimit.js'

// Two-phase upload via @vercel/blob/client:
//   Phase 1 — body.type='blob.generate-client-token' (browser handshake):
//             check Clerk role here; an unauthenticated request must not be
//             able to mint a Blob upload token.
//   Phase 2 — body.type='blob.upload-completed' (Blob platform webhook):
//             the request originates from Vercel Blob, not the browser, so
//             there is no user Bearer token to verify. handleUpload() itself
//             cryptographically verifies the payload via the issued token.
// Explicit Node runtime so the Edge whole-graph bundler doesn't follow
// the ratelimit.js → @clerk/backend → node:crypto chain into middleware.
export const config = { runtime: 'nodejs' }

const HANDSHAKE_ALLOWED_ROLES = ALL_KNOWN_ROLES

// Client-direct upload to Vercel Blob using a token issued by this endpoint.
//
// Flow:
//   1. Browser calls upload() from '@vercel/blob/client' against this URL.
//   2. handleUpload first POSTs { type:'blob.generate-client-token', payload:{ pathname, clientPayload } }.
//      onBeforeGenerateToken returns the allowed mime types + clientPayload echoed back later.
//   3. Browser uploads file directly to Vercel Blob.
//   4. Blob calls back here with { type:'blob.upload-completed', payload:{ blob, tokenPayload } }.
//      onUploadCompleted writes the row to media_assets.
//
// Runs on Node (Fluid Compute) — @vercel/blob's server bits depend on undici
// and Node built-ins, which the Edge runtime cannot bundle. The Node runtime
// uses the (req, res) handler shape with req.body auto-parsed; do NOT switch
// to (req) / Response — that's the Edge shape and it does not work here.

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const FFMPEG_BIN   = process.env.FFMPEG_PATH || ffmpegStaticPath || 'ffmpeg'

async function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...init.headers,
    },
  })
}

// HEIC/HEIF intentionally absent: the browser uploader transcodes those to
// JPEG client-side (src/lib/mediaLib.js) so the canonical blob is always
// renderable. Keeping HEIC out of the allowlist makes that invariant a
// hard contract — any path that bypasses the client transcode (e.g. a curl
// of a raw .heic) is rejected at the handshake instead of producing a
// preview-broken asset row downstream.
const ALLOWED_MIME = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v',
]

function kindFromMime(mime) {
  if (!mime) return null
  if (mime.startsWith('image/')) return 'photo'
  if (mime.startsWith('video/')) return 'video'
  return null
}

const PURPOSES = new Set(['interview', 'broll', 'photo', 'brand'])

// Default asset_purpose when the uploader didn't supply one — covers older
// API callers (e.g. return-uploads of finished edits, server-side seeding).
// Videos default to interview to preserve the historical behavior; photos
// default to photo. Brand assets are always opted into explicitly.
function defaultPurpose(kind) {
  return kind === 'video' ? 'interview' : 'photo'
}

async function probeImageDimsFromUrl(url) {
  const res = await fetch(url, { headers: { Range: 'bytes=0-65535' } })
  if (!res.ok) throw new Error(`probe fetch failed: ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const meta = await sharp(buf).metadata()
  return { width: meta.width || null, height: meta.height || null }
}

function probeVideoDimsFromUrl(url) {
  return new Promise((resolve) => {
    const proc = spawn(FFMPEG_BIN, ['-i', url], { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    proc.stderr.on('data', (d) => { stderr += d.toString() })
    proc.on('close', () => {
      const m = stderr.match(/Stream #\d+:\d+(?:\([^)]+\))?:\s*Video:[^\n]*?\s(\d+)x(\d+)/)
      if (m) resolve({ width: parseInt(m[1], 10), height: parseInt(m[2], 10) })
      else resolve({ width: null, height: null })
    })
    proc.on('error', () => resolve({ width: null, height: null }))
  })
}

// Probes the moov-atom location of an MP4/MOV by Range-fetching the first
// ~256 KB of the file and scanning the top-level atom sequence. A `moov`
// atom that appears before `mdat` means the file is faststart (player can
// start streaming immediately). When `moov` is at the tail, the player has
// to download the whole file before playback starts, AND any ffmpeg edit
// that wants to fix this hits the disk-thrash problem (peak ~3x file size).
//
// Returns one of: 'faststart' | 'tail' | 'unknown'. Non-fatal — we just log
// the result so we can decide later whether to remediate via a streaming-pipe
// re-mux at upload time.
async function probeFaststart(url) {
  try {
    const r = await fetch(url, { headers: { Range: 'bytes=0-262143' } })
    if (!r.ok && r.status !== 206) return 'unknown'
    const buf = Buffer.from(await r.arrayBuffer())
    // Top-level MP4 atom walk: each atom is [size:4 BE][type:4 ASCII][...payload].
    // Bail out as soon as we see moov or mdat — whichever appears first wins.
    let off = 0
    while (off + 8 <= buf.length) {
      const size = buf.readUInt32BE(off)
      const type = buf.slice(off + 4, off + 8).toString('ascii')
      if (type === 'moov') return 'faststart'
      if (type === 'mdat') return 'tail'
      // size === 0 → atom extends to EOF. size === 1 → 64-bit size at off+8.
      const step = size === 0
        ? Infinity
        : size === 1 && off + 16 <= buf.length
          ? Number(buf.readBigUInt64BE(off + 8))
          : size
      if (!Number.isFinite(step) || step < 8) break
      off += step
    }
    return 'unknown'
  } catch {
    return 'unknown'
  }
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const body = req.body

  // Only the browser handshake carries a user Bearer token. The completion
  // webhook is platform-to-server; handleUpload verifies it via signature.
  // Resolve the workspace scope at handshake time (req-bound) so it can be
  // baked into tokenPayload — onUploadCompleted runs without req access.
  let scope = null
  if (body?.type === 'blob.generate-client-token') {
    const auth = await requireRole(req, HANDSHAKE_ALLOWED_ROLES)
    if (!auth.ok) {
      return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
    }
    // Rate-limit only the user-initiated handshake. The completion webhook
    // (body.type === 'blob.upload-completed') is platform→server and not
    // attacker-controlled, so capping it would hurt the upload pipeline
    // without reducing abuse surface.
    if (!(await enforceLimit(req, res, 'media'))) return
    scope = await workspaceScope(req)
  }

  try {
    const result = await handleUpload({
      body,
      request: req,

      onBeforeGenerateToken: async (pathname, clientPayload) => {
        // clientPayload is a JSON string the browser opted into sending.
        let meta = {}
        try { meta = clientPayload ? JSON.parse(clientPayload) : {} } catch { /* empty */ }

        return {
          allowedContentTypes: ALLOWED_MIME,
          // Round up to a generous ceiling — Blob enforces account limits anyway.
          maximumSizeInBytes: 500 * 1024 * 1024,
          // tokenPayload is echoed back to onUploadCompleted as a string.
          tokenPayload: JSON.stringify({
            scopeColumn: scope.column,
            scopeId: scope.id,
            filename: meta.filename || pathname.split('/').pop(),
            createdBy: meta.createdBy || null,
            patientPseudonym: meta.patientPseudonym || null,
            condition: meta.condition || null,
            capturedAt: meta.capturedAt || null,
            notes: meta.notes || null,
            assetPurpose: PURPOSES.has(meta.assetPurpose) ? meta.assetPurpose : null,
            speakerRole: meta.speakerRole || null,
            parentId: meta.parentId || null,
            contentPieceId: meta.contentPieceId || null,
          }),
        }
      },

      onUploadCompleted: async ({ blob, tokenPayload }) => {
        let meta = {}
        try { meta = tokenPayload ? JSON.parse(tokenPayload) : {} } catch { /* empty */ }

        const kind = kindFromMime(blob.contentType)
        if (!kind) return  // unknown type → don't record

        // Scope was resolved at handshake time (workspaceScope) and round-tripped
        // via tokenPayload. The completion webhook is platform-to-server and
        // has no req-host to re-resolve from, so a missing scope here means a
        // malformed token — refuse to write rather than guess a workspace.
        const scopeColumn = meta.scopeColumn
        const scopeId = meta.scopeId
        if (!scopeColumn || !scopeId) {
          console.error('media upload: tokenPayload missing scopeColumn/scopeId; refusing to insert row')
          return
        }
        // Fetch the full workspace row by id so the auto-pipeline (tagAsset,
        // segmentInterview) can read prompt fields off scope.workspace. The
        // completion webhook is platform-to-server, so workspaceContext(req)
        // can't resolve from the request host — workspaceById picks it up
        // from the foreign-key id round-tripped through tokenPayload.
        const workspaceRow = await workspaceById(scopeId)
        if (!workspaceRow) {
          console.error(`media upload: workspace ${scopeId} not found or inactive; refusing to insert row`)
          return
        }
        const innerScope = { column: scopeColumn, id: scopeId, workspace: workspaceRow }

        // If this is a return-upload of a finished edit (parentId set), it
        // lands in 'approved' status and is linked to the source. Skips Phase
        // 2/3 auto-pipeline because the contractor has already done the work.
        const isReturnUpload = !!meta.parentId
        const assetPurpose = PURPOSES.has(meta.assetPurpose)
          ? meta.assetPurpose
          : defaultPurpose(kind)
        // speaker_role only carries meaning for interview-purpose uploads.
        // For broll/photo/brand we deliberately store NULL so the segmenter
        // doesn't pick the row up and so MediaDetail can hide the field.
        const speakerRole = assetPurpose === 'interview'
          ? (meta.speakerRole || 'clinician')
          : null
        let probeWidth = null
        let probeHeight = null
        if (kind === 'photo') {
          try {
            const dims = await probeImageDimsFromUrl(blob.url)
            probeWidth = dims.width
            probeHeight = dims.height
          } catch { /* non-fatal */ }
        }

        const row = {
          [scopeColumn]: scopeId,
          kind,
          status: isReturnUpload ? 'approved' : 'raw',
          source: 'upload',
          blob_url: blob.url,
          blob_pathname: blob.pathname,
          filename: meta.filename || blob.pathname.split('/').pop(),
          mime_type: blob.contentType,
          size_bytes: blob.size || null,
          width: probeWidth,
          height: probeHeight,
          patient_pseudonym: meta.patientPseudonym || null,
          condition: meta.condition || null,
          captured_at: meta.capturedAt || null,
          notes: meta.notes || null,
          created_by: meta.createdBy || null,
          asset_purpose: assetPurpose,
          speaker_role: speakerRole,
          clinician_id: (assetPurpose === 'interview' && meta.clinicianId) ? meta.clinicianId : null,
          parent_id: meta.parentId || null,
        }

        const ins = await sb('media_assets', { method: 'POST', body: JSON.stringify(row) })
        if (!ins.ok) {
          // Blob is already uploaded — log but don't throw, otherwise the
          // browser sees a successful upload that didn't get recorded.
          console.error('media_assets insert failed:', ins.status, await ins.text())
          return
        }

        // Handle return-uploads (finished edits) before kicking the pipeline.
        // A return upload links back to its source via parent_id and to its
        // brief via content_piece_id; we patch the brief to status='returned'.
        let insertedRow = null
        try {
          const inserted = await ins.json()
          insertedRow = inserted?.[0]
        } catch { /* empty */ }

        if (isReturnUpload && insertedRow?.id && meta.contentPieceId) {
          try {
            await sb(`content_pieces?id=eq.${meta.contentPieceId}&${scopeColumn}=eq.${scopeId}`, {
              method: 'PATCH',
              body: JSON.stringify({
                final_asset_id: insertedRow.id,
                status: 'returned',
                returned_at: new Date().toISOString(),
              }),
            })
          } catch (e) {
            console.error('Brief link-up after return-upload failed:', e?.message)
          }
          return  // skip auto-pipeline; finished media doesn't need re-tagging
        }

        // Auto-kick the Phase 2 → Phase 3 pipeline. waitUntil keeps the
        // function alive while it runs in the background; the Blob completion
        // webhook still returns immediately to the platform.
        //
        //   tag (Phase 2) → segment into content_pieces (Phase 3, video only)
        try {
          if (insertedRow?.id) {
            // Record the upload in the audit log. actor comes from the token
            // payload (created_by), since the Blob completion webhook doesn't
            // carry the original user's session.
            waitUntil(recordAudit({
              assetId: insertedRow.id,
              action:  'upload',
              actor:   meta.createdBy || 'unknown',
              before:  null,
              after:   snapshot(insertedRow),
              scope:   innerScope,
            }).catch((e) => console.error('Audit record failed:', e?.message)))

            // Auto-pipeline: tag (Phase 2) → segment into content_pieces
            // (Phase 3, interview videos only). tagAndPersist's own audit
            // row writes inside _lib/tagAsset.js.
            //
            // Segmentation is gated on asset_purpose='interview' because the
            // segmenter prompt assumes spoken narrative + speaker role and
            // produces nonsense for B-roll / facility photos / brand assets.
            // Those still get AI tags (useful for search), just not edit
            // briefs in the content queue.
            waitUntil(
              tagAndPersist(insertedRow, innerScope)
                .then((tagged) => {
                  if (tagged?.kind !== 'video') return
                  if (tagged?.asset_purpose !== 'interview') return
                  const hasSpeech = tagged?.transcription?.trim()
                  const hasVisual = tagged?.visual_narrative?.trim()
                  if (hasSpeech || hasVisual) return segmentAndPersist(tagged, innerScope)
                })
                .catch((e) => console.error('Auto-pipeline failed:', e?.message)),
            )

            // Poster-frame extraction runs in parallel with tagging — neither
            // depends on the other, and a thumbnail is the user-visible signal
            // in the Media Hub grid even when AI tagging fails.
            if (insertedRow.kind === 'video') {
              waitUntil(
                generateAndPersistThumbnail(insertedRow, innerScope)
                  .catch((e) => console.error('Thumbnail generation failed:', e?.message)),
              )
              waitUntil(
                probeVideoDimsFromUrl(blob.url)
                  .then(({ width, height }) => {
                    if (!width || !height) return
                    return sb(`media_assets?id=eq.${insertedRow.id}&${scopeColumn}=eq.${scopeId}`, {
                      method: 'PATCH',
                      body: JSON.stringify({ width, height }),
                    })
                  })
                  .catch((e) => console.error('Video dimension probe failed:', e?.message)),
              )
              // Faststart probe — observability only for now. A "tail" result
              // means the moov atom is at the end of the file, which both
              // hurts playback start-latency and would blow /tmp if a later
              // edit tried to re-add +faststart. When we add a streaming-pipe
              // re-mux ("upload-time normalize"), this is the signal to fire.
              waitUntil(
                probeFaststart(blob.url)
                  .then((status) => {
                    if (status === 'tail') {
                      console.warn(
                        `[upload] non-faststart video uploaded id=${insertedRow.id} size=${blob.size} — playback start latency will be slow until normalize lands`,
                      )
                    } else if (status === 'unknown') {
                      console.warn(`[upload] faststart probe inconclusive id=${insertedRow.id}`)
                    }
                  })
                  .catch((e) => console.error('Faststart probe failed:', e?.message)),
              )
            }
          }
        } catch (e) {
          console.error('Auto-pipeline dispatch error:', e?.message)
        }
      },
    })

    return res.status(200).json(result)
  } catch (e) {
    return res.status(400).json({ error: e.message || 'Upload handler failed' })
  }
}

export default withSentry(handler)

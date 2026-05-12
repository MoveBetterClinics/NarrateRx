import { withSentry } from '../_lib/sentry.js'
import { handleUpload } from '@vercel/blob/client'
import { waitUntil } from '@vercel/functions'
import { tagAndPersist } from '../_lib/tagAsset.js'
import { segmentAndPersist } from '../_lib/segmentInterview.js'
import { generateAndPersistThumbnail } from '../_lib/thumbnail.js'
import { recordAudit, snapshot } from '../_lib/audit.js'
import { requireRole } from '../_lib/auth.js'
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

const HANDSHAKE_ALLOWED_ROLES = ['admin', 'editor', 'clinician']

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
        try { meta = clientPayload ? JSON.parse(clientPayload) : {} } catch {}

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
            speakerRole: meta.speakerRole || null,
            parentId: meta.parentId || null,
            contentPieceId: meta.contentPieceId || null,
          }),
        }
      },

      onUploadCompleted: async ({ blob, tokenPayload }) => {
        let meta = {}
        try { meta = tokenPayload ? JSON.parse(tokenPayload) : {} } catch {}

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
          patient_pseudonym: meta.patientPseudonym || null,
          condition: meta.condition || null,
          captured_at: meta.capturedAt || null,
          notes: meta.notes || null,
          created_by: meta.createdBy || null,
          speaker_role: meta.speakerRole || 'clinician',
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
        } catch {}

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
            // (Phase 3, video only). tagAndPersist's own audit row writes
            // inside _lib/tagAsset.js.
            waitUntil(
              tagAndPersist(insertedRow, innerScope)
                .then((tagged) => {
                  if (tagged?.kind !== 'video') return
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

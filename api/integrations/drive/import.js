import { withSentry } from '../../_lib/sentry.js'
import { spawn } from 'node:child_process'
import { createReadStream, createWriteStream } from 'node:fs'
import { stat, unlink, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { put } from '@vercel/blob'
import { waitUntil } from '@vercel/functions'
import sharp from 'sharp'
import ffmpegStaticPath from 'ffmpeg-static'
import { requireRole } from '../../_lib/auth.js'
import { ALL_KNOWN_ROLES } from '../../_lib/roles.js'
import { workspaceContext } from '../../_lib/workspaceContext.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { DriveAuthError } from '../../_lib/driveAuth.js'
import { getDriveFile, downloadDriveFile } from '../../_lib/driveClient.js'
import { tagAndPersist } from '../../_lib/tagAsset.js'
import { segmentAndPersist } from '../../_lib/segmentInterview.js'
import { generateAndPersistThumbnail } from '../../_lib/thumbnail.js'
import { processImageUpload } from '../../_lib/imagePipeline.js'
import { recordAudit, snapshot } from '../../_lib/audit.js'

// POST /api/integrations/drive/import
// Body: { items: [{ id, assetPurpose?, speakerRole?, staffId?, collectionId? }, ...] }
//
// Server-side import: download each selected Drive file to /tmp (streamed, no
// arrayBuffer per CLAUDE.md large-file rule), upload to Vercel Blob, insert
// the media_assets row, then kick the standard auto-pipeline (tag → segment
// → thumbnail) via waitUntil.
//
// Returns per-item status so the picker UI can show "Imported" / "Skipped
// (duplicate)" / "Failed (…)" right next to each selected row.
//
// Cap of 10 items per request keeps each invocation comfortably inside the
// 300s function ceiling for typical clinic media (mostly ≤ 50 MB images,
// occasional 500 MB videos). Larger batches should be chunked client-side.

export const config = { runtime: 'nodejs', maxDuration: 300 }

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const FFMPEG_BIN = process.env.FFMPEG_PATH || ffmpegStaticPath || 'ffmpeg'

const MAX_ITEMS_PER_REQUEST = 10
const MAX_BYTES_PER_FILE = 500 * 1024 * 1024
const PURPOSES = new Set(['interview', 'broll', 'photo', 'brand'])
const SPEAKER_ROLES = new Set(['clinician', 'admin', 'patient_guest'])

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

function kindFromMime(mime) {
  if (!mime) return null
  if (mime.startsWith('image/')) return 'photo'
  if (mime.startsWith('video/')) return 'video'
  return null
}

function defaultPurpose(kind) {
  return kind === 'video' ? 'interview' : 'photo'
}

function safeFilename(name, fallback) {
  const base = String(name || fallback || 'drive-import')
  return base.replace(/[/\\?%*:|"<>]/g, '-').slice(0, 200)
}

async function existingAssetByDriveId(workspaceId, driveId) {
  const url =
    `${SUPABASE_URL}/rest/v1/media_assets` +
    `?workspace_id=eq.${encodeURIComponent(workspaceId)}` +
    `&source=eq.drive&drive_id=eq.${encodeURIComponent(driveId)}` +
    `&select=id,blob_url,kind,filename&limit=1`
  const r = await fetch(url, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  })
  if (!r.ok) return null
  const rows = await r.json().catch(() => null)
  return Array.isArray(rows) && rows[0] ? rows[0] : null
}

async function probeImageDims(localPath) {
  try {
    const meta = await sharp(localPath).metadata()
    return { width: meta.width || null, height: meta.height || null }
  } catch {
    return { width: null, height: null }
  }
}

function probeVideoDims(localPath) {
  return new Promise((resolve) => {
    const proc = spawn(FFMPEG_BIN, ['-i', localPath], { stdio: ['ignore', 'ignore', 'pipe'] })
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

async function importOne({ workspaceId, item, createdBy }) {
  const { id: driveId } = item
  if (!driveId) return { id: null, status: 'failed', reason: 'missing-id' }

  // Idempotency check first — duplicate imports return a clean "already in
  // Library" hint instead of re-running the pipeline. The unique index on
  // (workspace_id, drive_id) where source='drive' is the hard guarantee;
  // this lookup is the friendly UX layer.
  const existing = await existingAssetByDriveId(workspaceId, driveId)
  if (existing) {
    return {
      id: existing.id,
      status: 'duplicate',
      driveId,
      filename: existing.filename,
    }
  }

  let meta
  try {
    meta = await getDriveFile({ workspaceId, fileId: driveId, fields: 'id,name,mimeType,size,createdTime' })
  } catch (e) {
    if (e instanceof DriveAuthError) throw e
    return { id: null, status: 'failed', reason: `drive-meta: ${e?.message || e?.status}`, driveId }
  }

  const kind = kindFromMime(meta.mimeType)
  if (!kind) {
    return { id: null, status: 'failed', reason: `unsupported mime: ${meta.mimeType}`, driveId }
  }
  const declaredSize = meta.size ? Number(meta.size) : null
  if (declaredSize && declaredSize > MAX_BYTES_PER_FILE) {
    return {
      id: null,
      status: 'failed',
      reason: `file too large (${Math.round(declaredSize / (1024 * 1024))} MB, max ${MAX_BYTES_PER_FILE / (1024 * 1024)} MB)`,
      driveId,
    }
  }

  // Stream Drive → /tmp. We need the bytes on disk twice: once to upload to
  // Blob, once to probe dimensions. Streaming avoids materializing the
  // whole file in RAM (which OOMs on anything over ~500 MB per CLAUDE.md
  // large-file rule).
  const dir = await mkdtemp(join(tmpdir(), 'drive-import-'))
  const filename = safeFilename(meta.name, `drive-${driveId}`)
  const localPath = join(dir, filename)
  let downloadSize = 0
  try {
    const r = await downloadDriveFile({ workspaceId, fileId: driveId })
    await pipeline(Readable.fromWeb(r.body), createWriteStream(localPath))
    const st = await stat(localPath)
    downloadSize = st.size
    if (downloadSize > MAX_BYTES_PER_FILE) {
      throw new Error(`downloaded ${downloadSize} bytes exceeds ${MAX_BYTES_PER_FILE} cap`)
    }
  } catch (e) {
    await unlink(localPath).catch(() => {})
    if (e instanceof DriveAuthError) throw e
    return { id: null, status: 'failed', reason: `download: ${e?.message}`, driveId }
  }

  // Probe dimensions before uploading so the row carries width/height on
  // first insert. Failures are non-fatal — the auto-pipeline will fill in
  // what it can later.
  const dims = kind === 'photo'
    ? await probeImageDims(localPath)
    : await probeVideoDims(localPath)

  // Workspace-prefixed pathname matches the convention used by the direct
  // upload pipeline (media/raw/<slug>/...). The exact slug isn't required —
  // we only need a stable namespace per workspace so the legacy blob
  // backfill scripts continue to work.
  const pathname = `media/drive/${workspaceId}/${Date.now()}-${filename}`
  let putResult
  try {
    putResult = await put(pathname, createReadStream(localPath), {
      access: 'public',
      addRandomSuffix: true,
      contentType: meta.mimeType,
      // Multipart uploads chunk large files and retry failed parts. Below
      // ~10 MB the overhead isn't worth it.
      multipart: downloadSize > 10 * 1024 * 1024,
    })
  } catch (e) {
    await unlink(localPath).catch(() => {})
    return { id: null, status: 'failed', reason: `blob-put: ${e?.message}`, driveId }
  } finally {
    await unlink(localPath).catch(() => {})
  }

  const assetPurpose = PURPOSES.has(item.assetPurpose) ? item.assetPurpose : defaultPurpose(kind)
  const speakerRole = assetPurpose === 'interview'
    ? (SPEAKER_ROLES.has(item.speakerRole) ? item.speakerRole : 'clinician')
    : null

  const row = {
    workspace_id: workspaceId,
    kind,
    status: 'raw',
    source: 'drive',
    drive_id: driveId,
    blob_url: putResult.url,
    blob_pathname: putResult.pathname,
    filename: meta.name || filename,
    mime_type: meta.mimeType,
    size_bytes: downloadSize || declaredSize || null,
    width: dims.width,
    height: dims.height,
    captured_at: meta.createdTime || null,
    asset_purpose: assetPurpose,
    speaker_role: speakerRole,
    staff_id: typeof item.staffId === 'string' && item.staffId ? item.staffId : null,
    created_by: createdBy || null,
    notes: 'Imported from Google Drive',
  }

  const ins = await sb('media_assets', { method: 'POST', body: JSON.stringify(row) })
  if (!ins.ok) {
    const text = await ins.text().catch(() => '')
    // Unique-index violation = the same Drive ID got imported by a parallel
    // request between our existence check and this insert. Return as duplicate
    // for a clean UX instead of surfacing a generic DB error.
    if (ins.status === 409) {
      const dup = await existingAssetByDriveId(workspaceId, driveId)
      if (dup) return { id: dup.id, status: 'duplicate', driveId, filename: dup.filename }
    }
    return { id: null, status: 'failed', reason: `insert: ${ins.status} ${text.slice(0, 120)}`, driveId }
  }

  let inserted = null
  try {
    const json = await ins.json()
    inserted = Array.isArray(json) ? json[0] : null
  } catch { /* empty */ }
  if (!inserted?.id) {
    return { id: null, status: 'failed', reason: 'insert returned no row', driveId }
  }

  // Optional collection assignment — verify workspace membership the same
  // way the upload-completion webhook does.
  if (typeof item.collectionId === 'string' && item.collectionId) {
    try {
      const verify = await sb(
        `collections?id=eq.${encodeURIComponent(item.collectionId)}&workspace_id=eq.${workspaceId}&select=id&limit=1`,
      )
      const rows = verify.ok ? await verify.json().catch(() => []) : []
      if (rows.length === 1) {
        await sb('collection_items', {
          method: 'POST',
          body: JSON.stringify({
            collection_id: item.collectionId,
            asset_id: inserted.id,
            added_by: createdBy || null,
          }),
        })
      }
    } catch (e) {
      console.warn('[drive/import] collection link failed:', e?.message)
    }
  }

  return { inserted, row: inserted }
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method-not-allowed' })
  }

  const workspace = await workspaceContext(req)
  if (!workspace) return res.status(404).json({ error: 'no-workspace-context' })

  const auth = await requireRole(req, ALL_KNOWN_ROLES, { orgId: workspace.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  if (!(await enforceLimit(req, res, 'media'))) return

  const body = req.body || {}
  const items = Array.isArray(body.items) ? body.items : null
  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'items-required' })
  }
  if (items.length > MAX_ITEMS_PER_REQUEST) {
    return res.status(400).json({
      error: 'too-many-items',
      message: `Import at most ${MAX_ITEMS_PER_REQUEST} files per request (chunk client-side).`,
    })
  }

  // Sequential per-request — parallel downloads in a single function would
  // race for /tmp space (Vercel default is ~500 MB ephemeral disk) and burn
  // memory if all 10 items happen to be 50 MB videos. The browser can
  // parallelize across multiple requests if it wants higher throughput.
  const innerScope = { column: 'workspace_id', id: workspace.id, workspace }
  const results = []
  for (const item of items) {
    try {
      const r = await importOne({
        workspaceId: workspace.id,
        item,
        createdBy: auth.userId || null,
      })
      if (r.inserted) {
        const inserted = r.inserted
        results.push({
          status: 'imported',
          driveId: item.id,
          id: inserted.id,
          asset: {
            id: inserted.id,
            filename: inserted.filename,
            kind: inserted.kind,
            blob_url: inserted.blob_url,
            mime_type: inserted.mime_type,
          },
        })

        // Audit + auto-pipeline mirrors api/media/upload.js.
        waitUntil(recordAudit({
          assetId: inserted.id,
          action: 'upload',
          actor: auth.userId || 'drive-import',
          before: null,
          after: snapshot(inserted),
          scope: innerScope,
        }).catch((e) => console.error('[drive/import] audit failed:', e?.message)))

        waitUntil(
          tagAndPersist(inserted, innerScope)
            .then((tagged) => {
              if (tagged?.kind !== 'video') return
              if (tagged?.asset_purpose !== 'interview') return
              const hasSpeech = tagged?.transcription?.trim()
              const hasVisual = tagged?.visual_narrative?.trim()
              if (hasSpeech || hasVisual) return segmentAndPersist(tagged, innerScope)
            })
            .catch((e) => console.error('[drive/import] auto-pipeline failed:', e?.message)),
        )

        if (inserted.kind === 'video') {
          waitUntil(
            generateAndPersistThumbnail(inserted, innerScope)
              .catch((e) => console.error('[drive/import] thumbnail failed:', e?.message)),
          )
        }

        // Image pipeline — sharp resize + HEIC→JPEG + AI alt-text. Mirrors
        // api/media/upload.js so Drive-imported photos get the same hybrid
        // storage shape (original_blob_url + web_blob_url) as direct uploads.
        // No-op for videos.
        if (inserted.kind === 'photo') {
          waitUntil(
            processImageUpload({
              assetId: inserted.id,
              blobUrl: inserted.blob_url,
              declaredMime: inserted.mime_type,
            })
              .then(async (result) => {
                if (!result) return
                const patch = {
                  original_blob_url: result.originalBlobUrl,
                  web_blob_url:      result.webBlobUrl,
                  web_width:         result.webWidth,
                  web_height:        result.webHeight,
                  blob_url:          result.webBlobUrl,
                  mime_type:         result.webMime,
                  size_bytes:        result.webSizeBytes,
                  width:             result.webWidth,
                  height:            result.webHeight,
                }
                if (result.altText && !inserted.alt_text) patch.alt_text = result.altText
                await sb(
                  `media_assets?id=eq.${inserted.id}&workspace_id=eq.${workspace.id}`,
                  { method: 'PATCH', body: JSON.stringify(patch) },
                )
              })
              .catch((e) => console.error('[drive/import] image pipeline failed:', e?.message)),
          )
        }
      } else {
        results.push(r)
      }
    } catch (e) {
      if (e instanceof DriveAuthError) {
        // No more imports will succeed without reconnect — bail with whatever
        // we've collected so far and let the UI prompt the admin.
        return res.status(412).json({
          error: e.code,
          message: e.message,
          results,
        })
      }
      console.error('[drive/import] item exception:', e?.message)
      results.push({ status: 'failed', driveId: item.id, reason: e?.message || 'unknown' })
    }
  }

  return res.status(200).json({ results })
}

export default withSentry(handler)

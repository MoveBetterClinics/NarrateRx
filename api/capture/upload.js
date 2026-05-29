// POST /api/capture/upload
//
// iOS Capture Companion endpoint. Accepts a raw binary body (image or video),
// uploads to Vercel Blob, creates a media_assets row tagged with
// source='capture_companion', and triggers the existing auto-tag pipeline +
// new visualMemoryIndex in waitUntil.
//
// Auth: Bearer <capture_upload_token> from clinicians.capture_upload_token.
//       Token is per-clinician, 90-day expiry, rotatable from Profile UI.
//
// Query params (set by the iOS Shortcut):
//   filename     — required, original filename (used for blob path + mime hint)
//   capturedAt   — ISO timestamp of when the moment happened (iPhone time)
//   locationHint — optional, free-text room/area label
//   caption      — optional, clinician's quick note about what's in the clip
//
// Response 201: { assetId, blobUrl, status: 'uploaded', kind }
// Errors: 401 (auth), 413 (size), 415 (mime), 500 (blob/db)
//
// Runtime notes:
//   • Node runtime — body parser disabled (raw binary, not JSON).
//   • maxDuration 300s — large videos may take time to stream to Blob.
//   • Behind workspaces.video_pipeline_enabled flag.

export const config = {
  runtime: 'nodejs',
  maxDuration: 300,
  api: { bodyParser: false },
}

import { put as blobPut } from '@vercel/blob'
import { waitUntil } from '@vercel/functions'
import { indexMediaAsset } from '../_lib/visualMemoryIndex.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// Generous cap; will be tuned based on real iPhone capture sizes during dogfood.
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024 // 200 MB

const ALLOWED_IMAGE_MIME = new Set([
  'image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp', 'image/gif',
])
const ALLOWED_VIDEO_MIME = new Set([
  'video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v',
])

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

function dbErr(res, r, msg) {
  // Mirrors api/db/*.js dbErr pattern — opaque public response, full detail in logs.
  const body = r?.statusText || 'db_error'
   
  console.error(`[capture/upload] ${msg}: status=${r?.status} body=${body}`)
  return res.status(500).json({ error: 'db_error' })
}

function mimeFromFilename(filename) {
  if (!filename) return 'application/octet-stream'
  const ext = filename.toLowerCase().split('.').pop()
  const map = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    heic: 'image/heic', heif: 'image/heif', webp: 'image/webp', gif: 'image/gif',
    mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/x-m4v', webm: 'video/webm',
  }
  return map[ext] || 'application/octet-stream'
}

function kindFromMime(mime) {
  if (ALLOWED_IMAGE_MIME.has(mime)) return 'photo'
  if (ALLOWED_VIDEO_MIME.has(mime)) return 'video'
  return null
}

/**
 * Authenticate the Bearer capture_upload_token.
 * Returns the matching clinician + workspace row, or null on failure.
 */
async function authByCaptureToken(token) {
  if (!token || !token.startsWith('cct_')) return null

  const r = await sb(
    `clinicians?capture_upload_token=eq.${encodeURIComponent(token)}` +
      `&select=id,workspace_id,name,user_id,permission_tier,staff_type,capture_upload_token_expires_at`,
  )
  if (!r.ok) return null
  const rows = await r.json()
  const clinician = rows?.[0]
  if (!clinician) return null

  // Expiry check
  if (clinician.capture_upload_token_expires_at) {
    const exp = new Date(clinician.capture_upload_token_expires_at).getTime()
    if (Date.now() > exp) return null
  }

  // Check workspace exists, is active, and has video_pipeline_enabled.
  // status=eq.active guard ensures archived workspaces can't receive uploads
  // from still-valid capture tokens.
  const wr = await sb(
    `workspaces?id=eq.${clinician.workspace_id}&status=eq.active&select=id,slug,video_pipeline_enabled`,
  )
  if (!wr.ok) return null
  const wsRows = await wr.json()
  const workspace = wsRows?.[0]
  if (!workspace?.video_pipeline_enabled) return null

  return { clinician, workspace }
}

async function readBodyToBuffer(req) {
  // Stream the raw binary body. Cap at MAX_UPLOAD_BYTES.
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > MAX_UPLOAD_BYTES) {
      throw new Error('PAYLOAD_TOO_LARGE')
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  // --- Auth ---
  const authHeader = req.headers['authorization'] || ''
  const m = authHeader.match(/^Bearer\s+(.+)$/i)
  if (!m) return res.status(401).json({ error: 'missing_bearer' })
  const token = m[1].trim()

  const auth = await authByCaptureToken(token)
  if (!auth) return res.status(401).json({ error: 'invalid_or_expired_token' })

  // --- Parse query ---
  const url = new URL(req.url, 'http://localhost')
  const filename = url.searchParams.get('filename') || `capture-${Date.now()}.bin`
  const capturedAtParam = url.searchParams.get('capturedAt')
  const capturedAt = capturedAtParam ? new Date(capturedAtParam).toISOString() : new Date().toISOString()
  const locationHint = url.searchParams.get('locationHint') || null
  const caption = url.searchParams.get('caption') || null

  // --- Determine mime + kind ---
  const headerMime = (req.headers['content-type'] || '').split(';')[0].trim()
  const mime = headerMime || mimeFromFilename(filename)
  const kind = kindFromMime(mime)
  if (!kind) {
    return res.status(415).json({ error: 'unsupported_media_type', mime })
  }

  // --- Stream body ---
  let body
  try {
    body = await readBodyToBuffer(req)
  } catch (e) {
    if (e.message === 'PAYLOAD_TOO_LARGE') {
      return res.status(413).json({ error: 'payload_too_large', maxBytes: MAX_UPLOAD_BYTES })
    }
     
    console.error('[capture/upload] body read failed:', e?.message)
    return res.status(500).json({ error: 'body_read_failed' })
  }

  // --- Upload to Blob ---
  const safeFilename = filename.replace(/[^\w.-]/g, '_')
  const blobPathname = `media/capture/${auth.workspace.slug}/${Date.now()}-${safeFilename}`
  let blobResult
  try {
    blobResult = await blobPut(blobPathname, body, {
      access: 'public',
      contentType: mime,
      addRandomSuffix: false,
    })
  } catch (e) {
     
    console.error('[capture/upload] blob put failed:', e?.message)
    return res.status(500).json({ error: 'blob_upload_failed' })
  }

  // --- Insert media_assets row ---
  const insertRes = await sb('media_assets', {
    method: 'POST',
    body: JSON.stringify({
      workspace_id: auth.workspace.id,
      clinician_id: auth.clinician.id,
      kind,
      status: 'raw',
      source: 'capture_companion',
      blob_url: blobResult.url,
      blob_pathname: blobPathname,
      original_blob_url: blobResult.url,
      filename: safeFilename,
      mime_type: mime,
      size_bytes: body.length,
      captured_at: capturedAt,
      asset_purpose: 'capture_moment',
      notes: caption,
      tags: locationHint ? [locationHint] : [],
      created_by: auth.clinician.user_id || null,
    }),
  })

  if (!insertRes.ok) return dbErr(res, insertRes, 'insert_media_asset')
  const rows = await insertRes.json()
  const asset = rows?.[0]
  if (!asset?.id) return res.status(500).json({ error: 'insert_returned_no_row' })

  // --- Update token last-used (best effort) ---
  waitUntil(
    sb(`clinicians?id=eq.${auth.clinician.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ capture_upload_token_last_used_at: new Date().toISOString() }),
    }).catch(() => {}),
  )

  // --- Visual memory index (async, doesn't block response) ---
  // Note: tagAndPersist (the existing auto-tag pipeline) is NOT called here for
  // Phase 1 because that helper is tightly coupled to api/media/upload.js's flow
  // (handles Mux + thumbnails + segmenting interviews). For Phase 1 capture, the
  // simpler path is: store the asset now, run visualMemoryIndex with whatever
  // text fields are present, and let Phase 2's clip-pull AI re-enrich as needed.
  // tagAndPersist integration is a Phase 2 follow-up (see roadmap).
  waitUntil(
    indexMediaAsset({ assetId: asset.id }).catch((e) => {
       
      console.error('[capture/upload] visualMemoryIndex failed:', e?.message)
    }),
  )

  return res.status(201).json({
    assetId: asset.id,
    blobUrl: blobResult.url,
    status: 'uploaded',
    kind,
  })
}

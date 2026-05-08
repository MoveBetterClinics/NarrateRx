import { del as blobDel } from '@vercel/blob'
import { recordAudit, snapshot } from '../_lib/audit.js'

// Runs on Node (Fluid Compute) — @vercel/blob's server bits aren't edge-safe.
// Uses the (req, res) handler shape; req is IncomingMessage with auto-parsed
// req.body for JSON requests.

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

function brandId() {
  return (process.env.BRAND || process.env.VITE_BRAND || 'people').toLowerCase()
}

function sb(path, init = {}) {
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

const SELECT = 'id,brand,kind,status,source,blob_url,blob_pathname,rendered_url,drive_id,filename,mime_type,size_bytes,duration_s,aspect_ratio,width,height,thumbnail_url,patient_pseudonym,condition,captured_at,tags,ai_tags,transcription,notes,content_item_ids,created_at,updated_at,created_by'

async function fetchRow(where) {
  const r = await sb(`media_assets?${where}&select=${SELECT}`)
  if (!r.ok) return null
  const rows = await r.json()
  return rows[0] || null
}

export default async function handler(req, res) {
  // req.url is a relative path on Node runtime; the base lets URL parse it.
  const url = new URL(req.url, 'http://localhost')
  const id  = url.pathname.split('/').pop()
  if (!id) return res.status(400).json({ error: 'Missing id' })

  // Brand-scope every read & write.
  const where = `id=eq.${id}&brand=eq.${brandId()}`

  if (req.method === 'GET') {
    const r = await sb(`media_assets?${where}&select=${SELECT}`)
    if (!r.ok) return res.status(500).json({ error: 'Database error' })
    const data = await r.json()
    return res.status(200).json(data[0] ?? null)
  }

  if (req.method === 'PATCH') {
    const patch = req.body || {}
    const allowed = {
      status:            patch.status,
      tags:              patch.tags,
      ai_tags:           patch.aiTags,
      notes:             patch.notes,
      patient_pseudonym: patch.patientPseudonym,
      condition:         patch.condition,
      captured_at:       patch.capturedAt,
      transcription:     patch.transcription,
      duration_s:        patch.durationS,
      aspect_ratio:      patch.aspectRatio,
      width:             patch.width,
      height:            patch.height,
      thumbnail_url:     patch.thumbnailUrl,
      rendered_url:      patch.renderedUrl,
      content_item_ids:  patch.contentItemIds,
    }
    const body = Object.fromEntries(Object.entries(allowed).filter(([, v]) => v !== undefined))

    // Snapshot before so the audit trail captures what changed.
    const before = await fetchRow(where)
    if (!before) return res.status(404).json({ error: 'Not found' })

    const r = await sb(`media_assets?${where}`, { method: 'PATCH', body: JSON.stringify(body) })
    if (!r.ok) return res.status(500).json({ error: 'Update failed' })
    const data = await r.json()
    const after = data[0] ?? null

    await recordAudit({
      assetId: id,
      action:  'edit',
      before:  snapshot(before),
      after:   snapshot(after),
      req,
    })

    return res.status(200).json(after)
  }

  if (req.method === 'DELETE') {
    // Look up first to get full row for the audit snapshot, then delete from
    // Blob, then DB. NB: PR-3 will rewrite this to a soft-delete (status =
    // 'archived') and move blob deletion behind an admin-only purge endpoint.
    const before = await fetchRow(where)
    if (!before) return res.status(404).json({ error: 'Not found' })

    if (before.blob_url) {
      try { await blobDel(before.blob_url) }
      catch (e) { console.error('Blob delete failed:', e.message) }
    }

    const r = await sb(`media_assets?${where}`, { method: 'DELETE' })
    if (!r.ok) return res.status(500).json({ error: 'Delete failed' })

    await recordAudit({
      assetId: id,
      action:  'purge',
      before:  snapshot(before),
      after:   null,
      req,
    })

    return res.status(200).json({ deleted: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}

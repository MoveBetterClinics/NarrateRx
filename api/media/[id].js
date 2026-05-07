import { del as blobDel } from '@vercel/blob'

// Runs on Node (Fluid Compute) — @vercel/blob's server bits aren't edge-safe.

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

const ok  = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
const err = (msg, status = 400)  => new Response(JSON.stringify({ error: msg }), { status, headers: { 'Content-Type': 'application/json' } })

const SELECT = 'id,brand,kind,status,source,blob_url,blob_pathname,rendered_url,drive_id,filename,mime_type,size_bytes,duration_s,aspect_ratio,width,height,thumbnail_url,patient_pseudonym,condition,captured_at,tags,ai_tags,transcription,notes,content_item_ids,created_at,updated_at,created_by'

export default async function handler(req) {
  // Vercel routes [id].js — id is in the URL path. Edge runtime exposes it via the URL.
  const url = new URL(req.url)
  const id  = url.pathname.split('/').pop()
  if (!id) return err('Missing id')

  // Brand-scope every read & write.
  const where = `id=eq.${id}&brand=eq.${brandId()}`

  if (req.method === 'GET') {
    const res = await sb(`media_assets?${where}&select=${SELECT}`)
    if (!res.ok) return err('Database error', 500)
    const data = await res.json()
    return ok(data[0] ?? null)
  }

  if (req.method === 'PATCH') {
    const patch = await req.json()
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

    const res = await sb(`media_assets?${where}`, { method: 'PATCH', body: JSON.stringify(body) })
    if (!res.ok) return err('Update failed', 500)
    const data = await res.json()
    return ok(data[0] ?? null)
  }

  if (req.method === 'DELETE') {
    // Look up first to get blob_pathname, then delete from Blob, then DB.
    const lookup = await sb(`media_assets?${where}&select=blob_pathname,blob_url`)
    if (!lookup.ok) return err('Database error', 500)
    const rows = await lookup.json()
    const row  = rows[0]
    if (!row) return err('Not found', 404)

    if (row.blob_url) {
      try { await blobDel(row.blob_url) }
      catch (e) { console.error('Blob delete failed:', e.message) }
    }

    const res = await sb(`media_assets?${where}`, { method: 'DELETE' })
    if (!res.ok) return err('Delete failed', 500)
    return ok({ deleted: true })
  }

  return err('Method not allowed', 405)
}

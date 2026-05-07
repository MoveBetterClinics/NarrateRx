// Runs on Node (Fluid Compute) for consistency with the other media routes,
// which need Node for @vercel/blob. Uses the (req, res) handler shape — on
// Vercel's Node runtime req is an IncomingMessage, not a Web Request.

import { requireRole } from '../_lib/auth.js'

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
      ...init.headers,
    },
  })
}

const SELECT = 'id,brand,kind,status,source,blob_url,blob_pathname,rendered_url,drive_id,filename,mime_type,size_bytes,duration_s,aspect_ratio,width,height,thumbnail_url,patient_pseudonym,condition,captured_at,tags,ai_tags,transcription,visual_narrative,speaker_role,parent_id,notes,content_item_ids,archived_at,created_at,updated_at,created_by'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const auth = await requireRole(req)
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  // req.url is a relative path on Node runtime; supply a base so URL parses.
  const { searchParams } = new URL(req.url, 'http://localhost')
  const kind        = searchParams.get('kind')         // 'video' | 'photo'
  const status      = searchParams.get('status')       // raw | tagged | rendered | approved | archived
  const search      = searchParams.get('q')            // ilike on filename/notes/condition/patient
  const tag         = searchParams.get('tag')          // contained in tags or ai_tags
  const speakerRole = searchParams.get('speakerRole')  // clinician | admin | patient_guest
  const sources     = searchParams.get('sources')      // 'true' → parent_id IS NULL (sources only)
  const parent      = searchParams.get('parent')       // parent_id for variants of one source
  const limit       = Math.min(parseInt(searchParams.get('limit') || '60'), 200)
  const offset      = parseInt(searchParams.get('offset') || '0')

  // Always brand-scoped.
  let qs = `media_assets?select=${SELECT}&brand=eq.${brandId()}&order=created_at.desc&limit=${limit}&offset=${offset}`
  if (kind)        qs += `&kind=eq.${kind}`
  if (status) {
    qs += `&status=eq.${status}`
  } else {
    // Default view excludes archived assets — they're recoverable from the
    // explicit "Archived" filter, but should not surface in the main library
    // grid where they'd just clutter and tempt accidental "is this still
    // here?" double-action by users.
    qs += `&status=neq.archived`
  }
  if (speakerRole) qs += `&speaker_role=eq.${speakerRole}`
  if (sources === 'true') qs += `&parent_id=is.null`
  if (parent)      qs += `&parent_id=eq.${encodeURIComponent(parent)}`
  if (search) {
    const term = encodeURIComponent(`%${search}%`)
    // PostgREST `or` syntax. Note: jsonb columns can't be ilike'd directly here.
    qs += `&or=(filename.ilike.${term},notes.ilike.${term},condition.ilike.${term},patient_pseudonym.ilike.${term},transcription.ilike.${term})`
  }
  if (tag) {
    // tags is a jsonb array of strings — `cs` (contains) wants a JSON array literal.
    qs += `&tags=cs.${encodeURIComponent(JSON.stringify([tag]))}`
  }

  const r = await sb(qs)
  if (!r.ok) return res.status(500).json({ error: 'Database error' })
  return res.status(200).json(await r.json())
}

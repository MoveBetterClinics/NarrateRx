// Runs on Node (Fluid Compute) for consistency with the other media routes,
// which need Node for @vercel/blob.

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

const ok  = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
const err = (msg, status = 400)  => new Response(JSON.stringify({ error: msg }), { status, headers: { 'Content-Type': 'application/json' } })

const SELECT = 'id,brand,kind,status,source,blob_url,blob_pathname,rendered_url,drive_id,filename,mime_type,size_bytes,duration_s,aspect_ratio,width,height,thumbnail_url,patient_pseudonym,condition,captured_at,tags,ai_tags,transcription,notes,content_item_ids,created_at,updated_at,created_by'

export default async function handler(req) {
  if (req.method !== 'GET') return err('Method not allowed', 405)

  const { searchParams } = new URL(req.url)
  const kind     = searchParams.get('kind')      // 'video' | 'photo'
  const status   = searchParams.get('status')    // raw | tagged | rendered | approved | archived
  const search   = searchParams.get('q')         // ilike on filename/notes/condition/patient
  const tag      = searchParams.get('tag')       // contained in tags or ai_tags
  const limit    = Math.min(parseInt(searchParams.get('limit') || '60'), 200)
  const offset   = parseInt(searchParams.get('offset') || '0')

  // Always brand-scoped.
  let qs = `media_assets?select=${SELECT}&brand=eq.${brandId()}&order=created_at.desc&limit=${limit}&offset=${offset}`
  if (kind)   qs += `&kind=eq.${kind}`
  if (status) qs += `&status=eq.${status}`
  if (search) {
    const term = encodeURIComponent(`%${search}%`)
    // PostgREST `or` syntax. Note: jsonb columns can't be ilike'd directly here.
    qs += `&or=(filename.ilike.${term},notes.ilike.${term},condition.ilike.${term},patient_pseudonym.ilike.${term},transcription.ilike.${term})`
  }
  if (tag) {
    // tags is a jsonb array of strings — `cs` (contains) wants a JSON array literal.
    qs += `&tags=cs.${encodeURIComponent(JSON.stringify([tag]))}`
  }

  const res = await sb(qs)
  if (!res.ok) return err('Database error', 500)
  return ok(await res.json())
}

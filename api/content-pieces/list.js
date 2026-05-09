// List content_pieces (a.k.a. "edit briefs") for the current workspace. Each piece
// is a draft/edit task: AI surfaced a moment from a source media row, and the
// editor reviews/accepts/rejects/returns through this list.
//
// Runs on Node (Fluid Compute). Brand-scoped reads only.

import { requireRole } from '../_lib/auth.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

function workspaceId() {
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

const SELECT =
  'id,brand,source_asset_id,source_trim_start,source_trim_end,source_quote,' +
  'ai_suggested_platform,ai_caption,ai_hashtags,ai_cta_text,ai_reasoning,' +
  'ai_model,ai_generated_at,final_caption,final_hashtags,final_cta_text,' +
  'final_cta_url,target_platform,final_asset_id,status,assigned_to,notes,' +
  'rejected_reason,created_at,updated_at,accepted_at,returned_at,' +
  'published_at,published_target_id'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const auth = await requireRole(req)
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  const { searchParams } = new URL(req.url, 'http://localhost')
  const status      = searchParams.get('status')        // suggested | accepted | rejected | in_progress | returned | published | archived
  const platform    = searchParams.get('platform')      // target_platform filter
  const sourceId    = searchParams.get('sourceId')      // limit to one source asset
  const assignedTo  = searchParams.get('assignedTo')    // email
  const limit       = Math.min(parseInt(searchParams.get('limit') || '60'), 200)
  const offset      = parseInt(searchParams.get('offset') || '0')

  let qs = `content_pieces?select=${SELECT}&brand=eq.${workspaceId()}&order=created_at.desc&limit=${limit}&offset=${offset}`
  if (status)     qs += `&status=eq.${status}`
  if (platform)   qs += `&target_platform=eq.${platform}`
  if (sourceId)   qs += `&source_asset_id=eq.${sourceId}`
  if (assignedTo) qs += `&assigned_to=eq.${encodeURIComponent(assignedTo)}`

  const r = await sb(qs)
  if (!r.ok) return res.status(500).json({ error: 'Database error' })
  return res.status(200).json(await r.json())
}

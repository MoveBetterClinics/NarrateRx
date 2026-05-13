import { withSentry } from '../_lib/sentry.js'
// Runs on Node (Fluid Compute) for consistency with the other media routes,
// which need Node for @vercel/blob. Uses the (req, res) handler shape — on
// Vercel's Node runtime req is an IncomingMessage, not a Web Request.

import { requireRole } from '../_lib/auth.js'
import { workspaceScope } from '../_lib/workspaceScope.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

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

const SELECT_COMMON  = 'id,kind,status,source,blob_url,blob_pathname,rendered_url,drive_id,filename,mime_type,size_bytes,duration_s,aspect_ratio,width,height,thumbnail_url,patient_pseudonym,condition,captured_at,tags,ai_tags,transcription,visual_narrative,asset_purpose,speaker_role,parent_id,notes,alt_text,content_item_ids,archived_at,created_at,updated_at,created_by'
const SELECT_COMPACT = 'id,kind,status,filename,mime_type,size_bytes,blob_url,rendered_url,thumbnail_url'

async function handler(req, res) {
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
  const purpose     = searchParams.get('purpose')      // interview | broll | photo | brand
  const speakerRole = searchParams.get('speakerRole')  // clinician | admin | patient_guest
  const sources     = searchParams.get('sources')      // 'true' → parent_id IS NULL (sources only)
  const parent      = searchParams.get('parent')       // parent_id for variants of one source
  const collectionId = searchParams.get('collectionId')// limit to assets in a given collection
  const compact     = searchParams.get('compact') === 'true'
  const limit       = Math.min(parseInt(searchParams.get('limit') || '60'), 200)
  const offset      = parseInt(searchParams.get('offset') || '0')

  const scope = await workspaceScope(req)

  // Resolve a collection filter into an asset-id whitelist before composing
  // the main query. Two queries instead of a PostgREST embed because the
  // embed syntax fights with the existing or= text-search filter below.
  //
  // collection_items has no workspace_id of its own (tenant scope is inherited
  // via the collection FK), so verify the collection belongs to this workspace
  // before reading its items — otherwise an attacker passing a foreign
  // collection_id can probe membership via response shape, and a future drop
  // of the final workspace_id filter on media_assets would turn this into a
  // real cross-tenant read.
  let collectionAssetIds = null
  if (collectionId) {
    const ownRes = await sb(`collections?id=eq.${encodeURIComponent(collectionId)}&${scope.column}=eq.${scope.id}&select=id&limit=1`)
    if (!ownRes.ok) return res.status(500).json({ error: 'Database error' })
    const ownRows = await ownRes.json()
    if (!ownRows[0]) return res.status(200).json([])
    const ciRes = await sb(`collection_items?collection_id=eq.${encodeURIComponent(collectionId)}&select=asset_id`)
    if (!ciRes.ok) return res.status(500).json({ error: 'Database error' })
    const ciRows = await ciRes.json()
    collectionAssetIds = ciRows.map((r) => r.asset_id)
    if (collectionAssetIds.length === 0) return res.status(200).json([])
  }
  const SELECT = `${scope.column},${compact ? SELECT_COMPACT : SELECT_COMMON}`

  // Always workspace-scoped.
  let qs = `media_assets?select=${SELECT}&${scope.column}=eq.${scope.id}&order=created_at.desc&limit=${limit}&offset=${offset}`
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
  if (purpose && ['interview', 'broll', 'photo', 'brand'].includes(purpose)) {
    qs += `&asset_purpose=eq.${purpose}`
  }
  if (speakerRole) qs += `&speaker_role=eq.${speakerRole}`
  if (sources === 'true') qs += `&parent_id=is.null`
  if (parent)      qs += `&parent_id=eq.${encodeURIComponent(parent)}`
  if (collectionAssetIds) {
    qs += `&id=in.(${collectionAssetIds.map(encodeURIComponent).join(',')})`
  }
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

export default withSentry(handler)

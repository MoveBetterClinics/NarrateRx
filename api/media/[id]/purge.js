import { withSentry } from '../../_lib/sentry.js'
import { del as blobDel } from '@vercel/blob'
import { recordAudit, snapshot } from '../../_lib/audit.js'
import { requireRole } from '../../_lib/auth.js'
import { workspaceScope } from '../../_lib/workspaceScope.js'

// Hard delete (purge) for an archived media asset.
//
// Routing: POST /api/media/:id/purge
// Gates (in order — every one of these must be true to proceed):
//   1. Caller's Clerk role is 'admin'.
//   2. Asset exists and is workspace-scoped to this deployment.
//   3. Asset.status === 'archived' AND archived_at is set.
//   4. Now() - archived_at >= 30 days (cooldown).
//   5. Body { confirmFilename } matches asset.filename verbatim.
// Then: blob delete, blob delete (rendered), Supabase row delete, audit 'purge'.
//
// If any gate fails, nothing is mutated and the response explains which gate.
// Audit row is written ONLY on a successful purge — failed attempts are not
// logged here (Clerk's own audit log captures auth failures, and a failed
// gate is an attempted action, not a completed mutation).

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const COOLDOWN_DAYS = 30

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

const SELECT_COMMON = 'id,kind,status,source,blob_url,blob_pathname,rendered_url,drive_id,filename,mime_type,size_bytes,duration_s,aspect_ratio,width,height,thumbnail_url,patient_pseudonym,condition,captured_at,tags,ai_tags,transcription,notes,content_item_ids,archived_at,created_at,updated_at,created_by'

async function fetchRow(where, select) {
  const r = await sb(`media_assets?${where}&select=${select}`)
  if (!r.ok) return null
  const rows = await r.json()
  return rows[0] || null
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Parse the asset id from the URL: /api/media/:id/purge.
  const url = new URL(req.url, 'http://localhost')
  const parts = url.pathname.split('/').filter(Boolean)
  const id = parts[parts.length - 2]
  if (!id) return res.status(400).json({ error: 'Missing id' })

  const scope  = await workspaceScope(req)

  const auth = await requireRole(req, ['admin'], { orgId: scope.workspace.clerk_org_id })
  if (!auth.ok) {
    const status = auth.reason === 'forbidden' ? 403 : 401
    return res.status(status).json({ error: auth.reason })
  }
  const SELECT = `${scope.column},${SELECT_COMMON}`
  const where  = `id=eq.${id}&${scope.column}=eq.${scope.id}`
  const before = await fetchRow(where, SELECT)
  if (!before) return res.status(404).json({ error: 'Not found' })

  if (before.status !== 'archived' || !before.archived_at) {
    return res.status(400).json({ error: 'Must be archived before purge' })
  }

  const archivedMs   = new Date(before.archived_at).getTime()
  const ageDays      = (Date.now() - archivedMs) / 86_400_000
  if (ageDays < COOLDOWN_DAYS) {
    const remaining = Math.ceil(COOLDOWN_DAYS - ageDays)
    return res.status(400).json({
      error: `Cooldown active — ${remaining} day${remaining === 1 ? '' : 's'} remaining before purge`,
      remainingDays: remaining,
    })
  }

  const confirm = req.body?.confirmFilename
  if (typeof confirm !== 'string' || confirm !== before.filename) {
    return res.status(400).json({ error: 'Type the exact filename to confirm purge' })
  }

  // Best-effort blob deletes — if Blob lookup fails (e.g. file already gone),
  // log and continue so the row still gets removed. Order: blobs first, then
  // row, so a row pointing at a missing blob never lingers.
  if (before.blob_url) {
    try { await blobDel(before.blob_url) }
    catch (e) { console.error('[purge] blob_url delete failed:', e?.message) }
  }
  if (before.rendered_url) {
    try { await blobDel(before.rendered_url) }
    catch (e) { console.error('[purge] rendered_url delete failed:', e?.message) }
  }

  const r = await sb(`media_assets?${where}`, { method: 'DELETE' })
  if (!r.ok) return res.status(500).json({ error: 'Purge failed' })

  await recordAudit({
    assetId: id,
    action:  'purge',
    before:  snapshot(before),
    after:   null,
    req,
    scope,
  })

  return res.status(200).json({ purged: true })
}

export default withSentry(handler)

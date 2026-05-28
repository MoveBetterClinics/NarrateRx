// Create or update a campaign. Admin-only.
//
// POST body: {
//   id?, name, description?, status?, target_clinician_ids,
//   // Phase 4 Tentpole PR A — time-windowed multi-campaign fields:
//   start_at?, end_at?, event_at?,            // ISO timestamps; null = no constraint
//   theme_notes?,                              // freeform what-this-is-about
//   content_style?,                            // 'clinical' | 'promotional' | 'relationship'
//   cta_url?, cta_label?, cta_pitch?,          // structured CTA fields
// }
//   - If id is present → UPDATE (workspace-scoped).
//   - Else → INSERT (workspace_id from request context, created_by from auth).
//
// Node runtime + (req, res) shape.

export const config = { runtime: 'nodejs' }

import { requireRole, requireCapability } from '../_lib/auth.js'
import { ALL_KNOWN_ROLES } from '../_lib/roles.js'
import { CAP_CAMPAIGNS_EDIT } from '../_lib/capabilities.js'
import { workspaceContext } from '../_lib/workspaceContext.js'
import { enforceLimit } from '../_lib/ratelimit.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

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

async function dbErr(res, r, msg = 'Database error', status = 500) {
  const body = await r.text().catch(() => '')
  console.error(`[campaigns/upsert] ${msg} — supabase ${r.status}: ${body.slice(0, 500)}`)
  return res.status(status).json({ error: msg })
}

const ALLOWED_STATUS = new Set(['active', 'complete', 'archived'])
const ALLOWED_CONTENT_STYLE = new Set(['clinical', 'promotional', 'relationship'])

// Coerce body field → ISO timestamp string or null. Accepts:
//   - undefined → returns 'leave-alone' (the field is omitted from the patch)
//   - null      → returns null (clears the field)
//   - ISO/parseable string → returns ISO string
//   - bad input → returns 'invalid'
function coerceTimestamp(v) {
  if (v === undefined) return 'leave-alone'
  if (v === null || v === '') return null
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return 'invalid'
  return d.toISOString()
}

// Coerce body field → trimmed string or null. Same 'leave-alone' sentinel.
function coerceText(v, max = 5000) {
  if (v === undefined) return 'leave-alone'
  if (v === null) return null
  const s = String(v).trim()
  if (!s) return null
  return s.slice(0, max)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (!(await enforceLimit(req, res, 'default'))) return

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })

  // Phase 4 PR 4: producer-friendly gate. Pass any workspace member through
  // the JWT/org check, then enforce CAP_CAMPAIGNS_EDIT (producer has it by
  // default template; clinicians + viewers do not).
  const auth = await requireRole(req, ALL_KNOWN_ROLES, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }
  const capAuth = await requireCapability(req, ws, [CAP_CAMPAIGNS_EDIT])
  if (!capAuth.ok) {
    return res.status(403).json({ error: capAuth.reason, missing: capAuth.missing })
  }

  const body = req.body || {}
  const id = body.id ? String(body.id) : null
  const name = String(body.name || '').trim()
  if (!name) return res.status(400).json({ error: 'name required' })

  const description = body.description ? String(body.description) : null
  const status = ALLOWED_STATUS.has(body.status) ? body.status : 'active'

  const rawTargets = Array.isArray(body.target_clinician_ids) ? body.target_clinician_ids : []
  // Force every element to a string; reject anything obviously non-uuidish so the
  // PostgREST insert doesn't fail with a cryptic 22P02. Keeps the public error
  // response tidy ("invalid clinician id") instead of "Database error".
  const target_clinician_ids = rawTargets
    .map((v) => (v == null ? '' : String(v)))
    .filter((v) => /^[0-9a-f-]{8,}$/i.test(v))

  // Phase 4 Tentpole PR A — multi-campaign fields. Each uses the
  // 'leave-alone' sentinel so omitting from PATCH body doesn't clobber
  // existing values, while explicit null clears them.
  const start_at      = coerceTimestamp(body.start_at)
  const end_at        = coerceTimestamp(body.end_at)
  const event_at      = coerceTimestamp(body.event_at)
  const theme_notes   = coerceText(body.theme_notes, 4000)
  const cta_url       = coerceText(body.cta_url, 500)
  const cta_label     = coerceText(body.cta_label, 80)
  const cta_pitch     = coerceText(body.cta_pitch, 500)

  if (start_at === 'invalid') return res.status(400).json({ error: 'invalid start_at' })
  if (end_at === 'invalid')   return res.status(400).json({ error: 'invalid end_at' })
  if (event_at === 'invalid') return res.status(400).json({ error: 'invalid event_at' })

  // Cross-field validation: if both start_at and end_at are concrete strings,
  // end must come after start. (One being null is fine.)
  if (typeof start_at === 'string' && typeof end_at === 'string'
      && new Date(end_at).getTime() <= new Date(start_at).getTime()) {
    return res.status(400).json({ error: 'end_at must be after start_at' })
  }

  let content_style = 'leave-alone'
  if (body.content_style !== undefined) {
    if (!ALLOWED_CONTENT_STYLE.has(body.content_style)) {
      return res.status(400).json({ error: 'invalid content_style' })
    }
    content_style = body.content_style
  }

  // Apply each multi-campaign field only when it isn't the 'leave-alone' sentinel.
  function applyMulti(target) {
    if (start_at !== 'leave-alone') target.start_at = start_at
    if (end_at !== 'leave-alone')   target.end_at = end_at
    if (event_at !== 'leave-alone') target.event_at = event_at
    if (theme_notes !== 'leave-alone') target.theme_notes = theme_notes
    if (cta_url !== 'leave-alone')  target.cta_url = cta_url
    if (cta_label !== 'leave-alone') target.cta_label = cta_label
    if (cta_pitch !== 'leave-alone') target.cta_pitch = cta_pitch
    if (content_style !== 'leave-alone') target.content_style = content_style
  }

  if (id) {
    // UPDATE — scoped to this workspace so a stale id can't cross-tenant write.
    const patch = { name, description, status, target_clinician_ids }
    applyMulti(patch)
    const r = await sb(
      `campaigns?id=eq.${encodeURIComponent(id)}&workspace_id=eq.${ws.id}`,
      { method: 'PATCH', body: JSON.stringify(patch) },
    )
    if (!r.ok) return dbErr(res, r, 'Update failed')
    const data = await r.json()
    if (!Array.isArray(data) || data.length === 0) {
      return res.status(404).json({ error: 'Campaign not found' })
    }
    return res.status(200).json(data[0])
  }

  // INSERT
  const row = {
    workspace_id: ws.id,
    name,
    description,
    status,
    target_clinician_ids,
    created_by: auth.userId || null,
  }
  applyMulti(row)
  const r = await sb('campaigns', { method: 'POST', body: JSON.stringify(row) })
  if (!r.ok) return dbErr(res, r, 'Insert failed')
  const data = await r.json()
  return res.status(201).json(data[0] ?? null)
}

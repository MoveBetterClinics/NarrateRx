// GET  /api/clinicians/campaign-settings?clinician_id=<uuid>
// PATCH /api/clinicians/campaign-settings?clinician_id=<uuid>  body: object | null
//
// Per-clinician campaign override. Stored as JSONB on clinicians.campaign_settings:
//   { mode, notes, cta_url, cta_label, cta_pitch, event_at }
//
// NULL = "use workspace default" (cleared via PATCH with body { settings: null }
// or { use_default: true }).
//
// Permissions:
//   - GET: any authenticated workspace member (transparency — anyone can see
//          who's pushing what in this workspace's content stream)
//   - PATCH: the clinician themselves (clinicians.user_id matches the JWT sub)
//            OR a workspace admin.
//
// Tenant isolation: workspace resolved from host; every query filters by
// workspace_id; cross-workspace clinician_ids return 404 (not 403, to avoid
// leaking which IDs exist in other workspaces).

export const config = { runtime: 'nodejs' }

import { withSentry } from '../_lib/sentry.js'
import { requireRole } from '../_lib/auth.js'
import { workspaceScope } from '../_lib/workspaceScope.js'
import { enforceLimit } from '../_lib/ratelimit.js'
import { ROLE_ADMIN } from '../_lib/roles.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const ALLOWED_MODES = new Set(['bookings', 'seminars', 'referrals'])

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

async function dbErr(res, r, msg) {
  let body = ''
  try { body = await r.text() } catch { /* ignore */ }
  console.error(`[clinicians/campaign-settings] ${msg} status=${r.status} body=${body.slice(0, 500)}`)
  return res.status(500).json({ error: 'Database error' })
}

// Whitelist the JSONB shape so a malicious client can't dump arbitrary keys
// into the column. Drops unknown keys silently; clamps strings to a sane size.
function sanitizeSettings(raw) {
  if (!raw || typeof raw !== 'object') return null
  if (!raw.mode || !ALLOWED_MODES.has(raw.mode)) return null
  const clamp = (v, max = 2000) => (typeof v === 'string' ? v.slice(0, max) : '')
  const out = {
    mode:      raw.mode,
    notes:     clamp(raw.notes,     2000),
    cta_url:   clamp(raw.cta_url,   500),
    cta_label: clamp(raw.cta_label, 120),
    cta_pitch: clamp(raw.cta_pitch, 400),
    event_at:  raw.event_at && typeof raw.event_at === 'string' ? raw.event_at : null,
  }
  return out
}

async function handler(req, res) {
  const scope = await workspaceScope(req)
  if (!scope?.workspace) {
    return res.status(400).json({ error: 'Workspace not resolved' })
  }
  const workspaceId = scope.id

  const auth = await requireRole(req, null, { orgId: scope.workspace.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  const url = new URL(req.url, 'http://localhost')
  const clinicianId = url.searchParams.get('clinician_id')
  if (!clinicianId) return res.status(400).json({ error: 'Missing clinician_id' })

  // Scope the clinician lookup to this workspace — cross-tenant ids 404.
  // We also need user_id to evaluate the "own override" permission on PATCH.
  const clinRes = await sb(
    `clinicians?id=eq.${clinicianId}&workspace_id=eq.${workspaceId}&select=id,user_id,name,campaign_settings`,
  )
  if (!clinRes.ok) return dbErr(res, clinRes, 'clinician lookup failed')
  const clinRows = await clinRes.json()
  if (!clinRows.length) return res.status(404).json({ error: 'Clinician not found' })
  const clinician = clinRows[0]

  if (req.method === 'GET') {
    return res.status(200).json({
      clinician_id: clinician.id,
      name: clinician.name,
      settings: clinician.campaign_settings || null, // null means using workspace default
    })
  }

  if (req.method === 'PATCH') {
    if (!(await enforceLimit(req, res, 'default'))) return

    // Own-or-admin gate. Admin role passes unconditionally; everyone else
    // must match the clinician.user_id on the row they're editing.
    const isAdmin = auth.role === ROLE_ADMIN
    const isOwner = clinician.user_id && auth.userId && clinician.user_id === auth.userId
    if (!isAdmin && !isOwner) {
      return res.status(403).json({ error: 'forbidden' })
    }

    const body = req.body || {}
    let nextSettings

    if (body.use_default === true || body.settings === null) {
      // Clear override → fall back to workspace default at generation time.
      nextSettings = null
    } else if (body.settings) {
      nextSettings = sanitizeSettings(body.settings)
      if (!nextSettings) {
        return res.status(400).json({ error: 'Invalid settings — mode is required' })
      }
    } else {
      return res.status(400).json({ error: 'Body must include either settings or use_default' })
    }

    const r = await sb(
      `clinicians?id=eq.${clinicianId}&workspace_id=eq.${workspaceId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          campaign_settings: nextSettings,
          updated_at: new Date().toISOString(),
        }),
      },
    )
    if (!r.ok) return dbErr(res, r, 'update failed')
    const rows = await r.json()
    return res.status(200).json({
      clinician_id: clinicianId,
      settings: rows[0]?.campaign_settings ?? null,
    })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}

export default withSentry(handler)

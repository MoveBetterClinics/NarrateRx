import { withSentry } from '../_lib/sentry.js'
export const config = { runtime: 'nodejs' }
// Workspace profile endpoint.
//
// GET  — returns the active workspace row (resolved from Host header). No auth required.
// PATCH — updates tenant-editable fields on the workspace row. Requires Clerk admin role.
//
// 404 when no resolvable workspace (apex, www, preview URL, unknown subdomain).

import { workspaceContext } from '../_lib/workspaceContext.js'
import { requireRole } from '../_lib/auth.js'

// Hard allowlist — only these columns may be patched via this endpoint.
// slug, clerk_org_id, capabilities, status are developer-owned.
const PATCHABLE_FIELDS = new Set([
  'display_name', 'tagline', 'sign_in_blurb',
  'website', 'location', 'region',
  'clinic_context', 'audience_short', 'brand_voice', 'booking_url',
  'internal_links_markdown', 'signature_system_name', 'signature_system_url',
  'social',
  'app_name', 'region_short', 'website_hostname', 'link_preview_blurb',
  'audience_description', 'activity_context',
  'pinterest_boards', 'location_keyword', 'location_hashtag', 'brand_hashtag',
  'spoken_url',
  'enabled_outputs',
  'logo', 'colors', 'brandbook',
  'tone_modifiers',
  'patient_context',
  'interview_context',
  'topic_suggestions',
  'publish_topics',
  'skip_review',
])

const TOPIC_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function sanitizePublishTopics(value) {
  if (value === null || value === undefined) return []
  if (!Array.isArray(value)) return null
  const seen = new Set()
  const out = []
  for (const raw of value) {
    if (typeof raw !== 'string') return null
    const t = raw.trim().toLowerCase()
    if (!t) continue
    if (t.length > 60) return null
    if (!TOPIC_SLUG_RE.test(t)) return null
    if (seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

const TONE_KEYS = ['active', 'clinical', 'warm', 'smart']

// Shape gates for the JSONB paradigm-content columns. We require the
// client to PATCH parsed objects/arrays, not raw strings — Settings UI
// parses its JSON textarea before saving and surfaces parse errors there.
function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function sanitizePatientContext(value) {
  if (value === null || value === undefined) return {}
  if (!isPlainObject(value)) return null
  return value
}

function sanitizeInterviewContext(value) {
  if (value === null || value === undefined) return {}
  if (!isPlainObject(value)) return null
  return value
}

function sanitizeTopicSuggestions(value) {
  if (value === null || value === undefined) return []
  if (!Array.isArray(value)) return null
  return value
}

function sanitizeToneModifiers(value) {
  if (value === null || value === undefined) return {}
  if (typeof value !== 'object' || Array.isArray(value)) return null
  const out = {}
  for (const [k, v] of Object.entries(value)) {
    if (!TONE_KEYS.includes(k)) continue
    if (v === null || v === undefined || v === '') continue
    if (typeof v !== 'string') return null
    out[k] = v
  }
  return out
}

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

async function handler(req, res) {
  if (req.method === 'GET') {
    const workspace = await workspaceContext(req)
    if (!workspace) return res.status(404).json({ error: 'no-workspace-context' })

    // Attach active workspace_locations so the SPA can render the per-post
    // location picker without an extra round trip. Locations are not secret —
    // the same identity (city/region/hashtag) is already interpolated into
    // public-facing copy via prompts. Failing the locations fetch is non-fatal
    // (legacy workspaces with the table absent get [] and degrade to single-
    // location behavior).
    let locations = []
    try {
      const lr = await sb(
        `workspace_locations?workspace_id=eq.${encodeURIComponent(workspace.id)}&status=eq.active&select=*&order=position.asc`
      )
      if (lr.ok) {
        const rows = await lr.json().catch(() => [])
        locations = Array.isArray(rows) ? rows : []
      }
    } catch (e) {
      console.error('[workspace/me] locations fetch failed:', e?.message)
    }

    // Resolve the Brand Kit primary_logo to a URL so the SPA header can render
    // it without a second round trip. Falls back to workspace.logo.main when
    // no role is assigned. Non-fatal on failure — header still has the static
    // logo to fall back to.
    let primary_logo_url = null
    try {
      const lr = await sb(
        `brand_kit_roles?workspace_id=eq.${encodeURIComponent(workspace.id)}&role=eq.primary_logo&select=brand_assets(blob_url)&limit=1`
      )
      if (lr.ok) {
        const rows = await lr.json().catch(() => [])
        primary_logo_url = rows?.[0]?.brand_assets?.blob_url || null
      }
    } catch (e) {
      console.error('[workspace/me] primary_logo fetch failed:', e?.message)
    }

    res.setHeader('Cache-Control', 'private, no-store')
    return res.status(200).json({ ...workspace, locations, primary_logo_url })
  }

  if (req.method === 'PATCH') {
    const workspace = await workspaceContext(req)
    if (!workspace) return res.status(404).json({ error: 'no-workspace-context' })

    const auth = await requireRole(req, ['admin'], { orgId: workspace.clerk_org_id })
    if (!auth.ok) {
      const status = auth.reason === 'forbidden' ? 403 : 401
      return res.status(status).json({ error: auth.reason })
    }

    const body = req.body || {}
    const patch = {}
    for (const [key, value] of Object.entries(body)) {
      if (!PATCHABLE_FIELDS.has(key)) continue
      if (key === 'tone_modifiers') {
        const cleaned = sanitizeToneModifiers(value)
        if (cleaned === null) {
          return res.status(400).json({ error: 'invalid-tone-modifiers' })
        }
        patch.tone_modifiers = cleaned
        continue
      }
      if (key === 'patient_context') {
        const cleaned = sanitizePatientContext(value)
        if (cleaned === null) return res.status(400).json({ error: 'invalid-patient-context' })
        patch.patient_context = cleaned
        continue
      }
      if (key === 'interview_context') {
        const cleaned = sanitizeInterviewContext(value)
        if (cleaned === null) return res.status(400).json({ error: 'invalid-interview-context' })
        patch.interview_context = cleaned
        continue
      }
      if (key === 'topic_suggestions') {
        const cleaned = sanitizeTopicSuggestions(value)
        if (cleaned === null) return res.status(400).json({ error: 'invalid-topic-suggestions' })
        patch.topic_suggestions = cleaned
        continue
      }
      if (key === 'publish_topics') {
        const cleaned = sanitizePublishTopics(value)
        if (cleaned === null) return res.status(400).json({ error: 'invalid-publish-topics' })
        patch.publish_topics = cleaned
        continue
      }
      patch[key] = value
    }
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'no-patchable-fields' })
    }

    let r
    try {
      r = await sb(
        `workspaces?id=eq.${encodeURIComponent(workspace.id)}`,
        {
          method: 'PATCH',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify(patch),
        },
      )
    } catch (e) {
      console.error('[workspace/me PATCH] network error:', e?.message)
      return res.status(500).json({ error: 'db-error' })
    }

    if (!r.ok) {
      const text = await r.text().catch(() => '')
      console.error(`[workspace/me PATCH] supabase ${r.status}:`, text)
      return res.status(500).json({ error: 'db-error' })
    }

    const rows = await r.json().catch(() => null)
    const updated = Array.isArray(rows) ? rows[0] : null
    if (!updated) return res.status(500).json({ error: 'db-error' })
    return res.status(200).json(updated)
  }

  return res.status(405).json({ error: 'method-not-allowed' })
}

export default withSentry(handler)

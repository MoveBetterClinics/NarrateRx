import { withSentry } from '../_lib/sentry.js'
export const config = { runtime: 'nodejs' }
// Workspace profile endpoint.
//
// GET  — returns the active workspace row (resolved from Host header).
//        Unauthenticated callers (or JWTs whose org_id doesn't match this
//        workspace's clerk_org_id) get a slim public-branding shape so the
//        sign-in page can render without leaking tenant-editable fields like
//        brand_voice, patient_context, schedule_prefs, etc. (Audit
//        2026-05-25 item 9.) Authenticated, org-bound callers get the full row.
// PATCH — updates tenant-editable fields on the workspace row. Requires Clerk admin role.
//
// 404 when no resolvable workspace (apex, www, preview URL, unknown subdomain).

import { workspaceContext, invalidateWorkspaceCacheById, invalidateWorkspaceCacheBySlug } from '../_lib/workspaceContext.js'
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
  'audience_options',
  'story_type_options',
  'publish_topics',
  'skip_review',
  'buffer_use_queue',
  'schedule_prefs',
  'realtime_voice_daily_cap_min',
])

// Platforms recognized in schedule_prefs. Mirrors PLATFORM_SCHEDULE_PREFS in
// src/lib/scheduleHeuristics.js. Unknown platforms are silently dropped.
const SCHEDULE_PREF_PLATFORMS = new Set([
  'instagram', 'facebook', 'linkedin', 'blog', 'email',
  'youtube', 'tiktok', 'gbp', 'google_ads', 'instagram_ads', 'landing_page',
])

// Shape: { [platform]: { days: number[], hours: number[] } | null }
// Returns the cleaned object on success, or null on shape error.
function sanitizeSchedulePrefs(value) {
  if (value === null) return null
  if (typeof value !== 'object' || Array.isArray(value)) return null
  const out = {}
  for (const [platform, entry] of Object.entries(value)) {
    if (!SCHEDULE_PREF_PLATFORMS.has(platform)) continue
    if (entry === null) { out[platform] = null; continue }
    if (typeof entry !== 'object' || Array.isArray(entry)) return null
    const { days, hours } = entry
    if (!Array.isArray(days) || days.length === 0 || days.length > 7) return null
    if (!Array.isArray(hours) || hours.length === 0 || hours.length > 24) return null
    const cleanDays = []
    for (const d of days) {
      if (!Number.isInteger(d) || d < 0 || d > 6) return null
      if (!cleanDays.includes(d)) cleanDays.push(d)
    }
    const cleanHours = []
    for (const h of hours) {
      if (!Number.isInteger(h) || h < 0 || h > 23) return null
      if (!cleanHours.includes(h)) cleanHours.push(h)
    }
    cleanDays.sort((a, b) => a - b)
    cleanHours.sort((a, b) => a - b)
    out[platform] = { days: cleanDays, hours: cleanHours }
  }
  return out
}

// Caps for the curated pre-interview slot lists. Must stay in lockstep with
// MAX_CATALOG_SLOTS / MAX_CUSTOM_SLOTS in src/lib/interviewOptionsCatalog.js
// (server doesn't import the SPA module to avoid coupling the API bundle
// to JSX dependencies).
const MAX_CATALOG_SLOTS = 6
const MAX_CUSTOM_SLOTS  = 2
const MAX_SLOT_LABEL_LEN       = 60
const MAX_SLOT_DESCRIPTION_LEN = 120
const SLOT_KEY_RE = /^[a-z][a-z0-9_]{0,40}$/

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

// Shape gate for slot arrays (audience_options / story_type_options).
// Each slot must be { key, label, emoji, description, is_custom }. Caps:
// up to 6 catalog slots + 2 custom slots. Returns the cleaned array on
// success, null on shape violation.
function sanitizeSlotArray(value) {
  if (value === null || value === undefined) return []
  if (!Array.isArray(value)) return null

  let catalogCount = 0
  let customCount  = 0
  const seenKeys = new Set()
  const out = []

  for (const raw of value) {
    if (!isPlainObject(raw)) return null

    const isCustom = !!raw.is_custom
    if (isCustom) {
      if (++customCount > MAX_CUSTOM_SLOTS) return null
    } else {
      if (++catalogCount > MAX_CATALOG_SLOTS) return null
    }

    const key = typeof raw.key === 'string' ? raw.key.trim() : ''
    if (!key || !SLOT_KEY_RE.test(key)) return null
    if (seenKeys.has(key)) return null
    seenKeys.add(key)

    const label = typeof raw.label === 'string' ? raw.label.trim() : ''
    if (!label || label.length > MAX_SLOT_LABEL_LEN) return null

    const emoji = typeof raw.emoji === 'string' ? raw.emoji.trim().slice(0, 8) : ''
    const description = typeof raw.description === 'string'
      ? raw.description.trim().slice(0, MAX_SLOT_DESCRIPTION_LEN)
      : ''

    out.push({ key, label, emoji, description, is_custom: isCustom })
  }

  return out
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

    // Gate the full row behind a Clerk session bound to this workspace's org.
    // Unauth/wrong-org callers get a slim shape (sign-in page branding only).
    // We don't 401 here because the sign-in page itself is unauth and reads
    // app_name / sign_in_blurb from this endpoint to render the panel.
    const auth = await requireRole(req, null, { orgId: workspace.clerk_org_id })
    res.setHeader('Cache-Control', 'private, no-store')

    if (!auth.ok) {
      // Slim public-branding shape. INCLUDES clerk_org_id even though the
      // caller is unauth/wrong-org — it's derived from the host header, not
      // the user's auth state, so disclosing it doesn't leak anything that
      // a curl of the same subdomain wouldn't reveal. The client needs it
      // to recover from a wrong-org-stuck Clerk session (apiFetch reads it
      // from window.__narraterxExpectedClerkOrgId to force a setActive flip
      // — without it, the recovery path silently skips and the user is
      // stranded on a "wrong-org" error screen).
      return res.status(200).json({
        // Discriminator the SPA uses to tell this apart from a sparse full row.
        // If the client sees this true while Clerk reports a signed-in session
        // bound to this workspace's org, it forces a token-refresh refetch —
        // the slim response means the server didn't see a matching JWT.
        slim_branding:    true,
        id:               workspace.id,
        slug:             workspace.slug,
        clerk_org_id:     workspace.clerk_org_id,
        app_name:         workspace.app_name,
        display_name:     workspace.display_name,
        sign_in_blurb:    workspace.sign_in_blurb,
        logo:             workspace.logo,
        colors:           workspace.colors,
      })
    }

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

    // Phase 4: per-workspace permission_tier for the calling user. Drives the
    // producer-restricted UX (nav filtering, default landing redirect). Falls
    // back to null when the user has no clinicians row in this workspace —
    // the client treats null as "no special restriction" so the existing nav
    // shows. Non-fatal on failure.
    let current_user_tier = null
    try {
      const ctr = await sb(
        `clinicians?user_id=eq.${encodeURIComponent(auth.userId)}` +
        `&workspace_id=eq.${encodeURIComponent(workspace.id)}&select=permission_tier&limit=1`
      )
      if (ctr.ok) {
        const rows = await ctr.json().catch(() => [])
        current_user_tier = rows?.[0]?.permission_tier || null
      }
    } catch (e) {
      console.error('[workspace/me] tier fetch failed:', e?.message)
    }

    return res.status(200).json({ ...workspace, locations, primary_logo_url, current_user_tier })
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
      if (key === 'audience_options') {
        const cleaned = sanitizeSlotArray(value)
        if (cleaned === null) return res.status(400).json({ error: 'invalid-audience-options' })
        patch.audience_options = cleaned
        continue
      }
      if (key === 'story_type_options') {
        const cleaned = sanitizeSlotArray(value)
        if (cleaned === null) return res.status(400).json({ error: 'invalid-story-type-options' })
        patch.story_type_options = cleaned
        continue
      }
      if (key === 'publish_topics') {
        const cleaned = sanitizePublishTopics(value)
        if (cleaned === null) return res.status(400).json({ error: 'invalid-publish-topics' })
        patch.publish_topics = cleaned
        continue
      }
      if (key === 'realtime_voice_daily_cap_min') {
        // Accept null (unlimited, ops escalation) or an integer in [0, 1440].
        // 1440 = a full day in minutes; higher than that is functionally
        // equivalent to unlimited and almost certainly a typo. 0 is the
        // "temporarily disable Live Interview" knob.
        if (value === null) { patch.realtime_voice_daily_cap_min = null; continue }
        const n = typeof value === 'number' ? value : parseInt(value, 10)
        if (!Number.isInteger(n) || n < 0 || n > 1440) {
          return res.status(400).json({ error: 'invalid-realtime-voice-daily-cap-min' })
        }
        patch.realtime_voice_daily_cap_min = n
        continue
      }
      if (key === 'schedule_prefs') {
        const cleaned = sanitizeSchedulePrefs(value)
        if (cleaned === null && value !== null) {
          return res.status(400).json({ error: 'invalid-schedule-prefs' })
        }
        patch.schedule_prefs = cleaned
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
    // Drop the in-process workspace cache so the next read on this instance
    // sees the write. Sibling instances still TTL out at 60s; the front-end
    // sees its own write back in the response body so the immediate UI is
    // correct, but freshness on the next GET matters for any other tab.
    invalidateWorkspaceCacheById(workspace.id)
    invalidateWorkspaceCacheBySlug(workspace.slug)
    return res.status(200).json(updated)
  }

  return res.status(405).json({ error: 'method-not-allowed' })
}

export default withSentry(handler)

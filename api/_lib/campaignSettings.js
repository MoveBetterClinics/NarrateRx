// Load the active campaign settings for one content-generation context.
//
// Resolution order:
//   1. Per-clinician override on clinicians.campaign_settings (JSONB,
//      shape: { mode, notes, cta_url, cta_label, cta_pitch, event_at }).
//      Skipped when clinicianId is missing or the JSONB cell is NULL.
//   2. Workspace default on clinic_settings.campaign_* columns.
//   3. Hard default (bookings mode, no CTA override) when both are missing
//      or a DB error occurs — we never throw out of here because callers
//      want the prompt to fall back to its built-in CTAs cleanly.
//
// Used by atom-prompt callers (api/content-plan/draft.js,
// api/content-items/regenerate.js) so every new derivative content piece
// reflects whoever's voice it is. Blog generation does NOT call this.

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const DEFAULT_CAMPAIGN = Object.freeze({
  mode:      'bookings',
  notes:     '',
  cta_url:   '',
  cta_label: '',
  cta_pitch: '',
  event_at:  null,
})

function normalize(src) {
  if (!src || typeof src !== 'object') return null
  // Treat an empty/blank mode as "no override" — guards against a stored
  // {} sneaking past as a phantom override that resolves to bookings.
  if (!src.mode || typeof src.mode !== 'string') return null
  return {
    mode:      src.mode,
    notes:     typeof src.notes     === 'string' ? src.notes     : '',
    cta_url:   typeof src.cta_url   === 'string' ? src.cta_url   : '',
    cta_label: typeof src.cta_label === 'string' ? src.cta_label : '',
    cta_pitch: typeof src.cta_pitch === 'string' ? src.cta_pitch : '',
    event_at:  src.event_at || null,
  }
}

async function sbGet(path) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey:        SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  })
}

async function loadClinicianOverride(clinicianId) {
  if (!clinicianId) return null
  try {
    const r = await sbGet(
      `clinicians?id=eq.${encodeURIComponent(clinicianId)}&select=campaign_settings`,
    )
    if (!r.ok) {
      const body = await r.text().catch(() => '')
      console.error(`[campaignSettings] clinician override select failed — supabase ${r.status}: ${body.slice(0, 300)}`)
      return null
    }
    const rows = await r.json()
    if (!rows.length) return null
    return normalize(rows[0].campaign_settings)
  } catch (e) {
    console.error(`[campaignSettings] clinician override threw: ${e?.message || e}`)
    return null
  }
}

async function loadWorkspaceDefault(workspaceId) {
  if (!workspaceId) return DEFAULT_CAMPAIGN
  try {
    const r = await sbGet(
      `clinic_settings?workspace_id=eq.${encodeURIComponent(workspaceId)}` +
        `&select=campaign_mode,campaign_notes,campaign_cta_url,campaign_cta_label,campaign_cta_pitch,campaign_event_at`,
    )
    if (!r.ok) {
      const body = await r.text().catch(() => '')
      console.error(`[campaignSettings] workspace default select failed — supabase ${r.status}: ${body.slice(0, 300)}`)
      return DEFAULT_CAMPAIGN
    }
    const rows = await r.json()
    if (!rows.length) return DEFAULT_CAMPAIGN
    return {
      mode:      rows[0].campaign_mode      || 'bookings',
      notes:     rows[0].campaign_notes     || '',
      cta_url:   rows[0].campaign_cta_url   || '',
      cta_label: rows[0].campaign_cta_label || '',
      cta_pitch: rows[0].campaign_cta_pitch || '',
      event_at:  rows[0].campaign_event_at  || null,
    }
  } catch (e) {
    console.error(`[campaignSettings] workspace default threw: ${e?.message || e}`)
    return DEFAULT_CAMPAIGN
  }
}

// Public API. clinicianId is optional — pass it when generating from an
// interview owned by a specific clinician so their override (if any) wins.
export async function loadActiveCampaign(workspaceId, clinicianId = null) {
  const override = await loadClinicianOverride(clinicianId)
  if (override) return override
  return loadWorkspaceDefault(workspaceId)
}

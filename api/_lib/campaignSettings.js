// Load the workspace's active campaign settings from clinic_settings.
// Returns a normalized shape suitable for passing to
// getCampaignPromptContext(campaign, ws). Missing row or DB error returns
// the safe default (bookings mode, no CTA override).
//
// Used by atom-prompt callers (api/content-plan/draft.js,
// api/content-items/regenerate.js) so every new derivative content piece
// (social, email/newsletter, video script) sees the active campaign's CTA.
// Blog generation intentionally does NOT call this — blogs are evergreen.

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

export async function loadActiveCampaign(workspaceId) {
  if (!workspaceId) return DEFAULT_CAMPAIGN
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/clinic_settings?workspace_id=eq.${encodeURIComponent(workspaceId)}` +
        `&select=campaign_mode,campaign_notes,campaign_cta_url,campaign_cta_label,campaign_cta_pitch,campaign_event_at`,
      {
        headers: {
          apikey:        SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
      },
    )
    if (!r.ok) {
      const body = await r.text().catch(() => '')
      console.error(`[campaignSettings] select failed — supabase ${r.status}: ${body.slice(0, 300)}`)
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
    console.error(`[campaignSettings] load threw: ${e?.message || e}`)
    return DEFAULT_CAMPAIGN
  }
}

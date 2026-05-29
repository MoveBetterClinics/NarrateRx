// Phase 4 Tentpole PR B — Active campaigns helper.
//
// Two responsibilities:
//   1. Fetch currently-active campaigns for a workspace (status='active'
//      AND inside any configured date window).
//   2. Allocate today's N slate slots across them, weighted by event proximity.
//
// Used by:
//   • api/editorial/generate-package.js (consumer — accepts campaignId)
//   • api/workspace/me.js (embeds the active list for the Slate client)
//   • src/pages/Slate.jsx via the workspace response (does slot allocation
//     CLIENT-SIDE so each generate-package call can be made with the
//     resolved campaignId)

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const CAMPAIGN_FIELDS = [
  'id', 'name', 'status',
  'start_at', 'end_at', 'event_at',
  'theme_notes', 'content_style',
  'cta_url', 'cta_label', 'cta_pitch',
].join(',')

/**
 * Fetch currently-active campaigns for a workspace.
 * A campaign is "active" if:
 *   • status = 'active'
 *   • start_at IS NULL OR start_at <= now
 *   • end_at   IS NULL OR end_at   >= now
 *
 * Returns campaigns sorted by event_at ascending (closest event first; rows
 * with no event_at sort last).
 */
export async function getActiveCampaigns(workspaceId) {
  if (!workspaceId) return []
  const nowIso = new Date().toISOString()
  // PostgREST OR filter: (start_at IS NULL OR start_at <= now)
  //                   AND (end_at IS NULL OR end_at >= now)
  // encodeURIComponent is required: colons in ISO timestamps (e.g. 2026-05-28T12:00:00.000Z)
  // are ambiguous inside PostgREST or() groups and can produce wrong slates silently.
  const nowEnc = encodeURIComponent(nowIso)
  const startFilter = `or=(start_at.is.null,start_at.lte.${nowEnc})`
  const endFilter   = `or=(end_at.is.null,end_at.gte.${nowEnc})`
  const path = `campaigns?workspace_id=eq.${encodeURIComponent(workspaceId)}` +
               `&status=eq.active` +
               `&${startFilter}` +
               `&${endFilter}` +
               `&select=${CAMPAIGN_FIELDS}`
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    })
    if (!r.ok) {
      console.error('[activeCampaigns] fetch failed:', r.status)
      return []
    }
    const rows = await r.json().catch(() => [])
    if (!Array.isArray(rows)) return []
    // Sort: event_at ascending, nulls last.
    return rows.slice().sort((a, b) => {
      if (!a.event_at && !b.event_at) return 0
      if (!a.event_at) return 1
      if (!b.event_at) return -1
      return new Date(a.event_at).getTime() - new Date(b.event_at).getTime()
    })
  } catch (e) {
    console.error('[activeCampaigns] error:', e?.message)
    return []
  }
}

/**
 * Weight a single campaign by event proximity.
 *
 *   • Evergreen (no event_at)        → base 5
 *   • Event in the past              → base 1 (low priority — wind down)
 *   • Event 0–7 days out             → 30..15  (urgent)
 *   • Event 7–30 days out            → 15..2   (ramping)
 *   • Event >30 days out             → base 2  (background)
 *
 * Higher weight = more slots in today's allocation.
 */
export function campaignWeight(c, now = Date.now()) {
  if (!c?.event_at) return 5  // evergreen
  const eventTime = new Date(c.event_at).getTime()
  // Defensive: malformed event_at strings produce NaN, which would silently
  // fall through to the "far future" branch and break sort stability.
  // Treat malformed as evergreen.
  if (!Number.isFinite(eventTime)) return 5
  const days = (eventTime - now) / (24 * 60 * 60 * 1000)
  if (days < 0)  return 1  // past event
  if (days <= 7) return Math.max(15, Math.round(30 - 2 * days))
  if (days <= 30) return Math.max(2, Math.round(30 - days))
  return 2  // far future
}

/**
 * Allocate `totalSlots` across `campaigns` proportional to their weights.
 *
 * Returns an array of length totalSlots, each entry = a campaign id or null.
 * Null entries are "uncommitted" slots — the caller fills them with the
 * non-campaign topic-gap picks (legacy behavior). When there are more
 * campaigns than slots, picks the top-N by weight (closer events win).
 *
 * Tie-breaking: by id (stable) so repeated calls with the same input
 * produce the same allocation.
 */
export function allocateSlots(campaigns, totalSlots, opts = {}) {
  const now = opts.now || Date.now()
  // Negative totalSlots crashes new Array(n); empty totalSlots returns [].
  if (typeof totalSlots !== 'number' || totalSlots < 1) return []
  if (!Array.isArray(campaigns) || campaigns.length === 0) {
    return new Array(totalSlots).fill(null)
  }

  // If too many campaigns for available slots, keep the top-N by weight.
  const ranked = campaigns
    .map((c) => ({ c, w: campaignWeight(c, now) }))
    .sort((a, b) => (b.w - a.w) || String(a.c.id).localeCompare(String(b.c.id)))

  const trimmed = ranked.slice(0, totalSlots)
  const totalWeight = trimmed.reduce((sum, x) => sum + x.w, 0)
  if (totalWeight === 0) return new Array(totalSlots).fill(null)

  // First pass: floor-allocate proportional slots.
  const alloc = trimmed.map((x) => ({
    id: x.c.id,
    weight: x.w,
    floor: Math.floor((x.w / totalWeight) * totalSlots),
    fractional: ((x.w / totalWeight) * totalSlots) % 1,
  }))

  // Second pass: distribute leftover slots by highest fractional, tie-break
  // by weight (so a more-urgent campaign wins the rounded slot).
  let used = alloc.reduce((s, a) => s + a.floor, 0)
  const leftover = totalSlots - used
  alloc.sort((a, b) => (b.fractional - a.fractional) || (b.weight - a.weight))
  for (let i = 0; i < leftover; i++) {
    alloc[i].floor += 1
  }

  // Emit slot list. Interleave deterministically: highest-weight campaign
  // claims the first slots, then next, etc. (Could randomize but
  // deterministic = easier to reason about + reproducible for testing.)
  const result = []
  // Reorder back to weight-desc for output assignment.
  alloc.sort((a, b) => (b.weight - a.weight) || String(a.id).localeCompare(String(b.id)))
  for (const a of alloc) {
    for (let i = 0; i < a.floor; i++) result.push(a.id)
  }
  // Pad with nulls if we somehow under-allocated (shouldn't, but defensive).
  while (result.length < totalSlots) result.push(null)
  return result.slice(0, totalSlots)
}

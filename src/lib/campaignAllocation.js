// Client mirror of api/_lib/activeCampaigns.js allocation logic.
//
// Keeping the math in two places is duplicative but necessary — the server
// uses it to validate generate-package campaign_id arguments, the client
// uses it to decide WHICH campaign_id to send per slot. Tests against the
// same fixtures in both directions ensure they don't drift.
//
// If this gets bigger, the right next step is to move it to a shared
// /shared/ folder + a Vite path alias both API and src can import from.

/**
 * Weight a campaign by event proximity. MUST match api/_lib/activeCampaigns.js
 * → campaignWeight() exactly.
 */
export function campaignWeight(c, now = Date.now()) {
  if (!c?.event_at) return 5
  const eventTime = new Date(c.event_at).getTime()
  if (!Number.isFinite(eventTime)) return 5  // malformed → treat as evergreen
  const days = (eventTime - now) / (24 * 60 * 60 * 1000)
  if (days < 0)  return 1
  if (days <= 7) return Math.max(15, Math.round(30 - 2 * days))
  if (days <= 30) return Math.max(2, Math.round(30 - days))
  return 2
}

/**
 * Allocate `totalSlots` across campaigns proportional to weight. Returns an
 * array of length totalSlots, each entry = campaign object or null.
 * MUST match api/_lib/activeCampaigns.js → allocateSlots() exactly except
 * this returns campaign objects (for ergonomics) rather than just ids.
 */
export function allocateSlots(campaigns, totalSlots, opts = {}) {
  const now = opts.now || Date.now()
  if (typeof totalSlots !== 'number' || totalSlots < 1) return []
  if (!Array.isArray(campaigns) || campaigns.length === 0) {
    return new Array(totalSlots).fill(null)
  }

  const ranked = campaigns
    .map((c) => ({ c, w: campaignWeight(c, now) }))
    .sort((a, b) => (b.w - a.w) || String(a.c.id).localeCompare(String(b.c.id)))

  const trimmed = ranked.slice(0, totalSlots)
  const totalWeight = trimmed.reduce((sum, x) => sum + x.w, 0)
  if (totalWeight === 0) return new Array(totalSlots).fill(null)

  const alloc = trimmed.map((x) => ({
    campaign: x.c,
    weight: x.w,
    floor: Math.floor((x.w / totalWeight) * totalSlots),
    fractional: ((x.w / totalWeight) * totalSlots) % 1,
  }))

  const used = alloc.reduce((s, a) => s + a.floor, 0)
  const leftover = totalSlots - used
  alloc.sort((a, b) => (b.fractional - a.fractional) || (b.weight - a.weight))
  for (let i = 0; i < leftover; i++) alloc[i].floor += 1

  const result = []
  alloc.sort((a, b) => (b.weight - a.weight) || String(a.campaign.id).localeCompare(String(b.campaign.id)))
  for (const a of alloc) {
    for (let i = 0; i < a.floor; i++) result.push(a.campaign)
  }
  while (result.length < totalSlots) result.push(null)
  return result.slice(0, totalSlots)
}

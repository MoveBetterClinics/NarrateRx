// Platform-specific scheduling heuristics shared between the calendar
// surface (ContentCalendar / future StoriesCalendarView) and the
// per-post scheduler (ReviewPost). Lifted out of ContentCalendar.jsx in
// the IA refactor (PR 1/6).
//
// The preferences table mirrors the per-platform "optimal posting day +
// hour" rule of thumb used by both surfaces. Pure data — no React.

// Platform-specific preferred posting days (0=Sun…6=Sat) and hours (local time).
// Union of the ContentCalendar canvas table and the ReviewPost scheduler table:
// social + email + video keep their richer 2-3 hour windows; ads/landing pages
// get a single 9am slot on Mon-Wed (carry-over from ReviewPost).
export const PLATFORM_SCHEDULE_PREFS = {
  instagram:    { days: [2, 3, 4, 5],    hours: [11, 14, 18] },
  facebook:     { days: [2, 3, 4],       hours: [12, 15] },
  linkedin:     { days: [2, 3, 4],       hours: [8, 10] },
  blog:         { days: [1, 2, 3],       hours: [8, 10] },
  email:        { days: [2, 4],          hours: [10, 11] },
  youtube:      { days: [5, 6],          hours: [17, 19] },
  tiktok:       { days: [2, 3, 5],       hours: [19, 20] },
  gbp:          { days: [1, 2, 3, 4, 5], hours: [9, 10] },
  google_ads:   { days: [1, 2, 3],       hours: [9] },
  instagram_ads:{ days: [1, 2, 3],       hours: [9] },
  landing_page: { days: [1, 2, 3],       hours: [9] },
}

// 2-hour buffer between scheduled posts on the same platform — keeps
// the feed from looking flooded and gives Buffer/external schedulers
// room to breathe.
export const MIN_GAP_MS = 2 * 60 * 60 * 1000

// Returns the effective preferences table for a workspace. `overrides` is the
// workspaces.schedule_prefs JSONB: { [platform]: { days, hours } | null }.
// Per-platform: a present, valid entry replaces the default; null/missing
// keeps the default. Returns a fresh object — safe to consume directly.
export function resolveSchedulePrefs(overrides) {
  if (!overrides || typeof overrides !== 'object') return { ...PLATFORM_SCHEDULE_PREFS }
  const merged = { ...PLATFORM_SCHEDULE_PREFS }
  for (const [platform, value] of Object.entries(overrides)) {
    if (!value) continue // null or missing → keep default
    if (!Array.isArray(value.days) || !Array.isArray(value.hours)) continue
    if (value.days.length === 0 || value.hours.length === 0) continue
    merged[platform] = { days: [...value.days], hours: [...value.hours] }
  }
  return merged
}

// Picks the next available slot for `platform` given currently-scheduled items.
// Walks forward up to 60 days from `fromDate` (defaults to now), only accepting
// days in the platform's preferred-day list and hours in its preferred-hour
// list, while avoiding slots within MIN_GAP_MS of an already-scheduled post.
// Returns a Date or null if no slot found within the 60-day horizon.
//
// overrides: optional workspaces.schedule_prefs JSONB. When provided, the
// platform's preferences are replaced by the override before slot search.
export function suggestScheduleTime(platform, scheduledItems, fromDate, overrides) {
  const prefsTable = resolveSchedulePrefs(overrides)
  const prefs = prefsTable[platform] || { days: [1, 2, 3, 4, 5], hours: [9, 14] }
  const busy = scheduledItems.map((i) => new Date(i.scheduled_at).getTime()).filter(Boolean)
  const now = fromDate || new Date()
  for (let d = 0; d <= 60; d++) {
    const candidate = new Date(now)
    candidate.setDate(candidate.getDate() + d)
    if (!prefs.days.includes(candidate.getDay())) continue
    for (const h of prefs.hours) {
      candidate.setHours(h, 0, 0, 0)
      if (candidate <= now) continue
      const conflict = busy.some((t) => Math.abs(t - candidate.getTime()) < MIN_GAP_MS)
      if (!conflict) return new Date(candidate)
    }
  }
  return null
}

// True if any platform's optimal-window prefs include this (day, hour) slot.
// Used to drive the subtle heatmap tinting in the week view.
export function isOptimalSlot(day, hour, overrides) {
  for (const prefs of Object.values(resolveSchedulePrefs(overrides))) {
    if (prefs.days.includes(day) && prefs.hours.includes(hour)) return true
  }
  return false
}

// True if any platform's optimal-day list contains this day — used for the
// month-view heatmap (one tint per day rather than per-hour).
export function isOptimalDay(day, overrides) {
  for (const prefs of Object.values(resolveSchedulePrefs(overrides))) {
    if (prefs.days.includes(day)) return true
  }
  return false
}

// Human-readable explanation of why a platform's optimal slots fall where they
// do. Surfaced as a caption under the suggested time in the approve action
// sheet so the heuristic feels like a recommendation, not magic.
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const PLATFORM_LABELS = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  linkedin: 'LinkedIn',
  blog: 'Blog',
  email: 'Email',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  gbp: 'Google Business',
  google_ads: 'Google Ads',
  instagram_ads: 'Instagram Ads',
  landing_page: 'Landing pages',
}
function formatDayRange(days) {
  if (!days || days.length === 0) return ''
  const sorted = [...days].sort((a, b) => a - b)
  const contiguous = sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1)
  if (contiguous && sorted.length > 1) {
    return `${DAY_NAMES[sorted[0]]}–${DAY_NAMES[sorted[sorted.length - 1]]}`
  }
  return sorted.map((d) => DAY_NAMES[d]).join('/')
}
function formatHourRange(hours) {
  if (!hours || hours.length === 0) return ''
  const sorted = [...hours].sort((a, b) => a - b)
  const fmt = (h) => {
    if (h === 0) return '12am'
    if (h === 12) return '12pm'
    return h < 12 ? `${h}am` : `${h - 12}pm`
  }
  if (sorted.length === 1) return fmt(sorted[0])
  return `${fmt(sorted[0])}–${fmt(sorted[sorted.length - 1])}`
}
export function explainPlatformSlot(platform, overrides) {
  const prefs = resolveSchedulePrefs(overrides)[platform]
  if (!prefs) return null
  const label = PLATFORM_LABELS[platform] || platform
  const overridden = overrides?.[platform] ? ' (workspace preference)' : ''
  return `${label} engages best ${formatDayRange(prefs.days)} ${formatHourRange(prefs.hours)}${overridden}`
}

// Returns the closest scheduled item on the same platform within MIN_GAP_MS of
// `candidateDate`, or null if no conflict. Used by the approve action sheet to
// soft-warn (not block) when the user picks a custom time near another post.
export function findScheduleConflict(platform, candidateDate, scheduledItems) {
  if (!candidateDate || !scheduledItems?.length) return null
  const t = candidateDate.getTime()
  let closest = null
  let closestDelta = Infinity
  for (const item of scheduledItems) {
    if (!item.scheduled_at || item.platform !== platform) continue
    const other = new Date(item.scheduled_at).getTime()
    const delta = Math.abs(other - t)
    if (delta < MIN_GAP_MS && delta < closestDelta) {
      closest = item
      closestDelta = delta
    }
  }
  return closest
}

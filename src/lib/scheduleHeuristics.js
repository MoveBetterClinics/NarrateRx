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

// Picks the next available slot for `platform` given currently-scheduled items.
// Walks forward up to 60 days from `fromDate` (defaults to now), only accepting
// days in the platform's preferred-day list and hours in its preferred-hour
// list, while avoiding slots within MIN_GAP_MS of an already-scheduled post.
// Returns a Date or null if no slot found within the 60-day horizon.
export function suggestScheduleTime(platform, scheduledItems, fromDate) {
  const prefs = PLATFORM_SCHEDULE_PREFS[platform] || { days: [1, 2, 3, 4, 5], hours: [9, 14] }
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
export function isOptimalSlot(day, hour) {
  for (const prefs of Object.values(PLATFORM_SCHEDULE_PREFS)) {
    if (prefs.days.includes(day) && prefs.hours.includes(hour)) return true
  }
  return false
}

// True if any platform's optimal-day list contains this day — used for the
// month-view heatmap (one tint per day rather than per-hour).
export function isOptimalDay(day) {
  for (const prefs of Object.values(PLATFORM_SCHEDULE_PREFS)) {
    if (prefs.days.includes(day)) return true
  }
  return false
}

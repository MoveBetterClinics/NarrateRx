import { throwApiError } from '@/lib/apiError'

// Canonical fetch wrapper for our own /api routes. Three jobs:
//   1. Auto-inject the Clerk bearer token so callers never have to thread it
//      manually. Eliminates a whole class of "missing Authorization header"
//      bugs (PRs #424, #427) where the API returns 401 and the UI misreports
//      it as "admin only." Opt out per-call with `init.auth = false` (for
//      public endpoints like /api/share/* or /api/embed/*).
//   2. Default `credentials: 'include'` so Clerk's __session cookie also
//      reaches the server — the cookie is the fallback when getToken() races
//      with sign-in (component renders before Clerk hydrates).
//   3. Route !res.ok through throwApiError (401 toast, 429 toast, ApiError
//      with status). Guards the JSON success path so a 200-but-invalid-JSON
//      body doesn't silently return undefined to callers (FUNC-01, PR #304).

async function getClerkToken() {
  if (typeof window === 'undefined') return null
  try {
    return await window.Clerk?.session?.getToken?.()
  } catch {
    return null
  }
}

function hasAuthHeader(headers) {
  if (!headers) return false
  if (headers instanceof Headers) {
    return headers.has('Authorization') || headers.has('authorization')
  }
  return Object.keys(headers).some((k) => k.toLowerCase() === 'authorization')
}

export async function apiFetchResponse(path, init = {}) {
  const { auth = true, headers, credentials, ...rest } = init
  const mergedHeaders = { ...(headers || {}) }
  if (auth && !hasAuthHeader(mergedHeaders)) {
    const token = await getClerkToken()
    if (token) mergedHeaders.Authorization = `Bearer ${token}`
  }
  const res = await fetch(path, {
    ...rest,
    credentials: credentials ?? 'include',
    headers: mergedHeaders,
  })
  if (!res.ok) await throwApiError(res)
  return res
}

export async function apiFetch(path, init = {}) {
  const res = await apiFetchResponse(path, init)
  return res.json().catch(() => { throw new Error(`Invalid JSON from ${path}`) })
}

// ── Clinicians ──────────────────────────────────────────────────────────────

export function fetchClinicians() {
  return apiFetch('/api/db/clinicians')
}

export function fetchClinician(id) {
  return apiFetch(`/api/db/clinicians?id=${encodeURIComponent(id)}`)
}

export function getOrCreateClinician({ name, createdById, createdByEmail }) {
  return apiFetch('/api/db/clinicians', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, createdById, createdByEmail }),
  })
}

export function deleteClinician(id, userId) {
  return apiFetch(`/api/db/clinicians?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'x-user-id': userId },
  })
}

// ── Interviews ───────────────────────────────────────────────────────────────

export function fetchInterview(id) {
  return apiFetch(`/api/db/interviews?id=${encodeURIComponent(id)}`)
}

export function fetchSimilarInterviews(topic, excludeId) {
  const params = new URLSearchParams({ topic, excludeId })
  return apiFetch(`/api/db/interviews?${params}`)
}

export function createInterview({ clinicianId, topic, ownerId, ownerEmail, tone, voiceMode, prototypeId, locationId }) {
  return apiFetch('/api/db/interviews', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clinicianId, topic, ownerId, ownerEmail, tone, voiceMode, prototypeId, locationId }),
  })
}

export function updateInterview(id, patch, userId) {
  return apiFetch(`/api/db/interviews?id=${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
    body: JSON.stringify(patch),
  })
}

export function suggestPullQuotes(interviewId) {
  return apiFetch('/api/interviews/pull-quotes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ interviewId }),
  })
}

export function listContentItemComments(itemId) {
  return apiFetch(`/api/content-item-comments?itemId=${encodeURIComponent(itemId)}`)
}

export function createContentItemComment(itemId, { body, kind, userId, userEmail }) {
  return apiFetch('/api/content-item-comments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemId, body, kind, userId, userEmail }),
  })
}

export function cleanupTranscript(interviewId) {
  return apiFetch('/api/interviews/cleanup-transcript', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ interviewId }),
  })
}

export function listContentItemDrafts(itemId) {
  return apiFetch(`/api/content-item-drafts?itemId=${encodeURIComponent(itemId)}`)
}

export function createContentItemDraft(itemId, body, aiGenerated = false) {
  return apiFetch('/api/content-item-drafts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemId, body, aiGenerated }),
  })
}

export function deleteInterview(id, userId) {
  return apiFetch(`/api/db/interviews?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'x-user-id': userId },
  })
}

// ── Clinician Arc ────────────────────────────────────────────────────────────

// Returns { stats: { interviews, posts, streak }, recentPosts, standoutQuote }
// computed from data already reachable via existing endpoints.
//
// interviews: the clinician row's embedded interviews array (already fetched by
//   useClinician) — passed in to avoid a second network request.
// Published content: fetched from /api/db/content?clinicianId=<id>&status=published
//   which now accepts clinicianId filtering (api/db/content.js, added 2026-05-13).
export async function fetchClinicianArc(clinicianId, interviews = []) {
  // Fetch published content items for this clinician
  const posts = await apiFetch(
    `/api/db/content?clinicianId=${encodeURIComponent(clinicianId)}&status=published&limit=100`
  ).catch(() => [])

  // ── Stats ─────────────────────────────────────────────────────────────────

  const completedInterviews = interviews.filter((i) => i.status === 'completed')
  const interviewCount = completedInterviews.length

  // Posts = published OR has published_at
  const publishedPosts = posts.filter((p) => p.status === 'published' || p.published_at)
  const postCount = publishedPosts.length

  // Streak: consecutive ISO weeks ending this week with ≥1 completed interview
  const streak = computeWeekStreak(completedInterviews)

  // ── Recent posts (newest first, max 5) ────────────────────────────────────

  const recentPosts = [...publishedPosts]
    .sort((a, b) => new Date(b.published_at || b.created_at) - new Date(a.published_at || a.created_at))
    .slice(0, 5)

  // ── Standout quote ────────────────────────────────────────────────────────

  const standoutQuote = pickStandoutQuote(completedInterviews)

  return {
    stats: { interviews: interviewCount, posts: postCount, streak },
    recentPosts,
    standoutQuote,
  }
}

// Compute current week-streak from an array of completed interview objects that
// each have a `created_at` ISO timestamp. A week is identified by ISO week number
// (Mon-Sun). The streak counts back from the current week: if there's at least
// one interview this week → 1, and for each prior consecutive week that also has
// at least one interview → +1. Returns 0 if there's no interview in the current
// week.
function computeWeekStreak(completedInterviews) {
  if (!completedInterviews.length) return 0

  // Build a Set of ISO-week strings "YYYY-Www" for weeks that have interviews
  const weekSet = new Set(
    completedInterviews.map((i) => isoWeekKey(new Date(i.created_at)))
  )

  const todayWeek = isoWeekKey(new Date())
  if (!weekSet.has(todayWeek)) return 0 // no activity this week → streak is 0

  let streak = 1
  let cursor = new Date()
  // Step back 7 days at a time and check if that week had any interview
  while (true) {
    cursor = new Date(cursor.getTime() - 7 * 24 * 60 * 60 * 1000)
    const key = isoWeekKey(cursor)
    if (!weekSet.has(key)) break
    streak += 1
    if (streak > 200) break // safety cap
  }
  return streak
}

// Returns "YYYY-Www" for the ISO week containing the given Date.
function isoWeekKey(date) {
  // Copy date as UTC to avoid DST shifts
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  // ISO week: Thursday of the week determines the year
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
  const year = d.getUTCFullYear()
  const week = Math.ceil(
    ((d - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7
  )
  return `${year}-W${String(week).padStart(2, '0')}`
}

// Pick the best verbatim quote from completed interviews.
// Priority: verbatim_flags array → longest user message from most recent interview.
function pickStandoutQuote(completedInterviews) {
  if (!completedInterviews.length) return null

  // Try verbatim_flags across all completed interviews (newest first)
  const sorted = [...completedInterviews].sort(
    (a, b) => new Date(b.created_at) - new Date(a.created_at)
  )

  for (const iv of sorted) {
    const flags = Array.isArray(iv.verbatim_flags) ? iv.verbatim_flags : []
    if (flags.length > 0) {
      // Pick the longest flagged text if multiple exist
      const best = flags.reduce((a, b) =>
        (b.text || '').length > (a.text || '').length ? b : a
      )
      if (best.text?.trim()) {
        return { text: best.text.trim(), interviewTopic: iv.topic }
      }
    }
  }

  // Fallback: longest user message from the most recent completed interview
  const newest = sorted[0]
  const messages = Array.isArray(newest.messages) ? newest.messages : []
  const userMessages = messages.filter((m) => m.role === 'user' && m.content?.trim())
  if (!userMessages.length) return null

  const longest = userMessages.reduce((a, b) =>
    (b.content || '').length > (a.content || '').length ? b : a
  )
  return longest.content?.trim()
    ? { text: longest.content.trim(), interviewTopic: newest.topic }
    : null
}

// ── Campaign Settings ────────────────────────────────────────────────────────

export function fetchCampaign() {
  return apiFetch('/api/db/settings')
}

export function updateCampaign(patch, userId) {
  return apiFetch('/api/db/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
    body: JSON.stringify(patch),
  })
}

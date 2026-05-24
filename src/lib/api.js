// @ts-check
import { throwApiError } from '@/lib/apiError'

/**
 * @typedef {RequestInit & { auth?: boolean }} ApiFetchInit
 * `auth` (default true) controls whether the Clerk bearer token is injected.
 * Set to false for public/unauthenticated endpoints (/api/share/*, etc.).
 */

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

/** @returns {Promise<string | null>} */
async function getClerkToken() {
  if (typeof window === 'undefined') return null
  try {
    return await window.Clerk?.session?.getToken?.() ?? null
  } catch {
    return null
  }
}

/**
 * @param {HeadersInit | undefined} headers
 * @returns {boolean}
 */
function hasAuthHeader(headers) {
  if (!headers) return false
  if (headers instanceof Headers) {
    return headers.has('Authorization') || headers.has('authorization')
  }
  return Object.keys(/** @type {Record<string, string>} */ (headers))
    .some((k) => k.toLowerCase() === 'authorization')
}

/**
 * Fetch an internal /api route, injecting a Clerk bearer token and
 * defaulting credentials to 'include'. Throws ApiError on non-2xx.
 * @param {string} path
 * @param {ApiFetchInit} [init]
 * @returns {Promise<Response>}
 */
export async function apiFetchResponse(path, init = {}) {
  const { auth = true, headers, credentials, ...rest } = init
  const mergedHeaders = /** @type {Record<string, string>} */ ({ ...(headers || {}) })
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

/**
 * Fetch an internal /api route and parse the JSON response body.
 * @param {string} path
 * @param {ApiFetchInit} [init]
 * @returns {Promise<unknown>}
 */
export async function apiFetch(path, init = {}) {
  const res = await apiFetchResponse(path, init)
  return res.json().catch(() => { throw new Error(`Invalid JSON from ${path}`) })
}

// ── Clinicians ──────────────────────────────────────────────────────────────

/** @returns {Promise<unknown[]>} */
export function fetchClinicians() {
  return /** @type {Promise<unknown[]>} */ (apiFetch('/api/db/clinicians'))
}

/** @param {string} id @returns {Promise<unknown>} */
export function fetchClinician(id) {
  return apiFetch(`/api/db/clinicians?id=${encodeURIComponent(id)}`)
}

/**
 * Get or create a clinician row. When `userId` is provided, the server
 * binds the row to that Clerk user identity (Self clinician) — future
 * lookups by user_id return the same row even if the display name changes.
 * Omit `userId` for proxy clinicians (admin recording an interview with a
 * non-Clerk user).
 * @param {{ name: string, createdById: string, createdByEmail: string, userId?: string }} opts
 * @returns {Promise<unknown>}
 */
export function getOrCreateClinician({ name, createdById, createdByEmail, userId }) {
  return apiFetch('/api/db/clinicians', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, createdById, createdByEmail, userId }),
  })
}

/**
 * Propagate the calling user's new display name onto their Self clinician
 * row(s) in the current workspace. Idempotent.
 * @param {string} name
 * @returns {Promise<{ updated: number }>}
 */
export function syncClinicianName(name) {
  return /** @type {Promise<{updated:number}>} */ (apiFetch('/api/clinicians/sync-name', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  }))
}

/** @param {string} id @param {string} userId @returns {Promise<unknown>} */
export function deleteClinician(id, userId) {
  return apiFetch(`/api/db/clinicians?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'x-user-id': userId },
  })
}

/** @param {string} id @param {Record<string, unknown>} patch @param {string} userId @returns {Promise<unknown>} */
export function patchClinician(id, patch, userId) {
  return apiFetch(`/api/db/clinicians?id=${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
    body: JSON.stringify(patch),
  })
}

// ── Interviews ───────────────────────────────────────────────────────────────

/** @param {string} id @returns {Promise<unknown>} */
export function fetchInterview(id) {
  return apiFetch(`/api/db/interviews?id=${encodeURIComponent(id)}`)
}

/** @param {string} topic @param {string} excludeId @returns {Promise<unknown>} */
export function fetchSimilarInterviews(topic, excludeId) {
  const params = new URLSearchParams({ topic, excludeId })
  return apiFetch(`/api/db/interviews?${params}`)
}

/**
 * Practice-memory hot context: this clinician's most recent voice-bearing
 * content (approved or published). Used to inject prior-thinking style
 * anchors into the live interview's system prompt.
 * @param {string} clinicianId
 * @param {number} [limit]
 * @returns {Promise<unknown>}
 */
export function fetchClinicianRecentContent(clinicianId, limit = 3) {
  const params = new URLSearchParams({
    clinicianId,
    status: 'approved,published',
    limit: String(limit),
  })
  return apiFetch(`/api/db/content?${params}`)
}

/**
 * @param {{ clinicianId: string, topic: string, ownerEmail: string, tone?: string, voiceMode?: string, prototypeId?: string, locationId?: string, audience?: string, storyType?: string, cleanupLevel?: string, topicBacklogId?: string }} opts
 * @returns {Promise<unknown>}
 */
export function createInterview({ clinicianId, topic, ownerEmail, tone, voiceMode, prototypeId, locationId, audience, storyType, cleanupLevel, topicBacklogId }) {
  // owner_id is derived from the verified Clerk token server-side, never sent
  // from the client. (Fixed 2026-05-21 audit P0 #4.)
  return apiFetch('/api/db/interviews', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clinicianId, topic, ownerEmail, tone, voiceMode, prototypeId, locationId, audience, storyType, cleanupLevel, topicBacklogId }),
  })
}

// ── Clinician Recipes ───────────────────────────────────────────────────────

/** @param {string} clinicianId @returns {Promise<unknown[]>} */
export function fetchClinicianRecipes(clinicianId) {
  return /** @type {Promise<unknown[]>} */ (
    apiFetch(`/api/db/clinician-recipes?clinicianId=${encodeURIComponent(clinicianId)}`)
  )
}

/**
 * @param {{ clinicianId: string, name: string, emoji?: string, is_default?: boolean, audience?: string|null, story_type?: string|null, tone?: string|null, voice_mode?: string|null, cleanup_level?: string|null }} body
 * @returns {Promise<unknown>}
 */
export function createClinicianRecipe(body) {
  return apiFetch('/api/db/clinician-recipes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** @param {string} id @param {Record<string, unknown>} patch @returns {Promise<unknown>} */
export function patchClinicianRecipe(id, patch) {
  return apiFetch(`/api/db/clinician-recipes?id=${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
}

/** @param {string} id @returns {Promise<unknown>} */
export function deleteClinicianRecipe(id) {
  return apiFetch(`/api/db/clinician-recipes?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/** @param {string} id @param {Record<string, unknown>} patch @returns {Promise<unknown>} */
export function updateInterview(id, patch) {
  // Ownership check uses the verified Clerk token server-side; no x-user-id
  // header. (Fixed 2026-05-21 audit P0 #4.)
  return apiFetch(`/api/db/interviews?id=${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
}

/** @param {string} interviewId @returns {Promise<unknown>} */
export function suggestPullQuotes(interviewId) {
  return apiFetch('/api/interviews/pull-quotes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ interviewId }),
  })
}

/** @param {string} itemId @returns {Promise<unknown>} */
export function listContentItemComments(itemId) {
  return apiFetch(`/api/content-item-comments?itemId=${encodeURIComponent(itemId)}`)
}

/** @param {string} itemId @param {{ body: string, kind: string, userId: string, userEmail: string }} opts @returns {Promise<unknown>} */
export function createContentItemComment(itemId, { body, kind, userId, userEmail }) {
  return apiFetch('/api/content-item-comments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemId, body, kind, userId, userEmail }),
  })
}

/** @param {string} interviewId @returns {Promise<unknown>} */
export function cleanupTranscript(interviewId) {
  return apiFetch('/api/interviews/cleanup-transcript', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ interviewId }),
  })
}

// Voice-fidelity provenance — finds the blog content_item the cascade created
// from the interview's outputs and populates its provenance. Fire-and-forget
// from the generation handler. Empty trailer is allowed; the server falls
// back to algorithmic similarity matching against the transcript.
/**
 * @param {string} interviewId
 * @param {string} [trailer]
 * @param {string} [platform]
 * @returns {Promise<unknown>}
 */
export async function populateContentItemProvenance(interviewId, trailer = '', platform = 'blog') {
  /** @type {unknown} */
  let result
  try {
    result = await apiFetch(
      `/api/db/content?interviewId=${encodeURIComponent(interviewId)}&platform=${encodeURIComponent(platform)}&limit=1`
    )
  } catch {
    return null
  }
  const rows = /** @type {Array<{ id?: string }>} */ (Array.isArray(result) ? result : [])
  const contentItemId = rows[0]?.id
  if (!contentItemId) return null
  return apiFetch('/api/content-items/provenance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contentItemId, trailer: trailer || '' }),
  })
}

/** @param {string} itemId @returns {Promise<unknown>} */
export function listContentItemDrafts(itemId) {
  return apiFetch(`/api/content-item-drafts?itemId=${encodeURIComponent(itemId)}`)
}

/** @param {string} itemId @param {string} body @param {boolean} [aiGenerated] @returns {Promise<unknown>} */
export function createContentItemDraft(itemId, body, aiGenerated = false) {
  return apiFetch('/api/content-item-drafts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemId, body, aiGenerated }),
  })
}

/** @param {string} id @returns {Promise<unknown>} */
export function deleteInterview(id) {
  // Ownership check uses the verified Clerk token server-side; no x-user-id
  // header. (Fixed 2026-05-21 audit P0 #4.)
  return apiFetch(`/api/db/interviews?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
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
/**
 * @param {string} clinicianId
 * @param {any[]} [interviews]
 * @returns {Promise<{ stats: { interviews: number, posts: number, streak: number }, recentPosts: any[], standoutQuote: { text: string, interviewTopic: string } | null }>}
 */
export async function fetchClinicianArc(clinicianId, interviews = []) {
  // Fetch published content items for this clinician
  const posts = /** @type {any[]} */ (await apiFetch(
    `/api/db/content?clinicianId=${encodeURIComponent(clinicianId)}&status=published&limit=100`
  ).catch(() => /** @type {any[]} */ ([])))

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
    .sort((a, b) => +new Date(b.published_at || b.created_at) - +new Date(a.published_at || a.created_at))
    .slice(0, 5)

  // ── Standout quote ────────────────────────────────────────────────────────

  const standoutQuote = pickStandoutQuote(completedInterviews)

  return {
    stats: { interviews: interviewCount, posts: postCount, streak },
    recentPosts,
    standoutQuote,
  }
}

/**
 * Compute current week-streak from an array of completed interview objects.
 * Each object must have a `created_at` ISO timestamp.
 * @param {any[]} completedInterviews
 * @returns {number}
 */
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

/**
 * Returns "YYYY-Www" for the ISO week containing the given Date.
 * @param {Date} date
 * @returns {string}
 */
function isoWeekKey(date) {
  // Copy date as UTC to avoid DST shifts
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  // ISO week: Thursday of the week determines the year
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
  const year = d.getUTCFullYear()
  const week = Math.ceil(
    (+d - Date.UTC(year, 0, 1)) / 86400000 / 7 + 1
  )
  return `${year}-W${String(week).padStart(2, '0')}`
}

/**
 * Pick the best verbatim quote from completed interviews.
 * Priority: verbatim_flags array → longest user message from most recent interview.
 * @param {any[]} completedInterviews
 * @returns {{ text: string, interviewTopic: string } | null}
 */
function pickStandoutQuote(completedInterviews) {
  if (!completedInterviews.length) return null

  // Try verbatim_flags across all completed interviews (newest first)
  const sorted = [...completedInterviews].sort(
    (a, b) => +new Date(b.created_at) - +new Date(a.created_at)
  )

  for (const iv of sorted) {
    const flags = Array.isArray(iv.verbatim_flags) ? iv.verbatim_flags : []
    if (flags.length > 0) {
      // Pick the longest flagged text if multiple exist
      const best = flags.reduce((/** @type {any} */ a, /** @type {any} */ b) =>
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
  const userMessages = messages.filter((/** @type {any} */ m) => m.role === 'user' && m.content?.trim())
  if (!userMessages.length) return null

  const longest = userMessages.reduce((/** @type {any} */ a, /** @type {any} */ b) =>
    (b.content || '').length > (a.content || '').length ? b : a
  )
  return longest.content?.trim()
    ? { text: longest.content.trim(), interviewTopic: newest.topic }
    : null
}

// ── Campaign Settings ────────────────────────────────────────────────────────

/** @returns {Promise<unknown>} */
export function fetchCampaign() {
  return apiFetch('/api/db/settings')
}

/** @param {Record<string, unknown>} patch @returns {Promise<unknown>} */
export function updateCampaign(patch) {
  return apiFetch('/api/db/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
}

// Per-clinician campaign override (workspace default is at /api/db/settings).
// Returns { clinician_id, name, settings | null }. null settings = clinician
// uses the workspace default; an object means they've overridden.
/** @param {string} clinicianId @returns {Promise<unknown>} */
export function fetchClinicianCampaign(clinicianId) {
  return apiFetch(`/api/clinicians/campaign-settings?clinician_id=${encodeURIComponent(clinicianId)}`)
}

// settings === null  → clear the override (use workspace default)
// settings === object → set override (must include mode + optional CTA fields)
/** @param {string} clinicianId @param {Record<string, unknown> | null} settings @returns {Promise<unknown>} */
export function updateClinicianCampaign(clinicianId, settings) {
  const body = settings === null
    ? { use_default: true }
    : { settings }
  return apiFetch(`/api/clinicians/campaign-settings?clinician_id=${encodeURIComponent(clinicianId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

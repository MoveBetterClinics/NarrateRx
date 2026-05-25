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
 * Force-refresh from Clerk's servers, bypassing the local cache. Used to
 * recover from `wrong-org` responses where the cached token still carries
 * the previous workspace's org_id.
 * @returns {Promise<string | null>}
 */
async function getClerkTokenFresh() {
  if (typeof window === 'undefined') return null
  try {
    return await window.Clerk?.session?.getToken?.({ skipCache: true }) ?? null
  } catch {
    return null
  }
}

/**
 * Decode the org_id claim from a JWT without verifying it. Used purely for
 * diagnostics (logging which org our token claims when we hit wrong-org).
 * @param {string | null} token
 * @returns {string | null}
 */
function decodeJwtOrgId(token) {
  if (!token) return null
  try {
    const parts = token.split('.')
    if (parts.length < 2) return null
    return JSON.parse(atob(parts[1]))?.org_id || null
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
 * Peek the `error` field from a non-2xx response body without consuming the
 * stream (so the caller can still re-read it). Returns null if the body
 * isn't JSON or doesn't include an `error` field.
 * @param {Response} res
 * @returns {Promise<string | null>}
 */
async function peekErrorReason(res) {
  try {
    const body = await res.clone().json()
    return typeof body?.error === 'string' ? body.error : null
  } catch {
    return null
  }
}

/**
 * Fetch an internal /api route, injecting a Clerk bearer token and
 * defaulting credentials to 'include'. Throws ApiError on non-2xx.
 *
 * **Wrong-org self-healing**: Clerk caches issued tokens for ~50s. After a
 * workspace switch, the cached token still carries the previous org_id even
 * though the session has flipped. The first request after a switch can hit
 * the server with the stale token and get back `401 { error: 'wrong-org' }`.
 * We detect that response, force a fresh token via getToken({ skipCache:true }),
 * and retry the request once. Subsequent calls in the same page load reuse
 * the now-refreshed cache.
 * @param {string} path
 * @param {ApiFetchInit} [init]
 * @returns {Promise<Response>}
 */
export async function apiFetchResponse(path, init = {}) {
  const { auth = true, headers, credentials, ...rest } = init
  const mergedHeaders = /** @type {Record<string, string>} */ ({ ...(headers || {}) })
  let usedToken = /** @type {string | null} */ (null)
  if (auth && !hasAuthHeader(mergedHeaders)) {
    usedToken = await getClerkToken()
    if (usedToken) mergedHeaders.Authorization = `Bearer ${usedToken}`
  }
  let res = await fetch(path, {
    ...rest,
    credentials: credentials ?? 'include',
    headers: mergedHeaders,
  })

  // Defensive retry on wrong-org. Only fires when we attached a bearer token
  // ourselves (skipped for callers that passed an explicit Authorization).
  if (auth && res.status === 401 && usedToken) {
    const reason = await peekErrorReason(res)
    if (reason === 'wrong-org') {
      const staleOrgId = decodeJwtOrgId(usedToken)
      console.warn(`[apiFetch] wrong-org on ${path} — cached token org_id=${staleOrgId}; refreshing & retrying`)
      // Brief wait so any in-flight token rotation in Clerk's SDK lands.
      await new Promise(resolve => { setTimeout(resolve, 250) })
      let freshToken = await getClerkTokenFresh()
      let freshOrgId = decodeJwtOrgId(freshToken)

      // Force-flip path. Clerk's session can get genuinely stuck on the wrong
      // active org after a cross-subdomain switch — every getToken (cached or
      // skipCache) returns the previous org's id because Clerk's server still
      // reports lastActiveOrganizationId as the stale org. Diagnosed in prod
      // 2026-05-25 from console logs showing "fresh token still org_id=X"
      // repeated across many endpoints. Mitigation: explicitly call setActive
      // with the expected org_id (exposed by WorkspaceContext on window) to
      // force the flip, then re-fetch the token. Single attempt per page load
      // gated by a module-level flag to prevent infinite loops if the flip
      // still fails.
      if (freshToken && freshOrgId === staleOrgId && !_forceFlipAttempted && typeof window !== 'undefined') {
        const expectedOrgId = /** @type {string | undefined} */ (
          /** @type {any} */ (window).__narraterxExpectedClerkOrgId
        )
        if (expectedOrgId && expectedOrgId !== freshOrgId) {
          _forceFlipAttempted = true
          console.warn(`[apiFetch] session wedged on org_id=${freshOrgId}; expected ${expectedOrgId}. Forcing setActive.`)
          try {
            await /** @type {any} */ (window).Clerk?.setActive?.({ organization: expectedOrgId })
          } catch (e) {
            console.error('[apiFetch] forced setActive threw:', e?.message || e)
          }
          await new Promise(resolve => { setTimeout(resolve, 600) })
          freshToken = await getClerkTokenFresh()
          freshOrgId = decodeJwtOrgId(freshToken)
          if (freshOrgId === expectedOrgId) {
            console.info(`[apiFetch] forced flip succeeded; org_id=${freshOrgId}`)
          } else {
            console.error(`[apiFetch] forced flip FAILED; token still org_id=${freshOrgId} (expected ${expectedOrgId}). Page reload required.`)
            // Surface a reload toast. Guarded by sessionStorage so we don't
            // loop endlessly if Clerk is structurally broken — first failure
            // we offer the reload; second failure of the same kind we surface
            // the error as-is.
            try {
              const seen = sessionStorage.getItem('narraterx:force-flip-reload-offered')
              if (!seen) {
                sessionStorage.setItem('narraterx:force-flip-reload-offered', '1')
                const { toast } = await import('@/lib/toast')
                toast.error('Workspace session is stuck', {
                  description: 'Your active workspace got out of sync. Reload to fix.',
                  action: { label: 'Reload', onClick: () => window.location.reload() },
                  duration: Infinity,
                })
              }
            } catch (_e) { /* toast import failure shouldn't mask the original error */ }
          }
        }
      }

      if (freshToken && freshOrgId && freshOrgId !== staleOrgId) {
        console.info(`[apiFetch] retrying ${path} with fresh org_id=${freshOrgId}`)
        const retryHeaders = { ...mergedHeaders, Authorization: `Bearer ${freshToken}` }
        res = await fetch(path, {
          ...rest,
          credentials: credentials ?? 'include',
          headers: retryHeaders,
        })
      } else {
        // Fresh token didn't change — Clerk's server still has the old active
        // org. The retry would just fail again, so don't bother.
        console.warn(`[apiFetch] fresh token still org_id=${freshOrgId}; not retrying`)
      }
    }
  }

  if (!res.ok) await throwApiError(res)
  return res
}

// Module-level flag for the force-flip path. We only attempt one forced
// setActive per page load — if it doesn't take, retrying it ad infinitum would
// hammer Clerk's servers without progress and risk infinite loops as React
// Query refetches kick in. Cleared naturally on page reload.
let _forceFlipAttempted = false

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

/** @param {string} itemId @param {{ body: string, kind: string }} opts @returns {Promise<unknown>} */
export function createContentItemComment(itemId, { body, kind }) {
  return apiFetch('/api/content-item-comments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemId, body, kind }),
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

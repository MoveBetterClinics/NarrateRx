// Centralized TanStack Query key factory + reusable query/mutation hooks.
//
// The key factory pattern (https://tkdodo.eu/blog/effective-react-query-keys)
// keeps cache invalidation correct: every key is built from the same source,
// so a single `queryClient.invalidateQueries({ queryKey: queryKeys.clinicians.all })`
// flushes every clinician-shaped cache entry in one call.
//
// Layout:
//   queryKeys.clinicians.all           — ['clinicians']
//   queryKeys.clinicians.list()        — ['clinicians','list']
//   queryKeys.clinicians.detail(id)    — ['clinicians','detail', id]
//   queryKeys.workspace.me             — ['workspace','me']
//   queryKeys.contentItems.list(args)  — ['contentItems','list', args]
//   queryKeys.contentItems.detail(id)  — ['contentItems','detail', id]
//   queryKeys.interviews.detail(id)    — ['interviews','detail', id]
//
// Why a factory instead of inline keys: when a mutation needs to invalidate
// "everything clinician-shaped" we want one consistent prefix. Inline keys
// drift over time and become silent staleness bugs.

import { useQuery, useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { useAppMutation } from './useAppMutation'
import {
  apiFetch,
  fetchClinicians,
  fetchClinician,
  deleteClinician,
  deleteInterview,
  updateInterview,
  fetchInterview,
} from './api'
import {
  fetchContentItems,
  fetchContentItem,
  updateContentItem,
  deleteContentItem,
} from './publish'
import { listMedia } from './mediaLib'
import {
  getBrandKit,
  updateBrandAsset,
  deleteBrandAsset,
  assignBrandRole,
  clearBrandRole,
  updateBrandStyle,
} from './brandKitLib'
import { fetchContentPlanAtoms, updateAtomStatus, draftAtom } from './contentPlan'
import { fetchTopicBacklog, createTopic, updateTopic, deleteTopic, suggestTopics } from './topicBacklog'
import { buildStories, deriveStoryStage } from './stories'

export const queryKeys = {
  clinicians: {
    all:    ['clinicians'],
    list:   () => ['clinicians', 'list'],
    card:   () => ['clinicians', 'card'],  // slim view=card shape; populated by useStories
    detail: (id) => ['clinicians', 'detail', id],
  },
  interviews: {
    all:    ['interviews'],
    detail: (id) => ['interviews', 'detail', id],
  },
  contentItems: {
    all:    ['contentItems'],
    list:   (filters = {}) => ['contentItems', 'list', filters],
    detail: (id) => ['contentItems', 'detail', id],
  },
  contentPlan: {
    all:              ['contentPlan'],
    atoms: (ivId) => ['contentPlan', 'atoms', ivId],
  },
  topicBacklog: {
    all:               ['topicBacklog'],
    list: (status) => ['topicBacklog', 'list', status || 'all'],
  },
  workspace: {
    all: ['workspace'],
    me:  ['workspace', 'me'],
  },
  media: {
    all:  ['media'],
    list: (filters = {}) => ['media', 'list', filters],
  },
  brandKit: {
    all: ['brandKit'],
    me:  ['brandKit', 'me'],
  },
  stories: {
    all:    ['stories'],
    list:   (filters = {}) => ['stories', 'list', filters],
    detail: (id) => ['stories', 'detail', id],
  },
  comments: {
    list: (contentItemId) => ['comments', contentItemId],
  },
  topicSuggestions: ['topic-suggestions'],
  topPerformers:    ['top-performers'],
  bufferMetrics: (contentItemId) => ['buffer-metrics', contentItemId],
  locations: {
    all:  ['locations'],
    list: () => ['locations', 'list'],
  },
  onboardingProgress: ['onboarding-progress'],
}

// ── Locations ──────────────────────────────────────────────────────────────

// Returns active workspace_locations ordered by position. Used for location
// filter chips and the admin Locations overview on the Home page.
// staleTime 5 min — location list changes rarely (new clinic added by admin).
export function useLocations() {
  return useQuery({
    queryKey: queryKeys.locations.list(),
    queryFn: () => apiFetch('/api/db/locations').catch(() => []),
    staleTime: 1000 * 60 * 5,
  })
}

// ── Brand Kit ───────────────────────────────────────────────────────────────
//
// Single combined fetch (assets + roles + style) — the Brand Kit UI renders
// all three in one view and collapsing to one call avoids a loading cascade.
// Every mutation invalidates the combined cache key; refetch is cheap on this
// small payload (most workspaces have ≤30 brand assets).

export function useBrandKit(options = {}) {
  return useQuery({
    queryKey: queryKeys.brandKit.me,
    queryFn: getBrandKit,
    ...options,
  })
}

export function useUpdateBrandAsset() {
  const qc = useQueryClient()
  return useAppMutation({
    errorMessage: "Couldn't update brand asset",
    mutationFn: ({ id, patch }) => updateBrandAsset(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.brandKit.all }),
  })
}

export function useDeleteBrandAsset() {
  const qc = useQueryClient()
  return useAppMutation({
    errorMessage: "Couldn't delete brand asset",
    mutationFn: ({ id }) => deleteBrandAsset(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.brandKit.all }),
  })
}

export function useAssignBrandRole() {
  const qc = useQueryClient()
  return useAppMutation({
    errorMessage: "Couldn't assign brand role",
    mutationFn: ({ role, assetId }) => assignBrandRole(role, assetId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.brandKit.all })
      // /api/workspace/me bakes the primary_logo URL into its response so the
      // header can render the brand-kit logo without a second round trip.
      // Invalidate it so a role change updates the header immediately.
      qc.invalidateQueries({ queryKey: queryKeys.workspace.me })
    },
  })
}

export function useClearBrandRole() {
  const qc = useQueryClient()
  return useAppMutation({
    errorMessage: "Couldn't clear brand role",
    mutationFn: ({ role }) => clearBrandRole(role),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.brandKit.all })
      qc.invalidateQueries({ queryKey: queryKeys.workspace.me })
    },
  })
}

export function useUpdateBrandStyle() {
  const qc = useQueryClient()
  return useAppMutation({
    errorMessage: "Couldn't update brand style",
    mutationFn: (patch) => updateBrandStyle(patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.brandKit.all }),
  })
}

// ── Clinicians ──────────────────────────────────────────────────────────────

export function useClinicians(options = {}) {
  return useQuery({
    queryKey: queryKeys.clinicians.list(),
    queryFn: fetchClinicians,
    ...options,
  })
}

export function useClinician(id, options = {}) {
  return useQuery({
    queryKey: queryKeys.clinicians.detail(id),
    queryFn: () => fetchClinician(id),
    enabled: !!id,
    ...options,
  })
}

export function useDeleteClinician() {
  const qc = useQueryClient()
  return useAppMutation({
    errorMessage: "Couldn't delete clinician",
    mutationFn: ({ id, userId }) => deleteClinician(id, userId),
    onSuccess: (_data, { id }) => {
      // Wipe the list cache + the specific detail so a re-fetch sees fresh
      // state. Also flush anything interview-shaped since deleted clinicians
      // cascade their interviews server-side.
      qc.invalidateQueries({ queryKey: queryKeys.clinicians.all })
      qc.removeQueries({ queryKey: queryKeys.clinicians.detail(id) })
      qc.invalidateQueries({ queryKey: queryKeys.interviews.all })
    },
  })
}

// ── Interviews ──────────────────────────────────────────────────────────────

export function useInterview(id, options = {}) {
  return useQuery({
    queryKey: queryKeys.interviews.detail(id),
    queryFn: () => fetchInterview(id),
    enabled: !!id,
    ...options,
  })
}

export function useUpdateInterview() {
  const qc = useQueryClient()
  return useAppMutation({
    errorMessage: "Couldn't update interview",
    mutationFn: ({ id, patch, userId }) => updateInterview(id, patch, userId),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: queryKeys.interviews.detail(id) })
      // Interview status/outputs changes can flip the clinician-list summary
      // (e.g. "X completed interviews"), so refresh the clinician path too.
      qc.invalidateQueries({ queryKey: queryKeys.clinicians.all })
      // Auto-create of content_items on completion (see api/db/interviews.js)
      // means we should also flush the content list.
      qc.invalidateQueries({ queryKey: queryKeys.contentItems.all })
      qc.invalidateQueries({ queryKey: queryKeys.stories.all })
    },
  })
}

export function useDeleteInterview() {
  const qc = useQueryClient()
  return useAppMutation({
    errorMessage: "Couldn't delete interview",
    mutationFn: ({ id, userId }) => deleteInterview(id, userId),
    onSuccess: (_data, { id }) => {
      qc.removeQueries({ queryKey: queryKeys.interviews.detail(id) })
      qc.invalidateQueries({ queryKey: queryKeys.clinicians.all })
      qc.invalidateQueries({ queryKey: queryKeys.contentItems.all })
    },
  })
}

// ── Content items ──────────────────────────────────────────────────────────

export function useContentItems(filters = {}, options = {}) {
  return useQuery({
    queryKey: queryKeys.contentItems.list(filters),
    queryFn: () => fetchContentItems(filters),
    ...options,
  })
}

export function useContentItem(id, options = {}) {
  return useQuery({
    queryKey: queryKeys.contentItems.detail(id),
    queryFn: () => fetchContentItem(id),
    enabled: !!id,
    ...options,
  })
}

export function useUpdateContentItem() {
  const qc = useQueryClient()
  return useAppMutation({
    errorMessage: "Couldn't update content",
    mutationFn: ({ id, patch }) => updateContentItem(id, patch),
    onSuccess: (data, { id }) => {
      // Write the fresh row straight into the detail cache so subscribers
      // get the new value immediately (no extra network round-trip).
      if (data) qc.setQueryData(queryKeys.contentItems.detail(id), data)
      qc.invalidateQueries({ queryKey: queryKeys.contentItems.all })
      qc.invalidateQueries({ queryKey: queryKeys.stories.all })
    },
  })
}

export function useDeleteContentItem() {
  const qc = useQueryClient()
  return useAppMutation({
    errorMessage: "Couldn't delete content",
    mutationFn: (id) => deleteContentItem(id),
    onSuccess: (_data, id) => {
      qc.removeQueries({ queryKey: queryKeys.contentItems.detail(id) })
      qc.invalidateQueries({ queryKey: queryKeys.contentItems.all })
    },
  })
}

// ── Media (infinite) ───────────────────────────────────────────────────────

// MediaHub serves a paginated grid that can run into thousands of rows.
// useInfiniteQuery gives us: cache by filter signature, automatic dedupe
// across remounts, getNextPageParam-driven "load more," and pages-array
// shape that keeps prior pages on disk so a return-to-grid is instant.
export function useMediaInfinite(filters = {}, options = {}) {
  const { pageSize = 120, ...rest } = options
  return useInfiniteQuery({
    queryKey: queryKeys.media.list(filters),
    queryFn: ({ pageParam = 0 }) => listMedia({ ...filters, limit: pageSize, offset: pageParam }),
    initialPageParam: 0,
    // Stop paginating once we get a short page — the server returned fewer
    // rows than requested, so there's nothing beyond it.
    getNextPageParam: (lastPage, allPages) => {
      if (!Array.isArray(lastPage) || lastPage.length < pageSize) return undefined
      return allPages.reduce((sum, p) => sum + p.length, 0)
    },
    ...rest,
  })
}

// ── Content plan ───────────────────────────────────────────────────────────

export function useContentPlanAtoms(interviewId, options = {}) {
  return useQuery({
    queryKey: queryKeys.contentPlan.atoms(interviewId),
    queryFn: () => fetchContentPlanAtoms(interviewId),
    enabled: !!interviewId,
    ...options,
  })
}

export function useDraftAtom() {
  const qc = useQueryClient()
  return useAppMutation({
    errorMessage: "Couldn't draft content piece",
    mutationFn: ({ atomId }) => draftAtom(atomId),
    onSuccess: (_data, { interviewId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.contentPlan.atoms(interviewId) })
      qc.invalidateQueries({ queryKey: queryKeys.contentItems.all })
    },
  })
}

export function useSkipAtom() {
  const qc = useQueryClient()
  return useAppMutation({
    errorMessage: "Couldn't update content piece",
    mutationFn: ({ atomId, status }) => updateAtomStatus(atomId, status),
    onSuccess: (_data, { interviewId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.contentPlan.atoms(interviewId) })
    },
  })
}

// ── Topic backlog ──────────────────────────────────────────────────────────

export function useTopicBacklog(status, options = {}) {
  return useQuery({
    queryKey: queryKeys.topicBacklog.list(status),
    queryFn: () => fetchTopicBacklog(status),
    ...options,
  })
}

export function useCreateTopic() {
  const qc = useQueryClient()
  return useAppMutation({
    errorMessage: "Couldn't create topic",
    mutationFn: (payload) => createTopic(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.topicBacklog.all }),
  })
}

export function useUpdateTopic() {
  const qc = useQueryClient()
  return useAppMutation({
    errorMessage: "Couldn't update topic",
    mutationFn: ({ id, patch }) => updateTopic(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.topicBacklog.all }),
  })
}

export function useDeleteTopic() {
  const qc = useQueryClient()
  return useAppMutation({
    errorMessage: "Couldn't delete topic",
    mutationFn: (id) => deleteTopic(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.topicBacklog.all }),
  })
}

export function useSuggestTopics() {
  const qc = useQueryClient()
  return useAppMutation({
    errorMessage: "Couldn't suggest topics",
    mutationFn: (count) => suggestTopics(count),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.topicBacklog.all }),
  })
}

// ── Stories ────────────────────────────────────────────────────────────────
//
// Stories anchor on interviews with content_items rolled up. Both views
// (Cards + Pipeline) and the Story Detail page consume the same shape from
// buildStories(). useStories fetches both upstream lists in parallel and
// merges them client-side so there's a single cache entry for the full list.

// Slim list query — uses ?view=card on both endpoints so the payload only
// carries columns the Cards / Pipeline / Calendar / Themes views actually
// read (drops `messages`, `content`, `media_urls`, `buffer_metrics`, etc.).
// staleTime 5min — list rarely changes outside of explicit user actions, and
// every relevant mutation invalidates queryKeys.stories.all.
//
// Side-effect: writes the raw clinicians array to queryKeys.clinicians.card()
// so Home's useClinicianSummaries() is a free cache hit when Stories has
// already loaded, eliminating the duplicate clinicians network request.
export function useStories(filters = {}, options = {}) {
  const qc = useQueryClient()
  return useQuery({
    queryKey: queryKeys.stories.list(filters),
    queryFn: async () => {
      const [clinicians, contentItems] = await Promise.all([
        apiFetch('/api/db/clinicians?view=card'),
        apiFetch('/api/db/content?view=card&limit=500'),
      ])
      qc.setQueryData(queryKeys.clinicians.card(), clinicians)
      return buildStories(clinicians, contentItems)
    },
    staleTime: 5 * 60_000,
    ...options,
  })
}

// Slim clinician summaries — used by Home page for the "overdue" bucket and
// resume strip. Shares the view=card endpoint with useStories; when Stories
// has already loaded, setQueryData above makes this a zero-network cache hit.
// Falls back to a direct fetch if Home loads before Stories (e.g. direct URL).
export function useClinicianSummaries(options = {}) {
  return useQuery({
    queryKey: queryKeys.clinicians.card(),
    queryFn: () => apiFetch('/api/db/clinicians?view=card'),
    staleTime: 5 * 60_000,
    ...options,
  })
}

// Standalone fetcher extracted so prefetchQuery in StoryCard can reuse the
// same queryFn without duplicating the fetch logic.
export async function fetchStory(interviewId) {
  const [interviews, contentItems] = await Promise.all([
    apiFetch(`/api/db/interviews?id=${encodeURIComponent(interviewId)}`),
    apiFetch(`/api/db/content?interviewId=${encodeURIComponent(interviewId)}`),
  ])
  const interview = Array.isArray(interviews) ? interviews[0] : interviews
  if (!interview) return null
  const pieces = Array.isArray(contentItems) ? contentItems : []
  return {
    ...interview,
    pieces,
    pieces_count: pieces.length,
    story_stage: deriveStoryStage(interview, pieces),
    last_activity_at: pieces.reduce(
      (acc, p) => (p.updated_at > acc ? p.updated_at : acc),
      interview.updated_at,
    ),
  }
}

// Detail query. Seeds placeholderData from the cached Stories list (if any)
// so the header + tabs render instantly on navigation; the network round-trip
// only blocks the transcript pane filling in. Without this, the page sits on
// a spinner for the full interview+content fetch.
export function useStory(interviewId, options = {}) {
  const qc = useQueryClient()
  return useQuery({
    queryKey: queryKeys.stories.detail(interviewId),
    queryFn: () => fetchStory(interviewId),
    enabled: !!interviewId,
    staleTime: 30_000,
    placeholderData: () => {
      // Find the matching story in any cached Stories list. Returns the slim
      // story shape (no transcript yet) — enough to render the header, badge,
      // pieces tabs, and approval panel. The real query then fills in
      // messages/cleaned_messages for the transcript pane.
      const lists = qc.getQueriesData({ queryKey: queryKeys.stories.all })
      for (const [, data] of lists) {
        if (!Array.isArray(data)) continue
        const hit = data.find((s) => s?.id === interviewId)
        if (hit) return hit
      }
      return undefined
    },
    ...options,
  })
}

// ── Comments ───────────────────────────────────────────────────────────────

export function useComments(contentItemId, options = {}) {
  return useQuery({
    queryKey: queryKeys.comments.list(contentItemId),
    queryFn: () => apiFetch(`/api/db/comments?contentItemId=${encodeURIComponent(contentItemId)}`),
    enabled: !!contentItemId,
    ...options,
  })
}

export function useAddComment(contentItemId) {
  const qc = useQueryClient()
  return useAppMutation({
    errorMessage: "Couldn't post comment",
    mutationFn: ({ body, kind = 'comment' }) =>
      apiFetch('/api/db/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentItemId, body, kind }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.comments.list(contentItemId) }),
  })
}

// ── Topic suggestions (geo-local AI) ──────────────────────────────────────
//
// Fetches 5 AI-generated patient questions for the current workspace.
// The server caches results for 7 days; the client caches for 6 hours.
// Pass ?refresh=true to bust the server-side cache.

export function useTopicSuggestions() {
  return useQuery({
    queryKey: queryKeys.topicSuggestions,
    queryFn: () => apiFetch('/api/topic-suggestions').catch(() => ({ suggestions: [] })),
    staleTime: 1000 * 60 * 60 * 6, // 6h client-side cache
  })
}

// ── Top performers ──────────────────────────────────────────────────────────
//
// Fetches published content items, filters to those with buffer_metrics, and
// returns the top 3 by reach for the "What's working" insight panel.
// Stale time is 1h — metrics settle over hours, not seconds.

export function useTopPerformers() {
  return useQuery({
    queryKey: queryKeys.topPerformers,
    queryFn: async () => {
      // view=performers returns only the 5 cols this widget needs; drops
      // content body, media_urls, notes, hashtags, etc. (full row = 27 cols).
      const items = await apiFetch('/api/db/content?status=published&limit=20&view=performers').catch(() => [])
      if (!Array.isArray(items)) return []
      return items
        .filter((i) => i.buffer_metrics?.reach || i.buffer_metrics?.engagement)
        .sort((a, b) => (b.buffer_metrics?.reach || 0) - (a.buffer_metrics?.reach || 0))
        .slice(0, 3)
    },
    staleTime: 1000 * 60 * 60, // 1h
  })
}

// Regenerate the AI content for a single content_item in place.
// Resets the row to status=draft and clears approval audit fields, so any
// previously-approved piece needs fresh review before publish.
export function useRegenerateContentItem() {
  const qc = useQueryClient()
  return useAppMutation({
    errorMessage: 'Regeneration failed',
    mutationFn: ({ id }) =>
      apiFetch('/api/content-items/regenerate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.contentItems.all })
      qc.invalidateQueries({ queryKey: queryKeys.stories.all })
    },
  })
}

export function useUpdateContentItemStatus() {
  const qc = useQueryClient()
  return useAppMutation({
    errorMessage: "Couldn't update status",
    mutationFn: ({ id, status, approvedBy, approvedAt, reviewedBy, resolvedUrl, publishedAt }) => {
      const body = { id, status, approvedBy, approvedAt, reviewedBy }
      if (resolvedUrl !== undefined) body.resolvedUrl = resolvedUrl
      if (publishedAt !== undefined) body.publishedAt = publishedAt
      return apiFetch(`/api/db/content?id=${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.contentItems.all })
      qc.invalidateQueries({ queryKey: queryKeys.stories.all })
    },
  })
}

// ── Buffer Analytics ─────────────────────────────────────────────────────────

export function useBufferMetrics(contentItemId, options = {}) {
  return useQuery({
    queryKey: queryKeys.bufferMetrics(contentItemId),
    queryFn: () =>
      apiFetch(`/api/buffer-analytics?contentItemId=${encodeURIComponent(contentItemId)}`)
        .catch(() => null),
    enabled: !!contentItemId,
    staleTime: 1000 * 60 * 30, // 30min — Buffer stats don't update by the second
    ...options,
  })
}

// ── Onboarding Progress ───────────────────────────────────────────────────────

// Fetches activation checklist state + trial status for the current workspace.
// Response: { steps: [{key, label, done}], trialDaysLeft, completed, plan }
//
// Refreshes every 60s so step completion is reflected shortly after a user
// performs an action in another tab. Callers can also call refetch() directly
// after a user action to get immediate feedback.
export function useOnboardingProgress(options = {}) {
  return useQuery({
    queryKey: queryKeys.onboardingProgress,
    queryFn: () => apiFetch('/api/onboarding/progress').catch(() => null),
    staleTime: 1000 * 60, // 60s
    ...options,
  })
}

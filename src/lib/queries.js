// Centralized TanStack Query key factory + reusable query/mutation hooks.
//
// The key factory pattern (https://tkdodo.eu/blog/effective-react-query-keys)
// keeps cache invalidation correct: every key is built from the same source,
// so a single `queryClient.invalidateQueries({ queryKey: queryKeys.staff.all })`
// flushes every clinician-shaped cache entry in one call.
//
// Layout:
//   queryKeys.staff.all           — ['staff']
//   queryKeys.staff.list()        — ['staff','list']
//   queryKeys.staff.detail(id)    — ['staff','detail', id]
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
  fetchStaff,
  fetchStaffMember,
  deleteStaff,
  patchStaff,
  deleteInterview,
  updateInterview,
  fetchInterview,
  fetchStaffMemberRecipes,
  createStaffRecipe,
  patchStaffRecipe,
  deleteStaffRecipe,
} from './api'
import {
  fetchContentItems,
  fetchContentItem,
  updateContentItem,
  deleteContentItem,
  suggestMediaForDraft,
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
import { fetchContentPlanAtoms, updateAtomStatus, draftAtom, setChannelEnabled } from './contentPlan'
import { fetchTopicBacklog, createTopic, updateTopic, deleteTopic, suggestTopics } from './topicBacklog'
import { fetchReferences, createReference, updateReference, deleteReference } from './interviewReferences'
import { buildStories, deriveStoryStage } from './stories'

export const queryKeys = {
  staff: {
    all:    ['staff'],
    list:   () => ['staff', 'list'],
    card:   () => ['staff', 'card'],  // slim view=card shape; populated by useStories
    detail: (id) => ['staff', 'detail', id],
  },
  interviews: {
    all:    ['interviews'],
    detail: (id) => ['interviews', 'detail', id],
  },
  contentItems: {
    all:      ['contentItems'],
    list:     (filters = {}) => ['contentItems', 'list', filters],
    detail:   (id) => ['contentItems', 'detail', id],
    keystone: (ivId) => ['contentItems', 'keystone', ivId],
    splitSuggestion: (id) => ['contentItems', 'splitSuggestion', id],
    mediaSuggestions: (id) => ['contentItems', 'mediaSuggestions', id],
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
  campaigns: {
    all:  ['campaigns'],
    list: () => ['campaigns', 'list'],
  },
  staffRecipes: {
    all:                ['staffRecipes'],
    forStaff: (id) => ['staffRecipes', 'forStaff', id],
  },
  references: {
    all:           ['references'],
    forTopic:      (id) => ['references', 'topic', id],
    forInterview:  (id) => ['references', 'interview', id],
  },
  onboardingProgress: ['onboarding-progress'],
  carouselThemes: {
    all:  ['carouselThemes'],
    list: () => ['carouselThemes', 'list'],
  },
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

export function useStaff(options = {}) {
  return useQuery({
    queryKey: queryKeys.staff.list(),
    queryFn: fetchStaff,
    ...options,
  })
}

export function useStaffMember(id, options = {}) {
  return useQuery({
    queryKey: queryKeys.staff.detail(id),
    queryFn: () => fetchStaffMember(id),
    enabled: !!id,
    ...options,
  })
}

export function useDeleteStaff() {
  const qc = useQueryClient()
  return useAppMutation({
    errorMessage: "Couldn't delete staff member",
    mutationFn: ({ id, userId }) => deleteStaff(id, userId),
    onSuccess: (_data, { id }) => {
      // Wipe the list cache + the specific detail so a re-fetch sees fresh
      // state. Also flush anything interview-shaped since deleted clinicians
      // cascade their interviews server-side.
      qc.invalidateQueries({ queryKey: queryKeys.staff.all })
      qc.removeQueries({ queryKey: queryKeys.staff.detail(id) })
      qc.invalidateQueries({ queryKey: queryKeys.interviews.all })
    },
  })
}

export function usePatchStaff() {
  const qc = useQueryClient()
  return useAppMutation({
    errorMessage: "Couldn't save staff member",
    mutationFn: ({ id, patch, userId }) => patchStaff(id, patch, userId),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: queryKeys.staff.detail(id) })
      qc.invalidateQueries({ queryKey: queryKeys.staff.list() })
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
    mutationFn: ({ id, patch }) => updateInterview(id, patch),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: queryKeys.interviews.detail(id) })
      // Interview status/outputs changes can flip the clinician-list summary
      // (e.g. "X completed interviews"), so refresh the clinician path too.
      qc.invalidateQueries({ queryKey: queryKeys.staff.all })
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
    mutationFn: ({ id }) => deleteInterview(id),
    onSuccess: (_data, { id }) => {
      qc.removeQueries({ queryKey: queryKeys.interviews.detail(id) })
      qc.invalidateQueries({ queryKey: queryKeys.interviews.all })
      qc.invalidateQueries({ queryKey: queryKeys.stories.all })
      qc.invalidateQueries({ queryKey: queryKeys.staff.all })
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

// Ranked media candidates for a draft (the media→content matcher). `enabled` is
// destructured so the worklist can fetch lazily per-row (one embed per expand,
// no thundering herd on page load) while still respecting the pieceId guard.
export function useMediaSuggestions(pieceId, { enabled = true, ...options } = {}) {
  return useQuery({
    queryKey: queryKeys.contentItems.mediaSuggestions(pieceId),
    queryFn: () => suggestMediaForDraft(pieceId),
    enabled: !!pieceId && enabled,
    staleTime: 5 * 60_000,        // suggestions are stable within a session
    refetchOnWindowFocus: false,
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
      qc.invalidateQueries({ queryKey: queryKeys.contentPlan.all })
      // V5: a winner toggle changes performed_well, which the Slate's Coverage
      // tab rolls up into per-topic / per-clinician winner counts.
      qc.invalidateQueries({ queryKey: ['editorial-coverage'] })
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
      qc.invalidateQueries({ queryKey: queryKeys.contentPlan.all })
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

// Keystone long-form piece (the blog post) for an interview. Sits above the
// atom groups in ContentPlanPanel as the source piece the atoms derive from.
export function useKeystoneBlog(interviewId, options = {}) {
  return useQuery({
    queryKey: queryKeys.contentItems.keystone(interviewId),
    queryFn: async () => {
      const rows = await fetchContentItems({ interviewId, platform: 'blog', limit: 1 })
      return Array.isArray(rows) && rows.length ? rows[0] : null
    },
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

// Per-story channel control — enable/disable a whole Content Plan channel for
// one interview. Disabling skips its non-published atoms; enabling restores
// them. Invalidates both the atoms list (drives the plan UI) and content_items
// (skipped/restored drafts move in/out of Drafts surfaces).
export function useSetChannelEnabled() {
  const qc = useQueryClient()
  return useAppMutation({
    errorMessage: "Couldn't update channels",
    mutationFn: ({ interviewId, platform, enabled }) => setChannelEnabled(interviewId, platform, enabled),
    onSuccess: (_data, { interviewId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.contentPlan.atoms(interviewId) })
      qc.invalidateQueries({ queryKey: queryKeys.contentItems.all })
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

// ── Interview references ───────────────────────────────────────────────────
//
// External article URLs attached to either a topic_backlog row (pre-interview
// reading) or an interview (post-interview source list). Display-only; the
// `use_as_source` flag is staged for a future AI-ingestion path.

export function useReferences({ topicId, interviewId } = {}) {
  const enabled = Boolean(topicId || interviewId)
  return useQuery({
    queryKey: topicId
      ? queryKeys.references.forTopic(topicId)
      : queryKeys.references.forInterview(interviewId),
    queryFn: () => fetchReferences({ topicId, interviewId }),
    enabled,
    staleTime: 1000 * 30,
  })
}

export function useCreateReference() {
  const qc = useQueryClient()
  return useAppMutation({
    errorMessage: "Couldn't add reference",
    mutationFn: (payload) => createReference(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.references.all }),
  })
}

export function useUpdateReference() {
  const qc = useQueryClient()
  return useAppMutation({
    errorMessage: "Couldn't update reference",
    mutationFn: ({ id, patch }) => updateReference(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.references.all }),
  })
}

export function useDeleteReference() {
  const qc = useQueryClient()
  return useAppMutation({
    errorMessage: "Couldn't delete reference",
    mutationFn: (id) => deleteReference(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.references.all }),
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
// Side-effect: writes the raw staff array to queryKeys.staff.card()
// so Home's useStaffSummaries() is a free cache hit when Stories has
// already loaded, eliminating the duplicate staff network request.
export function useStories(filters = {}, options = {}) {
  const qc = useQueryClient()
  return useQuery({
    queryKey: queryKeys.stories.list(filters),
    queryFn: async () => {
      const [staff, contentItems] = await Promise.all([
        apiFetch('/api/db/staff?view=card'),
        apiFetch('/api/db/content?view=card&limit=500'),
      ])
      qc.setQueryData(queryKeys.staff.card(), staff)
      return buildStories(staff, contentItems)
    },
    staleTime: 5 * 60_000,
    ...options,
  })
}

// Slim clinician summaries — used by Home page for the "overdue" bucket and
// resume strip. Shares the view=card endpoint with useStories; when Stories
// has already loaded, setQueryData above makes this a zero-network cache hit.
// Falls back to a direct fetch if Home loads before Stories (e.g. direct URL).
export function useStaffSummaries(options = {}) {
  return useQuery({
    queryKey: queryKeys.staff.card(),
    queryFn: () => apiFetch('/api/db/staff?view=card'),
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
// Queries /api/engagement/top-performers which reads engagement_snapshots
// across both Buffer and GA4 sources. Previously read buffer_metrics directly
// from content_items, which excluded website-published posts with GA4 data.
// Stale time is 1h — metrics settle over hours, not seconds.

export function useTopPerformers() {
  return useQuery({
    queryKey: queryKeys.topPerformers,
    queryFn: async () => {
      const data = await apiFetch('/api/engagement/top-performers').catch(() => null)
      return data?.performers ?? []
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
    mutationFn: ({ id, lengthPreset, generationStyle }) =>
      apiFetch('/api/content-items/regenerate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          ...(lengthPreset != null ? { length_preset: lengthPreset } : {}),
          ...(generationStyle != null ? { generation_style: generationStyle } : {}),
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.contentItems.all })
      qc.invalidateQueries({ queryKey: queryKeys.stories.all })
      qc.invalidateQueries({ queryKey: queryKeys.contentPlan.all })
    },
  })
}

// Streamed blog-piece regeneration. Splits the old single-shot
// /api/content-items/regenerate call into three steps so the long-running
// Opus blog generation goes through /api/stream (which has its own 300s cap
// and emits SSE chunks, sidestepping the 60→180s function-cap dance):
//
//   1. POST /api/content-items/blog-regen-prepare  — server builds prompt
//   2. stream the model via /api/stream            — chunks accumulate
//   3. POST /api/content-items/blog-regen-finalize — server writes DB
//
// onChunk is optional; pass it to render partial output as it streams.
// The mutation resolves with the finalized content_items row.
export function useRegenerateBlogStreamed() {
  const qc = useQueryClient()
  return useAppMutation({
    errorMessage: 'Regeneration failed',
    mutationFn: async ({ id, lengthPreset, generationStyle, onChunk, signal } = {}) => {
      const { streamMessage } = await import('@/lib/claude')
      const prep = await apiFetch('/api/content-items/blog-regen-prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          ...(lengthPreset != null ? { length_preset: lengthPreset } : {}),
          ...(generationStyle != null ? { generation_style: generationStyle } : {}),
        }),
        signal,
      })
      if (!prep?.systemPrompt || !Array.isArray(prep.messages)) {
        throw new Error('Prepare returned an invalid payload')
      }

      let acc = ''
      for await (const delta of streamMessage(prep.messages, prep.systemPrompt, {
        model: prep.model,
        maxOutputTokens: prep.maxOutputTokens,
        signal,
      })) {
        acc += delta
        if (onChunk) onChunk(acc)
      }
      if (!acc.trim()) throw new Error('No content returned from generation')

      const row = await apiFetch('/api/content-items/blog-regen-finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          content: acc,
          ...(lengthPreset != null ? { length_preset: lengthPreset } : {}),
          ...(generationStyle != null ? { generation_style: generationStyle } : {}),
        }),
        signal,
      })
      return row
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.contentItems.all })
      qc.invalidateQueries({ queryKey: queryKeys.stories.all })
      qc.invalidateQueries({ queryKey: queryKeys.contentPlan.all })
    },
  })
}

// Split a single blog content_item into a multi-part series. Calls the
// two-pass cluster+write pipeline server-side. On success the original blog
// is archived and N new draft pieces appear with series_id / series_part /
// series_total populated.
export function useSplitBlogIntoSeries() {
  const qc = useQueryClient()
  return useAppMutation({
    errorMessage: 'Series generation failed',
    mutationFn: ({ id, parts, lengthPreset }) =>
      apiFetch('/api/content-items/split-into-series', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          parts,
          ...(lengthPreset != null ? { length_preset: lengthPreset } : {}),
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.contentItems.all })
      qc.invalidateQueries({ queryKey: queryKeys.stories.all })
      qc.invalidateQueries({ queryKey: queryKeys.contentPlan.all })
    },
  })
}

// Multi-piece extract detection (PR 4). Asks the server whether a blog piece's
// source interview holds enough distinct threads to PROPOSE a split. Read-only
// — the result drives the optional "split into N posts?" banner on Story
// Detail; accepting it calls useSplitBlogIntoSeries with the recommended count.
//
// Gated to eligible pieces only (blog, not already a series, splittable status,
// has a source interview) so we never spend an AI call where a split is
// impossible. staleTime is long — the recommendation only changes if the
// transcript changes, which it doesn't post-interview.
const SPLITTABLE_STATUSES = new Set(['draft', 'in_review', 'approved'])

export function useSplitSuggestion(piece) {
  const eligible = !!piece
    && piece.platform === 'blog'
    && !piece.series_id
    && !!piece.interview_id
    && SPLITTABLE_STATUSES.has(piece.status)

  return useQuery({
    queryKey: queryKeys.contentItems.splitSuggestion(piece?.id),
    queryFn: () =>
      apiFetch('/api/content-items/suggest-split', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: piece.id }),
      }).catch(() => null),
    enabled: eligible,
    staleTime: 1000 * 60 * 30,
    gcTime: 1000 * 60 * 60,
    refetchOnWindowFocus: false,
    retry: false,
  })
}

export function useUpdateContentItemStatus() {
  const qc = useQueryClient()
  return useAppMutation({
    errorMessage: "Couldn't update status",
    mutationFn: ({ id, status, approvedBy, approvedAt, reviewedBy, resolvedUrl, publishedAt, scheduledAt, bufferUpdateId }) => {
      const body = { id, status, approvedBy, approvedAt, reviewedBy }
      if (resolvedUrl !== undefined) body.resolvedUrl = resolvedUrl
      if (publishedAt !== undefined) body.publishedAt = publishedAt
      if (scheduledAt !== undefined) body.scheduledAt = scheduledAt
      if (bufferUpdateId !== undefined) body.bufferUpdateId = bufferUpdateId
      return apiFetch(`/api/db/content?id=${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.contentItems.all })
      qc.invalidateQueries({ queryKey: queryKeys.stories.all })
      qc.invalidateQueries({ queryKey: queryKeys.contentPlan.all })
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

// ── Campaigns ──────────────────────────────────────────────────────────────
//
// Workspace-scoped goal clusters that group interviews around a theme.
// `contributed_count` is rolled up server-side by /api/campaigns/list — it's
// the number of distinct clinicians whose interviews are tagged with the
// campaign and have at least one message (interviewer fired).
//
// staleTime 2 min — campaign progress updates only when a new interview is
// recorded against the campaign; explicit invalidations after upsert keep
// the cache honest in between.

export function useCampaigns(options = {}) {
  return useQuery({
    queryKey: queryKeys.campaigns.list(),
    queryFn: () => apiFetch('/api/campaigns/list').catch(() => []),
    staleTime: 1000 * 60 * 2,
    ...options,
  })
}

export function useUpsertCampaign() {
  const qc = useQueryClient()
  return useAppMutation({
    errorMessage: "Couldn't save campaign",
    mutationFn: (payload) =>
      apiFetch('/api/campaigns/upsert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.campaigns.all }),
  })
}

// ── Clinician Recipes ──────────────────────────────────────────────────────

export function useStaffRecipes(staffId, options = {}) {
  return useQuery({
    queryKey: queryKeys.staffRecipes.forStaff(staffId),
    queryFn: () => fetchStaffMemberRecipes(staffId),
    enabled: !!staffId,
    staleTime: 1000 * 30,
    ...options,
  })
}

export function useCreateStaffRecipe() {
  const qc = useQueryClient()
  return useAppMutation({
    errorMessage: "Couldn't save recipe",
    mutationFn: (body) => createStaffRecipe(body),
    onSuccess: (_data, body) => {
      qc.invalidateQueries({ queryKey: queryKeys.staffRecipes.forStaff(body.staffId) })
    },
  })
}

export function usePatchStaffRecipe() {
  const qc = useQueryClient()
  return useAppMutation({
    errorMessage: "Couldn't save recipe",
    mutationFn: ({ id, patch }) => patchStaffRecipe(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.staffRecipes.all }),
  })
}

export function useDeleteStaffRecipe() {
  const qc = useQueryClient()
  return useAppMutation({
    errorMessage: "Couldn't delete recipe",
    mutationFn: ({ id }) => deleteStaffRecipe(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.staffRecipes.all }),
  })
}

// ── Carousel themes ────────────────────────────────────────────────────────

export function useCarouselThemes() {
  return useQuery({
    queryKey: queryKeys.carouselThemes.list(),
    queryFn:  () => apiFetch('/api/carousel-themes').then((d) => d.themes ?? []),
    staleTime: 5 * 60 * 1000,
  })
}

export function useCreateCarouselTheme() {
  const qc = useQueryClient()
  return useAppMutation({
    errorMessage: "Couldn't create theme",
    mutationFn: (body) => apiFetch('/api/carousel-themes', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.carouselThemes.all }),
  })
}

export function useUpdateCarouselTheme() {
  const qc = useQueryClient()
  return useAppMutation({
    errorMessage: "Couldn't update theme",
    mutationFn: ({ id, patch }) => apiFetch(`/api/carousel-themes/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.carouselThemes.all }),
  })
}

export function useDeleteCarouselTheme() {
  const qc = useQueryClient()
  return useAppMutation({
    errorMessage: "Couldn't delete theme",
    mutationFn: (id) => apiFetch(`/api/carousel-themes/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.carouselThemes.all }),
  })
}

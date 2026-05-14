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

import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
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
  bufferMetrics: (contentItemId) => ['buffer-metrics', contentItemId],
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
  return useMutation({
    mutationFn: ({ id, patch }) => updateBrandAsset(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.brandKit.all }),
  })
}

export function useDeleteBrandAsset() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id }) => deleteBrandAsset(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.brandKit.all }),
  })
}

export function useAssignBrandRole() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ role, assetId }) => assignBrandRole(role, assetId),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.brandKit.all }),
  })
}

export function useClearBrandRole() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ role }) => clearBrandRole(role),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.brandKit.all }),
  })
}

export function useUpdateBrandStyle() {
  const qc = useQueryClient()
  return useMutation({
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
  return useMutation({
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
  return useMutation({
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
  return useMutation({
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
  return useMutation({
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
  return useMutation({
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
  return useMutation({
    mutationFn: ({ atomId }) => draftAtom(atomId),
    onSuccess: (_data, { interviewId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.contentPlan.atoms(interviewId) })
      qc.invalidateQueries({ queryKey: queryKeys.contentItems.all })
    },
  })
}

export function useSkipAtom() {
  const qc = useQueryClient()
  return useMutation({
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
  return useMutation({
    mutationFn: (payload) => createTopic(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.topicBacklog.all }),
  })
}

export function useUpdateTopic() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }) => updateTopic(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.topicBacklog.all }),
  })
}

export function useDeleteTopic() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id) => deleteTopic(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.topicBacklog.all }),
  })
}

export function useSuggestTopics() {
  const qc = useQueryClient()
  return useMutation({
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

export function useStories(filters = {}, options = {}) {
  return useQuery({
    queryKey: queryKeys.stories.list(filters),
    queryFn: async () => {
      const [cliniciansRes, contentRes] = await Promise.all([
        fetch('/api/db/clinicians', { credentials: 'include' }),
        fetch('/api/db/content?limit=500', { credentials: 'include' }),
      ])
      if (!cliniciansRes.ok) throw new Error('Failed to fetch clinicians')
      if (!contentRes.ok) throw new Error('Failed to fetch content')
      const clinicians = await cliniciansRes.json()
      const contentItems = await contentRes.json()
      return buildStories(clinicians, contentItems)
    },
    staleTime: 30_000,
    ...options,
  })
}

export function useStory(interviewId, options = {}) {
  return useQuery({
    queryKey: queryKeys.stories.detail(interviewId),
    queryFn: async () => {
      const [intRes, contentRes] = await Promise.all([
        fetch(`/api/db/interviews?id=${interviewId}`, { credentials: 'include' }),
        fetch(`/api/db/content?interviewId=${interviewId}`, { credentials: 'include' }),
      ])
      if (!intRes.ok) throw new Error('Failed to fetch interview')
      if (!contentRes.ok) throw new Error('Failed to fetch content')
      const interviews = await intRes.json()
      const contentItems = await contentRes.json()
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
    },
    enabled: !!interviewId,
    staleTime: 30_000,
    ...options,
  })
}

// ── Comments ───────────────────────────────────────────────────────────────

export function useComments(contentItemId, options = {}) {
  return useQuery({
    queryKey: queryKeys.comments.list(contentItemId),
    queryFn: async () => {
      const r = await fetch(`/api/db/comments?contentItemId=${contentItemId}`, { credentials: 'include' })
      if (!r.ok) throw new Error('Failed to fetch comments')
      return r.json()
    },
    enabled: !!contentItemId,
    ...options,
  })
}

export function useAddComment(contentItemId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ body, kind = 'comment' }) => {
      const r = await fetch('/api/db/comments', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentItemId, body, kind }),
      })
      if (!r.ok) throw new Error('Failed to add comment')
      return r.json()
    },
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
    queryFn: async () => {
      const r = await fetch('/api/topic-suggestions', { credentials: 'include' })
      if (!r.ok) return { suggestions: [] }
      return r.json()
    },
    staleTime: 1000 * 60 * 60 * 6, // 6h client-side cache
  })
}

export function useUpdateContentItemStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, status, approvedBy, approvedAt, reviewedBy }) => {
      const r = await fetch('/api/db/content', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status, approvedBy, approvedAt, reviewedBy }),
      })
      if (!r.ok) throw new Error('Failed to update status')
      return r.json()
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
    queryFn: async () => {
      const r = await fetch(`/api/buffer-analytics?contentItemId=${contentItemId}`, { credentials: 'include' })
      if (!r.ok) return null
      return r.json()
    },
    enabled: !!contentItemId,
    staleTime: 1000 * 60 * 30, // 30min — Buffer stats don't update by the second
    ...options,
  })
}

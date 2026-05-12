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

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
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
  workspace: {
    all: ['workspace'],
    me:  ['workspace', 'me'],
  },
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

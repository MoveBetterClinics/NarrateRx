// Client helpers + a small react-query hook around /api/book/excluded-sources.
//
// The exclusions list is workspace-wide, admin-only, and small (a handful of
// rows per workspace at most), so we fetch the whole list once and let every
// toggle look itself up. One cache key shared across StoryDetail + AuthorMode
// means a flip on one surface is reflected on the other after invalidate.

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { useAppMutation } from '@/lib/useAppMutation'

export const BOOK_EXCLUSIONS_KEY = ['book-excluded-sources']

export function fetchExcludedSources() {
  return apiFetch('/api/book/excluded-sources')
}

export function excludeSource({ sourceTable, sourceId, reason }) {
  return apiFetch('/api/book/excluded-sources', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source_table: sourceTable, source_id: sourceId, reason }),
  })
}

export function includeSource({ sourceTable, sourceId }) {
  const qs = new URLSearchParams({ source_table: sourceTable, source_id: sourceId })
  return apiFetch(`/api/book/excluded-sources?${qs.toString()}`, { method: 'DELETE' })
}

export function regenerateBook() {
  return apiFetch('/api/book/regenerate', { method: 'POST' })
}

// Single source of truth for "is this source excluded?". Returns helpers that
// caller wires to a checkbox/switch. `enabled` skips the network round-trip
// for non-admins so we don't reveal the endpoint shape to clinicians.
export function useBookExclusion({ sourceTable, sourceId, enabled = true }) {
  const queryClient = useQueryClient()

  const { data: list = [], isLoading } = useQuery({
    queryKey: BOOK_EXCLUSIONS_KEY,
    queryFn: fetchExcludedSources,
    enabled,
    staleTime: 30_000,
  })

  const isExcluded = list.some(
    (row) => row.source_table === sourceTable && row.source_id === sourceId
  )

  const setExcluded = useAppMutation({
    mutationFn: (next) =>
      next
        ? excludeSource({ sourceTable, sourceId })
        : includeSource({ sourceTable, sourceId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: BOOK_EXCLUSIONS_KEY }),
    errorMessage: 'Could not update book exclusion',
  })

  return { isExcluded, isLoading, setExcluded }
}

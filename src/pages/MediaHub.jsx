import { useState, useEffect, useCallback, useRef } from 'react'
import { useUser } from '@clerk/clerk-react'
import { Search, Loader2, Filter, X, CheckSquare, Image as ImageIcon, Upload as UploadIcon, SearchX } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import EmptyState from '@/components/EmptyState'
import MediaUploader from '@/components/MediaUploader'
import MediaGrid from '@/components/MediaGrid'
import MediaDetail from '@/components/MediaDetail'
import ContentBriefList from '@/components/ContentBriefList'
import CollectionsBar from '@/components/CollectionsBar'
import BulkActionBar from '@/components/BulkActionBar'
import MediaHubHelp from '@/components/MediaHubHelp'
import { listMedia, getMediaAsset } from '@/lib/mediaLib'
import { useMediaInfinite, queryKeys } from '@/lib/queries'
import { useQueryClient } from '@tanstack/react-query'
import { useUserRole } from '@/lib/useUserRole'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

const PAGE_SIZE = 120

const KIND_FILTERS   = [{ id: '', label: 'All' }, { id: 'video', label: 'Video' }, { id: 'photo', label: 'Photo' }]
// Default ('Any active') excludes archived rows server-side. The explicit
// 'Archived' option opts in to viewing the trash bin.
const STATUS_FILTERS = [
  { id: '',         label: 'Any active' },
  { id: 'raw',      label: 'Raw' },
  { id: 'tagged',   label: 'Tagged' },
  { id: 'rendered', label: 'Rendered' },
  { id: 'approved', label: 'Approved' },
  { id: 'archived', label: 'Archived' },
]

export default function MediaHub() {
  useDocumentTitle('Media')
  const { user } = useUser()
  const { canUpload, canEdit } = useUserRole()
  const qc = useQueryClient()
  const [kind, setKind]         = useState('')
  const [status, setStatus]     = useState('')
  const [search, setSearch]     = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [collectionId, setCollectionId] = useState(null)
  const [collectionRefreshKey, setCollectionRefreshKey] = useState(0)
  const [selected, setSelected] = useState(null)  // full asset row
  const [briefRefreshKey, setBriefRefreshKey] = useState(0)
  const [multiSelectMode, setMultiSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState([])

  // Debounce search input.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  // Centralized filter object for the media query — every place that needs
  // to read the same library page (here + SelectAll below) uses this so a
  // filter change produces a single cache key per state.
  const mediaFilters = {
    kind:         kind || undefined,
    status:       status || undefined,
    q:            debouncedSearch || undefined,
    collectionId: collectionId || undefined,
  }

  const {
    data:           mediaData,
    isLoading:      loading,
    isFetchingNextPage: loadingMore,
    hasNextPage:    hasMore,
    fetchNextPage:  fetchNext,
    error:          queryError,
    refetch:        refetchMedia,
  } = useMediaInfinite(mediaFilters, { pageSize: PAGE_SIZE })
  const error = queryError?.message || ''
  // Flatten pages → flat asset array for the existing grid/select code.
  const assets = mediaData?.pages?.flat() ?? []

  // Stable callback name so the existing IntersectionObserver effect keeps
  // working without churn.
  const loadMore = useCallback(() => {
    if (loadingMore || loading || !hasMore) return
    fetchNext()
  }, [loadingMore, loading, hasMore, fetchNext])

  // Existing call sites use refresh() after mutations to re-read the list.
  // Map that to invalidating the whole media tree so any other view watching
  // a different filter combo also picks up the change.
  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: queryKeys.media.all })
    refetchMedia()
  }, [qc, refetchMedia])

  // Walk every remaining page of the current filter and mark the full
  // result set as selected. Without this, "Select all" would only cover the
  // visible pages and silently miss off-screen matches — a footgun on
  // libraries past one page. Drives the infinite query forward until either
  // the cursor exhausts or we hit the 5000-row ceiling.
  const selectAllMatching = useCallback(async () => {
    try {
      let safety = 50  // 50 × PAGE_SIZE = 6000-row ceiling
      while (true) {
        // Re-read the latest paged state each iteration since fetchNextPage
        // updates the query cache directly.
        const current = qc.getQueryData(queryKeys.media.list(mediaFilters))
        const flat = current?.pages?.flat() ?? []
        const canFetchMore = current?.pageParams && current.pages.at(-1)?.length === PAGE_SIZE
        if (!canFetchMore || safety-- <= 0) {
          setSelectedIds(flat.map((a) => a.id))
          return
        }
        await fetchNext()
      }
    } catch (e) {
      // Selection still includes whatever pages were already fetched; that's
      // a better outcome than aborting silently.
      console.error('[selectAllMatching] failed:', e)
    }
  }, [qc, fetchNext, mediaFilters])

  // IntersectionObserver-driven infinite scroll. The sentinel sits 400px below
  // the last grid row so the next page starts loading before the user reaches
  // the bottom — keeps the scroll feeling continuous on long libraries.
  const sentinelRef = useRef(null)
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !hasMore || loading) return
    const io = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) loadMore() },
      { rootMargin: '400px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [hasMore, loading, loadMore])

  async function openDetail(asset) {
    // Refetch full row so any AI fields populated since list runs are visible.
    try {
      const fresh = await getMediaAsset(asset.id)
      setSelected(fresh || asset)
    } catch {
      setSelected(asset)
    }
  }

  // Track the last clicked index so shift-click can extend a range.
  const lastClickedIndexRef = useRef(null)

  function toggleSelected(asset, meta = {}) {
    const { shiftKey, index } = meta
    const lastIndex = lastClickedIndexRef.current

    // Shift-click range select: every asset between the anchor and the new
    // click gets added (never removed) to the selection. Matches the standard
    // gallery behavior in Dropbox / Photos / Finder.
    if (shiftKey && typeof lastIndex === 'number' && typeof index === 'number' && lastIndex !== index) {
      const [lo, hi] = lastIndex < index ? [lastIndex, index] : [index, lastIndex]
      const rangeIds = assets.slice(lo, hi + 1).map((a) => a.id)
      setSelectedIds((prev) => {
        const next = new Set(prev)
        rangeIds.forEach((id) => next.add(id))
        return [...next]
      })
      // Update anchor to the new endpoint so chained shift-clicks behave like
      // every other gallery (anchor follows the latest click).
      lastClickedIndexRef.current = index
      return
    }

    if (typeof index === 'number') lastClickedIndexRef.current = index
    setSelectedIds((prev) =>
      prev.includes(asset.id) ? prev.filter((id) => id !== asset.id) : [...prev, asset.id]
    )
  }

  function exitMultiSelect() {
    setMultiSelectMode(false)
    setSelectedIds([])
    lastClickedIndexRef.current = null
  }

  // Drop ids that vanish from the visible list (e.g. filter narrows the
  // result set) so the count stays honest.
  useEffect(() => {
    if (!multiSelectMode) return
    setSelectedIds((prev) => {
      const visible = new Set(assets.map((a) => a.id))
      const next = prev.filter((id) => visible.has(id))
      return next.length === prev.length ? prev : next
    })
  }, [assets, multiSelectMode])

  // Esc exits selection mode.
  useEffect(() => {
    if (!multiSelectMode) return
    function onKey(e) { if (e.key === 'Escape') exitMultiSelect() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [multiSelectMode])

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">Media Hub</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Your library of raw and edited clips. AI suggests posts to make from each upload — accept, edit, return finished files, then attach to Content Hub.
          </p>
        </div>
        <MediaHubHelp />
      </div>

      {/* Uploader — surfaced to every role per HANDOFF role table */}
      {canUpload && <MediaUploader createdBy={user?.id} onUploaded={refresh} />}

      {/* Edit briefs (AI suggestions + manual overrides) */}
      <ContentBriefList refreshKey={briefRefreshKey} />

      {/* Collections — editorial groupings; click a chip to filter the library */}
      <CollectionsBar
        selectedId={collectionId}
        onSelect={setCollectionId}
        refreshKey={collectionRefreshKey}
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search filename, notes, condition, patient…"
            className="pl-8 pr-8 h-8 text-sm"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2.5 top-2 text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {KIND_FILTERS.map((k) => (
            <button
              key={k.id || 'all-kind'}
              onClick={() => setKind(k.id)}
              className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                kind === k.id ? 'bg-primary text-white border-primary' : 'bg-muted text-muted-foreground border-border hover:border-primary/50'
              }`}
            >
              {k.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="text-[11px] h-7 px-2 rounded-md border border-border bg-background text-foreground"
          >
            {STATUS_FILTERS.map((s) => (
              <option key={s.id || 'all-status'} value={s.id}>{s.label}</option>
            ))}
          </select>
        </div>

        {canEdit && (
          <Button
            size="sm"
            variant={multiSelectMode ? 'default' : 'outline'}
            onClick={() => {
              if (multiSelectMode) exitMultiSelect()
              else setMultiSelectMode(true)
            }}
            className="h-7 gap-1.5 text-[11px] rounded-full"
            title="Select multiple media for bulk actions"
          >
            <CheckSquare className="h-3.5 w-3.5" />
            {multiSelectMode ? 'Exit select' : 'Select'}
          </Button>
        )}
      </div>

      {multiSelectMode && (
        <BulkActionBar
          selectedIds={selectedIds}
          assets={assets}
          hasMore={hasMore}
          currentStatus={status}
          currentCollectionId={collectionId}
          onClear={() => setSelectedIds([])}
          onSelectAll={selectAllMatching}
          onExit={exitMultiSelect}
          onChange={() => setCollectionRefreshKey((k) => k + 1)}
          onRefresh={() => {
            refresh()
            setBriefRefreshKey((k) => k + 1)
            setCollectionRefreshKey((k) => k + 1)
          }}
        />
      )}

      {/* Results */}
      {error && (
        <div className="text-sm text-destructive bg-destructive/10 rounded-lg p-3">{error}</div>
      )}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : assets.length === 0 ? (
        // Distinguish "library is empty" from "filters returned nothing" so
        // the coaching matches the situation. hasActiveFilter is true whenever
        // any narrowing control is active.
        (() => {
          const hasActiveFilter = !!(debouncedSearch || kind || status || collectionId)
          if (hasActiveFilter) {
            return (
              <EmptyState
                icon={<SearchX className="h-5 w-5" />}
                title="No media match these filters"
                description="Try clearing the search, switching the kind/status, or opening a different collection."
                action={
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setSearch('')
                      setKind('')
                      setStatus('')
                      setCollectionId(null)
                    }}
                  >
                    Clear all filters
                  </Button>
                }
              />
            )
          }
          return (
            <EmptyState
              icon={<ImageIcon className="h-5 w-5" />}
              title="Your media library is empty"
              description={
                canUpload
                  ? 'Drop a video or photo above to upload your first asset. The AI will tag and transcribe it automatically.'
                  : 'Once your team uploads photos and videos, they will appear here. Ask an admin or editor for upload access.'
              }
              action={
                canUpload
                  ? <Button size="sm" onClick={() => document.querySelector('input[type=file]')?.click()}>
                      <UploadIcon className="h-4 w-4 mr-1.5" />
                      Upload your first asset
                    </Button>
                  : null
              }
            />
          )
        })()
      ) : (
        <>
          <MediaGrid
            assets={assets}
            selectedId={selected?.id}
            onSelect={multiSelectMode ? toggleSelected : openDetail}
            multiSelect={multiSelectMode}
            selectedIds={selectedIds}
          />
          {hasMore && (
            <div ref={sentinelRef} className="flex items-center justify-center py-6">
              {loadingMore ? (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              ) : (
                <Button size="sm" variant="outline" onClick={loadMore} className="text-xs">
                  Load more
                </Button>
              )}
            </div>
          )}
          {!hasMore && assets.length > PAGE_SIZE && (
            <div className="text-center py-4 text-xs text-muted-foreground">End of library — {assets.length} items.</div>
          )}
        </>
      )}

      {selected && (
        <MediaDetail
          asset={selected}
          onClose={() => setSelected(null)}
          onChange={() => {
            refresh()
            setBriefRefreshKey((k) => k + 1)
            setCollectionRefreshKey((k) => k + 1)
          }}
        />
      )}
    </div>
  )
}

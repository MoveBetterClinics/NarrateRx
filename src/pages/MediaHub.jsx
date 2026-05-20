import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useUser } from '@clerk/clerk-react'
import { useSearchParams } from 'react-router-dom'
import { Search, Loader2, Filter, X, CheckSquare, Image as ImageIcon, Upload as UploadIcon, SearchX, Film, ChevronDown, ChevronRight, HardDrive } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import EmptyState from '@/components/EmptyState'
import MediaUploader from '@/components/MediaUploader'
import DriveImportPicker from '@/components/DriveImportPicker'
import MediaGrid from '@/components/MediaGrid'
import MediaDetail from '@/components/MediaDetail'
import ContentBriefList from '@/components/ContentBriefList'
import CollectionsBar from '@/components/CollectionsBar'
import BulkActionBar from '@/components/BulkActionBar'
import MediaHubHelp from '@/components/MediaHubHelp'
import LibraryReadyStrip from '@/components/LibraryReadyStrip'
import { getMediaAsset, backfillThumbnails } from '@/lib/mediaLib'
import { toast } from '@/lib/toast'
import { useMediaInfinite, useStories, useClinicians, queryKeys } from '@/lib/queries'
import { useQueryClient } from '@tanstack/react-query'
import { useUserRole } from '@/lib/useUserRole'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { useUploadProgress } from '@/lib/UploadProgressContext'
import {
  buildPieceStatusMap,
  groupByLifecycle,
  LIFECYCLE_NEW,
  LIFECYCLE_IN_PIPELINE,
  LIFECYCLE_AVAILABLE,
  LIFECYCLE_SHIPPED,
  LIFECYCLE_META,
} from '@/lib/mediaLifecycle'

const PAGE_SIZE = 120

// Bucket assets into three date bands. Used by the "Browse everything"
// chronological view; the curated view groups by workflow lifecycle instead.
function groupByDate(assets) {
  const now = Date.now()
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000
  const startOfMonth = new Date()
  startOfMonth.setDate(1)
  startOfMonth.setHours(0, 0, 0, 0)

  const recent = []
  const thisMonth = []
  const older = []

  for (const asset of assets) {
    const ts = asset.created_at ? new Date(asset.created_at).getTime() : 0
    if (ts >= now - sevenDaysMs) recent.push(asset)
    else if (ts >= startOfMonth.getTime()) thisMonth.push(asset)
    else older.push(asset)
  }
  return { recent, thisMonth, older }
}

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
  useDocumentTitle('Library')
  const { user } = useUser()
  const { canUpload, canEdit, role } = useUserRole()
  const qc = useQueryClient()

  // URL-persisted filters so the library position survives navigation.
  const [searchParams, setSearchParams] = useSearchParams()
  const kind    = searchParams.get('kind')    || ''
  const purpose = searchParams.get('purpose') || ''
  const status  = searchParams.get('status')  || ''
  const clinicianFilter = searchParams.get('clinician') || ''

  function setParam(key, value) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (value) next.set(key, value)
      else next.delete(key)
      return next
    }, { replace: true })
  }

  const setKind      = (v) => setParam('kind', v)
  const setPurpose   = (v) => setParam('purpose', v)
  const setStatus    = (v) => setParam('status', v)
  const setClinicianFilter = (v) => setParam('clinician', v)

  const [search, setSearch]     = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [collectionId, setCollectionId] = useState(null)
  const [collectionRefreshKey, setCollectionRefreshKey] = useState(0)
  const [selected, setSelected] = useState(null)  // full asset row
  const [briefRefreshKey, setBriefRefreshKey] = useState(0)
  const [multiSelectMode, setMultiSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState([])
  const [uploadOpen, setUploadOpen] = useState(false)
  const [driveImportOpen, setDriveImportOpen] = useState(false)
  // Date-grouped (default) vs. workflow-lifecycle sections. Date grouping
  // matches the Library mockup — Recent / This month / Earlier — and is the
  // mental model most users bring to a media library. The opt-in workflow
  // view keeps the lifecycle buckets (?view=workflow) for editors who want
  // them. URL-persisted so the choice survives reloads.
  const showAll = (searchParams.get('view') ?? '') !== 'workflow'
  const setShowAll = (v) => setParam('view', v ? '' : 'workflow')

  // Debounce search input.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  // Centralized filter object for the media query — every place that needs
  // to read the same library page (here + SelectAll below) uses this so a
  // filter change produces a single cache key per state. Memoized to give
  // a stable object reference so downstream useCallbacks don't churn on
  // every render (react-hooks/exhaustive-deps).
  const mediaFilters = useMemo(() => ({
    kind:         kind || undefined,
    purpose:      purpose || undefined,
    status:       status || undefined,
    q:            debouncedSearch || undefined,
    collectionId: collectionId || undefined,
    // Hide rotate/crop variants from the main grid — they're surfaced inside
    // their parent's detail drawer (variant strip). Keeps the library focused
    // on source assets and prevents the same clip from appearing N+1 times.
    sources:      true,
  }), [kind, purpose, status, debouncedSearch, collectionId])
  // clinicianFilter is a client-side filter (created_by value) — it isn't
  // sent to the server since the server only accepts workspace-scoped filter
  // params. We post-filter the flat asset array below after fetching.

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
  const allAssets = useMemo(() => mediaData?.pages?.flat() ?? [], [mediaData])
  // Client-side clinician filter (created_by is the Clerk user ID string).
  const assets = useMemo(
    () => clinicianFilter ? allAssets.filter((a) => a.created_by === clinicianFilter) : allAssets,
    [clinicianFilter, allAssets]
  )

  // Date-grouped buckets for the "Browse everything" chronological fallback.
  // Recomputes whenever the filtered list changes (new page loaded, filter
  // applied, etc.). The curated view (default) groups by lifecycle below.
  const dateGroups = useMemo(() => groupByDate(assets), [assets])

  // Pull workspace stories so we can resolve each asset's content-pipeline
  // state (in active draft? already published?). useStories shares its cache
  // with the Stories page so this is a near-free read on second visit.
  const { data: stories = [] } = useStories()
  const pieceStatusById = useMemo(() => buildPieceStatusMap(stories), [stories])
  const lifecycleGroups = useMemo(
    () => groupByLifecycle(assets, pieceStatusById),
    [assets, pieceStatusById]
  )
  // Stamp the resolved lifecycle onto each asset so MediaGrid can render
  // the right bottom-right chip without a second classify call per cell.
  const stampLifecycle = useCallback(
    (group, lifecycle) => group.map((a) => ({ ...a, _lifecycle: lifecycle })),
    []
  )

  // Per-type counts derived from the loaded (unfiltered-by-clinician) pages.
  // When hasMore is true these are partial; the filter chips show a + suffix.
  const counts = useMemo(() => {
    const base = allAssets
    return {
      total:     base.length,
      video:     base.filter((a) => a.kind === 'video').length,
      photo:     base.filter((a) => a.kind === 'photo').length,
      interview: base.filter((a) => a.asset_purpose === 'interview').length,
      broll:     base.filter((a) => a.asset_purpose === 'broll').length,
      photo_p:   base.filter((a) => a.asset_purpose === 'photo').length,
      brand:     base.filter((a) => a.asset_purpose === 'brand').length,
    }
  }, [allAssets])

  function countLabel(n) {
    return hasMore ? `${n}+` : `${n}`
  }

  // Pull the workspace clinician roster so we can resolve `created_by` (Clerk
  // user id) → human name on the clinician filter chips. Falls back to the
  // last-6-chars Clerk id stub when we can't find a match (e.g. an admin
  // uploaded an asset and isn't in the clinicians table).
  const { data: clinicianRoster = [] } = useClinicians()
  const clinicianNameByUserId = useMemo(() => {
    const m = new Map()
    for (const c of clinicianRoster) {
      if (c.created_by_id && c.name) m.set(c.created_by_id, c.name)
    }
    return m
  }, [clinicianRoster])

  // Unique uploaders visible in the current (unfiltered) page set, for the
  // clinician chip row. We use allAssets so changing the clinician chip
  // doesn't hide the other chips.
  const clinicianOptions = useMemo(() => {
    const seen = new Map()
    for (const a of allAssets) {
      if (a.created_by && !seen.has(a.created_by)) {
        seen.set(a.created_by, a.created_by)
      }
    }
    return [...seen.values()]
  }, [allAssets])

  // Visible secondary surfaces — Collections + (admin) Backfill — start
  // collapsed so the Library opens with just the search + chip strip + grid.
  // The Edit briefs pane is collapsed via ContentBriefList's own prop.
  const [collectionsOpen, setCollectionsOpen] = useState(false)

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

  // Background uploads (modal closed mid-upload) still need to refresh
  // this grid when they finish. The UploadProgressContext notifies all
  // subscribers on each completion; the in-modal `onUploaded={refresh}`
  // prop covers the modal-open case (idempotent — both are just re-queries).
  const { subscribe: subscribeToUploads } = useUploadProgress()
  useEffect(() => subscribeToUploads(refresh), [subscribeToUploads, refresh])

  // Admin-only one-click backfill for legacy videos uploaded before the
  // auto-thumbnail path landed (#159). Pages internally until the API
  // reports nothing left to process, then refreshes the grid so the new
  // thumbnails appear in place of the generic film-strip placeholder.
  const [backfilling, setBackfilling] = useState(false)
  const onBackfillThumbnails = useCallback(async () => {
    if (backfilling) return
    setBackfilling(true)
    try {
      let totalSucceeded = 0
      let totalFailed = 0
      // Loop until a pass returns processed=0. The server caps each batch at
      // 25 and self-bounds by wall-clock (~4 min) so any single HTTP call
      // stays comfortably under Vercel's 300s maxDuration; the loop here
      // walks the rest of the backlog one batch at a time.
      for (let pass = 0; pass < 200; pass++) {
        const r = await backfillThumbnails(25)
        totalSucceeded += r?.succeeded ?? 0
        totalFailed    += r?.failed    ?? 0
        if (!r || (r.processed ?? 0) === 0) break
      }
      refresh()
      if (totalSucceeded === 0 && totalFailed === 0) {
        toast.success('All videos already have thumbnails')
      } else {
        toast.success(
          `Backfilled ${totalSucceeded} thumbnail${totalSucceeded === 1 ? '' : 's'}` +
          (totalFailed ? ` · ${totalFailed} failed` : '')
        )
      }
    } catch (e) {
      toast.error('Backfill failed', { description: e?.message || 'See server logs' })
    } finally {
      setBackfilling(false)
    }
  }, [backfilling, refresh])

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
          <h1 className="text-2xl font-bold tracking-tight flex items-center">
            <span
              className="inline-block w-1 h-6 rounded-full shrink-0 mr-2.5"
              style={{ background: '#7c3aed' }}
              aria-hidden="true"
            />
            Library
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Your whole clinic&apos;s media — interview clips, B-roll, photos, and brand assets. Interview uploads also feed the editor brief queue; everything else is tagged for search and reuse.
          </p>
        </div>
        <MediaHubHelp />
      </div>

      {/* Ready to distribute — staff-only inbox of approved pieces awaiting
          media + publish. Hides itself when empty or for non-staff. */}
      <LibraryReadyStrip />

      {/* Upload modal — triggered from the Upload button in the filter row */}
      {canUpload && (
        <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
          <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Upload media</DialogTitle>
              <DialogDescription>
                Pick the asset kind, then drop your files. Interview clips feed the editor brief queue; everything else is tagged for search and reuse.
              </DialogDescription>
            </DialogHeader>
            <MediaUploader
              createdBy={user?.id}
              onUploaded={refresh}
            />
          </DialogContent>
        </Dialog>
      )}

      {/* Drive import modal — uses the per-workspace Google OAuth credential
          to browse the admin's connected Drive and pull selected files into
          the Library through the standard pipeline. */}
      {canUpload && (
        <Dialog open={driveImportOpen} onOpenChange={setDriveImportOpen}>
          <DialogContent className="sm:max-w-4xl max-h-[90vh] flex flex-col">
            <DialogHeader>
              <DialogTitle>Import from Google Drive</DialogTitle>
              <DialogDescription>
                Browse your workspace’s connected Drive and pull selected files into the Library. Imported files run through the same tagging and thumbnail pipeline as direct uploads.
              </DialogDescription>
            </DialogHeader>
            <DriveImportPicker
              onComplete={refresh}
              onClose={() => setDriveImportOpen(false)}
            />
          </DialogContent>
        </Dialog>
      )}

      {/* Edit briefs — collapsed by default so the Library opens visual-first.
          Pending-count badge stays visible on the collapsed header so nothing
          gets buried. */}
      <ContentBriefList refreshKey={briefRefreshKey} expandedDefault={false} />

      {/* Filters — search + actions on top; one chip strip below */}
      <div className="space-y-3">
        {/* Search field, status, and primary actions */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, clinician, notes…"
              className="pl-8 pr-8 h-8 text-sm"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2.5 top-2 text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <Filter className="h-3.5 w-3.5 text-muted-foreground" />
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              aria-label="Filter by status"
              className="text-2xs h-7 px-3 rounded-full border border-border bg-white text-foreground font-medium cursor-pointer hover:border-slate-300 hover:bg-slate-50 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50"
            >
              {STATUS_FILTERS.map((s) => (
                <option key={s.id || 'all-status'} value={s.id}>{s.label}</option>
              ))}
            </select>
          </div>

          {canUpload && (
            <Button
              size="sm"
              onClick={() => setUploadOpen(true)}
              className="h-7 gap-1.5 text-2xs rounded-full"
            >
              <UploadIcon className="h-3.5 w-3.5" />
              Upload
            </Button>
          )}

          {canUpload && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDriveImportOpen(true)}
              className="h-7 gap-1.5 text-2xs rounded-full"
            >
              <HardDrive className="h-3.5 w-3.5" />
              Import from Drive
            </Button>
          )}

          {canEdit && (
            <Button
              size="sm"
              variant={multiSelectMode ? 'default' : 'outline'}
              onClick={() => {
                if (multiSelectMode) exitMultiSelect()
                else setMultiSelectMode(true)
              }}
              className="h-7 gap-1.5 text-2xs rounded-full"
              title="Select multiple media for bulk actions"
            >
              <CheckSquare className="h-3.5 w-3.5" />
              {multiSelectMode ? 'Exit select' : 'Select'}
            </Button>
          )}

          {role === 'admin' && (
            <Button
              size="sm"
              variant="outline"
              onClick={onBackfillThumbnails}
              disabled={backfilling}
              className="h-7 gap-1.5 text-2xs rounded-full"
              title="Generate missing thumbnails for older videos"
            >
              {backfilling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Film className="h-3.5 w-3.5" />}
              {backfilling ? 'Backfilling…' : 'Backfill thumbnails'}
            </Button>
          )}
        </div>

        {/* Single consolidated chip strip: kind · purpose · clinician.
            Pipe separators delimit the groups the way the mockup envisions. */}
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1.5">
          {[
            { id: '',      label: 'All',      icon: null,  count: counts.total, group: 'kind' },
            { id: 'video', label: 'Video',    icon: '🎬',  count: counts.video, group: 'kind' },
            { id: 'photo', label: 'Photos',   icon: '📷',  count: counts.photo, group: 'kind' },
          ].map((k) => (
            <button
              key={k.id || 'all-kind'}
              onClick={() => setKind(k.id)}
              className={`text-2xs px-2.5 py-1 rounded-full border transition-colors inline-flex items-center gap-1 ${
                kind === k.id ? 'bg-primary text-white border-primary' : 'bg-muted text-muted-foreground border-border hover:border-primary/50'
              }`}
            >
              {k.icon && <span>{k.icon}</span>}
              <span>{k.label}</span>
              {!loading && <span className="opacity-70">· {countLabel(k.count)}</span>}
            </button>
          ))}

          <span className="w-px h-4 bg-border mx-1" aria-hidden />

          {[
            { id: 'interview', label: 'From interviews', count: counts.interview },
            { id: 'broll',     label: 'B-roll',          count: counts.broll },
            { id: 'photo',     label: 'Patient photos',  count: counts.photo_p },
            { id: 'brand',     label: 'Brand assets',    count: counts.brand },
          ].map((p) => (
            <button
              key={p.id || 'all-purpose'}
              onClick={() => setPurpose(purpose === p.id ? '' : p.id)}
              className={`text-2xs px-2.5 py-1 rounded-full border transition-colors ${
                purpose === p.id ? 'bg-primary text-white border-primary' : 'bg-muted text-muted-foreground border-border hover:border-primary/50'
              }`}
            >
              {p.label}
              {!loading && <span className="ml-1 opacity-70">· {countLabel(p.count)}</span>}
            </button>
          ))}

          {clinicianOptions.length > 1 && (
            <>
              <span className="w-px h-4 bg-border mx-1" aria-hidden />
              {clinicianOptions.map((uid) => {
                // Prefer the resolved clinician name; fall back to the last 6
                // chars of a Clerk id when the uploader isn't in the roster
                // (e.g. an admin without a clinicians row).
                const name = clinicianNameByUserId.get(uid)
                const label = name || (uid.startsWith('user_') ? `…${uid.slice(-6)}` : uid.slice(0, 12))
                return (
                  <button
                    key={uid}
                    onClick={() => setClinicianFilter(uid === clinicianFilter ? '' : uid)}
                    title={name ? `${name} · ${uid}` : uid}
                    className={`text-2xs px-2.5 py-1 rounded-full border transition-colors ${
                      clinicianFilter === uid ? 'bg-primary text-white border-primary' : 'bg-muted text-muted-foreground border-border hover:border-primary/50'
                    } ${name ? '' : 'font-mono'}`}
                  >
                    {label}
                  </button>
                )
              })}
            </>
          )}
        </div>
      </div>

      {/* Collections — editorial groupings; collapsed by default so the chip
          strip above isn't competing with another chip row. Header shows the
          active selection so it remains discoverable when collapsed. */}
      <div className="rounded-2xl border border-border bg-card shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <button
          onClick={() => setCollectionsOpen((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-muted/40 transition-colors rounded-t-2xl"
        >
          <div className="flex items-center gap-2 text-xs">
            <span
              className="inline-block w-1 h-5 rounded-full shrink-0"
              style={{ background: '#7c3aed' }}
              aria-hidden="true"
            />
            {collectionsOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            <span className="text-base font-bold tracking-tight text-foreground">Collections</span>
            {collectionId && (
              <span className="text-2xs text-primary font-semibold">· filtered</span>
            )}
          </div>
          <span className="text-2xs text-muted-foreground">Editorial groupings — campaigns, series, ad-hoc sets</span>
        </button>
        {collectionsOpen && (
          <div className="border-t border-slate-100 px-3 py-2">
            <CollectionsBar
              selectedId={collectionId}
              onSelect={setCollectionId}
              refreshKey={collectionRefreshKey}
            />
          </div>
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

      {/* Date-grouped (default) ↔ workflow-lifecycle toggle. Date grouping is
          the photo-app default; the workflow view is opt-in for editors who
          want the NEW / pipeline / available / shipped buckets. */}
      {!loading && allAssets.length > 0 && (
        <div className="flex items-center justify-between gap-3 text-2xs text-muted-foreground">
          <span>
            {allAssets.length} asset{allAssets.length === 1 ? '' : 's'} loaded{hasMore ? ' · more available' : ''}
          </span>
          <button
            onClick={() => setShowAll(!showAll)}
            className="text-2xs underline-offset-2 hover:underline hover:text-foreground transition-colors"
          >
            {showAll ? 'Switch to workflow view' : 'Switch to date view'}
          </button>
        </div>
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
          const hasActiveFilter = !!(debouncedSearch || kind || purpose || status || collectionId || clinicianFilter)
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
                      setPurpose('')
                      setStatus('')
                      setClinicianFilter('')
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
                  ? 'Click Upload to pick an asset kind (interview, B-roll, photo, or brand) and drop your first file. AI tags every upload for search.'
                  : 'Once your team uploads photos and videos, they will appear here. Ask an admin or editor for upload access.'
              }
              action={
                canUpload
                  ? <Button size="sm" onClick={() => setUploadOpen(true)}>
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
          {(showAll
            ? [
                { id: 'recent',    label: 'Recent · last 7 days', assets: dateGroups.recent, sub: null },
                { id: 'month',     label: 'This month',           assets: dateGroups.thisMonth, sub: null },
                { id: 'older',     label: 'Earlier',              assets: dateGroups.older, sub: null },
              ]
            : [
                { id: LIFECYCLE_NEW,         label: LIFECYCLE_META[LIFECYCLE_NEW].label,         assets: stampLifecycle(lifecycleGroups[LIFECYCLE_NEW],         LIFECYCLE_NEW),         sub: LIFECYCLE_META[LIFECYCLE_NEW].sublabel },
                { id: LIFECYCLE_IN_PIPELINE, label: LIFECYCLE_META[LIFECYCLE_IN_PIPELINE].label, assets: stampLifecycle(lifecycleGroups[LIFECYCLE_IN_PIPELINE], LIFECYCLE_IN_PIPELINE), sub: LIFECYCLE_META[LIFECYCLE_IN_PIPELINE].sublabel },
                { id: LIFECYCLE_AVAILABLE,   label: LIFECYCLE_META[LIFECYCLE_AVAILABLE].label,   assets: stampLifecycle(lifecycleGroups[LIFECYCLE_AVAILABLE],   LIFECYCLE_AVAILABLE),   sub: LIFECYCLE_META[LIFECYCLE_AVAILABLE].sublabel },
                { id: LIFECYCLE_SHIPPED,     label: LIFECYCLE_META[LIFECYCLE_SHIPPED].label,     assets: stampLifecycle(lifecycleGroups[LIFECYCLE_SHIPPED],     LIFECYCLE_SHIPPED),     sub: LIFECYCLE_META[LIFECYCLE_SHIPPED].sublabel },
              ]
          )
            .filter((g) => g.assets.length > 0)
            .map((group, i) => (
              <div key={group.id} className={i > 0 ? 'mt-8' : undefined}>
                <div className="flex items-baseline justify-between gap-2 mb-3">
                  <p className="text-2xs uppercase tracking-widest text-muted-foreground font-semibold">
                    {group.label}
                    <span className="ml-1.5 normal-case tracking-normal font-medium text-muted-foreground/80">· {group.assets.length}</span>
                  </p>
                  {group.sub && (
                    <p className="text-2xs text-muted-foreground/80">{group.sub}</p>
                  )}
                </div>
                <MediaGrid
                  assets={group.assets}
                  selectedId={selected?.id}
                  onSelect={multiSelectMode ? toggleSelected : openDetail}
                  multiSelect={multiSelectMode}
                  selectedIds={selectedIds}
                />
              </div>
            ))}
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
          onChange={async () => {
            refresh()
            setBriefRefreshKey((k) => k + 1)
            setCollectionRefreshKey((k) => k + 1)
            // Re-pull the open row so an in-place edit (rotate, retag,
            // make-thumbnail) shows the new blob_url / thumbnail_url in
            // the still-open drawer. Without this the drawer kept rendering
            // the stale prop and edits looked silent.
            if (selected?.id) {
              try {
                const fresh = await getMediaAsset(selected.id)
                if (fresh) setSelected(fresh)
              } catch { /* empty */ }
            }
          }}
        />
      )}
    </div>
  )
}

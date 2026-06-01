import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Scissors, Loader2, AlertCircle, BarChart3, Film, ShieldAlert,
  Search, RefreshCw, ChevronRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { useStaffSummaries } from '@/lib/queries'
import { apiFetch } from '@/lib/api'
import { listMedia } from '@/lib/mediaLib'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import CoveragePanel from '@/components/slate/CoveragePanel'
import PageHelp from '@/components/PageHelp'

const REFETCH_INTERVAL_MS = 30_000

function consentLabel(status) {
  if (status === 'pending') return { label: 'Consent pending', color: 'text-amber-700 bg-amber-50 border-amber-200' }
  if (status === 'revoked') return { label: 'Consent revoked', color: 'text-red-700 bg-red-50 border-red-200' }
  return null
}

function clipCount(asset) {
  // parent_asset_id counter — populated when Phase 1 clips are cut
  return typeof asset.clip_count === 'number' ? asset.clip_count : null
}

function SourceVideoCard({ asset, staffName, onEdit }) {
  const consent = consentLabel(asset.consent_status)
  const clips = clipCount(asset)
  const thumbUrl = asset.thumbnail_url || null

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden flex flex-col hover:shadow-md transition-shadow">
      {/* Thumbnail */}
      <div className="aspect-video bg-muted relative overflow-hidden">
        {thumbUrl ? (
          <img src={thumbUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <Film className="h-10 w-10 opacity-30" />
          </div>
        )}
        {consent && (
          <div className={`absolute top-2 left-2 text-2xs font-semibold px-2 py-0.5 rounded-full border ${consent.color} flex items-center gap-1`}>
            <ShieldAlert className="h-3 w-3" />
            {consent.label}
          </div>
        )}
        {clips !== null && (
          <div className="absolute bottom-2 right-2 text-2xs font-bold px-2 py-0.5 rounded-full bg-black/60 text-white">
            {clips} clip{clips !== 1 ? 's' : ''} cut
          </div>
        )}
      </div>

      {/* Body */}
      <div className="p-3 flex flex-col gap-2 flex-1">
        <p className="text-sm font-semibold line-clamp-2 leading-snug">
          {asset.filename || 'Untitled video'}
        </p>
        {staffName && (
          <p className="text-xs text-muted-foreground">{staffName}</p>
        )}
        <p className="text-xs text-muted-foreground">
          {asset.duration_sec ? `${Math.round(asset.duration_sec)}s` : '—'}
          {asset.created_at && (
            <> · {new Date(asset.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</>
          )}
        </p>

        <Button
          size="sm"
          className="mt-auto w-full gap-1.5"
          onClick={() => onEdit(asset.id)}
          disabled={!!consent}
          title={consent ? consent.label + ' — resolve before cutting clips' : undefined}
        >
          <Scissors className="h-3.5 w-3.5" />
          Cut a clip
          <ChevronRight className="h-3.5 w-3.5 ml-auto" />
        </Button>
      </div>
    </div>
  )
}

export default function Slate() {
  useDocumentTitle('Slate')
  const ws = useWorkspace()
  const navigate = useNavigate()

  const { data: staff = [] } = useStaffSummaries()
  const staffMap = useMemo(
    () => Object.fromEntries(staff.map((c) => [c.id, c.name])),
    [staff]
  )

  const [view, setView] = useState('videos')  // 'videos' | 'coverage'
  const [searchQ, setSearchQ] = useState('')
  const [activeStaffId, setActiveStaffId] = useState(null)
  const [isManualRefetching, setIsManualRefetching] = useState(false)

  // Source videos with clip potential (kind=video, not archived)
  const {
    data: mediaData,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['slate-source-videos', searchQ],
    queryFn: () => listMedia({ kind: 'video', limit: 100, q: searchQ || undefined }),
    enabled: ws?.video_pipeline_enabled === true,
    refetchInterval: REFETCH_INTERVAL_MS,
    refetchOnWindowFocus: false,
  })

  // Clip counts per source asset (from child rows with parent_asset_id set)
  const { data: clipCounts } = useQuery({
    queryKey: ['slate-clip-counts'],
    queryFn: () => apiFetch('/api/editorial/clip-counts'),
    enabled: ws?.video_pipeline_enabled === true,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  })

  const sourceVideos = useMemo(() => {
    const assets = mediaData?.assets || []
    const counts = clipCounts?.counts || {}
    const filtered = activeStaffId
      ? assets.filter((a) => a.staff_id === activeStaffId)
      : assets
    return filtered.map((a) => ({ ...a, clip_count: counts[a.id] ?? null }))
  }, [mediaData, clipCounts, activeStaffId])

  // Staff who have videos (for filter chips)
  const activeStaffIds = useMemo(
    () => [...new Set((mediaData?.assets || []).map((a) => a.staff_id).filter(Boolean))],
    [mediaData]
  )

  if (!ws?.video_pipeline_enabled) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
        <Scissors className="h-10 w-10 text-muted-foreground" />
        <p className="font-semibold text-lg">Slate is coming soon</p>
        <p className="text-sm text-muted-foreground max-w-sm">
          {"The video pipeline isn't enabled for this workspace yet."}
        </p>
        <a
          href="/settings/workspace"
          className="text-sm text-primary underline underline-offset-2 hover:opacity-80"
        >
          Open workspace settings to enable it
        </a>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="nx-grad-ribbon flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <p className="text-2xs font-bold uppercase tracking-widest opacity-85">Tools</p>
          <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight leading-tight">
            {view === 'coverage' ? 'Capture Coverage' : 'Clip Workshop'}
          </h1>
          <p className="text-sm opacity-80 mt-0.5">
            {view === 'coverage'
              ? 'Per-staff capture activity and topic coverage gaps'
              : 'Pick a source video, trim a clip, and send it to a post or Library'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <PageHelp pageKey="slate" variant="onGradient" />
          {view === 'videos' && (
            <Button
              variant="outline"
              size="sm"
              className="bg-white/90 text-foreground border-white/40 hover:bg-white"
              onClick={async () => {
                setIsManualRefetching(true)
                await refetch()
                setIsManualRefetching(false)
              }}
              disabled={isManualRefetching}
            >
              {isManualRefetching
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <RefreshCw className="h-3.5 w-3.5" />
              }
            </Button>
          )}
        </div>
      </div>

      {/* View tabs */}
      <div className="flex items-center gap-1 border-b border-border">
        <button
          onClick={() => setView('videos')}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors -mb-px ${
            view === 'videos'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Film className="h-4 w-4 inline-block mr-1.5 -mt-0.5" />
          Source videos
          {!isLoading && <span className="ml-2 text-2xs font-bold opacity-70">{sourceVideos.length}</span>}
        </button>
        <button
          onClick={() => setView('coverage')}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors -mb-px ${
            view === 'coverage'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <BarChart3 className="h-4 w-4 inline-block mr-1.5 -mt-0.5" />
          Coverage
        </button>
      </div>

      {view === 'coverage' ? (
        <CoveragePanel />
      ) : (
        <>
          {/* Search + staff filter */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <input
                type="search"
                placeholder="Search videos…"
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>

            {activeStaffIds.length > 1 && (
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => setActiveStaffId(null)}
                  className={`text-xs px-3 py-1.5 rounded-full font-medium border transition-colors ${
                    activeStaffId === null
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'border-border text-muted-foreground hover:border-primary/40'
                  }`}
                >
                  All staff
                </button>
                {activeStaffIds.map((sid) => (
                  <button
                    key={sid}
                    onClick={() => setActiveStaffId(sid === activeStaffId ? null : sid)}
                    className={`text-xs px-3 py-1.5 rounded-full font-medium border transition-colors ${
                      activeStaffId === sid
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'border-border text-muted-foreground hover:border-primary/40'
                    }`}
                  >
                    {staffMap[sid] || 'Unknown'}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Video grid */}
          {isLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
              <AlertCircle className="h-8 w-8 text-destructive" />
              <p className="text-sm text-destructive font-medium">Failed to load videos</p>
              <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
            </div>
          ) : sourceVideos.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 gap-4 text-center rounded-xl border-2 border-dashed border-border">
              <Film className="h-10 w-10 text-muted-foreground" />
              <div>
                <p className="font-semibold text-base">No source videos yet</p>
                <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                  Upload videos via Capture or the Library. Once a video is in your library,
                  it appears here for clipping.
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => navigate('/library')}>
                Go to Library
              </Button>
            </div>
          ) : (
            <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
              {sourceVideos.map((asset) => (
                <SourceVideoCard
                  key={asset.id}
                  asset={asset}
                  staffName={staffMap[asset.staff_id]}
                  onEdit={(id) => navigate(`/slate/clip/${id}`)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

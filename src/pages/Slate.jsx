import { useState, useRef, useMemo, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Clapperboard, Loader2, RefreshCw, Wand2, AlertCircle, ListChecks, ShieldAlert, BarChart3, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { useClinicianSummaries } from '@/lib/queries'
import { apiFetch } from '@/lib/api'
import { toast } from '@/lib/toast'
import { getSuggestedTopics } from '@/lib/topicSuggestions'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import PackageCard from '@/components/slate/PackageCard'
import CoveragePanel from '@/components/slate/CoveragePanel'
import ProducerOnboarding from '@/components/slate/ProducerOnboarding'

const SLATE_TARGET = 4  // aim for this many packages per day
const REFETCH_INTERVAL_MS = 3000
const TRIAGE_CONFIDENCE_THRESHOLD = 0.65  // packages below this need clinician attention
const STALE_HOURS = 36  // unaddressed complete packages older than this land in triage

async function fetchPackages() {
  // Fetch a wider window than the daily slate alone so the Triage tab has
  // ~last 14 days of context for low-confidence + failed + stale items.
  return apiFetch('/api/editorial/packages?limit=100')
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function isTodayPackage(pkg) {
  return (pkg.created_at || '').startsWith(todayIso())
}

function hoursSince(iso) {
  if (!iso) return Infinity
  return (Date.now() - new Date(iso).getTime()) / (60 * 60 * 1000)
}

/**
 * Returns a short label if the package belongs in the triage queue, else null.
 * Priority order: failed > low-confidence > stale.
 */
function triageReasonFor(pkg) {
  if (pkg.status === 'failed') return 'Render failed'
  if (pkg.status === 'complete') {
    if (typeof pkg.similarity === 'number' && pkg.similarity < TRIAGE_CONFIDENCE_THRESHOLD) {
      return 'Low confidence'
    }
    if (hoursSince(pkg.created_at) > STALE_HOURS) {
      return 'Stale — needs decision'
    }
  }
  return null
}

/**
 * Pick topic gaps: suggestions not yet covered by a today package.
 * Returns topic strings, up to `count`.
 */
function pickTopicGaps(workspace, todayTopics, count) {
  const ranked = getSuggestedTopics(workspace, [], null)
  const used = new Set(todayTopics.map((t) => t.toLowerCase()))
  const gaps = ranked.filter((s) => !used.has(s.topic.toLowerCase()))
  return gaps.slice(0, count).map((s) => s.topic)
}

export default function Slate() {
  useDocumentTitle('Story Slate')
  const ws = useWorkspace()
  const qc = useQueryClient()

  const { data: clinicians = [] } = useClinicianSummaries()
  const clinicianMap = useMemo(
    () => Object.fromEntries(clinicians.map((c) => [c.id, c.name])),
    [clinicians]
  )

  const [view, setView] = useState('today')  // 'today' | 'triage' | 'consent'
  const [activeClinicianId, setActiveClinicianId] = useState(null)
  const [generating, setGenerating] = useState(false)
  const [genProgress, setGenProgress] = useState({ current: 0, total: 0 })
  const generatingRef = useRef(false)  // guard against double-fire

  // Producer onboarding modal — auto-fires once when a producer-tier user
  // visits Slate without having completed onboarding. "Take the tour" link
  // in the header re-opens it on demand.
  const isProducer = ws?.current_user_tier === 'producer'
  const needsOnboarding = isProducer && !ws?.current_user_producer_onboarded_at
  const [showOnboarding, setShowOnboarding] = useState(false)
  const autoFiredRef = useRef(false)
  useEffect(() => {
    if (needsOnboarding && !autoFiredRef.current) {
      autoFiredRef.current = true
      setShowOnboarding(true)
    }
  }, [needsOnboarding])

  const {
    data,
    isLoading,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['story-packages'],
    queryFn: fetchPackages,
    refetchInterval: (q) => {
      const pkgs = q.state.data?.packages || []
      const anyPending = pkgs.some((p) => p.status === 'generating' || p.status === 'pending')
      return anyPending ? REFETCH_INTERVAL_MS : false
    },
    refetchOnWindowFocus: false,
  })

  const allPackages = useMemo(() => {
    const pkgs = data?.packages || []
    // Filter out explicitly skipped + approved packages from BOTH views
    return pkgs.filter((p) => p.status !== 'skipped' && p.status !== 'approved')
  }, [data])

  const todayPackages = useMemo(() => allPackages.filter(isTodayPackage), [allPackages])

  // Triage: failed + low-confidence + stale (any age, not just today)
  const triagePackages = useMemo(() => {
    return allPackages
      .filter((p) => triageReasonFor(p) !== null)
      // Newest-attention items first: failed first (high urgency), then low-confidence, then stale
      .sort((a, b) => {
        const order = { 'Render failed': 0, 'Low confidence': 1, 'Stale — needs decision': 2 }
        const oa = order[triageReasonFor(a)] ?? 99
        const ob = order[triageReasonFor(b)] ?? 99
        if (oa !== ob) return oa - ob
        return new Date(b.created_at) - new Date(a.created_at)
      })
  }, [allPackages])

  // Consent queue: any package whose source asset is pending or revoked.
  const consentPackages = useMemo(() => {
    return allPackages.filter((p) => {
      const status = p.source_asset?.consent_status
      return status === 'pending' || status === 'revoked'
    })
  }, [allPackages])

  const basePackages =
    view === 'triage'  ? triagePackages :
    view === 'consent' ? consentPackages :
                         todayPackages

  const filteredPackages = useMemo(() => {
    if (!activeClinicianId) return basePackages
    return basePackages.filter((p) => p.clinician_id === activeClinicianId)
  }, [basePackages, activeClinicianId])

  // Clinicians who appear in the current view (for filter chips)
  const activeClinicianIds = useMemo(
    () => [...new Set(basePackages.map((p) => p.clinician_id).filter(Boolean))],
    [basePackages]
  )

  async function handleGenerate() {
    if (generatingRef.current) return
    generatingRef.current = true
    setGenerating(true)

    const todayTopics = todayPackages.map((p) => p.topic)
    const needed = Math.max(0, SLATE_TARGET - todayPackages.filter((p) => p.status === 'complete').length)
    if (needed === 0) {
      toast('Slate is already full for today.')
      generatingRef.current = false
      setGenerating(false)
      return
    }

    const topics = pickTopicGaps(ws, todayTopics, needed)
    if (topics.length === 0) {
      toast('No topic gaps found. Add topics in Workspace Settings → Topics.')
      generatingRef.current = false
      setGenerating(false)
      return
    }

    setGenProgress({ current: 0, total: topics.length })

    let succeeded = 0
    for (let i = 0; i < topics.length; i++) {
      setGenProgress({ current: i + 1, total: topics.length })
      try {
        await apiFetch('/api/editorial/generate-package', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ topic: topics[i] }),
        })
        succeeded++
        // Refresh the list after each successful package
        qc.invalidateQueries({ queryKey: ['story-packages'] })
      } catch (err) {
        console.error('[Slate] generate-package failed for topic:', topics[i], err)
        toast.error(`Failed to generate: ${topics[i]}`)
      }
    }

    setGenerating(false)
    generatingRef.current = false
    setGenProgress({ current: 0, total: 0 })
    if (succeeded > 0) {
      toast(`Generated ${succeeded} package${succeeded !== 1 ? 's' : ''} for today's slate.`)
    }
  }

  async function handleApprove(pkg) {
    try {
      const result = await apiFetch('/api/editorial/approve-package', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageId: pkg.id }),
      })
      qc.invalidateQueries({ queryKey: ['story-packages'] })
      const count = result?.platformCount ?? result?.contentItems?.length ?? 0
      toast(`Staged in Drafts — ${count} platform${count !== 1 ? 's' : ''} ready to distribute.`)
    } catch (err) {
      toast.error(err?.message || 'Failed to approve package.')
    }
  }

  async function handleSkip(pkg) {
    try {
      await apiFetch(`/api/editorial/packages/${pkg.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'skipped' }),
      })
      qc.invalidateQueries({ queryKey: ['story-packages'] })
    } catch (_err) {
      toast.error('Failed to skip package.')
    }
  }

  const hasGeneratingPackages = todayPackages.some(
    (p) => p.status === 'generating' || p.status === 'pending'
  )

  if (!ws?.video_pipeline_enabled) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
        <Clapperboard className="h-10 w-10 text-muted-foreground" />
        <p className="font-semibold text-lg">Story Slate is coming soon</p>
        <p className="text-sm text-muted-foreground max-w-sm">
          {"The video pipeline isn't enabled for this workspace yet."}
          {" Contact your workspace admin to turn it on."}
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Producer onboarding modal */}
      {showOnboarding && (
        <ProducerOnboarding onComplete={() => setShowOnboarding(false)} />
      )}
      {/* Header */}
      <div className="nx-grad-ribbon flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <p className="text-2xs font-bold uppercase tracking-widest opacity-85 flex items-center gap-3">
            Story Director
            {isProducer && (
              <button
                type="button"
                onClick={() => setShowOnboarding(true)}
                className="inline-flex items-center gap-1 text-2xs font-semibold tracking-normal normal-case bg-white/15 hover:bg-white/25 transition-colors px-2 py-0.5 rounded-md"
              >
                <Sparkles className="h-3 w-3" />
                Take the tour
              </button>
            )}
          </p>
          <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight leading-tight">
            {view === 'triage'   ? 'Triage Queue' :
             view === 'consent'  ? 'Consent Queue' :
             view === 'coverage' ? 'Capture Coverage' :
                                   "Today's Slate"}
          </h1>
          <p className="text-sm opacity-80 mt-0.5">
            {view === 'triage'
              ? `${triagePackages.length} package${triagePackages.length !== 1 ? 's' : ''} need attention`
              : view === 'consent'
                ? `${consentPackages.length} package${consentPackages.length !== 1 ? 's' : ''} awaiting consent decision`
                : view === 'coverage'
                  ? 'Per-clinician capture activity and topic coverage gaps'
                  : new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
          {!generating && (
            <Button
              variant="outline"
              size="sm"
              className="bg-white/90 text-foreground border-white/40 hover:bg-white"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              {isFetching ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
            </Button>
          )}
          {view === 'today' && (
            <Button
              size="sm"
              className="bg-white text-foreground font-semibold hover:bg-slate-100 shadow"
              onClick={handleGenerate}
              disabled={generating || isLoading}
            >
              {generating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                  {genProgress.total > 0
                    ? `Generating ${genProgress.current} of ${genProgress.total}…`
                    : 'Starting…'}
                </>
              ) : (
                <>
                  <Wand2 className="h-4 w-4 mr-1.5" />
                  {todayPackages.filter((p) => p.status === 'complete').length === 0
                    ? "Generate today’s slate"
                    : 'Generate more'}
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      {/* View tabs */}
      <div className="flex items-center gap-1 border-b border-border">
        <button
          onClick={() => { setView('today'); setActiveClinicianId(null) }}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors -mb-px ${
            view === 'today'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Clapperboard className="h-4 w-4 inline-block mr-1.5 -mt-0.5" />
          Today
          <span className="ml-2 text-2xs font-bold opacity-70">{todayPackages.length}</span>
        </button>
        <button
          onClick={() => { setView('triage'); setActiveClinicianId(null) }}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors -mb-px ${
            view === 'triage'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <ListChecks className="h-4 w-4 inline-block mr-1.5 -mt-0.5" />
          Triage
          {triagePackages.length > 0 && (
            <span className={`ml-2 text-2xs font-bold px-1.5 py-0.5 rounded-full ${
              view === 'triage' ? 'bg-primary text-primary-foreground' : 'bg-amber-100 text-amber-800'
            }`}>
              {triagePackages.length}
            </span>
          )}
        </button>
        <button
          onClick={() => { setView('consent'); setActiveClinicianId(null) }}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors -mb-px ${
            view === 'consent'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <ShieldAlert className="h-4 w-4 inline-block mr-1.5 -mt-0.5" />
          Consent
          {consentPackages.length > 0 && (
            <span className={`ml-2 text-2xs font-bold px-1.5 py-0.5 rounded-full ${
              view === 'consent' ? 'bg-primary text-primary-foreground' : 'bg-amber-100 text-amber-800'
            }`}>
              {consentPackages.length}
            </span>
          )}
        </button>
        <button
          onClick={() => { setView('coverage'); setActiveClinicianId(null) }}
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

      {/* Coverage view short-circuits — package grid + chips + status strip don't apply. */}
      {view === 'coverage' ? (
        <CoveragePanel />
      ) : (
      <>

      {/* Clinician filter chips */}
      {activeClinicianIds.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground font-medium">Filter:</span>
          <button
            onClick={() => setActiveClinicianId(null)}
            className={`text-xs px-3 py-1.5 rounded-full font-medium border transition-colors ${
              activeClinicianId === null
                ? 'bg-primary text-primary-foreground border-primary'
                : 'border-border text-muted-foreground hover:border-primary/40'
            }`}
          >
            All clinicians
          </button>
          {activeClinicianIds.map((cid) => (
            <button
              key={cid}
              onClick={() => setActiveClinicianId(cid === activeClinicianId ? null : cid)}
              className={`text-xs px-3 py-1.5 rounded-full font-medium border transition-colors ${
                activeClinicianId === cid
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-border text-muted-foreground hover:border-primary/40'
              }`}
            >
              {clinicianMap[cid] || 'Unknown'}
            </button>
          ))}
        </div>
      )}

      {/* Status strip for in-progress generation (Today view only) */}
      {view === 'today' && hasGeneratingPackages && !generating && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 text-sm text-amber-800">
          <Loader2 className="h-4 w-4 animate-spin text-amber-600 shrink-0" />
          Packages are still rendering — refreshing automatically…
        </div>
      )}

      {/* Package grid / empty / loading */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <AlertCircle className="h-8 w-8 text-destructive" />
          <p className="text-sm text-destructive font-medium">Failed to load packages</p>
          <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
        </div>
      ) : filteredPackages.length === 0 ? (
        view === 'triage' ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4 text-center rounded-xl border-2 border-dashed border-border">
            <ListChecks className="h-10 w-10 text-emerald-600" />
            <div>
              <p className="font-semibold text-base">Triage queue is empty</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                Nothing needs your attention right now — everything is either approved,
                skipped, or recently rendered.
              </p>
            </div>
          </div>
        ) : view === 'consent' ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4 text-center rounded-xl border-2 border-dashed border-border">
            <ShieldAlert className="h-10 w-10 text-emerald-600" />
            <div>
              <p className="font-semibold text-base">No packages awaiting consent</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                Flag a package&apos;s source asset for consent review from its card to add it here.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-24 gap-4 text-center rounded-xl border-2 border-dashed border-border">
            <Clapperboard className="h-10 w-10 text-muted-foreground" />
            <div>
              <p className="font-semibold text-base">No packages for today yet</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                Click <strong>{"Generate today's slate"}</strong> to create story packages from your recent
                media and topic gaps.
              </p>
            </div>
          </div>
        )
      ) : (
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
          {filteredPackages.map((pkg) => (
            <PackageCard
              key={pkg.id}
              pkg={pkg}
              clinicianName={clinicianMap[pkg.clinician_id]}
              triageReason={view === 'triage' ? triageReasonFor(pkg) : null}
              onApprove={handleApprove}
              onSkip={handleSkip}
              onUpdate={() => qc.invalidateQueries({ queryKey: ['story-packages'] })}
            />
          ))}
        </div>
      )}

      {/* History strip — older packages (Today view only, only complete) */}
      {view === 'today'
        && allPackages.filter((p) => !isTodayPackage(p) && p.status === 'complete' && !triageReasonFor(p)).length > 0 && (
        <details className="mt-2">
          <summary className="text-sm font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground">
            Earlier packages ({allPackages.filter((p) => !isTodayPackage(p) && p.status === 'complete' && !triageReasonFor(p)).length})
          </summary>
          <div className="grid gap-4 mt-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
            {allPackages
              .filter((p) => !isTodayPackage(p) && p.status === 'complete' && !triageReasonFor(p))
              .map((pkg) => (
                <PackageCard
                  key={pkg.id}
                  pkg={pkg}
                  clinicianName={clinicianMap[pkg.clinician_id]}
                  onApprove={handleApprove}
                  onSkip={handleSkip}
                  onUpdate={() => qc.invalidateQueries({ queryKey: ['story-packages'] })}
                />
              ))}
          </div>
        </details>
      )}

      </>
      )}
    </div>
  )
}

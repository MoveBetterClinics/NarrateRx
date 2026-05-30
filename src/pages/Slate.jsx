import { useState, useRef, useMemo, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Clapperboard, Loader2, RefreshCw, Wand2, AlertCircle, ListChecks, ShieldAlert, BarChart3, Sparkles, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { useStaffSummaries } from '@/lib/queries'
import { apiFetch } from '@/lib/api'
import { toast } from '@/lib/toast'
import { getSuggestedTopics } from '@/lib/topicSuggestions'
import { allocateSlots } from '@/lib/campaignAllocation'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import PackageCard from '@/components/slate/PackageCard'
import CoveragePanel from '@/components/slate/CoveragePanel'
import ProducerOnboarding from '@/components/slate/ProducerOnboarding'
import PageHelp from '@/components/PageHelp'

const SLATE_TARGET = 4  // aim for this many packages per day
const REFETCH_INTERVAL_MS = 3000
// Hard cap so a dead render job (status stuck 'generating') can't poll forever.
// Raised 5min → 60min for the keep-whole long-form lane: a chunked 30–60 min
// talk renders piece-by-piece and its total wall-time can reach ~30–45 min, so
// a 5min cap would stop watching a legitimately in-flight render. The cap only
// matters as a backstop against a truly stuck row; it never delays a render.
const POLL_CAP_MS = 60 * 60 * 1000

// A package is still working if it's queued, rendering, or waiting on Runway
// b-roll. Used to drive the live poll. NOTE: the "Stop generating" button uses
// a deliberately narrower check (no pending_broll) — don't fold that into this.
const isPendingPackage = (p) =>
  p.status === 'generating' || p.status === 'pending' || p.status === 'pending_broll'
const TRIAGE_CONFIDENCE_THRESHOLD = 0.65  // packages below this need clinician attention
const STALE_HOURS = 36  // unaddressed complete packages older than this land in triage
// Phase 4 PR 3 — Brand QC threshold. Packages scoring below this on voice fidelity
// (0-100 scale; 70 = "mostly faithful" per scorer rubric) need a producer
// review before they ship. Excluded if a producer already approved them.
const BRAND_QC_THRESHOLD = 70

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
function pickTopicGaps(workspace, todayTopics, count, provenTopics = []) {
  // V5: provenTopics (topics whose past published content was flagged a winner)
  // float up within their gap/priority tier so the daily slate resurfaces
  // formats the audience has rewarded. Empty array = neutral ranking.
  const ranked = getSuggestedTopics(workspace, [], null, provenTopics)
  const used = new Set(todayTopics.map((t) => t.toLowerCase()))
  const gaps = ranked.filter((s) => !used.has(s.topic.toLowerCase()))
  return gaps.slice(0, count).map((s) => s.topic)
}

export default function Slate() {
  useDocumentTitle('Story Slate')
  const ws = useWorkspace()
  const qc = useQueryClient()

  const { data: staff = [] } = useStaffSummaries()
  const staffMap = useMemo(
    () => Object.fromEntries(staff.map((c) => [c.id, c.name])),
    [staff]
  )

  // V5 engagement loop: pull the same coverage rollup the Coverage tab uses so
  // the daily generator can bias toward "proven" topics — those whose past
  // published content was flagged a winner (performed_well). Shares the query
  // cache with CoveragePanel via the identical key. Failure is non-fatal: an
  // empty proven list just yields neutral topic ranking.
  const { data: coverage } = useQuery({
    queryKey: ['editorial-coverage'],
    queryFn: () => apiFetch('/api/editorial/coverage'),
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  })
  const provenTopics = useMemo(
    () => (coverage?.topics || []).filter((t) => t.winner_count > 0).map((t) => t.topic),
    [coverage]
  )

  const [view, setView] = useState('today')  // 'today' | 'triage' | 'consent' | 'qc' | 'coverage'
  const [activeStaffId, setActiveStaffId] = useState(null)
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

  // Track when pending-poll began so we can cap it. Without this, a render job
  // that dies after writing status='generating' but before the terminal PATCH
  // (OOM, or the 300s function wall where `finally` never runs) leaves the
  // package stuck pending forever — and every open Slate session hammers the
  // endpoint at 3 req/s indefinitely until page reload. Resets to { at: 0 }
  // whenever nothing is pending, so a fresh generation restarts the clock.
  const pollStartRef = useRef({ at: 0 })

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
      const anyPending = pkgs.some(isPendingPackage)
      if (!anyPending) return false
      if (!pollStartRef.current.at) pollStartRef.current.at = Date.now()
      if (Date.now() - pollStartRef.current.at > POLL_CAP_MS) return false
      return REFETCH_INTERVAL_MS
    },
    refetchOnWindowFocus: false,
  })

  // Reset the poll cap once nothing is pending, so the next generation gets a
  // fresh 5-min window instead of inheriting an expired clock.
  const anyPending = useMemo(
    () => (data?.packages || []).some(isPendingPackage),
    [data]
  )
  useEffect(() => {
    if (!anyPending) pollStartRef.current = { at: 0 }
  }, [anyPending])

  const allPackages = useMemo(() => {
    const pkgs = data?.packages || []
    // Filter out explicitly skipped + canceled + approved packages from BOTH views
    return pkgs.filter((p) => p.status !== 'skipped' && p.status !== 'canceled' && p.status !== 'approved')
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

  // Phase 4 PR 3 — Brand QC queue: packages with a voice-fidelity score below
  // the green/amber boundary. Caption fidelity scores live in the same column
  // (story_packages.voice_fidelity_score) per V1, so this view surfaces both
  // long-form drift and caption drift on a single producer-facing list.
  // Sorted lowest-score-first so the worst drift floats to the top.
  const qcPackages = useMemo(() => {
    return allPackages
      .filter((p) => {
        const s = p.voice_fidelity_score
        return typeof s === 'number' && s < BRAND_QC_THRESHOLD
      })
      .sort((a, b) => (a.voice_fidelity_score ?? 99) - (b.voice_fidelity_score ?? 99))
  }, [allPackages])

  const basePackages =
    view === 'triage'  ? triagePackages :
    view === 'consent' ? consentPackages :
    view === 'qc'      ? qcPackages :
                         todayPackages

  const filteredPackages = useMemo(() => {
    if (!activeStaffId) return basePackages
    return basePackages.filter((p) => p.staff_id === activeStaffId)
  }, [basePackages, activeStaffId])

  // Clinicians who appear in the current view (for filter chips)
  const activeStaffIds = useMemo(
    () => [...new Set(basePackages.map((p) => p.staff_id).filter(Boolean))],
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

    // Phase 4 Tentpole PR B: allocate slots across active campaigns by
    // event-proximity weighting. Slots without a campaign fall back to the
    // legacy topic-gaps generator (this is also the fallback when no
    // campaigns are active).
    const activeCampaigns = Array.isArray(ws?.active_campaigns) ? ws.active_campaigns : []
    const slotAssignments = allocateSlots(activeCampaigns, needed)
    const fallbackTopics = pickTopicGaps(ws, todayTopics, needed, provenTopics)

    // Build the per-slot generation plan. For campaign slots, the topic is
    // the campaign's theme_notes (or name as fallback). For non-campaign
    // slots, pull from fallbackTopics. When a campaign has
    // target_staff_ids, propagate it to generate-package so clip search
    // scopes to that clinician's library (per-clinician targeting).
    let fallbackCursor = 0
    const plan = slotAssignments.map((campaign) => {
      if (campaign) {
        const topic = campaign.theme_notes || campaign.name
        const targets = Array.isArray(campaign.target_staff_ids) ? campaign.target_staff_ids : []
        // Single target → pass as staffId. Multi-target → leave broad
        // (clip search picks from any of the targets via campaign-level
        // filtering — refine if/when multi-target campaigns get common).
        const staffId = targets.length === 1 ? targets[0] : null
        return { campaignId: campaign.id, topic, campaign, staffId }
      }
      const topic = fallbackTopics[fallbackCursor++]
      return topic ? { campaignId: null, topic } : null
    }).filter(Boolean)

    if (plan.length === 0) {
      toast('No active campaigns and no topic gaps. Add campaigns or topics first.')
      generatingRef.current = false
      setGenerating(false)
      return
    }

    setGenProgress({ current: 0, total: plan.length })

    let succeeded = 0
    for (let i = 0; i < plan.length; i++) {
      setGenProgress({ current: i + 1, total: plan.length })
      const { topic, campaignId, staffId } = plan[i]
      try {
        await apiFetch('/api/editorial/generate-package', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            topic,
            ...(campaignId ? { campaignId } : {}),
            ...(staffId ? { staffId } : {}),
          }),
        })
        succeeded++
        // Refresh the list after each successful package
        qc.invalidateQueries({ queryKey: ['story-packages'] })
      } catch (err) {
        console.error('[Slate] generate-package failed for topic:', topic, err)
        toast.error(`Failed to generate: ${topic.slice(0, 60)}`)
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

  // Cooperative stop for a still-generating package. Frees the producer
  // immediately (the canceled card drops out of every view); the background
  // render's terminal write is guarded server-side so it can't resurrect it.
  async function handleStop(pkg) {
    try {
      await apiFetch(`/api/editorial/packages/${pkg.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'canceled' }),
      })
      qc.invalidateQueries({ queryKey: ['story-packages'] })
      toast('Stopped. This one won\'t finish — start another whenever you\'re ready.')
    } catch (err) {
      // 409 already_settled = the render finished a beat before Stop landed.
      if (err?.status === 409) {
        qc.invalidateQueries({ queryKey: ['story-packages'] })
        toast('This one already finished rendering.')
      } else {
        toast.error(err?.message || 'Failed to stop generating.')
      }
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
             view === 'qc'       ? 'Brand QC' :
             view === 'coverage' ? 'Capture Coverage' :
                                   "Today's Slate"}
          </h1>
          <p className="text-sm opacity-80 mt-0.5">
            {view === 'triage'
              ? `${triagePackages.length} package${triagePackages.length !== 1 ? 's' : ''} need attention`
              : view === 'consent'
                ? `${consentPackages.length} package${consentPackages.length !== 1 ? 's' : ''} awaiting consent decision`
                : view === 'qc'
                  ? `${qcPackages.length} package${qcPackages.length !== 1 ? 's' : ''} below brand voice threshold (lowest fidelity first)`
                  : view === 'coverage'
                    ? 'Per-staff capture activity and topic coverage gaps'
                    : new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
          <PageHelp pageKey="slate" variant="onGradient" />
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
          onClick={() => { setView('today'); setActiveStaffId(null) }}
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
          onClick={() => { setView('triage'); setActiveStaffId(null) }}
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
              view === 'triage' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
            }`}>
              {triagePackages.length}
            </span>
          )}
        </button>
        <button
          onClick={() => { setView('consent'); setActiveStaffId(null) }}
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
              view === 'consent' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
            }`}>
              {consentPackages.length}
            </span>
          )}
        </button>
        <button
          onClick={() => { setView('qc'); setActiveStaffId(null) }}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors -mb-px ${
            view === 'qc'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <ShieldCheck className="h-4 w-4 inline-block mr-1.5 -mt-0.5" />
          Brand QC
          {qcPackages.length > 0 && (
            <span className={`ml-2 text-2xs font-bold px-1.5 py-0.5 rounded-full ${
              view === 'qc' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
            }`}>
              {qcPackages.length}
            </span>
          )}
        </button>
        <button
          onClick={() => { setView('coverage'); setActiveStaffId(null) }}
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
      {activeStaffIds.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground font-medium">Filter:</span>
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
          {activeStaffIds.map((cid) => (
            <button
              key={cid}
              onClick={() => setActiveStaffId(cid === activeStaffId ? null : cid)}
              className={`text-xs px-3 py-1.5 rounded-full font-medium border transition-colors ${
                activeStaffId === cid
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-border text-muted-foreground hover:border-primary/40'
              }`}
            >
              {staffMap[cid] || 'Unknown'}
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
        ) : view === 'qc' ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4 text-center rounded-xl border-2 border-dashed border-border">
            <ShieldCheck className="h-10 w-10 text-emerald-600" />
            <div>
              <p className="font-semibold text-base">Brand voice is on-key</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                No packages are scoring below the {BRAND_QC_THRESHOLD}/100 voice-fidelity threshold.
                Drafts that drift will surface here automatically.
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
              staffName={staffMap[pkg.staff_id]}
              triageReason={view === 'triage' ? triageReasonFor(pkg) : null}
              onApprove={handleApprove}
              onSkip={handleSkip}
              onStop={handleStop}
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
                  staffName={staffMap[pkg.staff_id]}
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

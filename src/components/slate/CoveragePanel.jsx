import { useQuery } from '@tanstack/react-query'
import { Camera, Loader2, AlertCircle, TrendingDown, CheckCircle2, Clock, Lightbulb, Trophy } from 'lucide-react'
import { apiFetch } from '@/lib/api'

const RECENT_DAYS = 14
const STALE_CAPTURE_DAYS = 21  // clinician hasn't captured in 3 weeks → flag

function daysSince(iso) {
  if (!iso) return Infinity
  return Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000))
}

function ClinicianRow({ c }) {
  const lastDays = daysSince(c.last_capture_at)
  const stale = lastDays > STALE_CAPTURE_DAYS
  const noContent = c.asset_count === 0
  const lastLabel =
    !c.last_capture_at         ? 'Never captured' :
    lastDays === 0             ? 'Today' :
    lastDays === 1             ? 'Yesterday' :
    lastDays < 30              ? `${lastDays}d ago` :
                                 new Date(c.last_capture_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

  return (
    <div className="flex items-center gap-4 p-3 rounded-lg border border-border bg-card hover:bg-muted/30 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-semibold text-sm truncate">{c.name}</p>
          {noContent ? (
            <span className="text-2xs font-bold px-1.5 py-0.5 rounded-full bg-destructive/10 text-destructive border border-destructive/30">
              No clips
            </span>
          ) : stale ? (
            <span className="text-2xs font-bold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
              Stale
            </span>
          ) : null}
        </div>
        <p className="text-2xs text-muted-foreground mt-0.5 flex items-center gap-1.5">
          <Clock className="h-3 w-3" />
          Last capture: {lastLabel}
        </p>
      </div>
      {c.winner_count > 0 && (
        <span
          className="text-2xs font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300 inline-flex items-center gap-1 shrink-0"
          title={`${c.winner_count} published piece${c.winner_count !== 1 ? 's' : ''} the audience responded to`}
        >
          <Trophy className="h-3 w-3" />
          {c.winner_count}
        </span>
      )}
      <div className="text-right shrink-0">
        <p className="text-lg font-bold tabular-nums leading-none">{c.asset_count}</p>
        <p className="text-2xs text-muted-foreground mt-1">
          {c.asset_count_14d} in last {RECENT_DAYS}d
        </p>
      </div>
    </div>
  )
}

function TopicRow({ t }) {
  const hasCoverage = t.package_count > 0
  const priority = t.priority || 'medium'
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card hover:bg-muted/30 transition-colors">
      <div className="shrink-0">
        {hasCoverage
          ? <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          : priority === 'high'
            ? <TrendingDown className="h-4 w-4 text-destructive" />
            : <Lightbulb className="h-4 w-4 text-amber-600" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm truncate">{t.topic}</p>
        <p className="text-2xs text-muted-foreground mt-0.5">
          {priority} priority
          {hasCoverage
            ? <> · {t.package_count} package{t.package_count !== 1 ? 's' : ''}</>
            : <> · No packages yet</>}
        </p>
      </div>
      {t.winner_count > 0 && (
        <span
          className="text-2xs font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300 inline-flex items-center gap-1 shrink-0"
          title={`${t.winner_count} published piece${t.winner_count !== 1 ? 's' : ''} on this topic the audience responded to`}
        >
          <Trophy className="h-3 w-3" />
          {t.winner_count}
        </span>
      )}
    </div>
  )
}

export default function CoveragePanel() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['editorial-coverage'],
    queryFn: () => apiFetch('/api/editorial/coverage'),
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  })

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
        <AlertCircle className="h-8 w-8 text-destructive" />
        <p className="text-sm text-destructive font-medium">Failed to load coverage data</p>
        <button
          className="text-xs font-medium text-primary hover:underline"
          onClick={() => refetch()}
        >
          Retry
        </button>
      </div>
    )
  }

  const clinicians = data?.clinicians || []
  const topics = data?.topics || []
  const gapsCount = topics.filter((t) => t.package_count === 0).length
  const staleCliniciansCount = clinicians.filter(
    (c) => c.asset_count === 0 || daysSince(c.last_capture_at) > STALE_CAPTURE_DAYS
  ).length

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Per-clinician panel */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground inline-flex items-center gap-2">
            <Camera className="h-3.5 w-3.5" />
            Clinician capture activity
          </h2>
          {staleCliniciansCount > 0 && (
            <span className="text-2xs font-semibold text-amber-700">
              {staleCliniciansCount} need{staleCliniciansCount !== 1 ? '' : 's'} attention
            </span>
          )}
        </div>
        {clinicians.length === 0 ? (
          <div className="rounded-lg border-2 border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No clinicians in this workspace yet.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {clinicians.map((c) => <ClinicianRow key={c.id} c={c} />)}
          </div>
        )}
      </section>

      {/* Per-topic panel */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground inline-flex items-center gap-2">
            <Lightbulb className="h-3.5 w-3.5" />
            Topic coverage
          </h2>
          {gapsCount > 0 && (
            <span className="text-2xs font-semibold text-amber-700">
              {gapsCount} gap{gapsCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        {topics.length === 0 ? (
          <div className="rounded-lg border-2 border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No topic suggestions configured. Add topics in <strong>Workspace Settings → Topics</strong>.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {topics.map((t) => <TopicRow key={t.topic} t={t} />)}
          </div>
        )}
      </section>
    </div>
  )
}

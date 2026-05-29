import { useState, useEffect, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Loader2, AlertCircle, Users, BookOpen, TrendingUp,
  ChevronRight, Circle, CheckCircle2, BarChart3, Lightbulb,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { useUserRole } from '@/lib/useUserRole'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { apiFetch } from '@/lib/api'

// ── Kind metadata ─────────────────────────────────────────────────────────────

const KIND_META = {
  archetype:  { label: 'Patient archetypes',   color: 'bg-blue-100 text-blue-800 border-blue-200',   dot: 'bg-blue-400' },
  condition:  { label: 'Conditions treated',   color: 'bg-green-100 text-green-800 border-green-200', dot: 'bg-green-400' },
  paradigm:   { label: 'Practice philosophy',  color: 'bg-purple-100 text-purple-800 border-purple-200', dot: 'bg-purple-400' },
  value:      { label: 'Core values',          color: 'bg-amber-100 text-amber-800 border-amber-200',  dot: 'bg-amber-400' },
  objection:  { label: 'Patient hesitations',  color: 'bg-rose-100 text-rose-800 border-rose-200',   dot: 'bg-rose-400' },
}

const KIND_ORDER = ['condition', 'archetype', 'paradigm', 'value', 'objection']

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, sub }) {
  return (
    <div className="rounded-xl border bg-card p-4 flex items-start gap-3">
      <div className="rounded-md bg-muted p-2 shrink-0">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div>
        <p className="text-4xl font-extrabold leading-none tracking-tight">{value}</p>
        <p className="text-xs text-muted-foreground mt-1">{label}</p>
        {sub && <p className="text-xs text-muted-foreground/70 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

// ── Coverage bar ──────────────────────────────────────────────────────────────

function CoverageBar({ mentionedCount, totalCount }) {
  if (!totalCount) return null
  const pct = Math.round((mentionedCount / totalCount) * 100)
  return (
    <div className="flex items-center gap-2 mt-1.5">
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-emerald-400 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-3xs text-muted-foreground tabular-nums w-8 text-right">
        {mentionedCount}/{totalCount}
      </span>
    </div>
  )
}

// ── Concept row ───────────────────────────────────────────────────────────────

function ConceptRow({ concept, totalStaff, onDraft }) {
  const meta = KIND_META[concept.kind] || KIND_META.condition
  const agreed = concept.mentionedBy.length
  const gaps   = concept.notMentionedBy

  return (
    <div className="group flex items-start gap-3 py-3 border-b last:border-b-0">
      {/* Weight indicator */}
      <div className="shrink-0 mt-0.5 w-1.5 rounded-full self-stretch min-h-[2rem]"
        style={{ backgroundColor: agreed >= 2 ? '#34d399' : agreed === 1 ? '#fbbf24' : '#e5e7eb' }}
      />

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <span className="text-sm font-medium leading-snug">{concept.label}</span>
            <Badge variant="outline" className={`ml-2 text-3xs px-1.5 py-0 ${meta.color}`}>
              {meta.label}
            </Badge>
          </div>
          <Button
            variant="ghost" size="sm"
            onClick={() => onDraft(concept)}
            className="shrink-0 text-xs text-muted-foreground hover:text-primary transition-colors -mr-1 h-7 gap-1"
          >
            Draft content <ChevronRight className="h-3 w-3" />
          </Button>
        </div>

        <CoverageBar mentionedCount={agreed} totalCount={totalStaff} />

        {/* Clinician chips */}
        <div className="flex flex-wrap gap-1 mt-2">
          {concept.mentionedBy.map(c => (
            <span key={c.id} className="inline-flex items-center gap-1 text-2xs bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full px-2 py-0.5">
              <CheckCircle2 className="h-2.5 w-2.5" /> {c.name}
            </span>
          ))}
          {gaps.map(c => (
            <span key={c.id} className="inline-flex items-center gap-1 text-2xs bg-muted text-muted-foreground border border-border rounded-full px-2 py-0.5">
              <Circle className="h-2.5 w-2.5" /> {c.name}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Kind section ──────────────────────────────────────────────────────────────

function KindSection({ kind, concepts, totalStaff, onDraft }) {
  const meta = KIND_META[kind]
  if (!meta || !concepts.length) return null

  const agreed = concepts.filter(c => c.mentionedBy.length >= 2)
  const solo   = concepts.filter(c => c.mentionedBy.length === 0)

  return (
    <section className="rounded-xl border bg-card">
      <div className="flex items-center justify-between px-5 py-3.5 border-b">
        <div className="flex items-center gap-2">
          <div className={`h-2.5 w-2.5 rounded-full ${meta.dot}`} />
          <h2 className="text-sm font-semibold">{meta.label}</h2>
          <span className="text-xs text-muted-foreground">{concepts.length} concepts</span>
        </div>
        <div className="flex items-center gap-3 text-2xs text-muted-foreground">
          {agreed.length > 0 && <span className="text-emerald-600">≡ {agreed.length} shared</span>}
          {solo.length > 0  && <span className="text-amber-600">○ {solo.length} gaps</span>}
        </div>
      </div>
      <div className="px-5">
        {concepts.map(c => (
          <ConceptRow
            key={c.id}
            concept={c}
            totalStaff={totalStaff}
            onDraft={onDraft}
          />
        ))}
      </div>
    </section>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Synthesis() {
  useDocumentTitle('Knowledge Synthesis')
  const navigate = useNavigate()
  const { workspace } = useWorkspace()
  const { role, isLoading: roleLoading } = useUserRole()

  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    apiFetch('/api/concepts/synthesis')
      .then(setData)
      .catch(err => {
        // 403 = signed in but lacking the admin role (the canonical
        // "admin only" case). 401 is handled globally in apiError.js
        // (toasts "Sign in again") so we just surface the generic error.
        if (err?.status === 403) setError('admin_only')
        else setError(err?.message || 'fetch_failed')
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!roleLoading) load()
  }, [roleLoading, load])

  // Redirect non-admins
  useEffect(() => {
    if (!roleLoading && role !== 'admin') navigate('/', { replace: true })
  }, [roleLoading, role, navigate])

  function handleDraft(concept) {
    navigate(`/new?topic=${encodeURIComponent(concept.label)}`)
  }

  // ── States ───────────────────────────────────────────────────────────────────

  if (roleLoading || loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading synthesis…
      </div>
    )
  }

  if (error === 'admin_only') {
    return (
      <div className="max-w-2xl mx-auto py-16 text-center">
        <AlertCircle className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">Admin access required to view synthesis.</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto py-16 text-center space-y-3">
        <AlertCircle className="h-8 w-8 text-destructive mx-auto" />
        <p className="text-sm text-muted-foreground">Failed to load synthesis data.</p>
        <Button variant="outline" size="sm" onClick={load}>Retry</Button>
      </div>
    )
  }

  if (!data || !data.concepts.length) {
    return (
      <div className="max-w-2xl mx-auto py-16 text-center space-y-3">
        <Lightbulb className="h-8 w-8 text-muted-foreground mx-auto" />
        <h2 className="text-base font-semibold">No knowledge graph yet</h2>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          Complete and approve a few interviews to start building your practice&apos;s knowledge graph. Synthesis will appear here once concepts are learned.
        </p>
        <Button asChild size="sm" className="mt-2">
          <Link to="/new">Start an interview</Link>
        </Button>
      </div>
    )
  }

  const { concepts, clinicians, coverage } = data

  // Group by kind in preferred order
  const grouped = {}
  for (const c of concepts) {
    if (!grouped[c.kind]) grouped[c.kind] = []
    grouped[c.kind].push(c)
  }
  const orderedKinds = [
    ...KIND_ORDER.filter(k => grouped[k]?.length),
    ...Object.keys(grouped).filter(k => !KIND_ORDER.includes(k)),
  ]

  // Gap summary — concepts where ≥1 clinician hasn't mentioned it (high-value gaps first)
  const topGaps = concepts
    .filter(c => c.notMentionedBy.length > 0)
    .sort((a, b) => b.notMentionedBy.length - a.notMentionedBy.length || b.weight - a.weight)
    .slice(0, 5)

  return (
    <div className="py-8 space-y-8 px-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <Link to="/" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-3">
            <ArrowLeft className="h-3.5 w-3.5" /> Dashboard
          </Link>
          <h1 className="text-2xl font-bold tracking-tight flex items-center">
            <span
              className="inline-block w-1 h-6 rounded-full shrink-0 mr-2.5"
              style={{ background: 'hsl(var(--primary))' }}
              aria-hidden="true"
            />
            Knowledge synthesis
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Cross-staff concept coverage for {workspace?.display_name}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} className="shrink-0">
          Refresh
        </Button>
      </div>

      {/* Coverage legend — above stats so readers learn the color code
          before they see the numbers it grades. */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-400 inline-block" /> Mentioned by ≥2 clinicians (agreement territory)</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-400 inline-block" /> Mentioned by 1 clinician only</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-gray-300 inline-block" /> Not yet covered</span>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <StatCard icon={BookOpen}  label="Concepts learned"   value={coverage.total} />
        <StatCard icon={Users}     label="Clinicians with data" value={clinicians.length} />
        <StatCard
          icon={BarChart3}
          label="Coverage score"
          value={`${coverage.coveragePercent}%`}
          sub="concepts × clinicians mentioned"
        />
      </div>

      {/* Top gaps callout */}
      {topGaps.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <Circle className="h-4 w-4 text-amber-600" />
            <span className="text-sm font-medium text-amber-800">Coverage gaps to close</span>
          </div>
          <p className="text-xs text-amber-700">
            These concepts have clinicians who haven&apos;t shared their perspective yet — good candidates for Bernard to surface as gap probes.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            {topGaps.map(c => (
              <button
                key={c.id}
                onClick={() => handleDraft(c)}
                className="inline-flex items-center gap-1.5 text-xs bg-white border border-amber-300 text-amber-800 rounded-full px-3 py-1 hover:bg-amber-100 transition-colors"
              >
                {c.label}
                <span className="text-amber-500">({c.notMentionedBy.length} missing)</span>
                <ChevronRight className="h-3 w-3" />
              </button>
            ))}
          </div>
        </div>
      )}

      <Separator />

      {/* Concept matrix by kind */}
      <div className="space-y-4">
        {orderedKinds.map(kind => (
          <KindSection
            key={kind}
            kind={kind}
            concepts={grouped[kind]}
            totalStaff={clinicians.length}
            onDraft={handleDraft}
          />
        ))}
      </div>

      {/* Footer CTA */}
      <div className="rounded-xl border border-dashed p-6 text-center space-y-2">
        <TrendingUp className="h-6 w-6 text-muted-foreground mx-auto" />
        <p className="text-sm font-medium">Build content from any theme</p>
        <p className="text-xs text-muted-foreground max-w-sm mx-auto">
          Click &quot;Draft content&quot; on any concept row to start a new interview or content piece targeting that theme.
        </p>
        <Button asChild size="sm" className="mt-2">
          <Link to="/new">Start a new interview</Link>
        </Button>
      </div>
    </div>
  )
}

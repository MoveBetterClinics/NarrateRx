import { useSearchParams, Navigate } from 'react-router-dom'
import { LayoutGrid, Shield } from 'lucide-react'
import { useStories, useOnboardingProgress } from '@/lib/queries'
import { useUserRole } from '@/lib/useUserRole'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import StoriesPipelineView from '@/components/stories/StoriesPipelineView'
import StoriesCalendarView from '@/components/stories/StoriesCalendarView'
import StoriesThemesView from '@/components/stories/StoriesThemesView'
import UsageGate from '@/components/billing/UsageGate'
import PageHelp from '@/components/PageHelp'

// The clinic-wide, top-down board — separate from Home (which is personal) and
// from Stories/Storyboard (the producer's own work). Three lenses on the same
// content: Pipeline (by stage), Calendar (by ship date), Themes (by topic +
// gaps). These moved OFF the producer's Stories list, where they didn't belong.
//
// Role-gated to owner / producer / director (admin or publisher). An individual
// clinician just uses Home + their work and never sees this surface.
const LENSES = [
  ['pipeline', 'Pipeline'],
  ['calendar', 'Calendar'],
  ['themes', 'Themes'],
]

export default function Overview() {
  useDocumentTitle('Overview')
  const { isEditor, isLoading: roleLoading } = useUserRole()
  const [searchParams, setSearchParams] = useSearchParams()
  const view = searchParams.get('view') || 'pipeline'

  const { data: stories = [], isLoading } = useStories()
  const { data: progress } = useOnboardingProgress()
  const currentPlan = progress?.plan

  // Role gate — individual clinicians don't get the clinic-wide board. Wait for
  // the role to resolve before deciding so we don't bounce an editor mid-load.
  if (!roleLoading && !isEditor) return <Navigate to="/" replace />

  const setView = (v) =>
    setSearchParams(
      (prev) => {
        prev.set('view', v)
        return prev
      },
      { replace: true },
    )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <LayoutGrid className="h-5 w-5 text-primary" aria-hidden="true" />
            Overview
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The whole clinic&rsquo;s content, top-down — every piece, every staff member.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PageHelp pageKey="overview" variant="default" />
          <span className="inline-flex items-center gap-1.5 rounded-full border bg-muted/40 px-2.5 py-1 text-2xs font-medium text-muted-foreground">
            <Shield className="h-3 w-3" aria-hidden="true" />
            Owner · Producer view
          </span>
        </div>
      </div>

      {/* Lens toggle — Pipeline / Calendar / Themes, persisted in ?view= */}
      <div className="inline-flex rounded-md border p-0.5 text-xs font-medium">
        {LENSES.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setView(id)}
            className={`rounded px-3 py-1 transition-colors ${
              view === id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Lens dispatch — same data + the same view components Stories used to
          host, so the board stays consistent with the producer's surfaces. */}
      {view === 'calendar' ? (
        <StoriesCalendarView stories={stories} isLoading={isLoading} />
      ) : view === 'themes' ? (
        <UsageGate feature="cross_staff_synthesis" currentPlan={currentPlan}>
          <StoriesThemesView stories={stories} isLoading={isLoading} />
        </UsageGate>
      ) : (
        <StoriesPipelineView stories={stories} isLoading={isLoading} />
      )}
    </div>
  )
}

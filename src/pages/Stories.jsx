import { useSearchParams } from 'react-router-dom'
import { useStories, useOnboardingProgress } from '@/lib/queries'
import StoriesViewToggle from '@/components/stories/StoriesViewToggle'
import StoriesFilters from '@/components/stories/StoriesFilters'
import StoriesCardsView from '@/components/stories/StoriesCardsView'
import StoriesPipelineView from '@/components/stories/StoriesPipelineView'
import StoriesCalendarView from '@/components/stories/StoriesCalendarView'
import StoriesThemesView from '@/components/stories/StoriesThemesView'
import UsageGate from '@/components/billing/UsageGate'

/**
 * Stories page — top-level IA surface.
 *
 * Reads `?view=` (cards | pipeline | calendar | themes, default: cards) and
 * dispatches to the appropriate view component. All views share the same
 * useStories() data; filters live in URL params.
 *
 * The Themes view requires the Practice plan (cross_staff_synthesis feature).
 */
export default function Stories() {
  const [searchParams] = useSearchParams()
  const view = searchParams.get('view') || 'cards'

  const { data: stories = [], isLoading } = useStories()
  const { data: progress } = useOnboardingProgress()
  const currentPlan = progress?.plan

  return (
    <div className="flex flex-col gap-4 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Stories</h1>
        <StoriesViewToggle />
      </div>

      {/* Filters */}
      <StoriesFilters />

      {/* View dispatch */}
      {view === 'pipeline' ? (
        <StoriesPipelineView stories={stories} isLoading={isLoading} />
      ) : view === 'calendar' ? (
        <StoriesCalendarView stories={stories} isLoading={isLoading} />
      ) : view === 'themes' ? (
        <UsageGate feature="cross_staff_synthesis" currentPlan={currentPlan}>
          <StoriesThemesView stories={stories} isLoading={isLoading} />
        </UsageGate>
      ) : (
        <StoriesCardsView stories={stories} isLoading={isLoading} />
      )}
    </div>
  )
}

import { useSearchParams } from 'react-router-dom'
import { useStories } from '@/lib/queries'
import StoriesViewToggle from '@/components/stories/StoriesViewToggle'
import StoriesFilters from '@/components/stories/StoriesFilters'
import StoriesCardsView from '@/components/stories/StoriesCardsView'
import StoriesPipelineView from '@/components/stories/StoriesPipelineView'
import StoriesCalendarView from '@/components/stories/StoriesCalendarView'
import StoriesThemesView from '@/components/stories/StoriesThemesView'

/**
 * Stories page — top-level IA surface.
 *
 * Reads `?view=` (cards | pipeline | calendar, default: cards) and
 * dispatches to the appropriate view component. All three views share
 * the same useStories() data; filters live in URL params.
 */
export default function Stories() {
  const [searchParams] = useSearchParams()
  const view = searchParams.get('view') || 'cards'

  const { data: stories = [], isLoading } = useStories()

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
        <StoriesThemesView stories={stories} isLoading={isLoading} />
      ) : (
        <StoriesCardsView stories={stories} isLoading={isLoading} />
      )}
    </div>
  )
}

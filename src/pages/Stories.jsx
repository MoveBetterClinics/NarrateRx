import { useSearchParams } from 'react-router-dom'
import { useStories } from '@/lib/queries'
import StoriesViewToggle from '@/components/stories/StoriesViewToggle'
import StoriesFilters from '@/components/stories/StoriesFilters'
import StoriesCardsView from '@/components/stories/StoriesCardsView'

function PipelinePlaceholder() {
  return (
    <div className="p-8 text-center text-gray-500">
      Pipeline view — coming in the next update
    </div>
  )
}

function CalendarPlaceholder() {
  return (
    <div className="p-8 text-center text-gray-500">
      Calendar view — coming in the next update
    </div>
  )
}

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
        <PipelinePlaceholder />
      ) : view === 'calendar' ? (
        <CalendarPlaceholder />
      ) : (
        <StoriesCardsView stories={stories} isLoading={isLoading} />
      )}
    </div>
  )
}

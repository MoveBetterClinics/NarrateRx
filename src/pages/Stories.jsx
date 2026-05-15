import { useSearchParams } from 'react-router-dom'
import { useStories, useOnboardingProgress } from '@/lib/queries'
import StoriesViewToggle from '@/components/stories/StoriesViewToggle'
import StoriesSidebar from '@/components/stories/StoriesSidebar'
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
 * useStories() data; filters live in URL params and are driven by the left
 * sidebar (md+) or the horizontal chip row (mobile fallback).
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
    <div className="flex gap-8 min-h-[calc(100vh-3.5rem)]">
      {/* Sidebar — md+ only. Filter chips below act as the mobile fallback. */}
      <aside className="hidden md:block w-56 shrink-0 pt-6 pr-2 border-r border-border">
        <StoriesSidebar />
      </aside>

      <main className="flex-1 min-w-0 py-6">
        <div className="flex flex-col gap-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-semibold text-foreground">Stories</h1>
            <StoriesViewToggle />
          </div>

          {/* Mobile-only horizontal chip filters. Sidebar replaces these on md+. */}
          <div className="md:hidden">
            <StoriesFilters />
          </div>

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
      </main>
    </div>
  )
}

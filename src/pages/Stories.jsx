import { useSearchParams } from 'react-router-dom'
import { useStories, useOnboardingProgress, useCampaigns } from '@/lib/queries'
import { useUserRole } from '@/lib/useUserRole'
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
 * Reads `?view=` (cards | pipeline | calendar | themes) and dispatches to the
 * appropriate view component. Default view is role-aware: Publisher/staff land
 * on the Kanban pipeline since that's their primary working surface; clinicians
 * land on the cards grid. All views share the same useStories() data.
 *
 * The Themes view requires the Practice plan (cross_staff_synthesis feature).
 */
export default function Stories() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { isStaff } = useUserRole()
  const defaultView = isStaff ? 'pipeline' : 'cards'
  const view = searchParams.get('view') || defaultView
  const activeCampaign = searchParams.get('campaign') || ''

  const { data: stories = [], isLoading } = useStories()
  const { data: progress } = useOnboardingProgress()
  const { data: campaigns = [] } = useCampaigns()
  const currentPlan = progress?.plan
  const awaitingReviewCount = stories.filter((s) => s.story_stage === 'review').length

  // Only surface active campaigns in the dropdown. Archived/complete still
  // resolve from the URL (so a shared link stays meaningful), but we don't
  // clutter the selector with them.
  const selectableCampaigns = campaigns.filter(
    (c) => c.status === 'active' || c.id === activeCampaign,
  )

  function onCampaignChange(e) {
    const value = e.target.value
    const next = new URLSearchParams(searchParams)
    if (value) next.set('campaign', value)
    else next.delete('campaign')
    setSearchParams(next, { replace: true })
  }

  return (
    <div className="flex gap-8 min-h-[calc(100vh-3.5rem)]">
      {/* Sidebar — md+ only. Filter chips below act as the mobile fallback. */}
      <aside className="hidden md:block w-56 shrink-0 pt-6 pr-2 border-r border-border">
        <StoriesSidebar />
      </aside>

      <main className="flex-1 min-w-0 py-6">
        <div className="flex flex-col gap-4">
          {/* Header */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-baseline gap-3 min-w-0">
              <h1 className="text-xl font-semibold text-foreground">Stories</h1>
              {!isLoading && stories.length > 0 ? (
                <span className="text-xs text-muted-foreground truncate">
                  {stories.length === 1 ? '1 story' : `${stories.length} stories`}
                  {awaitingReviewCount > 0
                    ? ` · ${awaitingReviewCount} awaiting review`
                    : ''}
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              {selectableCampaigns.length > 0 && (
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="hidden sm:inline">Campaign</span>
                  <select
                    value={activeCampaign}
                    onChange={onCampaignChange}
                    className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
                  >
                    <option value="">All</option>
                    {selectableCampaigns.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </label>
              )}
              <StoriesViewToggle />
            </div>
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

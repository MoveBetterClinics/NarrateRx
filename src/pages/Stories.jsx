import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useUser } from '@clerk/clerk-react'
import { Target, User, X } from 'lucide-react'
import { useStories, useOnboardingProgress, useCampaigns, useClinicians, useLocations } from '@/lib/queries'
import { useUserRole } from '@/lib/useUserRole'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { getPatientPrototypesUi } from '@/lib/prompts'
import { PLATFORM_META } from '@/lib/contentMeta'
import StoriesViewToggle from '@/components/stories/StoriesViewToggle'
import StoriesCardsView from '@/components/stories/StoriesCardsView'
import StoriesPipelineView from '@/components/stories/StoriesPipelineView'
import StoriesCalendarView from '@/components/stories/StoriesCalendarView'
import StoriesThemesView from '@/components/stories/StoriesThemesView'
import CampaignProgressStrip from '@/components/stories/CampaignProgressStrip'
import UsageGate from '@/components/billing/UsageGate'

const PLATFORMS = Object.keys(PLATFORM_META)

const STAGES = [
  { key: 'capture',   label: 'Capture' },
  { key: 'drafting',  label: 'Drafting' },
  { key: 'review',    label: 'Review' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'published', label: 'Published' },
]

const SELECT_CLS =
  'shrink-0 rounded-full border border-border bg-white px-3 py-1.5 text-xs font-medium text-foreground ' +
  'cursor-pointer hover:border-slate-300 hover:bg-slate-50 transition-colors ' +
  'focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50'

/**
 * Stories page — top-level IA surface.
 *
 * Filter controls live in a horizontal chip-row above the grid (no sidebar).
 * The campaign progress strip renders at page level so it's visible in all views.
 */
export default function Stories() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { user } = useUser()
  const { isStaff } = useUserRole()
  const defaultView = isStaff ? 'pipeline' : 'cards'
  const view = searchParams.get('view') || defaultView

  const platformFilter = searchParams.get('platform') || ''
  const stageFilter    = searchParams.get('stage')    || ''
  const locationFilter = searchParams.get('location') || ''
  const campaignFilter = searchParams.get('campaign') || ''
  // owner=me restricts the list to the logged-in user's own interviews.
  // The Home page links here via "See all my stories" so clinicians have a
  // dedicated browseable view of their own work as the catalog grows.
  const ownerFilter    = searchParams.get('owner')    || ''
  const mineOnly       = ownerFilter === 'me'

  const { data: storiesAll = [], isLoading } = useStories()
  const stories = useMemo(
    () => (mineOnly && user?.id ? storiesAll.filter((s) => s.owner_id === user.id) : storiesAll),
    [storiesAll, mineOnly, user],
  )
  const { data: progress } = useOnboardingProgress()
  const { data: campaigns = [] } = useCampaigns()
  const { data: clinicians = [] } = useClinicians({ enabled: !!campaignFilter })
  const { data: locations = [] } = useLocations()
  const workspace = useWorkspace()
  const currentPlan = progress?.plan
  const awaitingReviewCount = stories.filter((s) => s.story_stage === 'review').length

  const prototypes = getPatientPrototypesUi(workspace).filter((p) => p.id != null)
  const showLocations  = locations.length > 1
  const showArchetypes = prototypes.length > 0

  const selectableCampaigns = campaigns.filter(
    (c) => c.status === 'active' || c.id === campaignFilter,
  )
  const activeCampaignObj = campaignFilter
    ? campaigns.find((c) => c.id === campaignFilter) || null
    : null

  function setParam(key, value) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (value) next.set(key, value)
      else next.delete(key)
      return next
    }, { replace: true })
  }

  function clearCampaign() {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('campaign')
      return next
    }, { replace: true })
  }

  function clearOwner() {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('owner')
      return next
    }, { replace: true })
  }

  return (
    <main className="py-6 px-6 flex flex-col gap-4">
      {/* Sticky page chrome — keeps the title, view toggle, and filter
          chips in view while the user scrolls through cards or the
          kanban. -mx-6 px-6 extends the backdrop to the parent main's
          edges so blurred content reads cleanly behind it. */}
      <div className="sticky top-14 z-30 -mx-6 px-6 -mt-6 pt-6 pb-3 bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75 border-b border-border/60 flex flex-col gap-3">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-baseline gap-3 min-w-0">
            <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center">
              <span className="nx-rail" aria-hidden="true" />
              {mineOnly ? 'My stories' : 'Stories'}
            </h1>
            {!isLoading && stories.length > 0 ? (
              <span className="text-sm text-muted-foreground truncate">
                {stories.length === 1 ? '1 story' : `${stories.length} stories`}
                {awaitingReviewCount > 0 ? (
                  <>
                    {' · '}
                    <span className="text-primary font-semibold">
                      {awaitingReviewCount} awaiting review
                    </span>
                  </>
                ) : ''}
              </span>
            ) : null}
          </div>
          <StoriesViewToggle defaultView={defaultView} />
        </div>

        {/* Filter bar — horizontal scroll on mobile so chips do not wrap
            into 3+ rows and crowd the sticky header. */}
        <div className="flex items-center gap-2 overflow-x-auto flex-nowrap md:flex-wrap -mx-6 px-6 md:mx-0 md:px-0 pb-1 md:pb-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {/* Owner — "Mine only" active chip. No selector form because the only
            two states are "all" and "me"; non-me clinician filtering is
            handled by the existing /clinicians/:id page. */}
        {mineOnly ? (
          <button
            type="button"
            onClick={clearOwner}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-[hsl(20_60%_95%)] text-[#c04d18] px-3 py-1.5 text-xs font-semibold hover:bg-[hsl(20_70%_92%)] transition-colors"
          >
            <User className="h-3 w-3" aria-hidden="true" />
            Mine only
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        ) : null}

        {/* Campaign — active chip or selector */}
        {activeCampaignObj ? (
          <button
            type="button"
            onClick={clearCampaign}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 text-warning px-3 py-1.5 text-xs font-semibold hover:bg-warning/20 transition-colors"
          >
            <Target className="h-3 w-3" aria-hidden="true" />
            Campaign: {activeCampaignObj.name}
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        ) : selectableCampaigns.length > 0 ? (
          <select
            value=""
            onChange={(e) => setParam('campaign', e.target.value)}
            className={SELECT_CLS}
          >
            <option value="">Campaign: All</option>
            {selectableCampaigns.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        ) : null}

        {/* Platform */}
        <select
          value={platformFilter}
          onChange={(e) => setParam('platform', e.target.value)}
          className={SELECT_CLS}
        >
          <option value="">Platform: All</option>
          {PLATFORMS.map((p) => (
            <option key={p} value={p}>{PLATFORM_META[p].label}</option>
          ))}
        </select>

        {/* Stage */}
        <select
          value={stageFilter}
          onChange={(e) => setParam('stage', e.target.value)}
          className={SELECT_CLS}
        >
          <option value="">Stage: All</option>
          {STAGES.map(({ key, label }) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>

        {/* Location — only when workspace has multiple */}
        {showLocations ? (
          <select
            value={locationFilter}
            onChange={(e) => setParam('location', e.target.value)}
            className={SELECT_CLS}
          >
            <option value="">Location: All</option>
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>{loc.label || loc.city}</option>
            ))}
          </select>
        ) : null}

        {/* Archetype — only when workspace has defined prototypes */}
        {showArchetypes ? (
          <select
            value={searchParams.get('archetype') || ''}
            onChange={(e) => setParam('archetype', e.target.value)}
            className={SELECT_CLS}
          >
            <option value="">Archetype: All</option>
            {prototypes.map((p) => (
              <option key={p.id} value={p.id}>
                {p.emoji ? `${p.emoji} ${p.label}` : p.label}
              </option>
            ))}
          </select>
        ) : null}
        </div>
      </div>

      {/* Campaign progress strip — shown whenever a campaign filter is
          active. Lives below the sticky chrome so it scrolls with content. */}
      {activeCampaignObj ? (
        <CampaignProgressStrip campaign={activeCampaignObj} clinicians={clinicians} />
      ) : null}

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
    </main>
  )
}

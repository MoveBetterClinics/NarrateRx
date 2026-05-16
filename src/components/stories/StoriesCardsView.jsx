import { useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { BookOpen, FileText, Target, X, ChevronDown, ChevronUp } from 'lucide-react'
import StoryCard from './StoryCard'
import EmptyState from '@/components/EmptyState'
import { Badge } from '@/components/ui/badge'
import { ClinicianChip } from '@/components/ClinicianChip'
import { useCampaigns, useClinicians } from '@/lib/queries'

function SkeletonCard() {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-4 animate-pulse">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="h-4 bg-gray-200 rounded w-1/2" />
        <div className="h-5 bg-gray-200 rounded-full w-16 shrink-0" />
      </div>
      <div className="h-3 bg-gray-200 rounded mb-1.5 w-full" />
      <div className="h-3 bg-gray-200 rounded mb-3 w-4/5" />
      <div className="flex gap-2 mb-3">
        <div className="h-4 bg-gray-200 rounded w-10" />
        <div className="h-4 bg-gray-200 rounded w-10" />
      </div>
      <div className="h-3 bg-gray-200 rounded w-24" />
    </div>
  )
}

/**
 * Renders the amber-tinted progress strip shown at the top of the Stories grid
 * when a campaign filter is active. Shows progress and an expandable list of
 * clinicians who haven't yet contributed.
 */
function CampaignProgressStrip({ campaign, clinicians = [] }) {
  const [showPending, setShowPending] = useState(false)

  const targetIds = Array.isArray(campaign.target_clinician_ids)
    ? campaign.target_clinician_ids
    : []
  const contributedIds = new Set(
    Array.isArray(campaign.contributed_clinician_ids)
      ? campaign.contributed_clinician_ids
      : [],
  )
  const targetTotal = targetIds.length
  const contributed = campaign.contributed_count || 0
  const pct = targetTotal > 0
    ? Math.min(100, Math.round((contributed / targetTotal) * 100))
    : 0

  const pendingIds = targetIds.filter((id) => !contributedIds.has(id))
  const pendingClinicians = pendingIds.map((id) => {
    const match = clinicians.find((c) => c.id === id)
    return { id, name: match?.name || match?.full_name || 'Unknown clinician' }
  })

  return (
    <div className="rounded-lg border border-warning/30 bg-warning/10 text-warning p-4">
      <div className="flex items-start gap-3">
        <Target className="h-5 w-5 mt-0.5 shrink-0" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="font-medium">{campaign.name} campaign</span>
            <span className="text-sm text-warning/90">
              {contributed} of {targetTotal} {targetTotal === 1 ? 'clinician has' : 'clinicians have'} contributed
            </span>
          </div>
          <div className="mt-2 h-1.5 w-full rounded-full bg-warning/20 overflow-hidden">
            <div
              className="h-full bg-warning transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
          {pendingClinicians.length > 0 ? (
            <>
              <button
                type="button"
                onClick={() => setShowPending((v) => !v)}
                className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-warning hover:underline"
              >
                {showPending ? 'Hide pending' : `View who's pending`}
                {showPending
                  ? <ChevronUp className="h-3 w-3" aria-hidden="true" />
                  : <ChevronDown className="h-3 w-3" aria-hidden="true" />}
              </button>
              {showPending ? (
                <ul className="mt-3 flex flex-col gap-1.5">
                  {pendingClinicians.map(({ id, name }) => (
                    <li key={id} className="flex items-center gap-2">
                      <ClinicianChip id={id} name={name} size="sm" showName
                        nameClassName="text-warning/90 text-xs font-medium"
                      />
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            <p className="mt-2 text-xs font-medium text-warning/90">
              All targeted clinicians have contributed.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * StoriesCardsView — responsive grid of StoryCard components.
 *
 * @param {{ stories: Array, isLoading: boolean }} props
 */
export default function StoriesCardsView({ stories = [], isLoading = false }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const platformFilter = searchParams.get('platform') || ''
  const stageFilter = searchParams.get('stage') || ''
  const locationFilter = searchParams.get('location') || ''
  const campaignFilter = searchParams.get('campaign') || ''

  const { data: campaigns = [] } = useCampaigns({ enabled: !!campaignFilter })
  const { data: clinicians = [] } = useClinicians({ enabled: !!campaignFilter })
  const activeCampaign = campaignFilter
    ? campaigns.find((c) => c.id === campaignFilter) || null
    : null

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    )
  }

  const filtered = stories.filter((s) => {
    if (platformFilter && !s.pieces?.some((p) => p.platform === platformFilter)) return false
    if (stageFilter && s.story_stage !== stageFilter) return false
    if (locationFilter && s.location_id !== locationFilter) return false
    if (campaignFilter && s.campaign_id !== campaignFilter) return false
    return true
  })

  function clearCampaign() {
    const next = new URLSearchParams(searchParams)
    next.delete('campaign')
    setSearchParams(next, { replace: true })
  }

  const showHeader = !!activeCampaign

  if (filtered.length === 0) {
    if (platformFilter || stageFilter || campaignFilter) {
      return (
        <div className="flex flex-col gap-4">
          {activeCampaign ? <CampaignProgressStrip campaign={activeCampaign} clinicians={clinicians} /> : null}
          {activeCampaign ? (
            <div>
              <Badge
                variant="outline"
                className="cursor-pointer gap-1.5 border-warning/40 bg-warning/10 text-warning hover:bg-warning/20"
                onClick={clearCampaign}
              >
                Campaign: {activeCampaign.name}
                <X className="h-3 w-3" aria-hidden="true" />
              </Badge>
            </div>
          ) : null}
          <EmptyState
            icon={BookOpen}
            title="No stories match"
            description="No stories match the current filters. Try clearing a filter."
          />
        </div>
      )
    }

    return (
      <div className="text-center py-16">
        <FileText className="mx-auto h-12 w-12 text-gray-300" />
        <h3 className="mt-4 text-lg font-medium text-gray-900">No stories yet</h3>
        <p className="mt-2 text-sm text-gray-500 max-w-sm mx-auto">
          Start by running an interview with one of your clinicians.
          Bernard will help turn the conversation into social content.
        </p>
        <Link
          to="/new"
          className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Start your first interview →
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {showHeader ? <CampaignProgressStrip campaign={activeCampaign} /> : null}
      {showHeader ? (
        <div>
          <Badge
            variant="outline"
            className="cursor-pointer gap-1.5 border-warning/40 bg-warning/10 text-warning hover:bg-warning/20"
            onClick={clearCampaign}
          >
            Campaign: {activeCampaign.name}
            <X className="h-3 w-3" aria-hidden="true" />
          </Badge>
        </div>
      ) : null}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((story) => (
          <StoryCard key={story.id} story={story} />
        ))}
      </div>
    </div>
  )
}

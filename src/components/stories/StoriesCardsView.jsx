import { useSearchParams, Link } from 'react-router-dom'
import { BookOpen, FileText } from 'lucide-react'
import StoryCard from './StoryCard'
import EmptyState from '@/components/EmptyState'

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
 * StoriesCardsView — responsive grid of StoryCard components.
 * Filtering is applied here from URL params; the campaign strip and filter
 * controls live in the parent Stories page.
 *
 * @param {{ stories: Array, isLoading: boolean }} props
 */
export default function StoriesCardsView({ stories = [], isLoading = false }) {
  const [searchParams] = useSearchParams()
  const platformFilter = searchParams.get('platform') || ''
  const stageFilter    = searchParams.get('stage')    || ''
  const locationFilter = searchParams.get('location') || ''
  const campaignFilter = searchParams.get('campaign') || ''

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
    if (stageFilter    && s.story_stage !== stageFilter)                          return false
    if (locationFilter && s.location_id !== locationFilter)                       return false
    if (campaignFilter && s.campaign_id !== campaignFilter)                       return false
    return true
  })

  if (filtered.length === 0) {
    if (platformFilter || stageFilter || campaignFilter) {
      return (
        <EmptyState
          icon={BookOpen}
          title="No stories match"
          description="No stories match the current filters. Try clearing a filter."
        />
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
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {filtered.map((story) => (
        <StoryCard key={story.id} story={story} />
      ))}
    </div>
  )
}

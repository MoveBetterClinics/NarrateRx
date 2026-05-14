import { useSearchParams } from 'react-router-dom'
import { BookOpen } from 'lucide-react'
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
 *
 * @param {{ stories: Array, isLoading: boolean }} props
 */
export default function StoriesCardsView({ stories = [], isLoading = false }) {
  const [searchParams] = useSearchParams()
  const platformFilter = searchParams.get('platform') || ''
  const stageFilter = searchParams.get('stage') || ''

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    )
  }

  const locationFilter = searchParams.get('location') || ''

  const filtered = stories.filter((s) => {
    if (platformFilter && !s.pieces?.some((p) => p.platform === platformFilter)) return false
    if (stageFilter && s.story_stage !== stageFilter) return false
    if (locationFilter && s.location_id !== locationFilter) return false
    return true
  })

  if (filtered.length === 0) {
    return (
      <EmptyState
        icon={BookOpen}
        title="No stories yet"
        description={
          platformFilter || stageFilter
            ? 'No stories match the current filters. Try clearing a filter.'
            : 'Stories are created automatically when you complete an interview. Start your first interview to see stories appear here.'
        }
      />
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

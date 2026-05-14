import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { useStory } from '@/lib/queries'
import TranscriptPane from '@/components/story-detail/TranscriptPane'
import AssetsPane from '@/components/story-detail/AssetsPane'
import TranscriptExport from '@/components/story-detail/TranscriptExport'

// Stage badge colours mirror the StoryCard conventions from StoriesCardsView.
const STAGE_META = {
  capture:   { label: 'Capture',   color: 'bg-sky-100 text-sky-700' },
  drafting:  { label: 'Drafting',  color: 'bg-slate-100 text-slate-700' },
  review:    { label: 'In Review', color: 'bg-amber-100 text-amber-700' },
  scheduled: { label: 'Scheduled', color: 'bg-purple-100 text-purple-700' },
  published: { label: 'Published', color: 'bg-green-100 text-green-700' },
}

/**
 * StoryDetail — consolidated view for a single story (interview + pieces).
 *
 * Two-column layout on md+:
 *   Left  — TranscriptPane: interview transcript
 *   Right — AssetsPane: tabbed content pieces
 *
 * Accessed via /stories/:storyId where storyId is the interview UUID.
 */
export default function StoryDetail() {
  const { storyId } = useParams()
  const { data: story, isLoading, isError, isPlaceholderData } = useStory(storyId)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (isError || !story) {
    return (
      <div className="p-6 space-y-4">
        <Link
          to="/stories"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Stories
        </Link>
        <p className="text-sm text-muted-foreground">Story not found.</p>
      </div>
    )
  }

  const stage = story.story_stage || 'drafting'
  const stageMeta = STAGE_META[stage] || { label: stage, color: 'bg-slate-100 text-slate-700' }

  return (
    <div className="space-y-5 p-6">
      {/* Header */}
      <div className="space-y-2">
        <Link
          to="/stories"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Stories
        </Link>

        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-1 min-w-0">
            <h1 className="text-xl font-semibold text-gray-900 leading-snug">
              {story.topic || 'Untitled interview'}
            </h1>
            {story.clinician_name && (
              <p className="text-sm text-muted-foreground">{story.clinician_name}</p>
            )}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <TranscriptExport story={story} />
            <Badge className={`text-xs border-0 ${stageMeta.color}`}>
              {stageMeta.label}
            </Badge>
          </div>
        </div>
      </div>

      {/* Two-column body */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-start">
        <TranscriptPane story={story} isLoadingTranscript={isPlaceholderData} />
        <AssetsPane story={story} />
      </div>
    </div>
  )
}

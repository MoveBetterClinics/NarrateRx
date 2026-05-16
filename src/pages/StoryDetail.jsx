import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { useStory } from '@/lib/queries'
import { getStageToken } from '@/lib/stageTokens'
import TranscriptPane from '@/components/story-detail/TranscriptPane'
import AssetsPane from '@/components/story-detail/AssetsPane'
import TranscriptExport from '@/components/story-detail/TranscriptExport'
import LoadingState from '@/components/LoadingState'
import ErrorState from '@/components/ErrorState'
import { ClinicianChip } from '@/components/ClinicianChip'

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

  // Provenance highlight — lifted here so TranscriptPane and AssetsPane can
  // share it. AssetsPane fires setProvenanceHighlight when the user clicks a
  // paragraph attribution row; TranscriptPane reacts by scrolling + highlighting
  // the corresponding user message.
  const [provenanceHighlight, setProvenanceHighlight] = useState(null)

  if (isLoading) return <LoadingState />

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
        <ErrorState message="Story not found." />
      </div>
    )
  }

  const stage = story.story_stage || 'drafting'
  const stageMeta = getStageToken(stage)

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
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-semibold text-foreground leading-snug">
                {story.topic || 'Untitled interview'}
              </h1>
              <Badge className={`text-xs border-0 shrink-0 ${stageMeta.badge}`}>
                {stageMeta.label}
              </Badge>
            </div>
            {story.clinician_name && (
              story.clinician_id ? (
                <Link
                  to={`/clinician/${story.clinician_id}`}
                  className="inline-flex text-muted-foreground hover:text-foreground"
                >
                  <ClinicianChip
                    id={story.clinician_id}
                    name={story.clinician_name}
                    size="md"
                    showName
                    nameClassName="text-sm"
                  />
                </Link>
              ) : (
                <ClinicianChip
                  id={story.clinician_id}
                  name={story.clinician_name}
                  size="md"
                  showName
                  nameClassName="text-sm text-muted-foreground"
                />
              )
            )}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <TranscriptExport story={story} />
          </div>
        </div>
      </div>

      {/* Two-column body */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-start">
        <TranscriptPane story={story} isLoadingTranscript={isPlaceholderData} provenanceHighlight={provenanceHighlight} />
        <AssetsPane story={story} onProvenanceHighlight={setProvenanceHighlight} />
      </div>
    </div>
  )
}

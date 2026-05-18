import { Loader2 } from 'lucide-react'
import PipelineKanban from '@/components/PipelineKanban'

/**
 * StoriesPipelineView — wraps PipelineKanban with story-shaped data.
 *
 * PipelineKanban expects flat content_item rows with `topic`, `platform`,
 * `status`, etc. Stories have those fields rolled up under `pieces` (lean
 * summarized shape). We annotate each piece with the parent story's topic
 * so the kanban cards render correctly.
 *
 * The Kanban is read-only — clicking a card navigates to the story detail
 * where status changes actually happen. There is no drag-to-transition.
 */
export default function StoriesPipelineView({ stories, isLoading }) {
  const items = (stories ?? []).flatMap((story) =>
    (story.pieces ?? []).map((piece) => ({
      ...piece,
      topic: story.topic,
      clinician_name: story.clinician_name,
    })),
  )

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return <PipelineKanban items={items} />
}

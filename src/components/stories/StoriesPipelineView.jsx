import { Link } from 'react-router-dom'
import { Loader2, Mic } from 'lucide-react'
import { Button } from '@/components/ui/button'
import EmptyState from '@/components/EmptyState'
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

  if ((stories ?? []).length === 0) {
    return (
      <EmptyState
        icon={<Mic className="h-5 w-5" />}
        title="Pipeline is empty"
        description="The pipeline tracks every draft from capture through to published. Run an interview to put the first card in motion."
        action={
          <Button asChild size="sm">
            <Link to="/new/live-interview">Start an interview</Link>
          </Button>
        }
      />
    )
  }

  return <PipelineKanban items={items} />
}

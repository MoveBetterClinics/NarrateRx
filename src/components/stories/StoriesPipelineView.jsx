import { Loader2 } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import PipelineKanban from '@/components/PipelineKanban'
import { updateContentItem } from '@/lib/publish'
import { queryKeys } from '@/lib/queries'
import { toast } from '@/lib/toast'

/**
 * StoriesPipelineView — wraps PipelineKanban with story-shaped data.
 *
 * PipelineKanban expects flat content_item rows with `topic`, `platform`,
 * `status`, etc. Stories have those fields rolled up under `pieces` (lean
 * summarized shape). We annotate each piece with the parent story's topic
 * so the kanban cards render correctly.
 */
export default function StoriesPipelineView({ stories, isLoading }) {
  const qc = useQueryClient()

  // Flatten stories → annotated pieces. Each piece gets the parent's topic
  // so PipelineKanban's Card component can render it.
  const items = (stories ?? []).flatMap((story) =>
    (story.pieces ?? []).map((piece) => ({
      ...piece,
      topic: story.topic,
      clinician_name: story.clinician_name,
    })),
  )

  async function handleStatusChange(item, toStatus) {
    try {
      // Dragging out of Published has to clear published_at too — the
      // Published lane is derived from `published_at OR status==='published'`,
      // so just flipping status would leave the card stuck in Published.
      const patch = { status: toStatus }
      if (toStatus !== 'published' && item.published_at) {
        patch.publishedAt = null
      }
      await updateContentItem(item.id, patch)
      qc.invalidateQueries({ queryKey: queryKeys.stories.all })
      qc.invalidateQueries({ queryKey: queryKeys.contentItems.all })
      qc.invalidateQueries({ queryKey: queryKeys.contentPlan.all })
      toast.success(`Moved to ${toStatus.replace('_', ' ')}`)
    } catch (e) {
      toast.error('Status update failed', { description: e.message })
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <PipelineKanban items={items} onStatusChange={handleStatusChange} />
  )
}

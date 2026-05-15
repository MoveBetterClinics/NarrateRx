import { useState } from 'react'
import { Link } from 'react-router-dom'
import { DndContext, useDraggable, useDroppable, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { FileText, Clock, CheckCircle2, CalendarDays, Send, Image as ImageIcon, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatRelativeDate } from '@/lib/utils'
import { PLATFORM_META } from '@/lib/contentMeta'

// Five lanes in workflow order. Archived items are intentionally excluded —
// they don't belong on the active pipeline. Published items DO render here
// so the editor sees recently-shipped work on the right edge, but dragging
// out of Published is allowed (it just acts as an unpublish).
const LANES = [
  { id: 'draft',     label: 'Draft',        icon: FileText,     accent: 'border-slate-200',  badge: 'bg-slate-100 text-slate-700' },
  { id: 'in_review', label: 'Needs Review', icon: Clock,        accent: 'border-amber-200',  badge: 'bg-amber-100 text-amber-700' },
  { id: 'approved',  label: 'Approved',     icon: CheckCircle2, accent: 'border-blue-200',   badge: 'bg-blue-100 text-blue-700' },
  { id: 'scheduled', label: 'Scheduled',    icon: CalendarDays, accent: 'border-purple-200', badge: 'bg-purple-100 text-purple-700' },
  { id: 'published', label: 'Published',    icon: Send,         accent: 'border-emerald-200',badge: 'bg-emerald-100 text-emerald-700' },
]

// Transitions that need explicit confirmation because they're either
// hard to reverse (publishing fires an outbound post) or affect downstream
// state visibly (archiving). For now: dropping onto Published triggers
// a confirm — there's no other irreversible move available from the
// pipeline UI.
const CONFIRM_TRANSITIONS = new Set(['published'])

export default function PipelineKanban({ items, onStatusChange }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const [pending, setPending] = useState(null) // { item, toStatus } | null

  const grouped = LANES.reduce((acc, lane) => {
    acc[lane.id] = items.filter((i) => i.status === lane.id)
    return acc
  }, {})

  function handleDragEnd(event) {
    const { active, over } = event
    if (!over) return
    const item = items.find((i) => i.id === active.id)
    if (!item) return
    const toStatus = over.id
    if (!toStatus || toStatus === item.status) return
    if (CONFIRM_TRANSITIONS.has(toStatus)) {
      setPending({ item, toStatus })
      return
    }
    onStatusChange(item, toStatus)
  }

  return (
    <>
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
          {LANES.map((lane) => (
            <Lane key={lane.id} lane={lane} items={grouped[lane.id] || []} />
          ))}
        </div>
      </DndContext>

      {pending && (
        <ConfirmPublishDialog
          item={pending.item}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            onStatusChange(pending.item, pending.toStatus)
            setPending(null)
          }}
        />
      )}
    </>
  )
}

function Lane({ lane, items }) {
  const { setNodeRef, isOver } = useDroppable({ id: lane.id })
  const Icon = lane.icon
  return (
    <div
      ref={setNodeRef}
      className={`rounded-xl border bg-card p-3 transition-colors ${lane.accent} ${
        isOver ? 'bg-accent/30 ring-2 ring-primary/30' : ''
      }`}
    >
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-1.5">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium">{lane.label}</span>
        </div>
        <span className={`text-[10px] font-medium rounded-full px-1.5 py-0.5 ${lane.badge}`}>
          {items.length}
        </span>
      </div>
      <div className="space-y-2 min-h-[80px]">
        {items.length === 0 && (
          <p className="text-[11px] text-muted-foreground italic px-1">Nothing here yet.</p>
        )}
        {items.map((item) => <Card key={item.id} item={item} />)}
      </div>
    </div>
  )
}

function Card({ item }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: item.id })
  const pm = PLATFORM_META[item.platform] || { label: item.platform, icon: FileText, color: 'text-slate-600', bg: 'bg-slate-50' }
  const Icon = pm.icon
  const hasMedia = Array.isArray(item.media_urls) && item.media_urls.length > 0
  const snippet = (item.content || '').slice(0, 90)
  const scheduledAt = item.scheduled_at ? new Date(item.scheduled_at) : null

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`rounded-lg border bg-background p-2 text-xs space-y-1.5 cursor-grab active:cursor-grabbing hover:border-primary/30 transition-colors ${
        isDragging ? 'opacity-50 ring-2 ring-primary/40' : ''
      }`}
    >
      <div className="flex items-center justify-between gap-1.5">
        <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded ${pm.bg}`}>
          <Icon className={`h-2.5 w-2.5 ${pm.color}`} />
          <span className={`text-[10px] font-medium ${pm.color}`}>{pm.label}</span>
        </div>
        {hasMedia && <ImageIcon className="h-3 w-3 text-muted-foreground" />}
      </div>
      <p className="font-medium leading-snug line-clamp-2">{item.topic}</p>
      {snippet && <p className="text-muted-foreground text-[11px] line-clamp-2">{snippet}</p>}
      <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
        <span className="truncate">
          {scheduledAt ? scheduledAt.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric' }) : formatRelativeDate(item.updated_at)}
        </span>
        <Link
          to={item.interview_id ? `/stories/${item.interview_id}` : `/review/${item.id}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          className="text-primary hover:underline shrink-0 inline-flex items-center gap-0.5"
        >
          <ExternalLink className="h-2.5 w-2.5" />
          Open
        </Link>
      </div>
      {item.reviewed_by && (
        <p className="text-[10px] text-muted-foreground truncate" title={item.reviewed_by}>Reviewer: {item.reviewed_by}</p>
      )}
    </div>
  )
}

function ConfirmPublishDialog({ item, onCancel, onConfirm }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onCancel}
    >
      <div className="bg-background rounded-lg shadow-lg max-w-sm w-full p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold">Publish this post?</h3>
        <p className="text-sm text-muted-foreground">
          Dropping onto Published fires the live post for <span className="font-medium">{item.topic}</span>. This can&apos;t be undone in one click.
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
          <Button size="sm" onClick={onConfirm}>Publish now</Button>
        </div>
      </div>
    </div>
  )
}

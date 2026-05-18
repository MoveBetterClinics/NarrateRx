import { useState } from 'react'
import { Link } from 'react-router-dom'
import { DndContext, useDraggable, useDroppable, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { FileText, Clock, CheckCircle2, CalendarDays, Send, Image as ImageIcon, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatRelativeDate } from '@/lib/utils'
import { PLATFORM_META } from '@/lib/contentMeta'
import { getContentStatusToken } from '@/lib/contentStatusTokens'

// Five lanes in workflow order. Archived items are intentionally excluded —
// they don't belong on the active pipeline. Published items DO render here
// so the publisher sees recently-shipped work on the right edge, but dragging
// out of Published is allowed (it just acts as an unpublish).
//
// Lane colours (accent/badge) and labels come from contentStatusTokens —
// this file only owns lane order, icon, and publisher-inbox flagging.
const LANES = [
  { id: 'draft',     icon: FileText,     publisherInbox: false },
  { id: 'in_review', icon: Clock,        publisherInbox: false },
  { id: 'approved',  icon: CheckCircle2, publisherInbox: true  },
  { id: 'scheduled', icon: CalendarDays, publisherInbox: false },
  { id: 'published', icon: Send,         publisherInbox: false },
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

  // Effective lane: published_at is authoritative for the Published lane.
  // Some publish paths set published_at without flipping status='published'
  // (and the Content Plan view also uses published_at), so we mirror that
  // here. A row with published_at set won't double-count in another lane.
  const laneFor = (i) => (i.published_at ? 'published' : i.status)
  const grouped = LANES.reduce((acc, lane) => {
    acc[lane.id] = items.filter((i) => laneFor(i) === lane.id)
    return acc
  }, {})

  function handleDragEnd(event) {
    const { active, over } = event
    if (!over) return
    const item = items.find((i) => i.id === active.id)
    if (!item) return
    const toStatus = over.id
    const fromLane = laneFor(item)
    if (!toStatus || toStatus === fromLane) return
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
            <Lane key={lane.id} lane={lane} items={grouped[lane.id] || []} isPublisherInbox={lane.publisherInbox} />
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

function Lane({ lane, items, isPublisherInbox }) {
  const { setNodeRef, isOver } = useDroppable({ id: lane.id })
  const Icon = lane.icon
  const token = getContentStatusToken(lane.id)
  return (
    <div
      ref={setNodeRef}
      className={`rounded-xl border p-3 transition-colors ${token.accent} ${
        isPublisherInbox ? 'bg-blue-50/60' : 'bg-card'
      } ${isOver ? 'bg-accent/30 ring-2 ring-primary/30' : ''}`}
    >
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-1.5">
          <Icon className={`h-3.5 w-3.5 ${isPublisherInbox ? 'text-blue-600' : 'text-muted-foreground'}`} />
          <span className={`text-xs font-medium ${isPublisherInbox ? 'text-blue-700' : ''}`}>{token.label}</span>
          {isPublisherInbox && items.length > 0 && (
            <span className="text-3xs font-semibold uppercase tracking-wide text-blue-500 ml-0.5">your queue</span>
          )}
        </div>
        <span className={`text-3xs font-medium rounded-full px-1.5 py-0.5 ${token.badge}`}>
          {items.length}
        </span>
      </div>
      <div className="space-y-2 min-h-[80px]">
        {items.length === 0 && (
          <p className="text-2xs text-muted-foreground italic px-1">Nothing here yet.</p>
        )}
        {items.map((item) => <Card key={item.id} item={item} />)}
      </div>
    </div>
  )
}

function VoiceDriftChip({ provenance }) {
  if (!provenance?.summary) return null
  const { verbatim_pct = 0, paraphrase_pct = 0 } = provenance.summary
  const ownWords = Math.round(verbatim_pct + paraphrase_pct)
  if (ownWords === 0) return null
  const color = ownWords >= 60 ? 'text-emerald-700 bg-emerald-50' : ownWords >= 35 ? 'text-amber-700 bg-amber-50' : 'text-slate-600 bg-slate-50'
  return (
    <span className={`inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-3xs font-medium ${color}`}>
      {ownWords}% voice
    </span>
  )
}

function Card({ item }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: item.id })
  const pm = PLATFORM_META[item.platform] || { label: item.platform, icon: FileText, color: 'text-slate-600', bg: 'bg-slate-50' }
  const Icon = pm.icon
  const hasMedia = Array.isArray(item.media_urls) && item.media_urls.length > 0
  const snippet = (item.content || '').slice(0, 90)
  const scheduledAt = item.scheduled_at ? new Date(item.scheduled_at) : null
  const showVoiceDrift = ['approved', 'scheduled', 'published'].includes(item.status)

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
          <span className={`text-3xs font-medium ${pm.color}`}>{pm.label}</span>
        </div>
        <div className="flex items-center gap-1">
          {showVoiceDrift && <VoiceDriftChip provenance={item.provenance} />}
          {hasMedia && <ImageIcon className="h-3 w-3 text-muted-foreground" />}
        </div>
      </div>
      <p className="font-medium leading-snug line-clamp-2">{item.topic}</p>
      {snippet && <p className="text-muted-foreground text-2xs line-clamp-2">{snippet}</p>}
      <div className="flex items-center justify-between gap-2 text-3xs text-muted-foreground">
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
        <p className="text-3xs text-muted-foreground truncate" title={item.reviewed_by}>Reviewer: {item.reviewed_by}</p>
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

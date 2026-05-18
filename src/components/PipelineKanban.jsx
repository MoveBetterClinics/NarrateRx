import { Link } from 'react-router-dom'
import { FileText, Clock, CheckCircle2, CalendarDays, Send, Image as ImageIcon, ExternalLink } from 'lucide-react'
import { formatRelativeDate } from '@/lib/utils'
import { PLATFORM_META } from '@/lib/contentMeta'
import { getContentStatusToken } from '@/lib/contentStatusTokens'

// Five lanes in workflow order. Archived items are intentionally excluded —
// they don't belong on the active pipeline. Published items DO render here
// so the publisher sees recently-shipped work on the right edge.
//
// The Kanban is a read-only reflection of state. Status transitions happen
// on the story/asset card (StoryDetail → AssetsPane), never here. Lane
// colours (accent/badge) and labels come from contentStatusTokens — this
// file only owns lane order, icon, and publisher-inbox flagging.
const LANES = [
  { id: 'draft',     icon: FileText,     publisherInbox: false },
  { id: 'in_review', icon: Clock,        publisherInbox: false },
  { id: 'approved',  icon: CheckCircle2, publisherInbox: true  },
  { id: 'scheduled', icon: CalendarDays, publisherInbox: false },
  { id: 'published', icon: Send,         publisherInbox: false },
]

export default function PipelineKanban({ items }) {
  const grouped = LANES.reduce((acc, lane) => {
    acc[lane.id] = items.filter((i) => i.status === lane.id)
    return acc
  }, {})

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
      {LANES.map((lane) => (
        <Lane key={lane.id} lane={lane} items={grouped[lane.id] || []} isPublisherInbox={lane.publisherInbox} />
      ))}
    </div>
  )
}

function Lane({ lane, items, isPublisherInbox }) {
  const Icon = lane.icon
  const token = getContentStatusToken(lane.id)
  return (
    <div
      className={`rounded-xl border p-3 ${token.accent} ${
        isPublisherInbox ? 'bg-blue-50/60' : 'bg-card'
      }`}
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
  const pm = PLATFORM_META[item.platform] || { label: item.platform, icon: FileText, color: 'text-slate-600', bg: 'bg-slate-50' }
  const Icon = pm.icon
  const hasMedia = Array.isArray(item.media_urls) && item.media_urls.length > 0
  const snippet = (item.content || '').slice(0, 90)
  const scheduledAt = item.scheduled_at ? new Date(item.scheduled_at) : null
  const showVoiceDrift = ['approved', 'scheduled', 'published'].includes(item.status)
  const href = item.interview_id ? `/stories/${item.interview_id}?piece=${item.id}` : `/review/${item.id}`

  return (
    <Link
      to={href}
      className="block rounded-lg border bg-background p-2 text-xs space-y-1.5 hover:border-primary/30 hover:bg-accent/20 transition-colors"
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
        <span className="text-primary shrink-0 inline-flex items-center gap-0.5">
          <ExternalLink className="h-2.5 w-2.5" />
          Open
        </span>
      </div>
      {item.reviewed_by && (
        <p className="text-3xs text-muted-foreground truncate" title={item.reviewed_by}>Reviewer: {item.reviewed_by}</p>
      )}
    </Link>
  )
}

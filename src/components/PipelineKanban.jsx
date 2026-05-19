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
// Per-lane accent rail color (used by the blend theme — the colored 4px
// bar next to each lane heading). These align with contentStatusTokens
// hues so the rail reinforces the badge color rather than competing.
const LANES = [
  { id: 'draft',     icon: FileText,     publisherInbox: false, rail: '#94a3b8' /* slate-400 */ },
  { id: 'in_review', icon: Clock,        publisherInbox: false, rail: '#d97706' /* amber-600 */ },
  { id: 'approved',  icon: CheckCircle2, publisherInbox: true,  rail: '#e36525' /* primary    */ },
  { id: 'scheduled', icon: CalendarDays, publisherInbox: false, rail: '#7c3aed' /* violet-600 */ },
  { id: 'published', icon: Send,         publisherInbox: false, rail: '#059669' /* emerald-600 */ },
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
  // Publisher inbox gets the warm-tint card treatment (matches .nx-card-hi)
  // so the "do this now" lane visually pops above the others. Other lanes
  // stay on neutral card surface.
  const surface = isPublisherInbox
    ? 'border-[#f3d3b5] bg-gradient-to-b from-white to-[#fefaf7] shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-18px_rgba(227,101,37,0.25)]'
    : 'border-border bg-card shadow-[0_1px_2px_rgba(15,23,42,0.03)]'
  return (
    <div className={`rounded-2xl border p-3 ${surface}`}>
      <div className="flex items-center justify-between gap-2 mb-3 px-1">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="inline-block w-1 h-5 rounded-full shrink-0"
            style={{ background: lane.rail }}
            aria-hidden="true"
          />
          <Icon className={`h-3.5 w-3.5 ${isPublisherInbox ? 'text-primary' : 'text-muted-foreground'}`} />
          <span className={`text-sm font-bold tracking-tight ${isPublisherInbox ? 'text-[#7a3a14]' : 'text-foreground'}`}>
            {token.label}
          </span>
          {isPublisherInbox && items.length > 0 && (
            <span className="text-3xs font-bold uppercase tracking-wider text-primary ml-0.5">
              your queue
            </span>
          )}
        </div>
        <span
          className={
            isPublisherInbox
              ? 'text-3xs font-bold rounded-full px-2 py-0.5 bg-primary text-primary-foreground'
              : `text-3xs font-semibold rounded-full px-2 py-0.5 ${token.badge}`
          }
        >
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
      className="block rounded-xl border border-border bg-white p-2.5 text-xs space-y-1.5 transition-all duration-150 hover:-translate-y-0.5 hover:border-[#fde0d2] hover:shadow-[0_8px_20px_-16px_rgba(15,23,42,0.18)]"
    >
      <div className="flex items-center justify-between gap-1.5">
        <div className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full ${pm.bg}`}>
          <Icon className={`h-2.5 w-2.5 ${pm.color}`} />
          <span className={`text-3xs font-semibold ${pm.color}`}>{pm.label}</span>
        </div>
        <div className="flex items-center gap-1">
          {showVoiceDrift && <VoiceDriftChip provenance={item.provenance} />}
          {hasMedia && <ImageIcon className="h-3 w-3 text-muted-foreground" />}
        </div>
      </div>
      <p className="font-semibold leading-snug line-clamp-2 text-foreground">{item.topic}</p>
      {snippet && <p className="text-muted-foreground text-2xs line-clamp-2">{snippet}</p>}
      <div className="flex items-center justify-between gap-2 text-3xs text-muted-foreground pt-1 border-t border-slate-100">
        <span className="truncate">
          {scheduledAt ? scheduledAt.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric' }) : formatRelativeDate(item.updated_at)}
        </span>
        <span className="text-primary shrink-0 inline-flex items-center gap-0.5 font-semibold">
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

import { Fragment, useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  Instagram, Facebook, Linkedin, FileText, Mail,
  MapPin, ChevronRight, Clock, CheckCircle2, Send, CalendarDays,
  AlertCircle, Loader2, RefreshCw,
  MousePointer2, LayoutTemplate, Youtube, Music2, Megaphone,
  ThumbsUp, Pin, Archive, ArchiveRestore, Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ConfirmDialog } from '@/components/ui/alert-dialog'
import SharedEmptyState from '@/components/EmptyState'
import { useContentItems, useUpdateContentItem, useDeleteContentItem } from '@/lib/queries'
import { formatRelativeDate } from '@/lib/utils'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { toast } from '@/lib/toast'

const PLATFORM_META = {
  blog:         { label: 'Blog Post',       icon: FileText,   color: 'text-slate-600',  bg: 'bg-slate-100' },
  instagram:    { label: 'Instagram',       icon: Instagram,  color: 'text-pink-600',   bg: 'bg-pink-50' },
  facebook:     { label: 'Facebook',        icon: Facebook,   color: 'text-blue-600',   bg: 'bg-blue-50' },
  linkedin:     { label: 'LinkedIn',        icon: Linkedin,   color: 'text-sky-700',    bg: 'bg-sky-50' },
  gbp:          { label: 'Google Business', icon: MapPin,     color: 'text-green-700',  bg: 'bg-green-50' },
  google_ads:   { label: 'Google Ads',      icon: MousePointer2, color: 'text-yellow-700', bg: 'bg-yellow-50' },
  instagram_ads:{ label: 'Instagram Ads',   icon: Megaphone,  color: 'text-rose-600',   bg: 'bg-rose-50' },
  landing_page: { label: 'Landing Page',    icon: LayoutTemplate, color: 'text-purple-600', bg: 'bg-purple-50' },
  youtube:      { label: 'YouTube Script',  icon: Youtube,       color: 'text-red-600',    bg: 'bg-red-50' },
  tiktok:       { label: 'TikTok / Reels', icon: Music2,        color: 'text-fuchsia-600', bg: 'bg-fuchsia-50' },
  email:        { label: 'Email',           icon: Mail,       color: 'text-teal-600',   bg: 'bg-teal-50' },
  pinterest:    { label: 'Pinterest',       icon: Pin,        color: 'text-red-500',    bg: 'bg-red-50' },
}

const STATUS_META = {
  draft:      { label: 'Draft',      color: 'bg-slate-100 text-slate-700',   icon: FileText },
  in_review:  { label: 'In Review',  color: 'bg-amber-100 text-amber-700',   icon: Clock },
  approved:   { label: 'Approved',   color: 'bg-blue-100 text-blue-700',     icon: CheckCircle2 },
  scheduled:  { label: 'Scheduled',  color: 'bg-purple-100 text-purple-700', icon: CalendarDays },
  published:  { label: 'Published',  color: 'bg-green-100 text-green-700',   icon: Send },
  archived:   { label: 'Archived',   color: 'bg-zinc-100 text-zinc-600',     icon: Archive },
}

// 'archived' is a UI-only pseudo-tab — there's no `archived` value on the
// status enum. Selecting it switches the list query to `archived=only` so
// rows with archived_at set come back regardless of their underlying status.
const STATUS_TABS = ['all', 'draft', 'in_review', 'approved', 'scheduled', 'published', 'archived']

// Chip groups for the platform filter — IG Ads sits alone between Social and Google.
const PLATFORM_GROUPS = [
  ['blog'],
  ['instagram', 'facebook', 'linkedin', 'gbp'],
  ['instagram_ads'],
  ['google_ads', 'landing_page'],
  ['youtube', 'tiktok', 'pinterest'],
  ['email'],
]

export default function ContentHub() {
  useDocumentTitle('Content Hub')
  const [activeStatus, setStatus] = useState('all')
  const [platform, setPlatform]   = useState('all')
  const [topicFilter, setTopicFilter] = useState('all')

  // useContentItems re-runs whenever the filters object changes (query key
  // includes the filter args). Refetch on demand via refetch() — wired to
  // the manual reload button in the header.
  //
  // 'archived' is the one tab that doesn't map to a status enum value — it
  // flips the archive filter on instead, returning archived rows regardless
  // of their workflow status.
  const isArchivedView = activeStatus === 'archived'
  const filters = {}
  if (activeStatus !== 'all' && !isArchivedView) filters.status = activeStatus
  if (platform !== 'all')                        filters.platform = platform
  if (isArchivedView)                            filters.archived = 'only'
  const { data: items = [], isLoading: loading, error: queryError, refetch } = useContentItems(filters)
  const error = queryError?.message || ''
  const load = refetch

  // Derive the topic dropdown options from the fetched items. Topics are
  // free-form strings on content_items.topic (mirrored from the source
  // interview), so the dropdown surfaces whatever topics actually exist in
  // the workspace's content. Case-insensitive dedupe + alpha sort.
  const availableTopics = (() => {
    const seen = new Map()
    for (const it of items) {
      const t = (it.topic || '').trim()
      if (!t) continue
      const k = t.toLowerCase()
      if (!seen.has(k)) seen.set(k, t)
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b))
  })()

  // Reset topic filter when the selection no longer exists in the new result
  // set (e.g. user switched platform/status and the topic vanished).
  useEffect(() => {
    if (topicFilter !== 'all' && !availableTopics.some(t => t.toLowerCase() === topicFilter.toLowerCase())) {
      setTopicFilter('all')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableTopics.join('|')])

  const filteredItems = topicFilter === 'all'
    ? items
    : items.filter((i) => (i.topic || '').toLowerCase() === topicFilter.toLowerCase())

  const counts = filteredItems.reduce((acc, i) => {
    acc[i.status] = (acc[i.status] || 0) + 1
    return acc
  }, {})

  const needsMedia = filteredItems.filter((i) =>
    ['draft', 'in_review', 'approved'].includes(i.status) &&
    ['instagram', 'facebook', 'gbp', 'pinterest'].includes(i.platform) &&
    (!i.media_urls || i.media_urls.length === 0)
  ).length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Content Hub</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Every piece of content across all interviews, organized by status. Track items from draft through review, scheduling, and publishing.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/review-queue"><Clock className="h-4 w-4 mr-1.5" />Review queue</Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link to="/calendar"><CalendarDays className="h-4 w-4 mr-1.5" />Calendar</Link>
          </Button>
          <Button variant="ghost" size="icon" onClick={load}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Stats — only meaningful for the live workflow. In the Archived view
          the counts would reflect underlying status of archived rows, which
          is confusing; just hide them. */}
      {!isArchivedView && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatChip label="Drafts"    value={counts.draft || 0}     color="text-slate-600" />
          <StatChip label="In Review" value={counts.in_review || 0} color="text-amber-600" />
          <StatChip label="Scheduled" value={counts.scheduled || 0} color="text-purple-600" />
          <StatChip label="Published" value={counts.published || 0} color="text-green-600" />
        </div>
      )}

      {/* Media needed warning — suppressed in the Archived view since archived
          posts aren't on the publish path. */}
      {!isArchivedView && needsMedia > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
          <p className="text-sm text-amber-800">
            <strong>{needsMedia} posts</strong> need photos or videos before they can be published.{' '}
            <Link to="/calendar" className="underline underline-offset-2">See media calendar →</Link>
          </p>
        </div>
      )}

      {/* Platform chip filter — separators denote category boundaries */}
      <div className="flex flex-wrap gap-1.5 items-center">
        <button
          onClick={() => setPlatform('all')}
          className={`flex items-center px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            platform === 'all'
              ? 'bg-foreground text-background'
              : 'bg-muted text-muted-foreground hover:text-foreground'
          }`}
        >
          All platforms
        </button>
        {PLATFORM_GROUPS.map((group, gi) => (
          <Fragment key={gi}>
            <span className="h-5 w-px bg-border mx-0.5" aria-hidden />
            {group.map((k) => {
              const meta = PLATFORM_META[k]
              if (!meta) return null
              const Icon = meta.icon
              const selected = platform === k
              return (
                <button
                  key={k}
                  onClick={() => setPlatform(k)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    selected ? `${meta.bg} ${meta.color}` : 'bg-muted text-muted-foreground hover:bg-accent'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {meta.label}
                </button>
              )
            })}
          </Fragment>
        ))}
      </div>

      {/* Topic filter — derived from whatever topics show up in the fetched
          items. Lets the user narrow to a single thread (e.g. only "Low back
          pain" content) without re-running interviews. */}
      {availableTopics.length > 0 && (
        <div className="flex items-center gap-2 text-xs">
          <label htmlFor="topic-filter" className="text-muted-foreground font-medium shrink-0">
            Topic:
          </label>
          <select
            id="topic-filter"
            value={topicFilter}
            onChange={(e) => setTopicFilter(e.target.value)}
            className="rounded-md border bg-background px-2 py-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="all">All topics ({availableTopics.length})</option>
            {availableTopics.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          {topicFilter !== 'all' && (
            <button
              type="button"
              onClick={() => setTopicFilter('all')}
              className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* Status tabs */}
      <div className="flex gap-1 bg-muted rounded-lg p-1 w-fit">
        {STATUS_TABS.map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`px-3 py-1 text-xs rounded-md font-medium transition-colors capitalize ${
              activeStatus === s ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {s === 'all' ? 'All' : STATUS_META[s]?.label}
            {/* Counts reflect the current result set, which on the Archived
                view are archived rows — surfacing those numbers next to
                Draft/In Review/etc. would be misleading. */}
            {s !== 'all' && !isArchivedView && counts[s] ? ` (${counts[s]})` : ''}
            {s === 'archived' && isArchivedView && filteredItems.length
              ? ` (${filteredItems.length})`
              : ''}
          </button>
        ))}
      </div>

      {/* Content list */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 text-muted-foreground animate-spin" />
        </div>
      ) : error ? (
        <div className="text-sm text-destructive bg-destructive/10 rounded-lg p-4">{error}</div>
      ) : filteredItems.length === 0 ? (
        <EmptyState status={activeStatus} topic={topicFilter} onClearTopic={() => setTopicFilter('all')} />
      ) : (
        <div className="space-y-2">
          {filteredItems.map((item) => <ContentRow key={item.id} item={item} archivedView={isArchivedView} />)}
        </div>
      )}
    </div>
  )
}

function ContentRow({ item, archivedView }) {
  const pm = PLATFORM_META[item.platform] || PLATFORM_META.blog
  // While viewing the Archived tab we display the Archived badge instead of
  // the underlying lifecycle status — restore preserves the original status,
  // but the relevant signal for the user here is "this is archived."
  const sm = archivedView
    ? STATUS_META.archived
    : (STATUS_META[item.status] || STATUS_META.draft)
  const Icon = pm.icon
  const preview = item.content?.replace(/[#*_`]/g, '').slice(0, 120)
  const hasMedia = item.media_urls?.length > 0
  const needsMedia = ['instagram', 'facebook', 'gbp', 'pinterest'].includes(item.platform) && !hasMedia

  const updateItem = useUpdateContentItem()
  const deleteItem = useDeleteContentItem()
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Archive + restore both go through PATCH archived_at. The toast on archive
  // exposes an Undo action so an accidental click is fully reversible without
  // hunting through the Archived tab.
  const archive = () => {
    updateItem.mutate(
      { id: item.id, patch: { archivedAt: new Date().toISOString() } },
      {
        onSuccess: () => {
          toast.success('Archived', {
            description: `${pm.label} · ${item.topic || 'Untitled'}`,
            action: {
              label: 'Undo',
              onClick: () => updateItem.mutate({ id: item.id, patch: { archivedAt: null } }),
            },
          })
        },
        onError: (e) => toast.error('Archive failed', { description: e?.message }),
      },
    )
  }

  const restore = () => {
    updateItem.mutate(
      { id: item.id, patch: { archivedAt: null } },
      {
        onSuccess: () => toast.success('Restored', { description: `${pm.label} · ${item.topic || 'Untitled'}` }),
        onError: (e) => toast.error('Restore failed', { description: e?.message }),
      },
    )
  }

  const remove = () => {
    deleteItem.mutate(item.id, {
      onSuccess: () => {
        setConfirmDelete(false)
        toast.success('Deleted permanently')
      },
      onError: (e) => toast.error('Delete failed', { description: e?.message }),
    })
  }

  return (
    <Card className={`hover:shadow-sm transition-shadow ${archivedView ? 'opacity-75' : ''}`}>
      <CardContent className="p-4 flex items-start gap-4">
        {/* Platform badge — icon + name */}
        <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg ${pm.bg} shrink-0 min-w-[110px]`}>
          <Icon className={`h-4 w-4 ${pm.color} shrink-0`} />
          <span className={`text-xs font-medium ${pm.color} leading-none`}>{pm.label}</span>
        </div>

        {/* Content preview */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-sm font-medium">{item.topic}</span>
            <span className="text-xs text-muted-foreground">·</span>
            <span className="text-xs text-muted-foreground">{item.clinician_name}</span>
            <span className="text-xs text-muted-foreground">·</span>
            <span className="text-xs text-muted-foreground">{formatRelativeDate(item.created_at)}</span>
          </div>
          <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{preview}…</p>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <Badge className={`text-xs ${sm.color} border-0`}>{sm.label}</Badge>
            {needsMedia && !archivedView && (
              <Badge className="text-xs bg-amber-100 text-amber-700 border-0">⚠ Needs media</Badge>
            )}
            {hasMedia && (
              <Badge className="text-xs bg-slate-100 text-slate-600 border-0">
                {item.media_urls.length} media file{item.media_urls.length !== 1 ? 's' : ''}
              </Badge>
            )}
            {item.scheduled_at && !archivedView && (
              <span className="text-xs text-purple-600 font-medium">
                Scheduled {formatRelativeDate(item.scheduled_at)}
              </span>
            )}
          </div>
        </div>

        {/* Exemplar thumbs-up — only meaningful for already-published, non-archived items */}
        {!archivedView && item.status === 'published' && <PerformedWellToggle item={item} />}

        {/* Row actions — different for live vs. archived views.
            Live: Archive icon + primary Review/Edit/View CTA.
            Archived: Restore (primary) + Delete-permanently (destructive). */}
        {archivedView ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0"
              onClick={restore}
              disabled={updateItem.isPending}
              title="Restore — move back to its prior status"
              aria-label="Restore"
            >
              <ArchiveRestore className="h-4 w-4 mr-1" />
              Restore
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 text-muted-foreground hover:text-destructive"
              onClick={() => setConfirmDelete(true)}
              disabled={deleteItem.isPending}
              title="Delete permanently — can't be undone"
              aria-label="Delete permanently"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 text-muted-foreground hover:text-foreground"
              onClick={archive}
              disabled={updateItem.isPending}
              title="Archive — hide without deleting (recoverable from the Archived tab)"
              aria-label="Archive"
            >
              <Archive className="h-4 w-4" />
            </Button>
            <Button asChild variant="ghost" size="sm" className="shrink-0">
              <Link to={`/review/${item.id}`}>
                {item.status === 'draft' ? 'Review' : item.status === 'published' ? 'View' : 'Edit'}
                <ChevronRight className="h-3.5 w-3.5 ml-1" />
              </Link>
            </Button>
          </>
        )}

        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title="Delete permanently?"
          description={`This will permanently remove the ${pm.label.toLowerCase()} draft for "${item.topic || 'Untitled'}". This action cannot be undone — use Archive if you might want it back.`}
          confirmLabel="Delete permanently"
          onConfirm={remove}
          loading={deleteItem.isPending}
        />
      </CardContent>
    </Card>
  )
}

function PerformedWellToggle({ item }) {
  const m = useUpdateContentItem()
  const on = !!item.performed_well
  return (
    <Button
      variant="ghost"
      size="sm"
      className={`shrink-0 ${on ? 'text-green-600' : 'text-muted-foreground'}`}
      disabled={m.isPending}
      onClick={() => m.mutate({ id: item.id, patch: { performedWell: !on } })}
      title={on ? 'Marked as performed well — the AI will reference this when generating future content' : 'Mark as performed well — the AI will use flagged posts as style references for future content'}
      aria-pressed={on}
      aria-label="Mark as performed well"
    >
      <ThumbsUp className={`h-4 w-4 ${on ? 'fill-current' : ''}`} />
    </Button>
  )
}

function StatChip({ label, value, color }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
    </div>
  )
}

function EmptyState({ status, topic, onClearTopic }) {
  // Topic filter is narrowing the result down to zero — give the user a
  // dedicated way out of that specific funnel before any other coaching.
  if (topic && topic !== 'all') {
    return (
      <SharedEmptyState
        icon={<FileText className="h-5 w-5" />}
        title={`No content for "${topic}"`}
        description="Nothing matches this topic with your current platform and status filters."
        action={
          onClearTopic ? (
            <Button size="sm" variant="outline" onClick={onClearTopic}>
              Clear topic filter
            </Button>
          ) : null
        }
      />
    )
  }
  if (status === 'all') {
    return (
      <SharedEmptyState
        icon={<FileText className="h-5 w-5" />}
        title="No content yet"
        description="Complete an interview to generate blog posts, social posts, and newsletter copy that will show up here."
        action={
          <Button asChild size="sm">
            <Link to="/new">Start a new interview</Link>
          </Button>
        }
        secondaryAction={
          <Button asChild size="sm" variant="outline">
            <Link to="/">See past interviews</Link>
          </Button>
        }
      />
    )
  }
  if (status === 'archived') {
    return (
      <SharedEmptyState
        icon={<Archive className="h-5 w-5" />}
        title="Nothing archived"
        description="Archived posts land here so you can recover them later. Use the archive button on any post to hide it without deleting it."
      />
    )
  }
  return (
    <SharedEmptyState
      icon={<FileText className="h-5 w-5" />}
      title={`No ${status.replace('_', ' ')} content`}
      description="Nothing matches this status right now. Switch to All to see everything, or complete an interview to add more."
    />
  )
}

export { PLATFORM_META, STATUS_META }

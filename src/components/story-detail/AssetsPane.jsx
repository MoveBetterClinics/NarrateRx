import { useState } from 'react'
import { useUser } from '@clerk/clerk-react'
import {
  FileText, CheckCircle2, XCircle, Send, Loader2,
  ChevronDown, MessageSquare, Eye, EyeOff,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PLATFORM_META, STATUS_META } from '@/lib/contentMeta'
import { useUserRole } from '@/lib/useUserRole'
import {
  useComments,
  useAddComment,
  useUpdateContentItemStatus,
} from '@/lib/queries'
import { publishAndTrack, publishBlogToWebsite } from '@/lib/publish'
import { toast } from '@/lib/toast'
import BufferMetricsRow from './BufferMetricsRow'
import ContentPlanPanel from '@/components/ContentPlanPanel'
import MediaAttachmentPanel from './MediaAttachmentPanel'
import OverlayTextEditor from './OverlayTextEditor'
import PostPreview from '@/components/PostPreview'
function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// ── Approval panel helpers ──────────────────────────────────────────────────

function StatusBadge({ status }) {
  const sm = STATUS_META[status] || { label: status || '—', color: 'bg-slate-100 text-slate-700' }
  return <Badge className={`text-xs border-0 ${sm.color}`}>{sm.label}</Badge>
}

function CommentThread({ pieceId }) {
  const { data: comments = [], isLoading } = useComments(pieceId)
  const addComment = useAddComment(pieceId)
  const [draft, setDraft] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!draft.trim()) return
    await addComment.mutateAsync({ body: draft, kind: 'comment' })
    setDraft('')
  }

  return (
    <div className="mt-3 space-y-2">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Comments</p>

      {isLoading && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading…
        </div>
      )}

      {!isLoading && comments.length === 0 && (
        <p className="text-xs text-muted-foreground italic">No comments yet.</p>
      )}

      {comments.map((c) => (
        <div
          key={c.id}
          className={`rounded-md p-2.5 text-xs ${
            c.kind === 'change_request'
              ? 'bg-amber-50 border border-amber-200'
              : 'bg-muted/40 border border-border'
          }`}
        >
          <div className="flex items-center gap-1.5 mb-1">
            <span className="font-medium text-foreground">{c.user_email}</span>
            <span className="text-muted-foreground">
              {timeAgo(c.created_at)}
            </span>
            {c.kind === 'change_request' && (
              <span className="ml-auto text-amber-700 font-medium">Change request</span>
            )}
          </div>
          <p className="text-foreground/90 whitespace-pre-wrap leading-relaxed">{c.body}</p>
        </div>
      ))}

      <form onSubmit={handleSubmit} className="flex gap-2 pt-1">
        <textarea
          className="flex-1 text-xs rounded border border-border bg-background px-2 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-primary/50 min-h-[56px]"
          placeholder="Add a comment…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button
          type="submit"
          size="sm"
          variant="outline"
          disabled={!draft.trim() || addComment.isPending}
          className="self-end"
        >
          {addComment.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <MessageSquare className="h-3 w-3" />}
        </Button>
      </form>
    </div>
  )
}

function ApprovalPanel({ piece }) {
  const { user } = useUser()
  const { canReview } = useUserRole()
  const updateStatus = useUpdateContentItemStatus()
  const addComment = useAddComment(piece.id)

  const [changeRequestOpen, setChangeRequestOpen] = useState(false)
  const [changeRequestBody, setChangeRequestBody] = useState('')
  const [publishing, setPublishing] = useState(false)

  const userEmail = user?.primaryEmailAddress?.emailAddress || user?.id || ''

  const handleSendForReview = async () => {
    await updateStatus.mutateAsync({
      id: piece.id,
      status: 'in_review',
      reviewedBy: userEmail,
    })
  }

  const handleApprove = async () => {
    await updateStatus.mutateAsync({
      id: piece.id,
      status: 'approved',
      approvedBy: userEmail,
      approvedAt: new Date().toISOString(),
    })
  }

  const handleRequestChanges = async (e) => {
    e.preventDefault()
    if (!changeRequestBody.trim()) return
    await addComment.mutateAsync({ body: changeRequestBody, kind: 'change_request' })
    await updateStatus.mutateAsync({ id: piece.id, status: 'draft' })
    setChangeRequestBody('')
    setChangeRequestOpen(false)
  }

  const handlePublish = async () => {
    setPublishing(true)
    try {
      const markdown = typeof piece.content === 'string' ? piece.content : JSON.stringify(piece.content)
      if (piece.platform === 'blog') {
        const lines = markdown.split('\n')
        const titleLine = lines.find((l) => /^#\s/.test(l))
        const title = titleLine ? titleLine.replace(/^#+\s+/, '').trim() : (piece.topic || 'Blog Post')
        const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
        const descLine = lines.find((l) => l.trim() && !/^#/.test(l) && !/^!\[/.test(l))
        const description = descLine?.trim().slice(0, 200) || title
        const pubDate = new Date().toISOString().slice(0, 10)
        const result = await publishBlogToWebsite({ slug, title, description, pubDate, markdown })
        toast.success('Published to website', {
          description: result.postUrl ? `View at ${result.postUrl}` : 'Post is live.',
        })
      } else {
        await publishAndTrack(
          {
            id: piece.id,
            platform: piece.platform,
            content: markdown,
            mediaUrls: piece.media_urls || [],
            scheduledAt: null,
          },
          userEmail,
        )
        toast.success('Sent to Buffer')
      }
    } catch (e) {
      toast.error('Publish failed', { description: e.message })
    } finally {
      setPublishing(false)
    }
  }

  const isBusy = updateStatus.isPending || addComment.isPending

  return (
    <div className="mt-3 pt-3 border-t space-y-3">
      {/* Status + audit trail */}
      <div className="flex items-center gap-2 flex-wrap">
        <StatusBadge status={piece.status} />
        {piece.approved_by && piece.approved_at && (
          <span className="text-xs text-muted-foreground">
            Approved by {piece.approved_by} on{' '}
            {new Date(piece.approved_at).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </span>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">
        {/* Send for review — all roles, only on draft */}
        {piece.status === 'draft' && (
          <Button
            size="sm"
            variant="outline"
            onClick={handleSendForReview}
            disabled={isBusy}
          >
            {isBusy && updateStatus.isPending ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5 mr-1.5" />
            )}
            Send for review
          </Button>
        )}

        {/* Approve — reviewer only, in_review */}
        {piece.status === 'in_review' && canReview && (
          <Button
            size="sm"
            onClick={handleApprove}
            disabled={isBusy}
            className="bg-green-600 hover:bg-green-700 text-white"
          >
            {isBusy && updateStatus.isPending ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
            )}
            Approve
          </Button>
        )}

        {/* Request changes — reviewer only, in_review */}
        {piece.status === 'in_review' && canReview && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setChangeRequestOpen((v) => !v)}
            disabled={isBusy}
          >
            <XCircle className="h-3.5 w-3.5 mr-1.5 text-amber-600" />
            Request changes
            <ChevronDown className={`h-3 w-3 ml-1 transition-transform ${changeRequestOpen ? 'rotate-180' : ''}`} />
          </Button>
        )}

        {/* Publish — reviewer only, approved */}
        {piece.status === 'approved' && canReview && (
          <Button
            size="sm"
            onClick={handlePublish}
            disabled={publishing || isBusy}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {publishing ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5 mr-1.5" />
            )}
            {piece.platform === 'blog' ? 'Publish to Website' : 'Publish to Buffer'}
          </Button>
        )}
      </div>



      {/* Change request inline form */}
      {changeRequestOpen && (
        <form onSubmit={handleRequestChanges} className="space-y-2">
          <textarea
            className="w-full text-xs rounded border border-amber-300 bg-amber-50 px-2 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-amber-400 min-h-[72px]"
            placeholder="Describe what needs to change…"
            value={changeRequestBody}
            onChange={(e) => setChangeRequestBody(e.target.value)}
            autoFocus
          />
          <div className="flex gap-2">
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={!changeRequestBody.trim() || isBusy}
              className="border-amber-400 text-amber-700 hover:bg-amber-50"
            >
              {isBusy ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
              Submit request
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setChangeRequestOpen(false)
                setChangeRequestBody('')
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      {/* Comment thread */}
      <CommentThread pieceId={piece.id} />
    </div>
  )
}

// ── AssetsPane ──────────────────────────────────────────────────────────────

/**
 * AssetsPane — tabbed list of content pieces for a story.
 *
 * Each tab shows platform + status + draft snippet and an approval panel
 * with role-gated actions (send for review, approve, request changes, publish).
 * The full ReviewPost editor remains accessible via the "Open for editing" link.
 */
export default function AssetsPane({ story }) {
  const pieces = story?.pieces ?? []
  const [activeIdx, setActiveIdx] = useState(0)
  const [view, setView] = useState('plan')
  // Preview visibility is per-piece so toggling on one tab doesn't bleed to others.
  const [previewOpen, setPreviewOpen] = useState({})

  const handleSelectPiece = (pieceId) => {
    const idx = pieces.findIndex((p) => p.id === pieceId)
    if (idx >= 0) setActiveIdx(idx)
    setView('edit')
  }

  const ViewToggle = (
    <div className="inline-flex rounded-md border bg-muted/30 p-0.5 text-xs">
      <button
        type="button"
        onClick={() => setView('plan')}
        className={`px-2.5 py-1 rounded ${view === 'plan' ? 'bg-card shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground'}`}
      >
        Plan
      </button>
      <button
        type="button"
        onClick={() => setView('edit')}
        className={`px-2.5 py-1 rounded ${view === 'edit' ? 'bg-card shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground'}`}
        disabled={pieces.length === 0}
      >
        Edit
      </button>
    </div>
  )

  if (view === 'plan') {
    return (
      <div className="rounded-xl border bg-card p-4 space-y-4">
        <div className="flex items-center justify-end">{ViewToggle}</div>
        <ContentPlanPanel
          interviewId={story?.id}
          interviewCreatedAt={story?.created_at}
          onSelectPiece={handleSelectPiece}
        />
        {pieces.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No content pieces yet. Generate content from the interview to populate the plan.
          </p>
        )}
      </div>
    )
  }

  if (pieces.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-4 space-y-3">
        <div className="flex items-center justify-end">{ViewToggle}</div>
        <p className="text-sm text-muted-foreground">
          No content pieces yet. Generate content from the interview to see it here.
        </p>
      </div>
    )
  }

  const active = pieces[activeIdx] ?? pieces[0]
  const pm = PLATFORM_META[active?.platform] || { label: active?.platform || 'Unknown', icon: FileText, color: 'text-slate-600', bg: 'bg-slate-100' }
  const PlatformIcon = pm.icon
  const showPreview = previewOpen[active?.id] ?? false

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="flex items-center justify-end px-3 pt-3">{ViewToggle}</div>
      {/* Tab row */}
      <div className="flex gap-1 px-3 pt-3 pb-0 overflow-x-auto border-b">
        {pieces.map((piece, i) => {
          const meta = PLATFORM_META[piece.platform] || { label: piece.platform, icon: FileText, color: 'text-slate-600', bg: 'bg-slate-100' }
          const Icon = meta.icon
          const isActive = i === activeIdx
          return (
            <button
              key={piece.id}
              type="button"
              onClick={() => setActiveIdx(i)}
              className={`flex items-center gap-1.5 shrink-0 px-3 py-2 text-xs rounded-t border-b-2 transition-colors ${
                isActive
                  ? 'border-primary text-primary font-medium bg-primary/5'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="h-3 w-3" />
              {meta.label}
            </button>
          )
        })}
      </div>

      {/* Active piece body */}
      <div className="p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className={`flex items-center gap-1.5 px-2 py-1 rounded ${pm.bg}`}>
            <PlatformIcon className={`h-3.5 w-3.5 ${pm.color}`} />
            <span className={`text-xs font-medium ${pm.color}`}>{pm.label}</span>
          </div>
          {active?.scheduled_at && (
            <span className="text-xs text-muted-foreground">
              Scheduled {new Date(active.scheduled_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric' })}
            </span>
          )}
        </div>

        {active?.content ? (
          <div className="rounded-md border bg-muted/30 p-3 max-h-64 overflow-y-auto">
            <pre className="text-xs leading-relaxed font-mono whitespace-pre-wrap text-foreground/90 break-words">
              {typeof active.content === 'string' ? active.content : JSON.stringify(active.content, null, 2)}
            </pre>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground italic">No draft content yet.</p>
        )}

        {/* Media + overlay editors — attach photos/videos and tune the on-screen
            text overlay without leaving the Story screen. */}
        {active && <MediaAttachmentPanel piece={active} />}
        {active && <OverlayTextEditor piece={active} />}

        {/* Live channel preview */}
        {active && (
          <div className="rounded-md border bg-card">
            <button
              type="button"
              onClick={() =>
                setPreviewOpen((prev) => ({ ...prev, [active.id]: !showPreview }))
              }
              className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <span className="inline-flex items-center gap-1.5">
                {showPreview ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {showPreview ? 'Hide' : 'Show'} preview
              </span>
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${showPreview ? 'rotate-180' : ''}`}
              />
            </button>
            {showPreview && (
              <div className="border-t bg-muted/20 p-3">
                <PostPreview
                  platform={active.platform}
                  content={typeof active.content === 'string' ? active.content : JSON.stringify(active.content)}
                  mediaUrls={Array.isArray(active.media_urls) ? active.media_urls : []}
                  overlayText={active.overlay_text || null}
                />
              </div>
            )}
          </div>
        )}

        {/* Buffer performance metrics — shown for published pieces with a buffer_update_id */}
        {active?.status === 'published' && active?.buffer_update_id && (
          <BufferMetricsRow contentItemId={active.id} />
        )}

        {/* Approval panel */}
        {active && <ApprovalPanel key={active.id} piece={active} />}
      </div>
    </div>
  )
}

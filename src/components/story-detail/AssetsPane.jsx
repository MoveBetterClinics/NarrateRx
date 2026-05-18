import { useState, useEffect, useMemo, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { useUser } from '@clerk/clerk-react'
import {
  FileText, CheckCircle2, XCircle, Send, Loader2,
  ChevronDown, MessageSquare, Eye, RotateCcw, ExternalLink, Quote,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ClinicianChip } from '@/components/ClinicianChip'
import { PLATFORM_META, STATUS_META } from '@/lib/contentMeta'
import { getStageToken } from '@/lib/stageTokens'
import { getPatientPrototypesUi } from '@/lib/prompts'
import { useUserRole } from '@/lib/useUserRole'
import { useWorkspace } from '@/lib/WorkspaceContext'
import {
  useComments,
  useAddComment,
  useUpdateContentItem,
  useUpdateContentItemStatus,
  useRegenerateContentItem,
  queryKeys,
} from '@/lib/queries'
import { publishAndTrack, publishBlogToWebsite } from '@/lib/publish'
import { suggestScheduleTime } from '@/lib/scheduleHeuristics'
import { buildImagesManifest } from '@/lib/publishImageMirror'
import { extractProvenanceBlock } from '@/lib/provenance'
import { toast, runWithToast } from '@/lib/toast'
import BufferMetricsRow from './BufferMetricsRow'
import ContentPlanPanel from '@/components/ContentPlanPanel'
import MediaAttachmentPanel from './MediaAttachmentPanel'
import OverlayTextEditor, { extractMarkerSuggestions, markersToOverlay } from './OverlayTextEditor'
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

// Format a Date for an HTML datetime-local input ("YYYY-MM-DDTHH:mm" in local
// time). The native input rejects ISO strings with a Z suffix.
function toLocalDatetimeInput(d) {
  if (!d) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ── Approval panel helpers ──────────────────────────────────────────────────

// Map content_item.status → canonical story stage so colours stay in sync
// with the stage tokens used everywhere else (StoryCard, StoriesThemesView).
const STATUS_TO_STAGE = {
  draft:     'drafting',
  in_review: 'review',
  approved:  'review',
  scheduled: 'scheduled',
  published: 'published',
}

const STATUS_DOT = {
  draft:     'bg-slate-400',
  in_review: 'bg-amber-400',
  approved:  'bg-blue-500',
  scheduled: 'bg-purple-500',
  published: 'bg-green-500',
  archived:  'bg-zinc-400',
}

function StatusBadge({ status }) {
  const sm = STATUS_META[status] || { label: status || '—' }
  const stage = STATUS_TO_STAGE[status]
  const token = stage ? getStageToken(stage) : null
  const badgeClass = token?.badge ?? 'bg-slate-100 text-slate-700'
  return <Badge className={`text-xs border-0 ${badgeClass}`}>{sm.label}</Badge>
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

// Inline editor for a content_item's body. Always-editable textarea that
// auto-grows with content. Save / Reset only appear when the local buffer
// differs from the saved value, so the unedited path stays clean.
// ── AttributedView ────────────────────────────────────────────────────────────
// Read-mode paragraph view that color-codes each block by its provenance type
// and fires a transcript highlight on click. Replaces the textarea in
// "attributed" view mode.

const BLOCK_BORDER = {
  verbatim:         'border-l-emerald-400',
  close_paraphrase: 'border-l-sky-400',
  synthesis:        'border-l-slate-300',
}

function AttributedView({ content, blocks, onHighlight }) {
  const paragraphs = (typeof content === 'string' ? content : '')
    .split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)

  return (
    <div className="rounded-md border bg-muted/20 p-3 space-y-3 text-xs leading-relaxed text-foreground/90">
      {paragraphs.map((para, i) => {
        const block  = blocks?.[i]
        const border = BLOCK_BORDER[block?.source_type] ?? 'border-l-transparent'
        const clickable = block?.source_msg_index != null
        return (
          <p
            key={i}
            className={`pl-3 border-l-2 ${border} py-0.5 whitespace-pre-wrap transition-colors duration-150 ${
              clickable ? 'cursor-pointer hover:bg-muted/40 rounded-r' : ''
            }`}
            title={clickable ? 'Click to see source in transcript' : undefined}
            onClick={clickable ? () => onHighlight?.({
              msgIndex: block.source_msg_index,
              start: block.source_span?.[0] ?? null,
              end:   block.source_span?.[1] ?? null,
            }) : undefined}
          >
            {para}
          </p>
        )
      })}
      <div className="flex items-center gap-3 pt-1 border-t border-border/50 text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="h-3 w-0.5 rounded bg-emerald-400" />Verbatim</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-0.5 rounded bg-sky-400" />Paraphrase</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-0.5 rounded bg-slate-300" />Synthesis</span>
        <span className="ml-auto italic">Click a paragraph to jump to its source in the transcript</span>
      </div>
    </div>
  )
}

function ContentEditor({ piece, onProvenanceHighlight }) {
  // JSONB platforms (rare — currently none in production) round-trip through
  // a JSON string so the textarea isn't [object Object]. Edits stay as plain
  // text — we don't try to re-parse on save; if the user mangled the JSON,
  // the backend will store the string and Plan/Preview will fall back.
  //
  // Defense-in-depth: strip any <PROVENANCE>…</PROVENANCE> trailer that
  // leaked into stored content from older generation paths. Server-side
  // strip lives in draft.js + regenerate.js, but legacy rows still carry
  // the trailer and would otherwise render as raw JSON in the editor.
  const rawInitial = typeof piece.content === 'string'
    ? piece.content
    : piece.content == null ? '' : JSON.stringify(piece.content, null, 2)
  const initial = typeof rawInitial === 'string'
    ? extractProvenanceBlock(rawInitial).content
    : rawInitial

  const [value, setValue] = useState(initial)
  const [viewMode, setViewMode] = useState('edit')
  const taRef = useRef(null)
  const updateItem = useUpdateContentItem()
  const hasProvenance = !!(piece.provenance?.blocks?.length)

  // Re-sync local buffer when the saved row changes from elsewhere
  // (regenerate, server roundtrip after Save). Without this the textarea
  // would stay pinned to the user's stale buffer after a Regenerate.
  useEffect(() => { setValue(initial) }, [initial])

  // Auto-grow textarea to fit content, clamped so very long posts stay
  // scrollable instead of pushing the rest of the pane off-screen.
  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 480)}px`
  }, [value])

  const dirty = value !== initial
  const saving = updateItem.isPending

  const handleSave = async () => {
    try {
      // Body is the single source of truth for overlay text. When the draft
      // contains `[ON SCREEN TEXT: …]` markers, derive overlay_text from them
      // so it stays in sync with the body — and null it out when markers are
      // removed. When there are no markers at all (clean body + overlay
      // seeded from the AI's separate ---OVERLAY--- block), leave overlay_text
      // alone so we don't wipe a pre-existing overlay on every save.
      const patch = { content: value }
      const markers = extractMarkerSuggestions(value)
      if (markers.length > 0) {
        patch.overlayText = markersToOverlay(markers)
      } else if (piece.overlay_text && /\[ON\s*SCREEN\s*TEXT:/i.test(piece.content || '')) {
        // User removed the markers from a body that previously had them →
        // clear the derived overlay too.
        patch.overlayText = null
      }
      await updateItem.mutateAsync({ id: piece.id, patch })
      toast.success('Saved')
    } catch (e) {
      toast.error('Save failed', { description: e.message })
    }
  }

  return (
    <div className="space-y-2">
      {/* View-mode toggle — always visible; Attributed only when provenance exists */}
      <div className="flex items-center gap-1">
        {(['edit', ...(hasProvenance ? ['attributed'] : []), 'assets']).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => setViewMode(mode)}
            className={`px-2 py-0.5 rounded text-xs capitalize transition-colors ${
              viewMode === mode
                ? 'bg-muted text-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {mode}
          </button>
        ))}
      </div>

      {viewMode === 'attributed' && hasProvenance ? (
        <AttributedView
          content={value}
          blocks={piece.provenance.blocks}
          onHighlight={onProvenanceHighlight}
        />
      ) : viewMode === 'assets' ? (
        <div className="space-y-3">
          <MediaAttachmentPanel piece={piece} />
          {piece.platform === 'instagram' && <OverlayTextEditor piece={piece} />}
        </div>
      ) : (
        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          spellCheck
          className="w-full min-h-[160px] max-h-[480px] rounded-md border bg-muted/20 p-3 text-xs leading-relaxed font-mono whitespace-pre-wrap text-foreground/90 break-words resize-none focus:outline-none focus:ring-1 focus:ring-primary/50"
          placeholder="No draft content yet."
        />
      )}
      {dirty && viewMode === 'edit' && (
        <div className="flex items-center justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => setValue(initial)}
            disabled={saving}
          >
            Reset
          </Button>
          <Button
            size="sm"
            className="h-7 text-xs"
            onClick={handleSave}
            disabled={saving}
            loading={saving}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      )}
    </div>
  )
}

function RegenerateButton({ piece, story }) {
  const regenerate = useRegenerateContentItem()
  const workspace = useWorkspace()
  const [confirming, setConfirming] = useState(false)

  const handleRegenerate = async () => {
    setConfirming(false)
    try {
      await regenerate.mutateAsync({ id: piece.id })
      toast.success('Regenerated', { description: 'Content rewritten and reset to draft.' })
    } catch (e) {
      toast.error('Regeneration failed', { description: e.message })
    }
  }

  // Build the resting-state context chip. Lists each piece of voice context
  // the regeneration will apply, so the user knows what's behind the button
  // before they click — no surprise about why output sounds the way it does.
  const contextBullets = (() => {
    const bullets = []
    // Voice notes: piece.clinician_id implies the clinician has a profile.
    // We don't have voice_notes content on the piece, so this is a heuristic
    // signal ("a clinician profile is bound, which may carry voice notes").
    if (piece.clinician_id || story?.clinician_id) bullets.push('Voice notes')
    const echoCount = piece.provenance?.summary?.voice_phrase_echo_count ?? 0
    if (echoCount > 0) bullets.push(`${echoCount} exemplar${echoCount === 1 ? '' : 's'}`)
    if (story?.prototype_id && workspace) {
      const proto = getPatientPrototypesUi(workspace).find((p) => p.id === story.prototype_id)
      if (proto?.label) bullets.push(`'${proto.label}' prototype`)
    }
    if (story?.tone) bullets.push(`${story.tone} tone`)
    return bullets
  })()

  if (regenerate.isPending) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Regenerating — this can take 30–60 seconds…
      </div>
    )
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs">
        <span className="text-amber-800">
          Replace this draft with a fresh AI generation? Current text and approval state will be lost.
          {piece.clinician_name && (
            <span className="block mt-0.5 text-amber-700/80">
              Bernard will apply {piece.clinician_name}&rsquo;s voice settings.
            </span>
          )}
        </span>
        <div className="ml-auto flex gap-1.5 shrink-0">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs border-amber-400 text-amber-700 hover:bg-amber-100"
            onClick={handleRegenerate}
          >
            Regenerate
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => setConfirming(false)}
          >
            Cancel
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-1">
      {contextBullets.length > 0 && (
        <div className="text-2xs text-muted-foreground italic">
          {contextBullets.join(' · ')}
        </div>
      )}
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs gap-1.5"
        onClick={() => setConfirming(true)}
      >
        <RotateCcw className="h-3 w-3" />
        Regenerate
      </Button>
    </div>
  )
}

// ── InspectDrawer ─────────────────────────────────────────────────────────────
// Collapsible drawer housing Regenerate + live channel preview. Collapsed by
// default so the primary write loop (body → approval) is uncluttered — expand
// only when you want to audit voice or sanity-check the post layout.
function InspectDrawer({ piece, story }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-md border bg-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <span className="inline-flex items-center gap-1.5">
          <Eye className="h-3.5 w-3.5" />
          Regenerate &amp; preview
        </span>
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="border-t p-3 space-y-3">
          <RegenerateButton piece={piece} story={story} />
          <div>
            <p className="mb-2 text-2xs font-medium uppercase tracking-wide text-muted-foreground">Preview</p>
            <PostPreview
              platform={piece.platform}
              content={typeof piece.content === 'string' ? piece.content : JSON.stringify(piece.content)}
              mediaUrls={Array.isArray(piece.media_urls) ? piece.media_urls : []}
              overlayText={piece.overlay_text || null}
              locationOverrides={piece.location_overrides || null}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function ApprovalPanel({ piece }) {
  const { user } = useUser()
  const { canReview } = useUserRole()
  const workspace = useWorkspace()
  const skipReview = !!workspace?.skip_review
  const updateStatus = useUpdateContentItemStatus()
  const addComment = useAddComment(piece.id)
  const qc = useQueryClient()

  const [changeRequestOpen, setChangeRequestOpen] = useState(false)
  const [changeRequestBody, setChangeRequestBody] = useState('')
  const [publishing, setPublishing] = useState(false)

  // Schedule controls — Buffer-dispatched platforms only. Default to honoring
  // the piece's pre-filled scheduled_at if it's still in the future. If expired
  // or absent, default to "Now" (matches prior behaviour) but pre-populate the
  // picker with the next platform-optimal slot (e.g. TikTok → next Tue/Wed/Fri
  // 7-8pm) so flipping the toggle to Schedule lands on a sensible time without
  // typing. Blog publishes are immediate and hide the toggle entirely.
  const initialFutureSchedule = (() => {
    if (!piece.scheduled_at) return null
    const d = new Date(piece.scheduled_at)
    return d.getTime() > Date.now() ? d : null
  })()
  const suggestedSchedule = useMemo(
    () => (initialFutureSchedule ? null : suggestScheduleTime(piece.platform, [])),
    [piece.platform, initialFutureSchedule],
  )
  const [publishMode, setPublishMode] = useState(initialFutureSchedule ? 'schedule' : 'now')
  const [scheduledAtInput, setScheduledAtInput] = useState(
    initialFutureSchedule
      ? toLocalDatetimeInput(initialFutureSchedule)
      : suggestedSchedule ? toLocalDatetimeInput(suggestedSchedule) : '',
  )

  const userEmail = user?.primaryEmailAddress?.emailAddress || user?.id || ''

  const handleSendForReview = async () => {
    try {
      await updateStatus.mutateAsync({
        id: piece.id,
        status: 'in_review',
        reviewedBy: userEmail,
      })
    } catch (err) {
      toast.error('Failed to send for review', { description: err.message })
    }
  }

  const handleApprove = async () => {
    try {
      await updateStatus.mutateAsync({
        id: piece.id,
        status: 'approved',
        approvedBy: userEmail,
        approvedAt: new Date().toISOString(),
      })
    } catch (err) {
      toast.error('Failed to approve', { description: err.message })
    }
  }

  const handleRequestChanges = async (e) => {
    e.preventDefault()
    if (!changeRequestBody.trim()) return
    try {
      await addComment.mutateAsync({ body: changeRequestBody, kind: 'change_request' })
      await updateStatus.mutateAsync({ id: piece.id, status: 'draft' })
      setChangeRequestBody('')
      setChangeRequestOpen(false)
    } catch (err) {
      toast.error('Failed to submit change request', { description: err.message })
    }
  }

  const handlePublish = async () => {
    // Schedule validation — Buffer path only; blog publishes ignore the toggle.
    let effectiveScheduledAt = null
    if (piece.platform !== 'blog' && publishMode === 'schedule') {
      if (!scheduledAtInput) {
        toast.error('Pick a schedule time before publishing')
        return
      }
      const scheduled = new Date(scheduledAtInput)
      if (Number.isNaN(scheduled.getTime())) {
        toast.error('Invalid schedule time')
        return
      }
      if (scheduled.getTime() <= Date.now()) {
        toast.error('Pick a time in the future')
        return
      }
      effectiveScheduledAt = scheduled.toISOString()
    }

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
        // Mirror-on-publish image manifest — hero from media_urls[0], inline
        // body images parsed from the markdown. Server-side WP path uploads
        // each into the Media Library and rewrites the body; the Astro
        // webhook receives the manifest and is responsible for committing the
        // bytes into the destination repo. See src/lib/publishImageMirror.js.
        const manifest = buildImagesManifest({ markdown, mediaUrls: piece.media_urls, slug })
        const payload = { slug, title, description, pubDate, markdown, ...manifest }
        if (piece.clinician_name) payload.author = piece.clinician_name
        if (piece.topic) {
          const topicSlug = piece.topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
          if (topicSlug) payload.topic = topicSlug
        }
        // The WordPress publish path is multi-step (slug check, hero upload,
        // tag resolve, inline image mirror, post create) and routinely takes
        // 30–90s. The persistent loading toast keeps the user oriented even
        // when the in-button spinner is offscreen.
        const result = await runWithToast(publishBlogToWebsite(payload), {
          loading: 'Publishing to website… this can take 30–90s',
          success: (r) => ({
            message: 'Published to website',
            description: r.postUrl ? `View at ${r.postUrl}` : 'Post is live.',
          }),
          error: (e) => ({ message: 'Publish failed', description: e.message }),
        })
        await updateStatus.mutateAsync({
          id: piece.id,
          status: 'published',
          publishedAt: new Date().toISOString(),
          resolvedUrl: result.postUrl || undefined,
        })
      } else {
        const scheduling = !!effectiveScheduledAt
        await runWithToast(
          publishAndTrack(
            {
              id: piece.id,
              platform: piece.platform,
              content: markdown,
              mediaUrls: piece.media_urls || [],
              scheduledAt: effectiveScheduledAt,
            },
            userEmail,
          ),
          {
            loading: scheduling ? 'Scheduling on Buffer…' : 'Sending to Buffer…',
            success: scheduling ? 'Scheduled on Buffer' : 'Sent to Buffer',
            error: (e) => ({ message: 'Publish failed', description: e.message }),
          },
        )
        // publishAndTrack already set status + publishedAt; this pass writes the
        // approver audit trail and (for scheduled posts) persists the chosen
        // scheduled_at on the row so the calendar/header reflect the new time.
        await updateStatus.mutateAsync({
          id: piece.id,
          status: scheduling ? 'scheduled' : 'published',
          approvedBy: userEmail,
          approvedAt: new Date().toISOString(),
          publishedAt: scheduling ? null : new Date().toISOString(),
          scheduledAt: scheduling ? effectiveScheduledAt : null,
        })
        qc.invalidateQueries({ queryKey: queryKeys.stories.detail(piece.interview_id) })
      }
    } catch {
      // runWithToast already surfaced the error toast; swallow so we don't
      // double-toast and so the finally block resets the spinner.
    } finally {
      setPublishing(false)
    }
  }

  const isBusy = updateStatus.isPending || addComment.isPending

  const provSummary = piece.provenance?.summary
  const ownWordsPct  = provSummary ? provSummary.verbatim_pct + provSummary.paraphrase_pct : null
  const echoCount    = provSummary?.voice_phrase_echo_count ?? 0
  // verbatim_count isn't on summary today — derive from blocks. Same shape
  // as if it were precomputed, so we can swap to summary.verbatim_count later
  // without touching the render path.
  const verbatimCount = provSummary
    ? piece.provenance?.blocks?.filter((b) => b.source_type === 'verbatim').length ?? 0
    : 0

  // Approver display: ClinicianChip when we have a name, plain email fallback
  // otherwise. piece.approved_by historically holds an email; approved_by_name
  // is the resolved display name when the approver is a clinician.
  const approverName = piece.approved_by_name || piece.approved_by

  return (
    <div className="mt-3 pt-3 border-t space-y-3">
      {/* Voice-drift scorecard — sourced from provenance.summary (PR1 substrate) */}
      {provSummary && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {verbatimCount > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium">
              <Quote className="h-3 w-3" aria-hidden="true" />
              {verbatimCount} verbatim phrase{verbatimCount === 1 ? '' : 's'} preserved
            </span>
          )}
          <span className="inline-flex items-center rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-xs text-emerald-700">
            {ownWordsPct}% in clinician&rsquo;s voice
          </span>
          {echoCount > 0 && (
            <span className="inline-flex items-center rounded-full bg-indigo-50 border border-indigo-200 px-2 py-0.5 text-xs text-indigo-700">
              {echoCount} phrase{echoCount === 1 ? '' : 's'} echo prior work
            </span>
          )}
          {provSummary.synthesis_pct > 40 && (
            <span className="inline-flex items-center rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-xs text-amber-700">
              {provSummary.synthesis_pct}% synthesis — read closely
            </span>
          )}
        </div>
      )}

      {/* Status + audit trail */}
      <div className="flex items-center gap-2 flex-wrap">
        <StatusBadge status={piece.status} />
        {piece.approved_by && piece.approved_at && (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            Approved by
            {piece.approved_by_clinician_id
              ? <ClinicianChip name={approverName} id={piece.approved_by_clinician_id} size="sm" showName />
              : <span>{approverName}</span>
            }
            <span>on{' '}
              {new Date(piece.approved_at).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </span>
          </span>
        )}
      </div>

      {/* Publish-timing controls — Buffer path only. Shown on approved pieces
          so the reviewer can choose to send immediately or schedule on Buffer.
          Blog publishes are immediate (the website webhook is synchronous). */}
      {piece.status === 'approved' && canReview && piece.platform !== 'blog' && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground font-medium">Publish:</span>
          <div className="inline-flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPublishMode('now')}
              className={`px-2.5 py-1 rounded-full border ${publishMode === 'now' ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted text-muted-foreground border-border'}`}
            >
              Now
            </button>
            <button
              type="button"
              onClick={() => setPublishMode('schedule')}
              className={`px-2.5 py-1 rounded-full border ${publishMode === 'schedule' ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted text-muted-foreground border-border'}`}
            >
              Schedule
            </button>
          </div>
          {publishMode === 'schedule' && (
            <Input
              type="datetime-local"
              value={scheduledAtInput}
              onChange={(e) => setScheduledAtInput(e.target.value)}
              min={toLocalDatetimeInput(new Date(Date.now() + 60_000))}
              className="h-8 text-sm w-fit"
            />
          )}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">
        {/* Send for review — all roles, only on draft, only when review workflow is on */}
        {piece.status === 'draft' && !skipReview && (
          <Button
            size="sm"
            variant="outline"
            onClick={handleSendForReview}
            disabled={isBusy}
            loading={isBusy && updateStatus.isPending}
          >
            {!(isBusy && updateStatus.isPending) && <Send className="h-3.5 w-3.5 mr-1.5" />}
            Send for review
          </Button>
        )}

        {/* Approve — on draft when workspace skips the review step, or on in_review */}
        {((piece.status === 'draft' && skipReview && canReview) ||
          (piece.status === 'in_review' && canReview)) && (
          <Button
            size="sm"
            onClick={handleApprove}
            disabled={isBusy}
            loading={isBusy && updateStatus.isPending}
            className="bg-green-600 hover:bg-green-700 text-white"
          >
            {!(isBusy && updateStatus.isPending) && <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />}
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
            loading={publishing}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {!publishing && <Send className="h-3.5 w-3.5 mr-1.5" />}
            {piece.platform === 'blog'
              ? 'Publish to Website'
              : publishMode === 'schedule' ? 'Schedule on Buffer' : 'Publish Now'}
          </Button>
        )}

        {/* Published state — no further action available */}
        {piece.status === 'published' && (
          <Button
            size="sm"
            variant="outline"
            disabled
            className="border-green-300 bg-green-50 text-green-700 cursor-default opacity-100"
          >
            <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
            {piece.platform === 'blog' ? 'Published to Website' : 'Published to Buffer'}
          </Button>
        )}

        {/* Live link — shown once the website publish round-trip captures a URL */}
        {piece.status === 'published' && piece.platform === 'blog' && piece.resolved_url && (
          <a
            href={piece.resolved_url}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline self-center"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            View live post
          </a>
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
              loading={isBusy}
              className="border-amber-400 text-amber-700 hover:bg-amber-50"
            >
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
//
// Paragraph-level attribution now lives inside ContentEditor's "Attributed"
// view-mode toggle — see AttributedView above. The earlier ProvenanceTracePanel
// duplicated that surface as a list below the editor and was removed for clarity.

/**
 * AssetsPane — tabbed list of content pieces for a story.
 *
 * Each tab shows platform + status + draft snippet and an approval panel
 * with role-gated actions (send for review, approve, request changes, publish).
 * The full ReviewPost editor remains accessible via the "Open for editing" link.
 */
export default function AssetsPane({ story, onProvenanceHighlight }) {
  const pieces = useMemo(() => story?.pieces ?? [], [story?.pieces])
  const [searchParams, setSearchParams] = useSearchParams()
  const pieceParam = searchParams.get('piece')
  const initialIdx = pieceParam
    ? Math.max(0, pieces.findIndex((p) => p.id === pieceParam))
    : 0
  const [activeIdx, setActiveIdx] = useState(initialIdx)
  const [view, setView] = useState(pieceParam ? 'edit' : 'plan')

  // If the ?piece=<id> param resolves after pieces load (async story fetch),
  // sync the active tab once the matching piece appears.
  useEffect(() => {
    if (!pieceParam) return
    const idx = pieces.findIndex((p) => p.id === pieceParam)
    if (idx >= 0 && idx !== activeIdx) {
      setActiveIdx(idx)
      setView('edit')
    }
  }, [pieceParam, pieces, activeIdx])

  const handleSelectPiece = (pieceId) => {
    const idx = pieces.findIndex((p) => p.id === pieceId)
    if (idx >= 0) setActiveIdx(idx)
    setView('edit')
    if (pieceId && pieceId !== pieceParam) {
      const next = new URLSearchParams(searchParams)
      next.set('piece', pieceId)
      setSearchParams(next, { replace: true })
    }
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

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="flex items-center justify-end px-3 pt-3">{ViewToggle}</div>
      {/* Tab row — numbers same-platform pieces (e.g. "Facebook 2 of 5") and
          shows a status dot so multiple drafts on the same channel are
          distinguishable without clicking through each tab. */}
      <div className="flex gap-1 px-3 pt-3 pb-0 overflow-x-auto border-b">
        {(() => {
          const platformCounts = {}
          for (const p of pieces) {
            platformCounts[p.platform] = (platformCounts[p.platform] || 0) + 1
          }
          const platformIdx = {}
          return pieces.map((piece, i) => {
            const meta = PLATFORM_META[piece.platform] || { label: piece.platform, icon: FileText, color: 'text-slate-600', bg: 'bg-slate-100' }
            const Icon = meta.icon
            const isActive = i === activeIdx
            const total = platformCounts[piece.platform]
            platformIdx[piece.platform] = (platformIdx[piece.platform] || 0) + 1
            const nth = platformIdx[piece.platform]
            const label = total > 1 ? `${meta.label} ${nth}/${total}` : meta.label
            const statusDot = STATUS_DOT[piece.status] ?? 'bg-slate-300'
            const statusLabel = STATUS_META[piece.status]?.label ?? piece.status
            const preview = typeof piece.content === 'string' ? piece.content.slice(0, 80) : ''
            const title = `${statusLabel}${preview ? ` — ${preview}${preview.length >= 80 ? '…' : ''}` : ''}`
            return (
              <button
                key={piece.id}
                type="button"
                onClick={() => handleSelectPiece(piece.id)}
                title={title}
                className={`flex items-center gap-1.5 shrink-0 px-3 py-2 text-xs rounded-t border-b-2 transition-colors ${
                  isActive
                    ? 'border-primary text-primary font-medium bg-primary/5'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className="h-3 w-3" />
                {label}
                <span className={`h-1.5 w-1.5 rounded-full ${statusDot}`} aria-label={statusLabel} />
              </button>
            )
          })
        })()}
      </div>

      {/* Active piece body */}
      <div className="p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className={`flex items-center gap-1.5 px-2 py-1 rounded ${pm.bg}`}>
            <PlatformIcon className={`h-3.5 w-3.5 ${pm.color}`} />
            <span className={`text-xs font-medium ${pm.color}`}>{pm.label}</span>
          </div>
          {(() => {
            const fmt = (d) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric' })
            if (active?.status === 'published') {
              const pubRaw = active.published_at || active.scheduled_at
              if (!pubRaw) return null
              return (
                <span className="text-xs text-muted-foreground">
                  Published {fmt(new Date(pubRaw))}
                </span>
              )
            }
            if (!active?.scheduled_at) return null
            const schedDate = new Date(active.scheduled_at)
            const isStale = schedDate < new Date()
            return isStale ? (
              <span className="flex items-center gap-1 text-xs text-amber-600 font-medium">
                <span>⚠ Schedule expired ({fmt(schedDate)}) — repick a time before publishing</span>
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">
                Scheduled {fmt(schedDate)}
              </span>
            )
          })()}
        </div>

        {/* Body / preview / approval — keyed wrapper forces a clean unmount/
            remount of the entire piece-scoped subtree when the active piece
            changes. Without this wrapper, React's reconciler was leaving old
            ContentEditor DOM nodes behind across tab clicks because the
            children array mixes keyed (ContentEditor, ApprovalPanel) and
            unkeyed (InspectDrawer, conditional BufferMetricsRow) siblings —
            the keyed children got new instances but the old ones never got
            removed, so every tab click stacked a new editor on top of the
            previous one. */}
        {active && (
          <div key={active.id} className="space-y-3">
            {/* Body / Assets / Attributed tabs live inside ContentEditor.
                Media + overlay panels are rendered under the Assets tab. */}
            <ContentEditor piece={active} onProvenanceHighlight={onProvenanceHighlight} />

            {/* Regenerate + live preview — collapsed by default to keep the
                primary write loop (body → approval) uncluttered. */}
            <InspectDrawer piece={active} story={story} />

            {/* Buffer performance metrics — shown for published pieces with a buffer_update_id */}
            {active.status === 'published' && active.buffer_update_id && (
              <BufferMetricsRow contentItemId={active.id} />
            )}

            <ApprovalPanel piece={active} />
          </div>
        )}
      </div>
    </div>
  )
}

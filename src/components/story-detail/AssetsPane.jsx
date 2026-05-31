import { useState, useEffect, useMemo, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { useUser } from '@clerk/react'
import {
  FileText, CheckCircle2, XCircle, Send, Loader2,
  ChevronDown, MessageSquare, Eye, RotateCcw, ExternalLink, Quote,
  Calendar, Clock, AlertTriangle, Layers, Copy, Download, Lock,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { StaffChip } from '@/components/StaffChip'
import ReadAloudButton from '@/components/ReadAloudButton'
import { PLATFORM_META, STATUS_META } from '@/lib/contentMeta'
import { getStageToken, getStatusDot } from '@/lib/stageTokens'
import { getPatientPrototypesUi } from '@/lib/prompts'
import { LENGTH_PRESETS, resolveLengthPreset } from '@/lib/lengthPresets'
import { useUserRole } from '@/lib/useUserRole'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { canDirectPublishPlatform, exportShapeForPlatform, EXPORT_SHAPES } from '@/lib/outputChannels'
import {
  useComments,
  useAddComment,
  useStaff,
  useUpdateContentItem,
  useUpdateContentItemStatus,
  useRegenerateContentItem,
  useRegenerateBlogStreamed,
  useSplitBlogIntoSeries,
  useCarouselThemes,
  queryKeys,
} from '@/lib/queries'
import { resolveTheme } from '@/lib/carouselThemes'
import { ensureRenderedSlides } from '@/lib/renderSlides'
import { publishAndTrack, publishBlogToWebsite, sendBlogToBeehiiv, cancelBufferPost } from '@/lib/publish'
import { suggestScheduleTime, explainPlatformSlot, findScheduleConflict } from '@/lib/scheduleHeuristics'
import { buildImagesManifest } from '@/lib/publishImageMirror'
import { extractProvenanceBlock } from '@/lib/provenance'
import { toast, runWithToast } from '@/lib/toast'
import BufferMetricsRow from './BufferMetricsRow'
import WinnerToggle from './WinnerToggle'
import ContentPlanPanel from '@/components/ContentPlanPanel'
import MediaAttachmentPanel from './MediaAttachmentPanel'
import SlideEditor from './SlideEditor'
import VoiceFidelityBadge from './VoiceFidelityBadge'
import SplitSuggestionBanner from './SplitSuggestionBanner'
import { extractMarkerSuggestions, markersToOverlay } from './OverlayTextEditor'
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
  const { data: staff = [] } = useStaff()
  const [draft, setDraft] = useState('')

  // Resolve a comment's author to a human display name. Prefer a matching
  // clinician row (by Clerk user id) so threads read "Q" rather than
  // "drq@narraterx.ai"; fall back to the email local-part.
  const authorLabel = (c) => {
    const match = c.user_id && staff.find((s) => s?.user_id === c.user_id)
    if (match?.name) return match.name
    const email = c.user_email || ''
    return email.includes('@') ? email.split('@')[0] : (email || 'Someone')
  }

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
            <span className="font-medium text-foreground">{authorLabel(c)}</span>
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
  prior_corpus:     'border-l-teal-400',
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

  const hasProvenance = !!(piece.provenance?.blocks?.length)
  const [value, setValue] = useState(initial)
  const [viewMode, setViewMode] = useState(() => {
    if (!hasProvenance) return 'edit'
    try {
      const saved = localStorage.getItem('narraterx:readMode')
      if (saved === 'plain') return 'edit'
    } catch { /* private browsing */ }
    return 'attributed'
  })
  const taRef = useRef(null)
  const updateItem = useUpdateContentItem()

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
      {/* Voice-fidelity audit (PR 3) — blog only. The two-pass guard scores the
          draft against the transcript + voice profile and flags drift for human
          review. Renders nothing until the audit lands. */}
      {piece.platform === 'blog' && <VoiceFidelityBadge piece={piece} />}
      {/* Multi-piece extract proposal (PR 4) — blog only, non-blocking. Detects
          when the source interview holds enough distinct threads to justify a
          split into a linked series and offers it. Renders nothing unless the
          server recommends >=2 parts and the user hasn't dismissed it. */}
      {piece.platform === 'blog' && <SplitSuggestionBanner piece={piece} />}
      {/* View-mode toggle — always visible; Attributed only when provenance exists.
          Read-aloud (Phase 5 F#3 audio caller) sits on the right; uses this
          piece's staff_id so the voice clone is auto-resolved server-side. */}
      <div className="flex items-center gap-1">
        {([...(hasProvenance ? ['attributed'] : []), 'edit', 'assets']).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => {
              setViewMode(mode)
              try {
                localStorage.setItem('narraterx:readMode', mode === 'edit' ? 'plain' : mode)
              } catch { /* private browsing */ }
            }}
            className={`px-2 py-0.5 rounded text-xs transition-colors ${
              viewMode === mode
                ? 'bg-muted text-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {mode === 'edit' ? 'Plain Text' : mode === 'attributed' ? 'Attributed' : 'Assets'}
          </button>
        ))}
        <div className="ml-auto">
          <ReadAloudButton
            text={value}
            staffId={piece.staff_id}
            size="sm"
            variant="ghost"
            className="h-6 text-xs"
          />
        </div>
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
          {piece.platform === 'instagram' && <SlideEditor piece={piece} />}
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

// Pill-pair switcher for the blog-piece generation style. Lives above the
// ContentEditor so it reads as a primary affordance, not a hidden setting.
// Active pill = the style the draft is currently in (read from
// story.generation_style, default 'blog_post'). Clicking the inactive pill
// pops a confirm dialog and, on confirm, fires the regenerate mutation with
// the new style. Approval audit is wiped server-side (same path as length
// preset regen) so the freshly-styled draft requires fresh review.
//
// Rendered only for blog pieces (the only platform with two prompt
// styles); atoms (social, video, marketing) always derive from the blog
// editorial summary, so a style choice doesn't make sense there.
const GENERATION_STYLE_LABELS = {
  blog_post: 'Full blog post',
  minimal_edits: 'Cleaned transcript',
}
const GENERATION_STYLE_DESCRIPTIONS = {
  blog_post: 'A structured blog post rewritten from your interview — headlines, sections, links.',
  minimal_edits: 'Your exact words, cleaned of filler and broken into paragraphs. No restructuring.',
}

function GenerationStyleSwitcher({ piece, story }) {
  // Blog regen routes through the streamed pipeline (prepare → /api/stream →
  // finalize) to escape the 60–180s function-cap dance that Opus 4.7 + the
  // practice-memory block were pushing /regenerate past.
  const regenerate = useRegenerateBlogStreamed()
  const currentStyle = story?.generation_style || 'blog_post'
  const [pending, setPending] = useState(null) // 'blog_post' | 'minimal_edits' | null

  if (piece.platform !== 'blog') return null
  if (piece.series_id && piece.series_part !== 1) return null

  const handleSwitch = async (nextStyle) => {
    setPending(null)
    try {
      await regenerate.mutateAsync({ id: piece.id, generationStyle: nextStyle })
      toast.success(
        `Switched to ${GENERATION_STYLE_LABELS[nextStyle]}`,
        { description: 'Draft regenerated and reset for review.' },
      )
    } catch (e) {
      toast.error('Switch failed', { description: e.message })
    }
  }

  if (regenerate.isPending) {
    return (
      <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Regenerating in the new style — this can take 30–60 seconds…
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <div
        role="radiogroup"
        aria-label="Draft style"
        className="inline-flex rounded-lg border bg-muted/20 p-0.5"
      >
        {(['blog_post', 'minimal_edits']).map((style) => {
          const active = style === currentStyle
          return (
            <button
              key={style}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => { if (!active) setPending(style) }}
              disabled={active}
              className={`rounded-md px-3 py-1 text-xs transition ${
                active
                  ? 'bg-background text-foreground shadow-sm font-medium cursor-default'
                  : 'text-muted-foreground hover:text-foreground hover:bg-background/60'
              }`}
              title={GENERATION_STYLE_DESCRIPTIONS[style]}
            >
              {GENERATION_STYLE_LABELS[style]}
            </button>
          )
        })}
      </div>
      <p className="text-2xs text-muted-foreground italic">
        {GENERATION_STYLE_DESCRIPTIONS[currentStyle]}
      </p>

      {pending && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs space-y-2">
          <p className="text-amber-900">
            Switch to <span className="font-medium">{GENERATION_STYLE_LABELS[pending]}</span>?
            The current draft and approval state will be replaced with a fresh AI generation.
          </p>
          <p className="text-amber-800/80">
            {GENERATION_STYLE_DESCRIPTIONS[pending]}
          </p>
          <div className="flex gap-1.5 justify-end">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs border-amber-400 text-amber-700 hover:bg-amber-100"
              onClick={() => handleSwitch(pending)}
            >
              Switch &amp; regenerate
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => setPending(null)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function RegenerateButton({ piece, story }) {
  // Blog → streamed pipeline (no function-cap timeouts). Atoms stay on the
  // non-streaming /regenerate endpoint (Sonnet 4.6 @ 1500 tokens, well under
  // 60s). Hook choice is by platform; either hook exposes the same
  // mutateAsync({ id, lengthPreset?, generationStyle? }) shape.
  const isBlogPiece = piece.platform === 'blog'
  const blogRegen = useRegenerateBlogStreamed()
  const atomRegen = useRegenerateContentItem()
  const regenerate = isBlogPiece ? blogRegen : atomRegen
  const workspace = useWorkspace()
  const [confirming, setConfirming] = useState(false)

  // Length preset is only meaningful for blog (the only long-form piece with a
  // server-side regenerate prompt today). Seeded from the piece's persisted
  // preset, then the staff member's preferred default, then 'standard'.
  const isBlog = piece.platform === 'blog'
  const initialLengthPreset = resolveLengthPreset(
    piece.length_preset,
    story?.staff_preferred_length,
  )
  const [lengthPreset, setLengthPreset] = useState(initialLengthPreset)

  const handleRegenerate = async () => {
    setConfirming(false)
    try {
      await regenerate.mutateAsync({
        id: piece.id,
        ...(isBlog ? { lengthPreset } : {}),
      })
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
    // Voice notes: piece.staff_id implies the clinician has a profile.
    // We don't have voice_notes content on the piece, so this is a heuristic
    // signal ("a clinician profile is bound, which may carry voice notes").
    if (piece.staff_id || story?.staff_id) bullets.push('Voice notes')
    const echoCount = piece.provenance?.summary?.voice_phrase_echo_count ?? 0
    if (echoCount > 0) bullets.push(`${echoCount} exemplar${echoCount === 1 ? '' : 's'}`)
    if (story?.prototype_id && workspace) {
      const proto = getPatientPrototypesUi(workspace).find((p) => p.id === story.prototype_id)
      if (proto?.label) bullets.push(`'${proto.label}' prototype`)
    }
    if (story?.tone) bullets.push(`${story.tone} tone`)
    if (isBlog) {
      const preset = LENGTH_PRESETS.find((p) => p.id === lengthPreset)
      if (preset) bullets.push(`${preset.label} length`)
    }
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
      <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs space-y-2">
        <div className="flex items-start gap-2">
          <span className="text-amber-800">
            Replace this draft with a fresh AI generation? Current text and approval state will be lost.
            {piece.staff_name && (
              <span className="block mt-0.5 text-amber-700/80">
                Bernard will apply {piece.staff_name}&rsquo;s voice settings.
              </span>
            )}
          </span>
        </div>
        {isBlog && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-amber-200">
            <span className="text-amber-800 font-medium mr-1">Length:</span>
            {LENGTH_PRESETS.map((p) => {
              const selected = p.id === lengthPreset
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setLengthPreset(p.id)}
                  title={`${p.description} (${p.targetWords} words)`}
                  className={`rounded-full border px-2 py-0.5 text-xs transition ${
                    selected
                      ? 'border-amber-500 bg-amber-200 text-amber-900 font-medium'
                      : 'border-amber-300 bg-white text-amber-700 hover:bg-amber-100'
                  }`}
                >
                  {p.emoji} {p.label}
                </button>
              )
            })}
          </div>
        )}
        <div className="flex gap-1.5 justify-end">
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

// "Part X of Y" badge + quick-jump links to sibling parts. Rendered on any
// content_item that has series_id populated. Siblings are computed from the
// pieces array already in scope (no extra fetch — sibling parts are inserted
// against the same interview and arrive together).
function SeriesBadge({ active, pieces, onJump }) {
  // React Compiler memoizes this — no manual useMemo needed.
  const siblings = active?.series_id
    ? pieces
        .filter((p) => p.series_id === active.series_id)
        .sort((a, b) => (a.series_part || 0) - (b.series_part || 0))
    : []

  if (siblings.length === 0) return null
  const total = active.series_total || siblings.length

  return (
    <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-violet-100 text-violet-800">
      <Layers className="h-3.5 w-3.5" />
      <span className="text-xs font-medium">
        Part {active.series_part || '?'} of {total}
      </span>
      {siblings.length > 1 && (
        <span className="ml-1 flex items-center gap-0.5">
          {siblings.map((s) => {
            const isActive = s.id === active.id
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => !isActive && onJump(s.id)}
                disabled={isActive}
                title={isActive ? `You are on Part ${s.series_part}` : `Jump to Part ${s.series_part}`}
                className={`min-w-[1.25rem] rounded px-1 text-xs font-medium transition ${
                  isActive
                    ? 'bg-violet-300 text-violet-900 cursor-default'
                    : 'bg-white text-violet-700 hover:bg-violet-200 border border-violet-200'
                }`}
              >
                {s.series_part}
              </button>
            )
          })}
        </span>
      )}
    </div>
  )
}

// Split a long-interview blog into a 2- to 4-part series. Only rendered on
// blog pieces that are not already part of a series. On confirm, the server
// runs cluster + write passes; the original blog is archived and N new draft
// pieces appear under the same interview.
function SplitIntoSeriesButton({ piece }) {
  const split = useSplitBlogIntoSeries()
  const [, setSearchParams] = useSearchParams()
  const [confirming, setConfirming] = useState(false)
  const [parts, setParts] = useState(2)

  if (piece.platform !== 'blog') return null
  if (piece.series_id) return null

  const handleSplit = async () => {
    setConfirming(false)
    try {
      const result = await split.mutateAsync({ id: piece.id, parts })
      const n = result?.parts?.length ?? parts
      // The source piece (`piece.id`) is now archived; the URL's `?piece=`
      // param still points to it, so AssetsPane would either resolve to
      // -1 → 0 (jumps to whatever's at index 0) or stay on the stale id.
      // Navigate to the new Part 1 explicitly so the UI lands on a real piece.
      const part1 = result?.parts?.find?.((p) => p.series_part === 1)
      if (part1?.id) {
        setSearchParams((prev) => {
          const next = new URLSearchParams(prev)
          next.set('piece', part1.id)
          return next
        }, { replace: true })
      }
      toast.success(
        `Split into ${n}-part series`,
        { description: 'New drafts created. Original blog archived for rollback.' },
      )
    } catch (e) {
      toast.error('Series generation failed', {
        description: e?.message || 'Try again — the planner sometimes needs a second pass.',
      })
    }
  }

  if (split.isPending) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Planning + writing — this can take 1–3 minutes (one Opus pass to plan, one per part).
      </div>
    )
  }

  if (confirming) {
    return (
      <div className="rounded-md border border-violet-300 bg-violet-50 px-3 py-2 text-xs space-y-2">
        <div className="text-violet-900">
          <div className="font-medium mb-0.5">Split this blog into a series?</div>
          <div className="text-violet-800/80">
            The full interview will be re-planned and written as multiple linked posts, each focused on one thread. Your current blog will be archived (kept for rollback). Each new part is a fresh draft and needs review before publish.
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-violet-200">
          <span className="text-violet-900 font-medium mr-1">Parts:</span>
          {[2, 3, 4].map((n) => {
            const selected = n === parts
            return (
              <button
                key={n}
                type="button"
                onClick={() => setParts(n)}
                className={`rounded-full border px-2.5 py-0.5 text-xs transition ${
                  selected
                    ? 'border-violet-500 bg-violet-200 text-violet-900 font-medium'
                    : 'border-violet-300 bg-white text-violet-700 hover:bg-violet-100'
                }`}
              >
                {n} parts
              </button>
            )
          })}
          <span className="ml-auto text-2xs text-violet-700/70 italic">
            The planner may return fewer parts if there isn&rsquo;t enough material.
          </span>
        </div>
        <div className="flex gap-1.5 justify-end">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs border-violet-400 text-violet-700 hover:bg-violet-100"
            onClick={handleSplit}
          >
            Split into {parts} parts
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
    <Button
      size="sm"
      variant="outline"
      className="h-7 text-xs gap-1.5"
      onClick={() => setConfirming(true)}
    >
      <Layers className="h-3 w-3" />
      Split into series
    </Button>
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
          <SplitIntoSeriesButton piece={piece} />
          <div>
            <p className="mb-2 text-2xs font-medium uppercase tracking-wide text-muted-foreground">Preview</p>
            <PostPreview
              platform={piece.platform}
              content={typeof piece.content === 'string' ? piece.content : JSON.stringify(piece.content)}
              mediaUrls={Array.isArray(piece.media_urls) ? piece.media_urls : []}
              slides={Array.isArray(piece.slides) ? piece.slides : null}
              overlayText={piece.overlay_text || null}
              locationOverrides={piece.location_overrides || null}
            />
          </div>
        </div>
      )}
    </div>
  )
}

// Gather every scheduled content_item the React Query cache has seen, across
// all stories lists. Used by the approve action sheet to (a) feed the
// platform-aware suggestion engine so it skips slots within 2h of another
// post, and (b) soft-warn when the user picks a custom time near another
// scheduled post on the same platform. Free when Stories has already loaded.
function getCachedScheduledItems(qc) {
  const out = []
  const lists = qc.getQueriesData({ queryKey: queryKeys.stories.all })
  const seen = new Set()
  for (const [, data] of lists) {
    if (!Array.isArray(data)) continue
    for (const story of data) {
      for (const p of story?.pieces ?? []) {
        if (!p?.scheduled_at) continue
        if (seen.has(p.id)) continue
        seen.add(p.id)
        out.push({ id: p.id, platform: p.platform, scheduled_at: p.scheduled_at })
      }
    }
  }
  return out
}

function formatScheduledLabel(d) {
  if (!d) return ''
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

// Export action sheet — the DEFAULT path for any workspace/channel without a
// wired direct-publish integration (per the export-first model: everything
// exports; "Publish" is the upgrade that unlocks when an integration is
// connected). Offers copy + download affordances keyed off the channel's
// exportShape: markdown for blog, HTML for email, caption + image for social.
function ExportCard({ piece }) {
  const shape = exportShapeForPlatform(piece.platform)
  const body = typeof piece.content === 'string' ? piece.content : JSON.stringify(piece.content, null, 2)
  const imageUrl = Array.isArray(piece.media_urls) && piece.media_urls[0]?.url ? piece.media_urls[0].url : null

  const copy = async (text, label) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`${label} copied`)
    } catch {
      toast.error('Copy failed — select and copy manually')
    }
  }

  const copyLabel = shape === EXPORT_SHAPES.MARKDOWN ? 'Copy markdown'
    : shape === EXPORT_SHAPES.HTML_EMAIL ? 'Copy HTML'
    : 'Copy caption'

  return (
    <div className="rounded-lg border bg-muted/30 p-3 space-y-2.5">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Download className="h-3.5 w-3.5" />
        Export
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={() => copy(body, copyLabel.replace('Copy ', '').replace(/^\w/, (c) => c.toUpperCase()))}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Copy className="h-3.5 w-3.5 mr-1.5" />
          {copyLabel}
        </Button>
        {shape === EXPORT_SHAPES.SOCIAL_COMPOSE && imageUrl && (
          <Button asChild size="sm" variant="outline">
            <a href={imageUrl} download target="_blank" rel="noopener noreferrer">
              <Download className="h-3.5 w-3.5 mr-1.5" />
              Download image
            </a>
          </Button>
        )}
      </div>
      <p className="inline-flex items-start gap-1.5 text-xs text-muted-foreground">
        <Lock className="h-3 w-3 mt-0.5 shrink-0" />
        <span>
          Paste into your tool of choice. Direct publishing unlocks for this
          channel once an integration is connected.
        </span>
      </p>
    </div>
  )
}

// Action sheet shown on approved pieces. Replaces the old toggle-group +
// Publish button with a primary suggested-time CTA, an explainer caption,
// and inline alt actions (pick a time / publish now). Blog pieces collapse
// to a single "Publish to website" button since the WP path is synchronous.
//
// bufferUseQueue: when true (workspace.buffer_use_queue), the primary CTA
// flips to "Add to Buffer queue" — Buffer picks the next open slot from the
// channel's own posting schedule. The explainer + heuristic suggestion are
// hidden in this mode; "Pick a specific time" remains available as an alt.
//
// prefsOverride: workspace.schedule_prefs JSONB — replaces the global
// PLATFORM_SCHEDULE_PREFS for the explainer caption when present.
function WhenToPublishCard({
  piece, suggested, otherScheduled,
  bufferUseQueue, prefsOverride,
  onSchedule, onPublishToQueue, onPublishNow,
  onSendToBeehiiv, beehiivPublishing,
  publishing,
}) {
  const [mode, setMode] = useState('default') // 'default' | 'pick'
  const [customAt, setCustomAt] = useState(
    suggested ? toLocalDatetimeInput(suggested) : '',
  )

  const explainer = explainPlatformSlot(piece.platform, prefsOverride)
  const customDate = customAt ? new Date(customAt) : null
  const customConflict = customDate && !Number.isNaN(customDate.getTime())
    ? findScheduleConflict(piece.platform, customDate, otherScheduled)
    : null
  const customInPast = customDate && customDate.getTime() <= Date.now()

  // Blog: synchronous publish, no scheduling choice. Beehiiv is offered as an
  // optional secondary destination — it creates a draft and pops Beehiiv open
  // in a new tab for final review. Independent of the website publish, so a
  // tenant can do either, both, or neither.
  if (piece.platform === 'blog') {
    return (
      <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
        <div className="text-xs font-medium text-muted-foreground">Publish</div>
        <Button
          size="sm"
          onClick={onPublishNow}
          disabled={publishing || beehiivPublishing}
          loading={publishing}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {!publishing && <Send className="h-3.5 w-3.5 mr-1.5" />}
          Publish to Website
        </Button>
        <p className="text-xs text-muted-foreground">
          Publishes immediately — the website webhook can take 30–90s.
        </p>
        {onSendToBeehiiv && (
          <div className="pt-2 mt-1 border-t border-muted-foreground/10 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <button
              type="button"
              onClick={onSendToBeehiiv}
              disabled={publishing || beehiivPublishing}
              className="text-primary hover:underline disabled:opacity-50 disabled:no-underline"
            >
              {beehiivPublishing ? 'Sending to Beehiiv…' : 'Also send draft to Beehiiv'}
            </button>
            <span className="text-muted-foreground">
              Creates a draft — finish the send in Beehiiv.
            </span>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="rounded-lg border bg-muted/30 p-3 space-y-2.5">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Clock className="h-3.5 w-3.5" />
        When to publish
      </div>

      {mode === 'default' && (
        <>
          {bufferUseQueue ? (
            <>
              <Button
                size="sm"
                onClick={onPublishToQueue}
                disabled={publishing}
                loading={publishing}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {!publishing && <Calendar className="h-3.5 w-3.5 mr-1.5" />}
                Add to Buffer queue
              </Button>
              <p className="text-xs text-muted-foreground">
                Buffer will slot this into the next open spot on your channel&rsquo;s queue.
              </p>
            </>
          ) : suggested ? (
            <>
              <Button
                size="sm"
                onClick={() => onSchedule(suggested)}
                disabled={publishing}
                loading={publishing}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {!publishing && <Calendar className="h-3.5 w-3.5 mr-1.5" />}
                Schedule for {formatScheduledLabel(suggested)}
              </Button>
              {explainer && (
                <p className="text-xs text-muted-foreground">
                  {explainer}. Avoids slots within 2h of another scheduled post.
                </p>
              )}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              No open slot found in the next 60 days — pick a time below.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs pt-1">
            <button
              type="button"
              onClick={() => setMode('pick')}
              disabled={publishing}
              className="text-primary hover:underline"
            >
              {bufferUseQueue ? 'Pick a specific time' : 'Pick a different time'}
            </button>
            {!bufferUseQueue && (
              <>
                <span className="text-muted-foreground">•</span>
                <button
                  type="button"
                  onClick={onPublishToQueue}
                  disabled={publishing}
                  className="text-primary hover:underline"
                >
                  Add to Buffer queue
                </button>
              </>
            )}
            <span className="text-muted-foreground">•</span>
            <button
              type="button"
              onClick={onPublishNow}
              disabled={publishing}
              className="text-primary hover:underline"
            >
              Publish now
            </button>
          </div>
        </>
      )}

      {mode === 'pick' && (
        <div className="space-y-2">
          <Input
            type="datetime-local"
            value={customAt}
            onChange={(e) => setCustomAt(e.target.value)}
            min={toLocalDatetimeInput(new Date(Date.now() + 60_000))}
            className="h-8 text-sm w-fit"
          />
          {customConflict && (
            <div className="flex items-start gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                Another {PLATFORM_META[piece.platform]?.label || piece.platform} post is scheduled near this time
                {' — '}
                {formatScheduledLabel(new Date(customConflict.scheduled_at))}.
                You can still proceed.
              </span>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => {
                const d = new Date(customAt)
                if (!customAt || Number.isNaN(d.getTime())) {
                  toast.error('Pick a valid date and time')
                  return
                }
                if (d.getTime() <= Date.now()) {
                  toast.error('Pick a time in the future')
                  return
                }
                onSchedule(d)
              }}
              disabled={publishing || !customAt || customInPast}
              loading={publishing}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {!publishing && <Calendar className="h-3.5 w-3.5 mr-1.5" />}
              Schedule
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setMode('default')
                setCustomAt(suggested ? toLocalDatetimeInput(suggested) : '')
              }}
              disabled={publishing}
            >
              Cancel
            </Button>
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
  const updateItem = useUpdateContentItem()
  const addComment = useAddComment(piece.id)
  const qc = useQueryClient()
  const { data: allThemes = [] } = useCarouselThemes()

  const [changeRequestOpen, setChangeRequestOpen] = useState(false)
  const [changeRequestBody, setChangeRequestBody] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [beehiivPublishing, setBeehiivPublishing] = useState(false)

  // Cross-story scheduled items from the React Query cache. Free when Stories
  // has already loaded; falls back to empty when it hasn't (e.g. direct URL
  // into Story Detail), which is fine — the suggestion engine simply doesn't
  // know about other-platform posts and the conflict warner stays silent.
  const otherScheduled = useMemo(
    () => getCachedScheduledItems(qc).filter((it) => it.id !== piece.id),
    [qc, piece.id],
  )
  const prefsOverride = workspace?.schedule_prefs
  const suggested = useMemo(
    () => suggestScheduleTime(piece.platform, otherScheduled, undefined, prefsOverride),
    [piece.platform, otherScheduled, prefsOverride],
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

  // Undo approve. Drops the piece back to in_review (or draft if the workspace
  // skips the review step) and clears the approver audit trail so the next
  // approver writes a fresh stamp. Only valid while status='approved' — once
  // the piece is scheduled or published on Buffer, use Cancel/Delete instead.
  const handleUnapprove = async () => {
    try {
      await updateStatus.mutateAsync({
        id: piece.id,
        status: skipReview ? 'draft' : 'in_review',
        approvedBy: null,
        approvedAt: null,
      })
      toast.success('Unapproved', {
        description: skipReview
          ? 'Back to draft. Approve again when ready.'
          : 'Back to in review. Approve again when ready.',
      })
    } catch (err) {
      toast.error('Failed to unapprove', { description: err.message })
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

  // Unified publish path. Called from the action sheet with one of:
  //   { scheduledAt: Date } — schedule at specific time (customScheduled)
  //   { useQueue: true }    — add to Buffer's queue (shareNext)
  //   {}                    — publish immediately (shareNow)
  // Blog publishes ignore both args and go to the website webhook synchronously.
  const handlePublish = async ({ scheduledAt: scheduledDate, useQueue } = {}) => {
    const effectiveScheduledAt = scheduledDate ? scheduledDate.toISOString() : null
    const usingQueue = !!useQueue

    setPublishing(true)
    try {
      const markdown = typeof piece.content === 'string' ? piece.content : JSON.stringify(piece.content)
      if (piece.platform === 'blog') {
        const lines = markdown.split('\n')
        const titleLine = lines.find((l) => /^#\s/.test(l))
        const title = titleLine ? titleLine.replace(/^#+\s+/, '').trim() : (piece.topic || 'Blog Post')
        // Cap slug at ~60 chars on a hyphen boundary so URLs stay readable.
        // Falls back to a hard cut if the title is one very long word.
        const SLUG_MAX = 60
        const rawSlug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
        let slug = rawSlug
        if (rawSlug.length > SLUG_MAX) {
          const truncated = rawSlug.slice(0, SLUG_MAX)
          const lastHyphen = truncated.lastIndexOf('-')
          slug = (lastHyphen > SLUG_MAX / 2 ? truncated.slice(0, lastHyphen) : truncated).replace(/-+$/, '')
        }
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
        if (piece.staff_name) payload.author = piece.staff_name
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
        const scheduling = !!effectiveScheduledAt || usingQueue

        // Carousel pieces with per-slide on-screen text must publish the BAKED
        // slide images (photo + text), not the raw photos. SlideEditor renders
        // these eagerly on save; this is the fallback for slides saved before
        // that (or edited without re-saving) so the overlay always ships.
        let mediaUrls = piece.media_urls || []
        if (Array.isArray(piece.slides) && piece.slides.length) {
          const customThemes = allThemes.filter((t) => t.custom)
          const theme = resolveTheme(piece.carousel_theme_id || null, customThemes)
          const { slides: renderedSlides, publishMediaUrls, changed } = await runWithToast(
            ensureRenderedSlides({
              slides:    piece.slides,
              mediaUrls: piece.media_urls,
              brandStyle: workspace?.brand_style || {},
              theme,
              themeId:   piece.carousel_theme_id || null,
              pieceId:   piece.id,
            }),
            {
              loading: 'Rendering on-screen text…',
              success: 'On-screen text rendered',
              error: (e) => ({ message: 'Could not render slide text', description: e.message }),
            },
          )
          if (publishMediaUrls.length) mediaUrls = publishMediaUrls
          // Persist freshly-baked URLs so the next publish reuses them.
          if (changed) {
            try {
              await updateItem.mutateAsync({ id: piece.id, patch: { slides: renderedSlides } })
            } catch { /* non-fatal: publish proceeds with the rendered URLs in hand */ }
          }
        }

        const result = await runWithToast(
          publishAndTrack(
            {
              id: piece.id,
              platform: piece.platform,
              content: markdown,
              mediaUrls,
              scheduledAt: effectiveScheduledAt,
              useQueue: usingQueue,
            },
            userEmail,
          ),
          {
            loading: usingQueue ? 'Adding to Buffer queue…'
              : effectiveScheduledAt ? 'Scheduling on Buffer…'
              : 'Sending to Buffer…',
            success: usingQueue ? 'Added to Buffer queue'
              : effectiveScheduledAt ? 'Scheduled on Buffer'
              : 'Sent to Buffer',
            error: (e) => ({ message: 'Publish failed', description: e.message }),
          },
        )
        // publishAndTrack already set status + publishedAt; this pass writes the
        // approver audit trail and (for scheduled posts) persists the chosen
        // scheduled_at on the row so the calendar/header reflect the new time.
        // In queue mode, Buffer returns the assigned dueAt — use that.
        const queueDueAt = result?.buffer?.scheduledAt || null
        await updateStatus.mutateAsync({
          id: piece.id,
          status: scheduling ? 'scheduled' : 'published',
          approvedBy: userEmail,
          approvedAt: new Date().toISOString(),
          publishedAt: scheduling ? null : new Date().toISOString(),
          scheduledAt: scheduling ? (effectiveScheduledAt || queueDueAt) : null,
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

  // Send the blog draft to Beehiiv as a draft post. Independent of the
  // website-publish path — a blog can go to the website, Beehiiv, both, or
  // neither. Does NOT advance piece.status; Beehiiv is a secondary destination
  // and the tenant finishes the send inside Beehiiv's UI (audience picker,
  // scheduling, thumbnail review).
  const handleSendToBeehiiv = async () => {
    if (piece.platform !== 'blog') return
    setBeehiivPublishing(true)
    try {
      const markdown = typeof piece.content === 'string' ? piece.content : JSON.stringify(piece.content)
      const lines = markdown.split('\n')
      const titleLine = lines.find((l) => /^#\s/.test(l))
      const title = titleLine ? titleLine.replace(/^#+\s+/, '').trim() : (piece.topic || 'Blog Post')
      const descLine = lines.find((l) => l.trim() && !/^#/.test(l) && !/^!\[/.test(l))
      const description = descLine?.trim().slice(0, 200) || title
      // Slug isn't required by Beehiiv (it assigns its own) but we echo it so
      // logs correlate; mirrors the slug derivation in handlePublish.
      const SLUG_MAX = 60
      const rawSlug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      let slug = rawSlug
      if (rawSlug.length > SLUG_MAX) {
        const truncated = rawSlug.slice(0, SLUG_MAX)
        const lastHyphen = truncated.lastIndexOf('-')
        slug = (lastHyphen > SLUG_MAX / 2 ? truncated.slice(0, lastHyphen) : truncated).replace(/-+$/, '')
      }
      const heroImage = Array.isArray(piece.media_urls) && piece.media_urls[0]?.url
        ? piece.media_urls[0].url
        : undefined
      const payload = { title, description, markdown, slug }
      if (heroImage) payload.heroImage = heroImage
      const result = await runWithToast(sendBlogToBeehiiv(payload), {
        loading: 'Sending draft to Beehiiv…',
        success: (r) => ({
          message: 'Draft in Beehiiv',
          description: r.postUrl ? 'Open Beehiiv to add thumbnail, set audience, and schedule.' : 'Draft created — finish in Beehiiv.',
        }),
        error: (e) => ({
          message: e.code === 'not_configured' ? 'Beehiiv not connected' : 'Beehiiv send failed',
          description: e.code === 'not_configured'
            ? 'Add a Beehiiv API key in Settings → Integrations.'
            : e.message,
        }),
      })
      if (result?.postUrl && typeof window !== 'undefined') {
        // Open Beehiiv in a new tab so the user lands directly in the
        // post editor for final review. Most tenants want this — they came
        // here to send a newsletter, not stop at "draft saved."
        window.open(result.postUrl, '_blank', 'noopener')
      }
    } catch {
      // runWithToast already surfaced the error toast.
    } finally {
      setBeehiivPublishing(false)
    }
  }

  // Cancel a scheduled Buffer post. Calls Buffer's deletePost mutation, then
  // resets the row to status='approved' with scheduled_at + buffer_update_id
  // cleared so the reviewer can pick a different time or unapprove. NOT for
  // already-published pieces (Buffer's API can't unpublish, only delete
  // metadata; the post stays live on the platform).
  const handleCancelScheduled = async () => {
    if (!piece.buffer_update_id) {
      toast.error('Cannot cancel — no Buffer post ID on file')
      return
    }
    setPublishing(true)
    try {
      await runWithToast(cancelBufferPost(piece.buffer_update_id), {
        loading: 'Cancelling on Buffer…',
        success: 'Cancelled — back to Approved',
        error: (e) => ({ message: 'Cancel failed', description: e.message }),
      })
      await updateStatus.mutateAsync({
        id: piece.id,
        status: 'approved',
        scheduledAt: null,
        bufferUpdateId: null,
        publishedAt: null,
      })
      qc.invalidateQueries({ queryKey: queryKeys.stories.detail(piece.interview_id) })
    } catch {
      // runWithToast surfaced the error; keep status='scheduled' so the user
      // can retry rather than having Buffer + our DB drift apart.
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

  // Approver display: StaffChip when we have a name, plain email fallback
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
          {(provSummary.prior_corpus_pct ?? 0) > 0 && (
            <span className="inline-flex items-center rounded-full bg-teal-50 border border-teal-200 px-2 py-0.5 text-xs text-teal-700">
              {provSummary.prior_corpus_pct}% drew on your prior work
            </span>
          )}
          {echoCount > 0 && (
            <span className="inline-flex items-center rounded-full bg-indigo-50 border border-indigo-200 px-2 py-0.5 text-xs text-indigo-700">
              {echoCount} phrase{echoCount === 1 ? '' : 's'} echo prior work
            </span>
          )}
          {provSummary.synthesis_pct > 40 && (
            <span className="inline-flex items-center rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-xs text-amber-700">
              {provSummary.synthesis_pct}% model-invented — read closely
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
            {piece.approved_by_staff_id
              ? <StaffChip name={approverName} id={piece.approved_by_staff_id} size="sm" showName />
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

      {/* When-to-publish action sheet — shown on approved pieces. The reviewer
          can accept the suggested time (one click), pick a custom time, or
          publish immediately. Blog pieces collapse to a single Publish button
          since the website webhook is synchronous. */}
      {piece.status === 'approved' && canReview && (
        canDirectPublishPlatform(workspace, piece.platform, workspace?.connected_publish_services) ? (
          <WhenToPublishCard
            piece={piece}
            suggested={suggested}
            otherScheduled={otherScheduled}
            bufferUseQueue={!!workspace?.buffer_use_queue && piece.platform !== 'blog'}
            prefsOverride={prefsOverride}
            onSchedule={(d) => handlePublish({ scheduledAt: d })}
            onPublishToQueue={() => handlePublish({ useQueue: true })}
            onPublishNow={() => handlePublish({})}
            onSendToBeehiiv={piece.platform === 'blog' ? handleSendToBeehiiv : undefined}
            beehiivPublishing={beehiivPublishing}
            publishing={publishing}
          />
        ) : (
          // Default path — no wired integration for this channel. Export-first.
          <ExportCard piece={piece} />
        )
      )}

      {/* Scheduled state — shows the scheduled time + Cancel button so the
          reviewer can pull the post out of Buffer's queue and pick a different
          time (or unapprove). Only valid for Buffer-dispatched platforms; blog
          publishes don't go through this state. */}
      {piece.status === 'scheduled' && canReview && piece.platform !== 'blog' && (
        <div className="rounded-lg border bg-purple-50/40 p-3 space-y-2.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-purple-700">
            <Calendar className="h-3.5 w-3.5" />
            Scheduled on Buffer
          </div>
          {piece.scheduled_at && (
            <p className="text-sm font-medium text-foreground">
              {new Date(piece.scheduled_at).toLocaleString(undefined, {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleCancelScheduled}
              disabled={publishing || !piece.buffer_update_id}
              loading={publishing}
              className="border-amber-300 text-amber-700 hover:bg-amber-50"
            >
              {!publishing && <XCircle className="h-3.5 w-3.5 mr-1.5" />}
              Cancel scheduled post
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Removes the post from Buffer&rsquo;s queue and returns this piece to Approved so you can pick a new time or unapprove.
          </p>
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

        {/* Unapprove — reviewer only, while still on approved (pre-Buffer). Once
            the piece is scheduled or published the post lives on Buffer and the
            undo path is Cancel scheduled / Delete published, not Unapprove. */}
        {piece.status === 'approved' && canReview && (
          <Button
            size="sm"
            variant="outline"
            onClick={handleUnapprove}
            disabled={isBusy}
            loading={isBusy && updateStatus.isPending}
            className="border-amber-300 text-amber-700 hover:bg-amber-50"
          >
            {!(isBusy && updateStatus.isPending) && <RotateCcw className="h-3.5 w-3.5 mr-1.5" />}
            Unapprove
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

        {/* Published state — no further action available */}
        {piece.status === 'published' && (
          <div className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <Button
              size="sm"
              variant="outline"
              disabled
              className="border-green-300 bg-green-50 text-green-700 cursor-default opacity-100"
            >
              <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
              {piece.platform === 'blog' ? 'Published to Website' : 'Published to Buffer'}
            </Button>
            {piece.published_at && (
              <span className="text-xs text-muted-foreground">
                {new Date(piece.published_at).toLocaleString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  year: new Date(piece.published_at).getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </span>
            )}
          </div>
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
export default function AssetsPane({
  story,
  onProvenanceHighlight,
  className = '',
  view: viewProp,
  onViewChange,
}) {
  const workspace = useWorkspace()
  // Sort so series parts appear in series_part order within their series.
  // The content API returns rows by created_at.desc, which doesn't match
  // series_part ordering, so without this the tabs would render as e.g.
  // [Part 2, Part 1, Part 3] while the SeriesBadge below shows the true part.
  // Also filter to only channels active in this story's plan (selected_outputs
  // overrides workspace enabled_outputs; fall back to showing all if unknown).
  const pieces = useMemo(() => {
    const base = story?.pieces ?? []
    const activeChannels = story?.selected_outputs ?? workspace?.enabled_outputs ?? null
    const filtered = activeChannels
      ? base.filter((p) => activeChannels.includes(p.platform))
      : base
    return [...filtered].sort((a, b) => {
      if (a.series_id && a.series_id === b.series_id) {
        return (a.series_part || 0) - (b.series_part || 0)
      }
      return 0
    })
  }, [story?.pieces, story?.selected_outputs, workspace?.enabled_outputs])
  const [searchParams, setSearchParams] = useSearchParams()
  const pieceParam = searchParams.get('piece')
  const initialIdx = pieceParam
    ? Math.max(0, pieces.findIndex((p) => p.id === pieceParam))
    : 0
  const [activeIdx, setActiveIdx] = useState(initialIdx)
  // Controlled-or-uncontrolled `view` — StoryDetail passes it in so its
  // outer layout (transcript pane vs. transcript rail) can react to mode
  // changes. Falls back to internal state if a parent doesn't control it.
  const [viewInternal, setViewInternal] = useState(pieceParam ? 'edit' : 'plan')
  const view = viewProp ?? viewInternal
  const setView = (next) => {
    if (onViewChange) onViewChange(next)
    if (viewProp === undefined) setViewInternal(next)
  }

  // If the ?piece=<id> param resolves after pieces load (async story fetch),
  // sync the active tab once the matching piece appears.
  useEffect(() => {
    if (!pieceParam) return
    const idx = pieces.findIndex((p) => p.id === pieceParam)
    if (idx >= 0 && idx !== activeIdx) {
      setActiveIdx(idx)
      setView('edit')
    }
    // setView is stable enough for our needs; including it would require
    // useCallback and adds noise without changing behavior.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      <div className={`rounded-xl border bg-card p-4 space-y-4 ${className}`}>
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
      <div className={`rounded-xl border bg-card p-4 space-y-3 ${className}`}>
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
    <div className={`rounded-xl border bg-card overflow-hidden ${className}`}>
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
            // For series pieces, label with the canonical series_part/series_total
            // so the tab number matches the SeriesBadge in the active panel.
            const seriesLabel = piece.series_id && piece.series_part && (piece.series_total || total)
              ? `${meta.label} ${piece.series_part}/${piece.series_total || total}`
              : null
            const label = seriesLabel
              || (total > 1 ? `${meta.label} ${nth}/${total}` : meta.label)
            const statusDot = getStatusDot(piece.status)
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
          {active?.series_id && (
            <SeriesBadge active={active} pieces={pieces} onJump={handleSelectPiece} />
          )}
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
            {/* Generation-style switcher for blog pieces. The choice lives on
                interview.generation_style and applies to the blog editorial
                summary. Atoms (social, video, marketing) always derive from
                that summary so they pick up the new style on next regen. */}
            <GenerationStyleSwitcher piece={active} story={story} />

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

            {/* V5 engagement loop: human "this worked" signal on published pieces.
                Feeds the Slate's Coverage winners + proven-topic resurfacing. */}
            {active.status === 'published' && <WinnerToggle piece={active} />}

            <ApprovalPanel piece={active} />
          </div>
        )}
      </div>
    </div>
  )
}

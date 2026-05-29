import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom'
import { useUser } from '@clerk/react'
import { AlertCircle, ArrowLeft, ChevronDown, Link as LinkIcon, Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { useStory, useUpdateInterview, useDeleteInterview } from '@/lib/queries'
import { apiFetch } from '@/lib/api'
import { toast } from '@/lib/toast'
import { getStageToken } from '@/lib/stageTokens'
import TranscriptPane from '@/components/story-detail/TranscriptPane'
import TranscriptRail from '@/components/story-detail/TranscriptRail'
import TranscriptDrawer from '@/components/story-detail/TranscriptDrawer'
import AssetsPane from '@/components/story-detail/AssetsPane'
import TranscriptExport from '@/components/story-detail/TranscriptExport'
import LoadingState from '@/components/LoadingState'
import ErrorState from '@/components/ErrorState'
import { ClinicianChip } from '@/components/ClinicianChip'
import ReferencesPanel from '@/components/ReferencesPanel'
import ExcludeFromBookToggle from '@/components/book/ExcludeFromBookToggle'
import { useWorkspace } from '@/lib/WorkspaceContext'
import {
  defaultAudienceSlots,
  defaultStoryTypeSlots,
} from '@/lib/interviewOptionsCatalog'
import { getCleanupLevel } from '@/lib/cleanupLevels'

/**
 * Inline-edit pill for the story header — renders as the existing muted
 * badge but is actually a styled native <select>. Click anywhere on the pill
 * to open the OS-native dropdown (keeps keyboard + mobile UX free).
 *
 * Showing it even when value is null gives clinicians a way to backfill
 * audience / story_type on interviews that pre-date these fields, which
 * directly improves voice-attribution scores on regeneration.
 */
function EditablePill({ value, options, placeholder, onChange, disabled }) {
  const selected = options.find((o) => o.key === value) || null
  return (
    <label
      className={`relative inline-flex items-center gap-1 text-xs rounded-full transition-colors ${
        selected
          ? 'text-muted-foreground bg-muted/60 hover:bg-muted active:bg-muted px-2 py-1.5'
          // Unset state — call-to-action styling: dashed primary border,
          // primary-tinted text, "+" affordance. Reads as an action chip,
          // not a passive label, so clinicians notice missing metadata.
          : 'text-primary bg-primary/5 border border-dashed border-primary/40 hover:bg-primary/10 hover:border-primary/60 active:bg-primary/10 font-medium px-2 py-1.5'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      {selected ? (
        <>
          <span className="text-2xs">{selected.emoji}</span>
          <span>{selected.label}</span>
          <ChevronDown className="h-3 w-3 opacity-50" />
        </>
      ) : (
        <>
          <Plus className="h-3 w-3" aria-hidden="true" />
          <span>{placeholder}</span>
        </>
      )}
      <select
        value={value || ''}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={disabled}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
        aria-label={placeholder}
      >
        <option value="">— Unset —</option>
        {options.map((o) => (
          <option key={o.key} value={o.key}>
            {o.emoji ? `${o.emoji} ` : ''}{o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function EditableTitle({ value, canEdit, disabled, onSave }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => { if (!editing) setDraft(value) }, [value, editing])
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  const accent = (
    <span
      className="inline-block w-1 h-6 rounded-full shrink-0 mr-2.5"
      style={{ background: 'hsl(var(--primary))' }}
      aria-hidden="true"
    />
  )

  async function commit() {
    const next = draft.trim()
    if (!next || next === value) {
      setEditing(false)
      setDraft(value)
      return
    }
    try {
      setSaving(true)
      await onSave(next)
      setEditing(false)
    } catch (err) {
      toast.error(err?.message || 'Could not update title')
      setDraft(value)
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <h1 className="text-2xl font-bold tracking-tight text-foreground leading-snug flex items-center min-w-0">
        {accent}
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit() }
            else if (e.key === 'Escape') { e.preventDefault(); setDraft(value); setEditing(false) }
          }}
          disabled={saving || disabled}
          maxLength={300}
          className="flex-1 min-w-0 bg-transparent border-b border-primary/60 focus:outline-none focus:border-primary text-2xl font-bold tracking-tight"
          aria-label="Story title"
        />
      </h1>
    )
  }

  return (
    <h1 className="group text-2xl font-bold tracking-tight text-foreground leading-snug flex items-center min-w-0">
      {accent}
      <span className="truncate">{value || 'Untitled interview'}</span>
      {canEdit && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="ml-2 inline-flex items-center justify-center h-7 w-7 rounded-full text-muted-foreground opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-foreground hover:bg-muted/60 transition"
          title="Edit title"
          aria-label="Edit title"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      )}
    </h1>
  )
}

/**
 * StoryDetail — consolidated view for a single story (interview + pieces).
 *
 * Layout responds to the Plan/Edit toggle (lifted from AssetsPane so the
 * layout itself can react to mode changes):
 *
 *   Plan mode  → two-column grid (TranscriptPane | AssetsPane)
 *                The transcript is fully visible because planning means
 *                deciding what gets routed where.
 *
 *   Edit mode  → 44px transcript rail + wide AssetsPane
 *                The transcript collapses to a clickable rail; clicking it
 *                opens TranscriptDrawer as a slide-over for spot lookups
 *                and "select text → route to a content format" actions.
 *
 * Accessed via /stories/:storyId where storyId is the interview UUID.
 */
export default function StoryDetail() {
  const { storyId } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { data: story, isLoading, isError, isPlaceholderData } = useStory(storyId)

  // Provenance highlight — lifted here so TranscriptPane and AssetsPane can
  // share it. AssetsPane fires setProvenanceHighlight when the user clicks a
  // paragraph attribution row; TranscriptPane reacts by scrolling + highlighting
  // the corresponding user message.
  const [provenanceHighlight, setProvenanceHighlight] = useState(null)
  const [refsOpen, setRefsOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  // Lifted from AssetsPane. Initial value mirrors AssetsPane's previous logic
  // — if the URL deep-links into a specific piece (?piece=<id>) we land in
  // Edit mode so the user doesn't see a planning surface they have to click
  // past to reach the piece they were sent to.
  const [view, setView] = useState(searchParams.get('piece') ? 'edit' : 'plan')
  // Edit-mode slide-over for the transcript. Closes automatically when we
  // flip back to Plan mode (the expanded pane takes over).
  const [transcriptDrawerOpen, setTranscriptDrawerOpen] = useState(false)
  useEffect(() => {
    if (view !== 'edit') setTranscriptDrawerOpen(false)
  }, [view])
  const { workspace } = useWorkspace()
  const { user } = useUser()
  const updateInterview = useUpdateInterview()
  const deleteInterview = useDeleteInterview()

  async function handleDelete() {
    if (!story?.id || !user?.id) return
    setDeleteError('')
    try {
      await deleteInterview.mutateAsync({ id: story.id })
      toast.success('Interview deleted')
      navigate('/stories')
    } catch (e) {
      // The DELETE handler returns 409 if the interview has published content
      // items — surface that inline so the user understands why.
      setDeleteError(e?.message || 'Delete failed')
    }
  }

  // Fallback: if the URL param is actually a content_item id (legacy bookmark
  // or stale link from /review/:itemId redirect), resolve it to its parent
  // interview and redirect. Keeps "Story not found" reserved for genuinely
  // missing rows.
  const notFound = !isLoading && (isError || !story)
  useEffect(() => {
    if (!notFound || !storyId) return
    let cancelled = false
    apiFetch(`/api/db/content?id=${encodeURIComponent(storyId)}`)
      .then((row) => {
        if (cancelled) return
        if (row?.interview_id) navigate(`/stories/${row.interview_id}`, { replace: true })
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [notFound, storyId, navigate])

  if (isLoading) return <LoadingState />

  if (isError || !story) {
    return (
      <div className="py-6 space-y-4">
        <Link
          to="/stories"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Stories
        </Link>
        <ErrorState message="Story not found." />
      </div>
    )
  }

  const stage = story.story_stage || 'drafting'
  const stageMeta = getStageToken(stage)

  return (
    <div className="space-y-5 py-6">
      {/* Header */}
      <div className="space-y-2">
        <Link
          to="/stories"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Stories
        </Link>

        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <EditableTitle
                value={story.topic || ''}
                canEdit={user?.id === story.owner_id}
                disabled={updateInterview.isPending}
                onSave={(next) => updateInterview.mutateAsync({ id: story.id, patch: { topic: next } })}
              />
              <Badge className={`text-xs border-0 shrink-0 ${stageMeta.badge}`}>
                {stageMeta.label}
              </Badge>
            </div>
            {story.clinician_name && (
              story.clinician_id ? (
                <Link
                  to={`/clinician/${story.clinician_id}`}
                  className="inline-flex text-muted-foreground hover:text-foreground"
                >
                  <ClinicianChip
                    id={story.clinician_id}
                    name={story.clinician_name}
                    size="md"
                    showName
                    nameClassName="text-sm"
                  />
                </Link>
              ) : (
                <ClinicianChip
                  id={story.clinician_id}
                  name={story.clinician_name}
                  size="md"
                  showName
                  nameClassName="text-sm text-muted-foreground"
                />
              )
            )}
            {(() => {
              // Fall back to default catalogs when the workspace hasn't
              // configured custom slot lists (memory: slot picker catalog
              // fallback — never silently hide pickers when config is empty).
              const audienceOptions = (workspace?.audience_options?.length ? workspace.audience_options : defaultAudienceSlots())
              const storyTypeOptions = (workspace?.story_type_options?.length ? workspace.story_type_options : defaultStoryTypeSlots())
              const cleanupSlot = story.cleanup_level ? getCleanupLevel(story.cleanup_level) : null
              // Defense: resolveAudienceSlot / resolveStoryTypeSlot return null
              // for unknown keys, but our editable pill uses the option array
              // directly so a key not present in options just shows as "Add audience".
              return (
                <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                  <EditablePill
                    value={story.audience || null}
                    options={audienceOptions}
                    placeholder="Add audience"
                    disabled={updateInterview.isPending || !user?.id}
                    onChange={(next) =>
                      updateInterview.mutate({
                        id: story.id,
                        patch: { audience: next },
                      })
                    }
                  />
                  <EditablePill
                    value={story.story_type || null}
                    options={storyTypeOptions}
                    placeholder="Add story type"
                    disabled={updateInterview.isPending || !user?.id}
                    onChange={(next) =>
                      updateInterview.mutate({
                        id: story.id,
                        patch: { storyType: next },
                      })
                    }
                  />
                  {cleanupSlot && (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground bg-muted/60 rounded-full px-2 py-0.5">
                      <span className="text-2xs">{cleanupSlot.emoji}</span>
                      <span>{cleanupSlot.label}</span>
                    </span>
                  )}
                </div>
              )
            })()}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <ExcludeFromBookToggle sourceTable="interviews" sourceId={story.id} variant="header" />
            <TranscriptExport story={story} />
            {user?.id === story.owner_id && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setDeleteError(''); setDeleteOpen(true) }}
                className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 h-8 px-2"
                title="Delete interview"
                aria-label="Delete interview"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* "What you covered" recap — generated at interview wrap-up and persisted
          on outputs.coveredSummary. Reappears here so the clinician sees the
          mirror of what they said alongside the resulting content. */}
      {story?.outputs?.coveredSummary && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 px-4 py-3">
          <p className="text-2xs font-bold uppercase tracking-widest text-emerald-700 mb-1.5">
            What you covered
          </p>
          <div className="text-sm text-emerald-900/90 leading-relaxed whitespace-pre-line">
            {story.outputs.coveredSummary}
          </div>
        </div>
      )}

      {/* References — collapsible. External articles attached to this
          interview (either added post-interview, or carried over from the
          originating topic). */}
      <div className="rounded-lg border bg-card">
        <button
          type="button"
          onClick={() => setRefsOpen((o) => !o)}
          className="w-full flex items-center justify-between gap-2 px-4 py-2.5 text-sm font-medium hover:bg-muted/40"
        >
          <span className="inline-flex items-center gap-2">
            <LinkIcon className="h-3.5 w-3.5 text-muted-foreground" />
            References
          </span>
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${refsOpen ? 'rotate-180' : ''}`} />
        </button>
        {refsOpen && (
          <div className="px-4 pb-4 pt-1 border-t">
            <ReferencesPanel interviewId={story.id} />
          </div>
        )}
      </div>

      {/* Body — layout responds to Plan vs Edit (see component-level docs).
          On mobile, AssetsPane renders first regardless of mode so a
          clinician on a phone doesn't have to scroll past the transcript to
          reach the action surface. The rail collapse only happens on md+
          where there's a meaningful horizontal split to be had. */}
      <div
        className={`grid gap-5 items-start grid-cols-1 ${
          view === 'edit'
            ? 'md:[grid-template-columns:44px_minmax(0,1fr)]'
            : 'md:grid-cols-2'
        }`}
      >
        {view === 'edit' ? (
          // Hidden on mobile — the rail only earns its keep on md+; on
          // phones the user already scrolls past the transcript and the
          // drawer would just duplicate the expanded pane below.
          <div className="hidden md:block">
            <TranscriptRail onClick={() => setTranscriptDrawerOpen(true)} />
          </div>
        ) : (
          <TranscriptPane
            story={story}
            isLoadingTranscript={isPlaceholderData}
            provenanceHighlight={provenanceHighlight}
          />
        )}
        <AssetsPane
          story={story}
          onProvenanceHighlight={setProvenanceHighlight}
          view={view}
          onViewChange={setView}
          className="order-first md:order-none"
        />
      </div>

      {/* Slide-over transcript for Edit mode. Mounted unconditionally so the
          open/close transition animates both directions; the Radix Dialog
          underneath only renders into the portal while `open`. */}
      <TranscriptDrawer
        story={story}
        open={transcriptDrawerOpen}
        onOpenChange={setTranscriptDrawerOpen}
      />

      {/* Delete confirmation — only reachable for the interview's owner (the
          trash button is hidden otherwise). The DELETE handler enforces the
          same check server-side; the 409 path here surfaces published-content
          conflicts inline so the user knows why the delete was refused. */}
      <Dialog open={deleteOpen} onOpenChange={(o) => { if (!o) { setDeleteOpen(false); setDeleteError('') } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete interview?</DialogTitle>
            <DialogDescription>
              This will permanently delete this interview and all generated content. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {deleteError && (
            <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2 mx-1">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />{deleteError}
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setDeleteOpen(false); setDeleteError('') }}
              disabled={deleteInterview.isPending}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteInterview.isPending}>
              {deleteInterview.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

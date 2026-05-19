import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useUser } from '@clerk/clerk-react'
import { AlertCircle, ArrowLeft, ChevronDown, Link as LinkIcon, Loader2, Plus, Trash2 } from 'lucide-react'
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
import AssetsPane from '@/components/story-detail/AssetsPane'
import TranscriptExport from '@/components/story-detail/TranscriptExport'
import LoadingState from '@/components/LoadingState'
import ErrorState from '@/components/ErrorState'
import { ClinicianChip } from '@/components/ClinicianChip'
import ReferencesPanel from '@/components/ReferencesPanel'
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

/**
 * StoryDetail — consolidated view for a single story (interview + pieces).
 *
 * Two-column layout on md+:
 *   Left  — TranscriptPane: interview transcript
 *   Right — AssetsPane: tabbed content pieces
 *
 * Accessed via /stories/:storyId where storyId is the interview UUID.
 */
export default function StoryDetail() {
  const { storyId } = useParams()
  const navigate = useNavigate()
  const { data: story, isLoading, isError, isPlaceholderData } = useStory(storyId)

  // Provenance highlight — lifted here so TranscriptPane and AssetsPane can
  // share it. AssetsPane fires setProvenanceHighlight when the user clicks a
  // paragraph attribution row; TranscriptPane reacts by scrolling + highlighting
  // the corresponding user message.
  const [provenanceHighlight, setProvenanceHighlight] = useState(null)
  const [refsOpen, setRefsOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const { workspace } = useWorkspace()
  const { user } = useUser()
  const updateInterview = useUpdateInterview()
  const deleteInterview = useDeleteInterview()

  async function handleDelete() {
    if (!story?.id || !user?.id) return
    setDeleteError('')
    try {
      await deleteInterview.mutateAsync({ id: story.id, userId: user.id })
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
      <div className="p-6 space-y-4">
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
    <div className="space-y-5 p-6">
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
              <h1 className="text-xl font-semibold text-foreground leading-snug">
                {story.topic || 'Untitled interview'}
              </h1>
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
                        userId: user?.id,
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
                        userId: user?.id,
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

      {/* Two-column body */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-start">
        <TranscriptPane story={story} isLoadingTranscript={isPlaceholderData} provenanceHighlight={provenanceHighlight} />
        <AssetsPane story={story} onProvenanceHighlight={setProvenanceHighlight} />
      </div>

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

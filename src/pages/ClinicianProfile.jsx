import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useUser } from '@clerk/clerk-react'
import {
  ArrowLeft, Plus, FileText, Clock, Trash2, ChevronRight, MessageSquare, Loader2, AlertCircle,
  Facebook, Instagram, Globe, Mail, BookOpen, TrendingUp, Flame, BarChart2, Star,
} from 'lucide-react'
import LoadingState from '@/components/LoadingState'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { ClinicianChip } from '@/components/ClinicianChip'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import {
  useClinician, useDeleteClinician, useDeleteInterview,
  useClinicianRecipes, usePatchClinicianRecipe, useDeleteClinicianRecipe,
} from '@/lib/queries'
import { resolveAudienceSlot, resolveStoryTypeSlot } from '@/lib/interviewOptionsCatalog'
import { getCleanupLevel } from '@/lib/cleanupLevels'
import VoiceNotesPanel from '@/components/VoiceNotesPanel'
import VoiceFreshnessCard from '@/components/VoiceFreshnessCard'
import { formatDate, formatRelativeDate } from '@/lib/utils'
import { toast } from '@/lib/toast'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { useUserRole } from '@/lib/useUserRole'
import { fetchClinicianArc } from '@/lib/api'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { TONES, getVoiceModes } from '@/lib/prompts'

export default function ClinicianProfile() {
  useDocumentTitle('Clinician')
  const { clinicianId } = useParams()
  const navigate = useNavigate()
  const { user } = useUser()
  const { role } = useUserRole()
  const { data: clinician, isLoading: loading, error: loadError } = useClinician(clinicianId)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteError, setDeleteError] = useState('')
  const [arc, setArc] = useState(null)

  const deleteClinicianMut = useDeleteClinician()
  const deleteInterviewMut = useDeleteInterview()
  const deleting = deleteClinicianMut.isPending || deleteInterviewMut.isPending

  // 404 (no such clinician) or any load failure bounces back to Dashboard,
  // matching the previous explicit refresh()-throws-navigate behavior.
  useEffect(() => {
    if (!loading && (loadError || clinician === null)) {
      navigate('/')
    }
  }, [loading, loadError, clinician, navigate])

  // Fetch arc data once the clinician (with interviews) is loaded, but only
  // when the viewer is the profile owner or an admin.
  useEffect(() => {
    if (!clinician) return
    const isOwner = clinician.created_by_id === user?.id
    if (!isOwner && role !== 'admin') return
    fetchClinicianArc(clinicianId, clinician.interviews || [])
      .then(setArc)
      .catch(() => {}) // non-fatal — dashboard just stays hidden
  }, [clinician, clinicianId, user?.id, role])

  async function handleDeleteInterview(interviewId) {
    setDeleteError('')
    try {
      await deleteInterviewMut.mutateAsync({ id: interviewId, userId: user.id })
      setDeleteTarget(null)
      // Cache invalidation in useDeleteInterview's onSuccess will refetch
      // the clinician detail automatically — no manual refresh() needed.
    } catch (e) {
      setDeleteError(e.message)
    }
  }

  async function handleDeleteClinician() {
    try {
      await deleteClinicianMut.mutateAsync({ id: clinicianId, userId: user.id })
      toast.success(`Deleted ${clinician?.name || 'clinician'}`)
      navigate('/')
    } catch (e) {
      toast.error('Could not delete clinician', { description: e.message })
    }
  }

  if (loading) return <LoadingState />

  if (!clinician) return null

  const interviews = clinician.interviews || []
  const completed = interviews.filter((i) => i.status === 'completed')
  const inProgress = interviews.filter((i) => i.status === 'in_progress')
  const isMyClinicianProfile = clinician.created_by_id === user?.id
  const showArc = isMyClinicianProfile || role === 'admin'

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link to="/">
          <ArrowLeft className="h-4 w-4 mr-1.5" />
          Dashboard
        </Link>
      </Button>

      <div className="flex items-center gap-5">
        <ClinicianChip id={clinician.id} name={clinician.name} size="xl" />
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{clinician.name}</h1>
          <p className="text-sm text-muted-foreground">
            Member since {formatDate(clinician.created_at)} · {interviews.length} interview{interviews.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild size="sm">
            <Link to="/new">
              <Plus className="h-4 w-4 mr-1.5" />
              New Interview
            </Link>
          </Button>
          {isMyClinicianProfile && (
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => setDeleteTarget({ type: 'clinician' })}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      <Separator />

      {/* Voice freshness — structured substrate visible to everyone (it's the
          input the AI consults, not a critique of editing behavior). */}
      <VoiceFreshnessCard clinicianId={clinician.id} clinicianName={clinician.name} />

      {/* Voice Memory — distilled edit patterns. Only shown to the owner so
          analyzing edits of other people's work is opt-in via their own page. */}
      {isMyClinicianProfile && <VoiceNotesPanel clinician={clinician} />}

      {/* Interview recipe — admin-only saved defaults that auto-fill the New
          Interview form when this clinician is selected. */}
      {role === 'admin' && (
        <ClinicianRecipeCard clinician={clinician} />
      )}

      {interviews.length === 0 ? (
        <div className="text-center py-16">
          <MessageSquare className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">No interviews yet for {clinician.name.split(' ')[0]}.</p>
          <Button asChild size="sm" className="mt-4">
            <Link to="/new">Start First Interview</Link>
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          {inProgress.length > 0 && (
            <section>
              <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">In Progress</h2>
              <div className="space-y-2">
                {inProgress.map((interview) => (
                  <InterviewRow
                    key={interview.id}
                    interview={interview}
                    clinicianId={clinicianId}
                    currentUserId={user?.id}
                    onDelete={() => setDeleteTarget({ type: 'interview', id: interview.id })}
                  />
                ))}
              </div>
            </section>
          )}
          {completed.length > 0 && (
            <section>
              <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Completed</h2>
              <div className="space-y-2">
                {completed.map((interview) => (
                  <InterviewRow
                    key={interview.id}
                    interview={interview}
                    clinicianId={clinicianId}
                    currentUserId={user?.id}
                    onDelete={() => setDeleteTarget({ type: 'interview', id: interview.id })}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {showArc && arc && <ClinicianArcDashboard arc={arc} clinicianName={clinician.name} />}

      <Dialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) { setDeleteTarget(null); setDeleteError('') } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {deleteTarget?.type === 'clinician' ? 'Delete clinician profile?' : 'Delete interview?'}
            </DialogTitle>
            <DialogDescription>
              {deleteTarget?.type === 'clinician'
                ? `This will permanently delete ${clinician.name}'s profile and all their interviews. This cannot be undone.`
                : 'This will permanently delete this interview and all generated content. This cannot be undone.'}
            </DialogDescription>
          </DialogHeader>
          {deleteError && (
            <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2 mx-1">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />{deleteError}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeleteTarget(null); setDeleteError('') }} disabled={deleting}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={deleting}
              onClick={() =>
                deleteTarget?.type === 'clinician'
                  ? handleDeleteClinician()
                  : handleDeleteInterview(deleteTarget.id)
              }
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Channel icon map ─────────────────────────────────────────────────────────

const CHANNEL_ICON = {
  facebook:      <Facebook className="h-3.5 w-3.5" />,
  instagram:     <Instagram className="h-3.5 w-3.5" />,
  gbp:           <Globe className="h-3.5 w-3.5" />,
  email:         <Mail className="h-3.5 w-3.5" />,
  blog:          <BookOpen className="h-3.5 w-3.5" />,
  youtube:       <TrendingUp className="h-3.5 w-3.5" />,
  landing_page:  <Globe className="h-3.5 w-3.5" />,
  google_ads:    <Globe className="h-3.5 w-3.5" />,
}

function ChannelBadge({ platform }) {
  const icon = CHANNEL_ICON[platform] ?? <Globe className="h-3.5 w-3.5" />
  return (
    <Badge variant="outline" className="text-xs gap-1 capitalize shrink-0">
      {icon}
      {platform?.replace(/_/g, ' ')}
    </Badge>
  )
}

// ── Arc Dashboard ─────────────────────────────────────────────────────────────

function ClinicianArcDashboard({ arc, clinicianName }) {
  const { stats, recentPosts, standoutQuote } = arc
  const firstName = clinicianName?.split(' ')[0] ?? 'them'

  return (
    <div className="space-y-6 pt-2">
      <Separator />

      <section>
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
          Voice impact
        </h2>

        {/* Part 1 — Stat chips */}
        <div className="grid grid-cols-3 gap-3">
          <StatChip
            label="Interviews"
            value={stats.interviews}
            icon={<BarChart2 className="h-4 w-4 text-primary" />}
          />
          <StatChip
            label="Posts published"
            value={stats.posts}
            icon={<FileText className="h-4 w-4 text-primary" />}
          />
          <StatChip
            label="Week streak"
            value={stats.streak}
            icon={<Flame className={`h-4 w-4 ${stats.streak > 0 ? 'text-orange-500' : 'text-muted-foreground'}`} />}
          />
        </div>
      </section>

      {/* Part 2 — Recent published posts */}
      <section>
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
          Published from this voice
        </h2>
        {recentPosts.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            {`Your first interview will become a post — keep going.`}
          </p>
        ) : (
          <div className="space-y-2">
            {recentPosts.map((post) => (
              <PublishedPostRow key={post.id} post={post} />
            ))}
          </div>
        )}
      </section>

      {/* Part 3 — Standout quote */}
      {standoutQuote && (
        <section>
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
            Standout quote
          </h2>
          <blockquote className="border-l-4 border-primary pl-4 py-1 space-y-1">
            <p className="text-sm italic text-foreground leading-relaxed">
              &ldquo;{standoutQuote.text}&rdquo;
            </p>
            <footer className="text-xs text-muted-foreground">
              — {firstName}
              {standoutQuote.interviewTopic && (
                <span className="ml-1 text-muted-foreground/60">· {standoutQuote.interviewTopic}</span>
              )}
            </footer>
          </blockquote>
        </section>
      )}
    </div>
  )
}

function StatChip({ label, value, icon }) {
  return (
    <Card>
      <CardContent className="p-3 flex flex-col items-start gap-1">
        <div className="flex items-center gap-1.5">
          {icon}
          <span className="text-xl font-bold tabular-nums">{value}</span>
        </div>
        <span className="text-xs text-muted-foreground">{label}</span>
      </CardContent>
    </Card>
  )
}

function PublishedPostRow({ post }) {
  const title = post.topic
    || (post.content ? post.content.slice(0, 60) + (post.content.length > 60 ? '…' : '') : 'Untitled post')
  const date = post.published_at || post.created_at

  return (
    <Card className="hover:shadow-sm transition-shadow">
      <CardContent className="p-3 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate" title={title}>{title}</p>
          <p className="text-xs text-muted-foreground">{formatRelativeDate(date)}</p>
        </div>
        <ChannelBadge platform={post.platform} />
        <Button asChild variant="ghost" size="icon" className="h-8 w-8 shrink-0">
          <Link to={post.interview_id ? `/stories/${post.interview_id}` : `/stories/${post.id}`}>
            <ChevronRight className="h-4 w-4" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  )
}

// ── Clinician recipe card ─────────────────────────────────────────────────────

// Shows the clinician's saved recipes (audience + story type + voice + tone +
// cleanup-level bundles). Star to set default, trash to delete. New recipes
// are CREATED from the New Interview page via the "Save as recipe" button —
// keeps recipe creation tied to the screen where their levers actually live.
function ClinicianRecipeCard({ clinician }) {
  const workspace = useWorkspace()
  const { data: recipes = [], isLoading } = useClinicianRecipes(clinician.id)
  const patchMut  = usePatchClinicianRecipe()
  const deleteMut = useDeleteClinicianRecipe()
  const VOICE_MODES = getVoiceModes(workspace)

  async function handleSetDefault(recipe) {
    if (recipe.is_default) return
    try {
      await patchMut.mutateAsync({ id: recipe.id, patch: { is_default: true } })
      toast.success(`"${recipe.name}" is now the default`)
    } catch {
      // handled by useAppMutation
    }
  }

  async function handleDelete(recipe) {
    if (!confirm(`Delete recipe "${recipe.name}"?`)) return
    try {
      await deleteMut.mutateAsync({ id: recipe.id })
      toast.success(`Deleted "${recipe.name}"`)
    } catch {
      // handled by useAppMutation
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div>
        <p className="text-sm font-semibold">Interview recipes</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Saved lever combinations for {clinician.name.split(' ')[0]}. The starred recipe auto-fills the New Interview form.
        </p>
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground italic">Loading…</p>
      ) : recipes.length === 0 ? (
        <div className="rounded-md border border-dashed border-input p-4 text-center">
          <p className="text-sm text-muted-foreground">No recipes saved yet.</p>
          <p className="text-xs text-muted-foreground mt-1">
            Create one from the{' '}
            <Link to="/new" className="text-primary hover:underline">New Interview</Link>
            {' '}page via &ldquo;Save as recipe&rdquo;.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {recipes.map((r) => (
            <RecipeRow
              key={r.id}
              recipe={r}
              workspace={workspace}
              voiceModes={VOICE_MODES}
              onSetDefault={() => handleSetDefault(r)}
              onDelete={() => handleDelete(r)}
              busy={patchMut.isPending || deleteMut.isPending}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function RecipeRow({ recipe, workspace, voiceModes, onSetDefault, onDelete, busy }) {
  const audienceSlot   = resolveAudienceSlot(recipe.audience, workspace?.audience_options)
  const storyTypeSlot  = resolveStoryTypeSlot(recipe.story_type, workspace?.story_type_options)
  const voiceModeSlot  = voiceModes.find((v) => v.id === recipe.voice_mode)
  const toneSlot       = TONES.find((t) => t.id === recipe.tone)
  const cleanupSlot    = recipe.cleanup_level ? getCleanupLevel(recipe.cleanup_level) : null

  const pills = [audienceSlot, storyTypeSlot, voiceModeSlot, toneSlot, cleanupSlot].filter(Boolean)

  return (
    <div className="rounded-md border border-input p-3 flex items-start gap-3">
      <span className="text-lg shrink-0 mt-0.5">{recipe.emoji || '⭐'}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium truncate">{recipe.name}</p>
          {recipe.is_default && (
            <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500 shrink-0" aria-label="Default recipe" />
          )}
        </div>
        {pills.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1 mt-1.5">
            {pills.map((p, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 text-2xs bg-muted/50 rounded-full px-1.5 py-0.5"
              >
                <span>{p.emoji}</span>
                <span className="text-muted-foreground">{p.label}</span>
              </span>
            ))}
          </div>
        ) : (
          <p className="text-2xs text-muted-foreground italic mt-1">No levers set</p>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {!recipe.is_default && (
          <button
            type="button"
            onClick={onSetDefault}
            disabled={busy}
            title="Make default"
            className="p-1.5 rounded text-muted-foreground hover:text-amber-500 hover:bg-amber-500/10 disabled:opacity-50"
          >
            <Star className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          title="Delete recipe"
          className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-50"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

// ── Interview row ─────────────────────────────────────────────────────────────

function InterviewRow({ interview, clinicianId, currentUserId, onDelete }) {
  const isOwner = interview.owner_id === currentUserId
  const isComplete = interview.status === 'completed'
  const href = isComplete
    ? `/output/${clinicianId}/${interview.id}`
    : `/interview/${clinicianId}/${interview.id}`

  return (
    <Card className="hover:shadow-sm transition-shadow">
      <CardContent className="p-4 flex items-center gap-4">
        <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
          {isComplete ? (
            <FileText className="h-4 w-4 text-primary" />
          ) : (
            <Clock className="h-4 w-4 text-warning" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm truncate" title={interview.topic}>{interview.topic}</p>
          <p className="text-xs text-muted-foreground">
            {formatRelativeDate(interview.updated_at)}
            {!isOwner && <span className="ml-2 text-muted-foreground/60">· by {interview.owner_email?.split('@')[0]}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge
            variant={isComplete ? 'secondary' : 'outline'}
            className={`text-xs ${!isComplete ? 'border-warning/40 text-warning' : ''}`}
          >
            {isComplete ? 'Content ready' : 'In progress'}
          </Badge>
          <Button asChild variant="ghost" size="icon" className="h-8 w-8">
            <Link to={href}>
              <ChevronRight className="h-4 w-4" />
            </Link>
          </Button>
          {isOwner && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              onClick={onDelete}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

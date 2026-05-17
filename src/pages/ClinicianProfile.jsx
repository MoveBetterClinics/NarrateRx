import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useUser } from '@clerk/clerk-react'
import {
  ArrowLeft, Plus, FileText, Clock, Trash2, ChevronRight, MessageSquare, Loader2, AlertCircle,
  Facebook, Instagram, Globe, Mail, BookOpen, TrendingUp, Flame, BarChart2,
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
import { useClinician, useDeleteClinician, useDeleteInterview, usePatchClinician } from '@/lib/queries'
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
        <ClinicianRecipeCard clinician={clinician} userId={user?.id} />
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

function RecipeSlotPicker({ label, options, field, recipe, setRecipe }) {
  const value = recipe[field]
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
        {value && (
          <button
            type="button"
            onClick={() => setRecipe(r => ({ ...r, [field]: null }))}
            className="text-2xs text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        )}
      </div>
      {options.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No options configured in workspace settings.</p>
      ) : (
        <div className="grid grid-cols-2 gap-1.5">
          {options.map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setRecipe(r => ({ ...r, [field]: r[field] === opt.key ? null : opt.key }))}
              className={`flex items-center gap-1.5 rounded-lg border p-2 text-left transition-all ${
                value === opt.key
                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                  : 'border-input hover:border-primary/40 hover:bg-accent/30'
              }`}
            >
              <span className="text-sm shrink-0">{opt.emoji}</span>
              <p className="text-xs font-medium leading-tight truncate">{opt.label}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ClinicianRecipeCard({ clinician, userId }) {
  const workspace = useWorkspace()
  const patchMut = usePatchClinician()

  const audienceOptions  = Array.isArray(workspace?.audience_options)   ? workspace.audience_options   : []
  const storyTypeOptions = Array.isArray(workspace?.story_type_options) ? workspace.story_type_options : []
  const VOICE_MODES      = getVoiceModes(workspace)

  const [recipe, setRecipe] = useState({
    default_audience:   clinician.default_audience   ?? null,
    default_story_type: clinician.default_story_type ?? null,
    default_tone:       clinician.default_tone       ?? null,
    default_voice_mode: clinician.default_voice_mode ?? null,
  })
  const [saved, setSaved] = useState(false)

  const hasAny = Object.values(recipe).some(Boolean)

  async function handleSave() {
    await patchMut.mutateAsync({ id: clinician.id, patch: recipe, userId })
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">Interview recipe</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Default selections that auto-fill when {clinician.name.split(' ')[0]} is chosen on the New Interview form.
          </p>
        </div>
        {hasAny && (
          <Button
            size="sm"
            variant="outline"
            onClick={handleSave}
            disabled={patchMut.isPending}
            className="shrink-0 text-xs"
          >
            {patchMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? '✓ Saved' : 'Save recipe'}
          </Button>
        )}
      </div>

      {audienceOptions.length > 0 && (
        <RecipeSlotPicker label="Default audience" options={audienceOptions} field="default_audience" recipe={recipe} setRecipe={setRecipe} />
      )}
      {storyTypeOptions.length > 0 && (
        <RecipeSlotPicker label="Default story type" options={storyTypeOptions} field="default_story_type" recipe={recipe} setRecipe={setRecipe} />
      )}

      {/* Tone */}
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Default tone</p>
        <div className="grid grid-cols-2 gap-1.5">
          {TONES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setRecipe(r => ({ ...r, default_tone: r.default_tone === t.id ? null : t.id }))}
              className={`flex items-center gap-1.5 rounded-lg border p-2 text-left transition-all ${
                recipe.default_tone === t.id
                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                  : 'border-input hover:border-primary/40 hover:bg-accent/30'
              }`}
            >
              <span className="text-sm shrink-0">{t.emoji}</span>
              <p className="text-xs font-medium leading-tight">{t.label}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Voice mode */}
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Default voice</p>
        <div className="grid grid-cols-2 gap-1.5">
          {VOICE_MODES.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setRecipe(r => ({ ...r, default_voice_mode: r.default_voice_mode === v.id ? null : v.id }))}
              className={`flex items-center gap-1.5 rounded-lg border p-2 text-left transition-all ${
                recipe.default_voice_mode === v.id
                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                  : 'border-input hover:border-primary/40 hover:bg-accent/30'
              }`}
            >
              <span className="text-sm shrink-0">{v.emoji}</span>
              <p className="text-xs font-medium leading-tight">{v.label}</p>
            </button>
          ))}
        </div>
      </div>

      {hasAny && (
        <Button
          size="sm"
          onClick={handleSave}
          disabled={patchMut.isPending}
          className="w-full text-xs"
        >
          {patchMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
          {saved ? '✓ Recipe saved' : 'Save recipe'}
        </Button>
      )}
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

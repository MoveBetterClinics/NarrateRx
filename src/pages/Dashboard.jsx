import { useState, useEffect, useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useUser, useAuth } from '@clerk/clerk-react'
import {
  Plus, MessageSquare, Clock, ChevronRight, Users, Loader2, LayoutGrid, User, Tag,
  AlertCircle, FileText, Image as ImageIcon, Compass, Mic, TrendingUp, PlayCircle,
  CheckCircle2, Circle, X, Sparkles, Settings,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { useClinicians } from '@/lib/queries'
import { listMedia } from '@/lib/mediaLib'
import { useUserRole } from '@/lib/useUserRole'
import { getSuggestedTopics } from '@/lib/topicSuggestions'
import { getInitials, formatRelativeDate } from '@/lib/utils'
import { workspace } from '@/lib/workspace'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

const RESUME_WINDOW_MS = 14 * 24 * 60 * 60 * 1000
const RESUME_INITIAL_CAP = 6

// Personalized hero. Prefers Clerk firstName, falls back through fullName,
// then the email's local-part, then the workspace's app name. Time-of-day
// suffix is intentional: short and natural ("Good morning, Brian").
function greetingFor(user, workspace) {
  const fallback = workspace?.app_name || workspace?.appName || 'Welcome'
  if (!user) return fallback
  const first = user.firstName
    || user.fullName?.split(' ')[0]
    || user.primaryEmailAddress?.emailAddress?.split('@')[0]
  if (!first) return fallback
  const hour = new Date().getHours()
  const tod  = hour < 5 ? 'evening' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'
  return `Good ${tod}, ${first}`
}

export default function Dashboard() {
  useDocumentTitle('Interviews')
  const { user } = useUser()
  const { getToken } = useAuth()
  const { role } = useUserRole()
  const runtimeWorkspace = useWorkspace()
  const { data: clinicians = [], isLoading: loading, error: cliniciansError } = useClinicians()
  const error = cliniciansError?.message || ''
  const [hasMedia, setHasMedia] = useState(false)
  const [hasCredential, setHasCredential] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()
  const [showWelcome, setShowWelcome] = useState(searchParams.get('welcome') === '1')

  // Drop the ?welcome=1 from the URL after picking it up so a refresh does
  // not re-show the celebration.
  useEffect(() => {
    if (searchParams.get('welcome') === '1') {
      searchParams.delete('welcome')
      setSearchParams(searchParams, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Live signals for the Getting Started checklist. Cheap probes — listMedia
  // with limit=1 and a credentials list call. Failures are swallowed (the
  // step just stays unchecked) so a Dashboard render is never blocked.
  useEffect(() => {
    listMedia({ limit: 1 })
      .then((rows) => setHasMedia(Array.isArray(rows) && rows.length > 0))
      .catch(() => {})
  }, [])

  useEffect(() => {
    // Only admins can read /api/workspace/credentials. For everyone else we
    // hide the step entirely rather than show a permanent uncheckable item.
    if (role !== 'admin') return
    let cancelled = false
    ;(async () => {
      try {
        const token = await getToken()
        const r = await fetch('/api/workspace/credentials', {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!r.ok) return
        const data = await r.json()
        if (!cancelled) setHasCredential(Array.isArray(data) && data.length > 0)
      } catch { /* empty */ }
    })()
    return () => { cancelled = true }
  }, [role, getToken])

  const allInterviews = useMemo(
    () => clinicians.flatMap((c) =>
      (c.interviews || []).map((i) => ({ ...i, clinicianName: c.name, clinicianId: c.id }))
    ),
    [clinicians]
  )
  const completedCount = useMemo(
    () => allInterviews.filter((i) => i.status === 'completed').length,
    [allInterviews]
  )
  const byInterviewer = useMemo(
    () => groupBy(allInterviews, (i) => i.owner_email || 'unknown'),
    [allInterviews]
  )
  const byTopic = useMemo(
    () => groupBy(allInterviews, (i) => i.topic),
    [allInterviews]
  )
  const existingTopics = useMemo(
    () => allInterviews.map((i) => i.topic),
    [allInterviews]
  )
  const topicGaps = useMemo(
    () => getSuggestedTopics(runtimeWorkspace, existingTopics)
      .filter((t) => t.interviewCount === 0 && t.priority !== 'low')
      .slice(0, 8),
    [existingTopics, runtimeWorkspace]
  )
  const resumeInterviews = useMemo(() => {
    const now = Date.now()
    return allInterviews
      .filter((i) => i.status !== 'completed' && i.updated_at && (now - new Date(i.updated_at).getTime()) <= RESUME_WINDOW_MS)
      .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
  }, [allInterviews])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 text-muted-foreground animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-sm text-destructive mb-2">Failed to load data</p>
        <p className="text-xs text-muted-foreground">{error}</p>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Welcome-after-onboarding banner. Lands once on first load after the
          /onboard wizard hands the user off to their new subdomain. Drops
          itself from the URL on mount so a refresh does not re-show it. */}
      {showWelcome && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 flex items-start gap-3">
          <span aria-hidden="true" className="text-xl">🎉</span>
          <div className="flex-1">
            <p className="text-sm font-semibold text-emerald-900">
              Your workspace is live
            </p>
            <p className="text-xs text-emerald-800 mt-0.5">
              You can fine-tune brand voice anytime from Workspace settings. For now, let's get your first clinician interviewed.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowWelcome(false)}
            className="text-emerald-700 hover:text-emerald-900 text-xs font-medium"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Hero — greet by first name when we have one. Falls back to the
          workspace app name so existing/legacy auth paths still see a clean
          title rather than "Welcome, ". */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {greetingFor(user, runtimeWorkspace)}
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          {clinicians.length === 0
            ? "Let's set up your first clinician and capture an interview."
            : "Capture your clinicians' expertise and turn it into patient-facing content."}
        </p>
      </div>

      {/* Getting started — dismissible checklist for new users */}
      <GettingStarted
        cliniciansCount={clinicians.length}
        completedCount={completedCount}
        hasMedia={hasMedia}
        hasCredential={hasCredential}
        isAdmin={role === 'admin'}
      />

      {/* Launchpad — App outline */}
      <LaunchpadTiles
        cliniciansCount={clinicians.length}
        interviewsCount={allInterviews.length}
        completedCount={completedCount}
      />

      {/* Resume strip — in-progress interviews within 14 days */}
      {resumeInterviews.length > 0 && (
        <ResumeStrip interviews={resumeInterviews} currentUserId={user?.id} />
      )}

      {/* Plan next interview — high-search topic gaps + New Interview CTA */}
      {topicGaps.length > 0 && (
        <PlanNextInterview gaps={topicGaps} isEmpty={allInterviews.length === 0} />
      )}

      {clinicians.length === 0 ? (
        <EmptyState />
      ) : (
        <Tabs defaultValue="clinician">
          <TabsList className="mb-6">
            <TabsTrigger value="clinician" className="gap-2">
              <LayoutGrid className="h-3.5 w-3.5" />
              By Clinician
            </TabsTrigger>
            <TabsTrigger value="interviewer" className="gap-2">
              <User className="h-3.5 w-3.5" />
              By Interviewer
            </TabsTrigger>
            <TabsTrigger value="topic" className="gap-2">
              <Tag className="h-3.5 w-3.5" />
              By Topic
            </TabsTrigger>
          </TabsList>

          <TabsContent value="clinician">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {clinicians.map((c) => (
                <ClinicianTile key={c.id} clinician={c} />
              ))}
              <NewClinicianTile />
            </div>
          </TabsContent>

          <TabsContent value="interviewer">
            <div className="space-y-8">
              {Object.entries(byInterviewer)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([email, interviews]) => (
                  <InterviewerSection
                    key={email}
                    email={email}
                    interviews={interviews}
                    currentUserId={user?.id}
                  />
                ))}
            </div>
          </TabsContent>

          <TabsContent value="topic">
            <TopicView byTopic={byTopic} existingTopics={existingTopics} currentUserId={user?.id} workspace={runtimeWorkspace} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}

// ── Getting started ──────────────────────────────────────────────────────────

// Dismissible checklist that helps new users find the four core flows. Auto-
// hides once dismissed (Clerk unsafeMetadata) or all steps are complete.
function GettingStarted({ cliniciansCount, completedCount, hasMedia = false, hasCredential = false, isAdmin = false }) {
  const { user, isLoaded } = useUser()
  const [dismissed, setDismissed] = useState(false)

  if (!isLoaded) return null

  const alreadyDismissed = Boolean(user?.unsafeMetadata?.gettingStartedDismissedAt)
  if (alreadyDismissed || dismissed) return null

  const items = [
    {
      done: cliniciansCount > 0,
      label: 'Add a clinician',
      detail: 'Create a profile so the AI knows whose voice to write in.',
      to: '/new',
    },
    {
      done: completedCount > 0,
      label: 'Run your first interview',
      detail: '15–30 minutes of conversation produces a full content set.',
      to: '/new',
    },
    {
      // Live: ticks once the workspace has at least one media asset.
      done: hasMedia,
      label: 'Add media to the library',
      detail: 'Upload photos and videos to pair with future posts.',
      to: '/media',
    },
    // Channel-connect step is admin-only — non-admins can't act on it, so
    // showing a permanently-unchecked item just clutters their checklist.
    ...(isAdmin
      ? [{
          done: hasCredential,
          label: 'Connect a publishing channel',
          detail: 'Wire up the destinations where finished posts will go out.',
          to: '/settings/integrations',
          icon: Settings,
        }]
      : []),
  ]

  const doneCount = items.filter((i) => i.done).length
  if (doneCount === items.length) return null

  async function handleDismiss() {
    setDismissed(true)
    try {
      await user?.update({
        unsafeMetadata: {
          ...(user.unsafeMetadata || {}),
          gettingStartedDismissedAt: new Date().toISOString(),
        },
      })
    } catch {
      // Locally hidden either way; metadata write is best-effort.
    }
  }

  return (
    <div className="rounded-xl border bg-gradient-to-br from-primary/5 to-background p-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <p className="text-sm font-semibold">Getting started</p>
          <span className="text-xs text-muted-foreground">
            {doneCount} of {items.length} done
          </span>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss getting started checklist"
          className="text-muted-foreground hover:text-foreground rounded p-1 -m-1"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <ul className="space-y-2">
        {items.map((item) => {
          const RowIcon = item.icon
          return (
            <li key={item.label}>
              <Link
                to={item.to}
                className="flex items-start gap-3 rounded-lg p-2.5 -m-2.5 hover:bg-primary/5 transition-colors group"
              >
                {item.done ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
                ) : (
                  <Circle className="h-5 w-5 text-muted-foreground/40 shrink-0 mt-0.5" />
                )}
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${item.done ? 'text-muted-foreground line-through' : ''}`}>
                    {item.label}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">{item.detail}</p>
                </div>
                {RowIcon && !item.done && (
                  <RowIcon className="h-4 w-4 text-muted-foreground shrink-0 mt-1 opacity-0 group-hover:opacity-100 transition-opacity" />
                )}
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-1 opacity-0 group-hover:opacity-100 transition-opacity" />
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ── Launchpad ────────────────────────────────────────────────────────────────

function LaunchpadTiles({ cliniciansCount, interviewsCount, completedCount }) {
  const tiles = [
    {
      to: '/new',
      icon: <Mic className="h-4 w-4" />,
      label: 'New Interview',
      detail: 'Start a 15–30 min conversation',
      cta: true,
    },
    {
      to: '/hub',
      icon: <FileText className="h-4 w-4" />,
      label: 'Content Hub',
      detail: 'Review, edit, and schedule generated posts',
    },
    {
      to: '/media',
      icon: <ImageIcon className="h-4 w-4" />,
      label: 'Media',
      detail: 'Photos, videos, and brand assets',
    },
    {
      to: '/strategy',
      icon: <Compass className="h-4 w-4" />,
      label: 'Strategy',
      detail: 'Distribution plan & campaign focus',
    },
  ]

  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
        App
      </p>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {tiles.map((t) => (
          <Link
            key={t.to}
            to={t.to}
            className={`group rounded-xl border p-4 transition-colors ${
              t.cta
                ? 'border-primary/40 bg-primary/5 hover:bg-primary/10'
                : 'bg-card hover:border-primary/40 hover:bg-primary/5'
            }`}
          >
            <div className={`h-8 w-8 rounded-lg flex items-center justify-center mb-3 ${
              t.cta ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary'
            }`}>
              {t.icon}
            </div>
            <p className="text-sm font-semibold">{t.label}</p>
            <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{t.detail}</p>
          </Link>
        ))}
      </div>
      {(cliniciansCount > 0 || interviewsCount > 0) && (
        <div className="grid grid-cols-3 gap-3 mt-3">
          <StatCard label="Clinicians" value={cliniciansCount} icon={<Users className="h-4 w-4" />} />
          <StatCard label="Interviews" value={interviewsCount} icon={<MessageSquare className="h-4 w-4" />} />
          <StatCard label="Completed" value={completedCount} icon={<Clock className="h-4 w-4" />} />
        </div>
      )}
    </div>
  )
}

// ── Resume strip ─────────────────────────────────────────────────────────────

function ResumeStrip({ interviews, currentUserId }) {
  const [showAll, setShowAll] = useState(false)
  const visible = showAll ? interviews : interviews.slice(0, RESUME_INITIAL_CAP)
  const hiddenCount = interviews.length - RESUME_INITIAL_CAP

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <PlayCircle className="h-3.5 w-3.5 text-amber-600" />
        <p className="text-xs font-medium uppercase tracking-wider text-amber-800">
          In progress — pick up where you left off
        </p>
        <span className="text-xs text-muted-foreground">
          {interviews.length} active
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {visible.map((i) => (
          <ResumeCard key={i.id} interview={i} currentUserId={currentUserId} />
        ))}
      </div>
      {hiddenCount > 0 && !showAll && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="mt-3 text-xs font-medium text-primary hover:underline"
        >
          View all {interviews.length} in-progress interviews →
        </button>
      )}
      {showAll && hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(false)}
          className="mt-3 text-xs font-medium text-muted-foreground hover:text-foreground hover:underline"
        >
          Show fewer
        </button>
      )}
    </div>
  )
}

function ResumeCard({ interview, currentUserId }) {
  const isOwner = interview.owner_id === currentUserId
  const href = isOwner
    ? `/interview/${interview.clinicianId}/${interview.id}`
    : `/clinician/${interview.clinicianId}`

  return (
    <Link
      to={href}
      className="block rounded-xl border-2 border-amber-200 bg-amber-50/50 p-3.5 hover:border-amber-300 hover:bg-amber-50 transition-colors"
    >
      <div className="flex items-center gap-2 mb-1.5">
        <Avatar className="h-6 w-6">
          <AvatarFallback className="bg-primary/10 text-primary text-[10px] font-semibold">
            {getInitials(interview.clinicianName)}
          </AvatarFallback>
        </Avatar>
        <p className="text-xs font-medium text-foreground/80 truncate">{interview.clinicianName}</p>
      </div>
      <p className="text-sm font-semibold text-amber-900 truncate">{interview.topic}</p>
      <p className="text-[11px] text-amber-700/80 mt-0.5">
        Updated {formatRelativeDate(interview.updated_at)}
        {!isOwner && interview.owner_email ? ` · by ${formatInterviewerName(interview.owner_email)}` : ''}
      </p>
      <div className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary">
        Resume
        <ChevronRight className="h-3 w-3" />
      </div>
    </Link>
  )
}

// ── Plan next interview ──────────────────────────────────────────────────────

function PlanNextInterview({ gaps, isEmpty = false }) {
  return (
    <div className="rounded-xl border-2 border-amber-200 bg-amber-50/60 p-5">
      <div className="flex flex-col sm:flex-row items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="h-4 w-4 text-amber-700" />
            <p className="text-sm font-semibold text-amber-900">
              {isEmpty ? 'Start with a high-impact topic' : 'Plan your next interview'}
            </p>
          </div>
          <p className="text-xs text-amber-800/80 mb-3">
            {isEmpty
              ? 'These are high-search topics in your area — pick one to kick off your first interview.'
              : 'High-search topics with no content yet — pick one to start an interview.'}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {gaps.map((t) => (
              <Link
                key={t.topic}
                to={`/new?topic=${encodeURIComponent(t.topic)}`}
                className="text-xs px-2.5 py-1 rounded-full bg-amber-100 border border-amber-300 text-amber-900 hover:bg-amber-200 transition-colors"
              >
                + {t.topic}
              </Link>
            ))}
          </div>
        </div>
        <Button asChild className="shrink-0">
          <Link to="/new">
            <Plus className="h-4 w-4 mr-1.5" />
            New Interview
          </Link>
        </Button>
      </div>
    </div>
  )
}

// ── By Topic view ────────────────────────────────────────────────────────────

function TopicView({ byTopic, existingTopics, currentUserId, workspace }) {
  const [selected, setSelected] = useState(null)

  const allSuggestions = getSuggestedTopics(workspace, existingTopics)
  const gaps = allSuggestions.filter((t) => t.interviewCount === 0 && t.priority !== 'low')

  const topicRows = Object.entries(byTopic)
    .map(([topic, interviews]) => ({
      topic,
      interviews,
      total: interviews.length,
      completed: interviews.filter((i) => i.status === 'completed').length,
    }))
    .sort((a, b) => b.total - a.total)

  const maxCount = topicRows[0]?.total || 1

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-4">
          Interview Count by Topic
        </h2>
        <div className="rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 border-b">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Topic</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground w-40 hidden sm:table-cell">Coverage</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground w-24">Interviews</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {topicRows.map(({ topic, interviews, total, completed }) => (
                <>
                  <tr
                    key={topic}
                    className="border-b last:border-0 hover:bg-muted/20 cursor-pointer transition-colors"
                    onClick={() => setSelected(selected === topic ? null : topic)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{topic}</span>
                        {completed > 0 && (
                          <Badge variant="secondary" className="text-xs hidden sm:inline-flex">
                            {completed} complete
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary transition-all"
                            style={{ width: `${(total / maxCount) * 100}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="font-semibold tabular-nums">{total}</span>
                    </td>
                    <td className="px-2 py-3">
                      <ChevronRight
                        className={`h-4 w-4 text-muted-foreground transition-transform ${selected === topic ? 'rotate-90' : ''}`}
                      />
                    </td>
                  </tr>
                  {selected === topic && (
                    <tr key={`${topic}-detail`} className="bg-muted/10">
                      <td colSpan={4} className="px-4 pb-3 pt-1">
                        <div className="space-y-2">
                          {interviews.map((i) => (
                            <InterviewListRow key={i.id} interview={i} currentUserId={currentUserId} />
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {gaps.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <AlertCircle className="h-3.5 w-3.5 text-muted-foreground" />
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Not yet covered — high patient search interest
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {gaps.slice(0, 12).map((t) => (
              <Link
                key={t.topic}
                to={`/new?topic=${encodeURIComponent(t.topic)}`}
                className="flex items-center justify-between rounded-lg border border-dashed px-3 py-2.5 hover:border-primary hover:bg-primary/5 transition-colors group"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{t.topic}</p>
                  <p className="text-xs text-muted-foreground truncate">{t.category}</p>
                </div>
                <Badge
                  variant="outline"
                  className={`text-xs shrink-0 ml-2 ${t.priority === 'high' ? 'border-amber-300 text-amber-700' : ''}`}
                >
                  {t.priority}
                </Badge>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function groupBy(arr, keyFn) {
  return arr.reduce((acc, item) => {
    const key = keyFn(item)
    if (!acc[key]) acc[key] = []
    acc[key].push(item)
    return acc
  }, {})
}

function formatInterviewerName(email) {
  if (!email || email === 'unknown') return 'Unknown'
  const [local] = email.split('@')
  return local
    .split('.')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ')
}

function StatCard({ label, value, icon }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-muted-foreground">{icon}</span>
      </div>
      <p className="text-2xl font-bold">{value}</p>
    </div>
  )
}

function ClinicianTile({ clinician }) {
  const interviews = clinician.interviews || []
  const completed = interviews.filter((i) => i.status === 'completed').length
  const inProgress = interviews.filter((i) => i.status === 'in_progress').length
  const last = interviews[0]

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="pt-6">
        <div className="flex items-start gap-4">
          <Avatar className="h-12 w-12 text-base">
            <AvatarFallback className="bg-primary/10 text-primary font-semibold">
              {getInitials(clinician.name)}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold truncate">{clinician.name}</h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              {interviews.length === 0
                ? 'No interviews yet'
                : `${interviews.length} interview${interviews.length !== 1 ? 's' : ''}`}
            </p>
          </div>
        </div>

        {interviews.length > 0 && (
          <div className="mt-4 space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              {completed > 0 && (
                <Badge variant="secondary" className="text-xs">{completed} completed</Badge>
              )}
              {inProgress > 0 && (
                <Badge variant="outline" className="text-xs border-amber-300 text-amber-700">
                  {inProgress} in progress
                </Badge>
              )}
            </div>
            {last && (
              <p className="text-xs text-muted-foreground">
                Last: {last.topic} · {formatRelativeDate(last.updated_at)}
              </p>
            )}
          </div>
        )}
      </CardContent>
      <CardFooter className="pt-0">
        <Button asChild variant="ghost" size="sm" className="w-full justify-between">
          <Link to={`/clinician/${clinician.id}`}>
            View Profile
            <ChevronRight className="h-4 w-4" />
          </Link>
        </Button>
      </CardFooter>
    </Card>
  )
}

function InterviewerSection({ email, interviews, currentUserId }) {
  const name = formatInterviewerName(email)
  const isMe = interviews.some((i) => i.owner_id === currentUserId)

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Avatar className="h-7 w-7">
          <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
            {name[0]?.toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <h2 className="text-sm font-semibold">{name}</h2>
        {isMe && <Badge variant="outline" className="text-xs">You</Badge>}
        <span className="text-xs text-muted-foreground ml-1">
          {interviews.length} interview{interviews.length !== 1 ? 's' : ''}
        </span>
      </div>
      <div className="space-y-2 pl-9">
        {interviews.map((i) => (
          <InterviewListRow key={i.id} interview={i} currentUserId={currentUserId} showClinician />
        ))}
      </div>
    </div>
  )
}

function InterviewListRow({ interview, currentUserId, showClinician }) {
  const isOwner = interview.owner_id === currentUserId
  const isComplete = interview.status === 'completed'
  const href = isComplete
    ? `/output/${interview.clinicianId}/${interview.id}`
    : isOwner
    ? `/interview/${interview.clinicianId}/${interview.id}`
    : null

  return (
    <Card className="hover:shadow-sm transition-shadow">
      <CardContent className="p-3 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          {showClinician && (
            <p className="text-xs text-muted-foreground truncate">{interview.clinicianName}</p>
          )}
          <p className="font-medium text-sm truncate">{interview.topic}</p>
          <p className="text-xs text-muted-foreground">{formatRelativeDate(interview.updated_at)}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge
            variant={isComplete ? 'secondary' : 'outline'}
            className={`text-xs ${!isComplete ? 'border-amber-300 text-amber-700' : ''}`}
          >
            {isComplete ? 'Complete' : 'In progress'}
          </Badge>
          {href ? (
            <Button asChild variant="ghost" size="icon" className="h-8 w-8">
              <Link to={href}>
                <ChevronRight className="h-4 w-4" />
              </Link>
            </Button>
          ) : (
            <div className="h-8 w-8" />
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function NewClinicianTile() {
  return (
    <Card className="border-dashed hover:border-primary/50 hover:bg-accent/30 transition-colors">
      <CardContent className="pt-6 pb-6 flex flex-col items-center justify-center h-full min-h-[160px] text-center">
        <Button asChild variant="ghost" className="flex-col gap-2 h-auto py-4 w-full">
          <Link to="/new">
            <div className="h-10 w-10 rounded-full border-2 border-dashed border-muted-foreground/30 flex items-center justify-center">
              <Plus className="h-5 w-5 text-muted-foreground/50" />
            </div>
            <span className="text-sm text-muted-foreground">New Interview</span>
          </Link>
        </Button>
      </CardContent>
    </Card>
  )
}

function EmptyState() {
  const steps = [
    {
      icon: <Mic className="h-4 w-4" />,
      title: 'Record a 15–30 min interview',
      detail: 'Pick a clinician and a topic. The AI guides the conversation — you just talk.',
    },
    {
      icon: <FileText className="h-4 w-4" />,
      title: 'Review the generated content',
      detail: 'Blog post, newsletter, and social posts drafted in your voice. Edit in the Content Hub.',
    },
    {
      icon: <Compass className="h-4 w-4" />,
      title: 'Schedule and publish',
      detail: 'Distribute to your website, email list, and social channels from one place.',
    },
  ]

  return (
    <div className="rounded-xl border bg-card p-6 sm:p-8">
      <div className="max-w-2xl">
        <div className="flex items-center gap-3 mb-2">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
            <Mic className="h-5 w-5" />
          </div>
          <h2 className="text-lg font-semibold">Ready when you are</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-6">
          Turn one short conversation into a week of patient-facing content. Here's how {workspace.name} uses NarrateRx:
        </p>

        <ol className="space-y-3 mb-6">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-3">
              <div className="shrink-0 h-7 w-7 rounded-full bg-muted flex items-center justify-center text-xs font-semibold text-muted-foreground">
                {i + 1}
              </div>
              <div className="flex-1 pt-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">{s.icon}</span>
                  <p className="text-sm font-medium">{s.title}</p>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{s.detail}</p>
              </div>
            </li>
          ))}
        </ol>

        <Button asChild>
          <Link to="/new">
            <Plus className="h-4 w-4 mr-1.5" />
            Start your first interview
          </Link>
        </Button>
      </div>
    </div>
  )
}

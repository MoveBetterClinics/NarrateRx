import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useUser } from '@clerk/clerk-react'
import { FileText, Eye, Clock, Loader2, RefreshCw, ChevronRight, Send, BookOpen } from 'lucide-react'
import LoadingState from '@/components/LoadingState'
import { Button } from '@/components/ui/button'
import { useStories, useClinicianSummaries } from '@/lib/queries'
import { useUserRole } from '@/lib/useUserRole'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { getSuggestedTopics } from '@/lib/topicSuggestions'
import { getPatientPrototypesUi } from '@/lib/prompts'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { greetingFor } from '@/components/home/helpers'
import GettingStarted from '@/components/home/GettingStarted'
import ResumeStrip from '@/components/home/ResumeStrip'
import PlanNextInterview from '@/components/home/PlanNextInterview'
import TaskBucketCard from '@/components/home/TaskBucketCard'
import HomeRightRail from '@/components/home/HomeRightRail'

const RESUME_WINDOW_MS = 14 * 24 * 60 * 60 * 1000
const MY_STORIES_LIMIT = 5

export default function Home() {
  useDocumentTitle('Home')
  const { user } = useUser()
  const { canReview, role, isStaff } = useUserRole()
  const runtimeWorkspace = useWorkspace()
  const [searchParams] = useSearchParams()

  // Stories (interviews + content pieces merged)
  const { data: stories = [], isLoading: storiesLoading, error: storiesError, refetch: refetchStories, isFetching: isRefetchingStories } = useStories()

  // Slim clinician summaries — free cache hit when Stories has loaded first
  // (useStories populates the card cache as a side-effect). Includes
  // session_state so we can identify in-progress interviews for the resume strip.
  const { data: clinicians = [], isLoading: cliniciansLoading } = useClinicianSummaries()

  // ?bucket= deep-link scroll
  useEffect(() => {
    const bucket = searchParams.get('bucket')
    if (!bucket) return
    // Small defer so the DOM has rendered the buckets before scrolling
    const timer = setTimeout(() => {
      document.getElementById(bucket)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 150)
    return () => clearTimeout(timer)
  }, [searchParams])

  // Derived data from stories
  const allInterviews = useMemo(
    () =>
      clinicians.flatMap((c) =>
        (c.interviews || []).map((i) => ({ ...i, clinicianName: c.name, clinicianId: c.id }))
      ),
    [clinicians]
  )

  const resumeInterviews = useMemo(() => {
    const now = Date.now()
    return allInterviews
      .filter(
        (i) =>
          i.status !== 'completed' &&
          i.session_state != null &&
          i.updated_at &&
          now - new Date(i.updated_at).getTime() <= RESUME_WINDOW_MS &&
          // "pick up where YOU left off" — only show the current user's own
          // in-progress interviews, not every clinician's open sessions.
          i.owner_id === user?.id
      )
      .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
  }, [allInterviews, user])

  // My recent completed interviews — quick-access for the logged-in clinician
  // to navigate back to their own stories. Surfaces the N most-recently-updated
  // completed interviews owned by the current user. Hidden when empty so it
  // doesn't show for pure-admin accounts that have no owned interviews.
  const myRecentInterviews = useMemo(() => {
    if (!user?.id) return []
    return allInterviews
      .filter((i) => i.owner_id === user.id && i.status === 'completed')
      .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
      .slice(0, MY_STORIES_LIMIT)
  }, [allInterviews, user])

  // Derive from stories (already loaded) — each story maps 1:1 to an interview
  const existingTopics = useMemo(
    () => stories.map((s) => s.topic),
    [stories]
  )

  // Archetype filter for PlanNextInterview. null = no filter. Workspaces
  // with no patient_context.prototypes don't render the chip strip, so
  // this stays null and the gap list behaves exactly as before.
  const [topicFilterPrototype, setTopicFilterPrototype] = useState(null)
  const prototypesUi = useMemo(
    () => getPatientPrototypesUi(runtimeWorkspace),
    [runtimeWorkspace]
  )
  // The unfiltered gap baseline drives whether to render PlanNextInterview
  // at all. If the workspace has gaps overall but an archetype filter zeros
  // them out, we still render the card (with empty-state copy + chips) so
  // the user can clear the filter — otherwise it disappears and the filter
  // becomes unreachable.
  const unfilteredGaps = useMemo(
    () =>
      getSuggestedTopics(runtimeWorkspace, existingTopics)
        .filter((t) => t.interviewCount === 0 && t.priority !== 'low')
        .slice(0, 8),
    [existingTopics, runtimeWorkspace]
  )
  const topicGaps = useMemo(
    () =>
      getSuggestedTopics(runtimeWorkspace, existingTopics, topicFilterPrototype)
        .filter((t) => t.interviewCount === 0 && t.priority !== 'low')
        .slice(0, 8),
    [existingTopics, runtimeWorkspace, topicFilterPrototype]
  )

  // ── Task bucket 1: Ready for content ───────────────────────────────────────
  // Stories in 'drafting' stage with no content pieces yet
  const readyForContent = useMemo(
    () => stories.filter((s) => s.story_stage === 'drafting' && (s.pieces_count || 0) === 0),
    [stories]
  )

  // ── Task bucket 2: Awaiting review ─────────────────────────────────────────
  // Stories that have at least one piece with status === 'in_review'.
  // Only shown to users who canReview — staff without review permissions
  // don't need to see others' queues.
  const awaitingReview = useMemo(
    () =>
      canReview
        ? stories.filter((s) =>
            (s.pieces || []).some((p) => p.status === 'in_review')
          )
        : [],
    [stories, canReview]
  )

  // ── Task bucket 3: Ready to distribute ─────────────────────────────────────
  // Stories with at least one approved piece — publisher's inbox. Only shown
  // to staff since clinicians don't distribute; an empty list hides the card.
  const readyToDistribute = useMemo(
    () =>
      isStaff
        ? stories.filter((s) => (s.pieces_by_status?.approved ?? 0) > 0)
        : [],
    [stories, isStaff]
  )

  // ── Task bucket 4: Hasn't interviewed in a while ────────────────────────────
  // Clinicians with 0 interviews OR most recent interview > 30 days ago
  const overdueClinicianItems = useMemo(() => {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
    return clinicians.filter((c) => {
      const interviews = c.interviews || []
      if (interviews.length === 0) return true
      const mostRecent = interviews.reduce((latest, i) => {
        const t = new Date(i.updated_at || i.created_at || 0).getTime()
        return t > latest ? t : latest
      }, 0)
      return mostRecent < thirtyDaysAgo
    })
  }, [clinicians])

  const isLoading = storiesLoading || cliniciansLoading

  if (isLoading) return <LoadingState />

  if (storiesError) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-sm text-destructive mb-2">Failed to load data</p>
        <p className="text-xs text-muted-foreground mb-4">{storiesError.message}</p>
        <Button size="sm" variant="outline" onClick={() => refetchStories()} disabled={isRefetchingStories}>
          {isRefetchingStories ? (
            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          )}
          Retry
        </Button>
      </div>
    )
  }

  const greeting = greetingFor(user, runtimeWorkspace)

  return (
    <div className="flex flex-col gap-6">
      {/* Greeting */}
      <h1 className="text-xl font-semibold text-foreground">{greeting}</h1>

      {/* Pre-roll: one section at a time. Priority: resume in-progress >
          coverage gaps (active workspace) > getting started (new workspace). */}
      {resumeInterviews.length > 0 ? (
        <ResumeStrip interviews={resumeInterviews} currentUserId={user?.id} clinicians={clinicians} />
      ) : unfilteredGaps.length > 0 && stories.length > 0 ? (
        <PlanNextInterview
          gaps={topicGaps}
          isEmpty={allInterviews.length === 0}
          prototypes={prototypesUi}
          activePrototypeId={topicFilterPrototype}
          onPrototypeChange={setTopicFilterPrototype}
        />
      ) : (
        <GettingStarted />
      )}

      {/* Main content: task buckets left, right rail right */}
      <div className="flex gap-6">
        <div className="flex flex-col gap-4 flex-1 min-w-0">
          {myRecentInterviews.length > 0 && (
            <TaskBucketCard
              id="my-stories"
              title="My recent stories"
              icon={<BookOpen className="h-4 w-4" />}
              items={myRecentInterviews}
              emptyMessage=""
              renderItem={(i) => (
                <Link
                  key={i.id}
                  to={`/stories/${i.id}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-accent/20 transition-colors group"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{i.topic}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {new Date(i.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                    </p>
                  </div>
                  <span className="text-xs font-medium text-muted-foreground group-hover:text-primary transition-colors flex items-center gap-0.5">
                    Open <ChevronRight className="h-3 w-3" />
                  </span>
                </Link>
              )}
              footer={
                <Link
                  to="/stories?owner=me"
                  className="text-xs font-medium text-muted-foreground hover:text-primary transition-colors inline-flex items-center gap-0.5"
                >
                  See all my stories <ChevronRight className="h-3 w-3" />
                </Link>
              }
            />
          )}

          <TaskBucketCard
            id="ready"
            title="Ready for content"
            icon={<FileText className="h-4 w-4" />}
            items={readyForContent}
            emptyMessage="No stories waiting for content — great work."
            renderItem={(s) => (
              <Link
                key={s.id}
                to={`/stories/${s.id}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-accent/20 transition-colors group"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{s.clinicianName}</p>
                  <p className="text-xs text-muted-foreground truncate">{s.topic}</p>
                </div>
                <span className="text-xs font-medium text-primary text-muted-foreground group-hover:text-primary transition-colors flex items-center gap-0.5">
                  Start drafting <ChevronRight className="h-3 w-3" />
                </span>
              </Link>
            )}
          />

          <TaskBucketCard
            id="review"
            title="Awaiting your review"
            icon={<Eye className="h-4 w-4" />}
            items={awaitingReview}
            emptyMessage="Nothing in review — all clear."
            renderItem={(s) => {
              const reviewPiece = (s.pieces || []).find((p) => p.status === 'in_review')
              return (
                <Link
                  key={s.id}
                  to={`/stories/${s.id}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-accent/20 transition-colors group"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {reviewPiece?.platform
                        ? `${reviewPiece.platform.charAt(0).toUpperCase()}${reviewPiece.platform.slice(1)} · `
                        : ''}
                      {s.clinicianName}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">{s.topic}</p>
                  </div>
                  <span className="text-xs font-medium text-primary text-muted-foreground group-hover:text-primary transition-colors flex items-center gap-0.5">
                    Review <ChevronRight className="h-3 w-3" />
                  </span>
                </Link>
              )
            }}
          />

          {readyToDistribute.length > 0 && (
            <TaskBucketCard
              id="distribute"
              title="Ready to distribute"
              icon={<Send className="h-4 w-4" />}
              items={readyToDistribute}
              emptyMessage="Nothing approved yet — check back after review."
              renderItem={(s) => {
                const approvedCount = s.pieces_by_status?.approved ?? 0
                return (
                  <Link
                    key={s.id}
                    to={`/stories/${s.id}`}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-accent/20 transition-colors group"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{s.clinicianName}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {s.topic}
                        {approvedCount > 1 ? ` · ${approvedCount} pieces` : ''}
                      </p>
                    </div>
                    <span className="text-xs font-medium text-primary text-muted-foreground group-hover:text-primary transition-colors flex items-center gap-0.5">
                      Distribute <ChevronRight className="h-3 w-3" />
                    </span>
                  </Link>
                )
              }}
            />
          )}

          <TaskBucketCard
            id="overdue"
            title="Hasn't interviewed in a while"
            icon={<Clock className="h-4 w-4" />}
            items={overdueClinicianItems}
            emptyMessage="Everyone has been interviewed recently — great cadence."
            renderItem={(c) => (
              <Link
                key={c.id}
                to="/new"
                className="flex items-center gap-3 px-4 py-3 hover:bg-accent/20 transition-colors group"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{c.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(c.interviews || []).length === 0
                      ? 'No interviews yet'
                      : 'Last interview over 30 days ago'}
                  </p>
                </div>
                <span className="text-xs font-medium text-primary text-muted-foreground group-hover:text-primary transition-colors flex items-center gap-0.5">
                  Schedule <ChevronRight className="h-3 w-3" />
                </span>
              </Link>
            )}
          />
        </div>

        {/* Right rail — hidden on smaller viewports */}
        <div className="w-72 flex-shrink-0 hidden lg:block">
          <HomeRightRail stories={stories} isAdmin={role === 'admin'} />
        </div>
      </div>

    </div>
  )
}

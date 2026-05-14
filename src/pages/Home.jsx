import { useState, useEffect, useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useUser, useAuth } from '@clerk/clerk-react'
import { FileText, Eye, Clock, Loader2, RefreshCw, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useStories, useClinicians } from '@/lib/queries'
import { useUserRole } from '@/lib/useUserRole'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { listMedia } from '@/lib/mediaLib'
import { getSuggestedTopics } from '@/lib/topicSuggestions'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { greetingFor } from '@/components/home/helpers'
import GettingStarted from '@/components/home/GettingStarted'
import ResumeStrip from '@/components/home/ResumeStrip'
import PlanNextInterview from '@/components/home/PlanNextInterview'
import TaskBucketCard from '@/components/home/TaskBucketCard'
import HomeRightRail from '@/components/home/HomeRightRail'

const RESUME_WINDOW_MS = 14 * 24 * 60 * 60 * 1000

export default function Home() {
  useDocumentTitle('Home')
  const { user } = useUser()
  const { getToken } = useAuth()
  const { role, canReview } = useUserRole()
  const runtimeWorkspace = useWorkspace()
  const [searchParams] = useSearchParams()

  // Stories (interviews + content pieces merged)
  const { data: stories = [], isLoading: storiesLoading, error: storiesError, refetch: refetchStories, isFetching: isRefetchingStories } = useStories()

  // Clinicians for "hasn't interviewed" bucket
  const { data: clinicians = [], isLoading: cliniciansLoading } = useClinicians()

  // Getting-started signals
  const [hasMedia, setHasMedia] = useState(false)
  const [hasCredential, setHasCredential] = useState(false)

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

  // Live Getting Started signals
  useEffect(() => {
    listMedia({ limit: 1 })
      .then((rows) => setHasMedia(Array.isArray(rows) && rows.length > 0))
      .catch(() => {})
  }, [])

  useEffect(() => {
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

  // Derived data from stories
  const allInterviews = useMemo(
    () =>
      clinicians.flatMap((c) =>
        (c.interviews || []).map((i) => ({ ...i, clinicianName: c.name, clinicianId: c.id }))
      ),
    [clinicians]
  )

  const completedCount = useMemo(
    () => allInterviews.filter((i) => i.status === 'completed').length,
    [allInterviews]
  )

  const resumeInterviews = useMemo(() => {
    const now = Date.now()
    return allInterviews
      .filter(
        (i) =>
          i.status !== 'completed' &&
          i.session_state != null &&
          i.updated_at &&
          now - new Date(i.updated_at).getTime() <= RESUME_WINDOW_MS
      )
      .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
  }, [allInterviews])

  const existingTopics = useMemo(
    () => allInterviews.map((i) => i.topic),
    [allInterviews]
  )

  const topicGaps = useMemo(
    () =>
      getSuggestedTopics(runtimeWorkspace, existingTopics)
        .filter((t) => t.interviewCount === 0 && t.priority !== 'low')
        .slice(0, 8),
    [existingTopics, runtimeWorkspace]
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

  // ── Task bucket 3: Hasn't interviewed in a while ────────────────────────────
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 text-muted-foreground animate-spin" />
      </div>
    )
  }

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
      <h1 className="text-xl font-semibold text-gray-900">{greeting}</h1>

      {/* Getting Started (auto-hides when complete or dismissed) */}
      <GettingStarted
        cliniciansCount={clinicians.length}
        completedCount={completedCount}
        hasMedia={hasMedia}
        hasCredential={hasCredential}
        isAdmin={role === 'admin'}
      />

      {/* Main content: task buckets left, right rail right */}
      <div className="flex gap-6">
        <div className="flex flex-col gap-4 flex-1 min-w-0">
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
                <span className="text-xs font-medium text-primary opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
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
                  <span className="text-xs font-medium text-primary opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
                    Review <ChevronRight className="h-3 w-3" />
                  </span>
                </Link>
              )
            }}
          />

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
                <span className="text-xs font-medium text-primary opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
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

      {/* Resume strip — in-progress interviews within 14 days */}
      {resumeInterviews.length > 0 && (
        <ResumeStrip interviews={resumeInterviews} currentUserId={user?.id} />
      )}

      {/* Plan next interview — high-search topic gaps */}
      {topicGaps.length > 0 && (
        <PlanNextInterview gaps={topicGaps} isEmpty={allInterviews.length === 0} />
      )}
    </div>
  )
}

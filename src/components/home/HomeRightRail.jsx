import { Link, useNavigate } from 'react-router-dom'
import { CalendarClock, Sparkles, Bot, RefreshCw, MapPin, TrendingUp } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useTopicSuggestions, useLocations, useTopPerformers, queryKeys } from '@/lib/queries'
import { toast } from '@/lib/toast'

const PLATFORM_LABELS = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  twitter: 'Twitter / X',
  gbp: 'Google Business',
  wordpress: 'Website',
  email: 'Email',
}

function formatScheduled(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// Skeleton loader — 5 shimmer rows while suggestions are fetching.
function SuggestionSkeleton() {
  return (
    <ul className="divide-y">
      {[...Array(5)].map((_, i) => (
        <li key={i} className="px-4 py-2.5">
          <div className="h-3.5 bg-muted rounded animate-pulse w-4/5" />
        </li>
      ))}
    </ul>
  )
}

// Right rail for the Home page.
// Props:
//   stories  — array from useStories() — we filter to upcoming scheduled pieces
//   isAdmin  — boolean; shows the Locations overview card when true
export default function HomeRightRail({ stories = [], isAdmin = false }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data, isLoading, isFetching } = useTopicSuggestions()
  const { data: topPerformers = [] } = useTopPerformers()

  const { data: locations = [] } = useLocations()

  const now = Date.now()
  const in7Days = now + 7 * 24 * 60 * 60 * 1000

  // Flatten stories → pieces, keep only pieces with scheduled_at in next 7 days
  const upcoming = stories
    .flatMap((s) =>
      (s.pieces || [])
        .filter((p) => {
          if (!p.scheduled_at) return false
          const t = new Date(p.scheduled_at).getTime()
          return t >= now && t <= in7Days
        })
        .map((p) => ({ ...p, storyId: s.id, clinicianName: s.clinicianName }))
    )
    .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))
    .slice(0, 8)

  const suggestions = data?.suggestions ?? []

  function handleSuggestionClick(topic) {
    navigate(`/new?topic=${encodeURIComponent(topic)}`)
  }

  async function handleRefresh() {
    // Invalidate client cache and hit the server with ?refresh=true to bust
    // the 7-day server-side cache. The query refetch will call the normal
    // endpoint; we separately ping the refresh URL so the next cache write
    // gets fresh data without blocking the UI.
    try {
      await fetch('/api/topic-suggestions?refresh=true', { credentials: 'include' })
    } catch (err) {
      toast.error('Failed to refresh suggestions', { description: err.message })
    }
    qc.invalidateQueries({ queryKey: queryKeys.topicSuggestions })
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Upcoming scheduled posts */}
      <div className="rounded-xl border bg-white shadow-sm">
        <div className="flex items-center gap-2 px-4 py-3 border-b">
          <CalendarClock className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold flex-1">Scheduled this week</h2>
        </div>
        {upcoming.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted-foreground">
            Nothing scheduled in the next 7 days.
          </p>
        ) : (
          <ul className="divide-y">
            {upcoming.map((p) => (
              <li key={p.id}>
                <Link
                  to={`/stories/${p.storyId}`}
                  className="flex flex-col gap-0.5 px-4 py-2.5 hover:bg-accent/20 transition-colors"
                >
                  <span className="text-xs font-medium text-foreground truncate">
                    {PLATFORM_LABELS[p.platform] || p.platform}
                    {p.clinicianName ? ` · ${p.clinicianName}` : ''}
                  </span>
                  <span className="text-2xs text-muted-foreground">
                    {formatScheduled(p.scheduled_at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* What's working — top performers by reach */}
      {topPerformers.length > 0 && (
        <div className="rounded-xl border bg-white shadow-sm">
          <div className="flex items-center gap-2 px-4 py-3 border-b">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold flex-1">What&apos;s working</h2>
          </div>
          <ul className="divide-y">
            {topPerformers.map((item) => (
              <li key={item.id} className="px-4 py-2.5 flex flex-col gap-0.5">
                <span className="text-xs font-medium text-foreground truncate leading-snug">
                  {item.topic || 'Untitled'}
                </span>
                <div className="flex items-center gap-2 text-2xs text-muted-foreground">
                  <span>{PLATFORM_LABELS[item.platform] || item.platform}</span>
                  {item.buffer_metrics?.reach > 0 && (
                    <span className="font-medium text-success">
                      {item.buffer_metrics.reach.toLocaleString()} reach
                    </span>
                  )}
                  {item.buffer_metrics?.engagement > 0 && (
                    <span>{item.buffer_metrics.engagement} engagements</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Topic suggestions — AI-generated patient questions */}
      <div className="rounded-xl border bg-white shadow-sm">
        <div className="flex items-center gap-2 px-4 py-3 border-b">
          <Sparkles className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold flex-1">Questions patients are asking</h2>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isLoading || isFetching}
            title="Refresh suggestions"
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent/20 transition-colors disabled:opacity-40"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {isLoading ? (
          <SuggestionSkeleton />
        ) : suggestions.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted-foreground">
            No suggestions yet — click refresh to generate.
          </p>
        ) : (
          <ul className="divide-y">
            {suggestions.map((topic, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => handleSuggestionClick(topic)}
                  className="w-full text-left px-4 py-2.5 text-xs text-foreground hover:bg-accent/20 transition-colors leading-snug"
                >
                  {topic}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Locations overview — admin only, 2+ locations */}
      {isAdmin && locations.length > 1 && (
        <div className="rounded-xl border bg-white shadow-sm">
          <div className="flex items-center gap-2 px-4 py-3 border-b">
            <MapPin className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold flex-1">Locations</h2>
          </div>
          <ul className="divide-y">
            {locations.map((loc) => {
              const locStories = stories.filter((s) => s.location_id === loc.id)
              const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
              const thisMonth = locStories.filter(
                (s) => s.updated_at && new Date(s.updated_at) >= monthStart
              ).length
              return (
                <li key={loc.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate">{loc.label || loc.city}</p>
                    {loc.city && loc.region && (
                      <p className="text-3xs text-muted-foreground">{loc.city}, {loc.region}</p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold tabular-nums">{locStories.length}</p>
                    {thisMonth > 0 && (
                      <p className="text-3xs text-muted-foreground">+{thisMonth} mo</p>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* Bernard nudge — stub */}
      <div className="rounded-xl border bg-white shadow-sm">
        <div className="flex items-center gap-2 px-4 py-3 border-b">
          <Bot className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold flex-1">Bernard</h2>
        </div>
        <p className="px-4 py-4 text-sm text-muted-foreground">
          Bernard is analyzing your workspace…
        </p>
      </div>
    </div>
  )
}

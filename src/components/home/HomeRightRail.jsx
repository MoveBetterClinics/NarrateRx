import { Link } from 'react-router-dom'
import { CalendarClock, Sparkles, Bot } from 'lucide-react'

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

// Right rail for the Home page.
// Props:
//   stories — array from useStories() — we filter to upcoming scheduled pieces
export default function HomeRightRail({ stories = [] }) {
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
                  <span className="text-[11px] text-muted-foreground">
                    {formatScheduled(p.scheduled_at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Topic suggestions — stub */}
      <div className="rounded-xl border bg-white shadow-sm">
        <div className="flex items-center gap-2 px-4 py-3 border-b">
          <Sparkles className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold flex-1">Topic suggestions</h2>
        </div>
        <p className="px-4 py-4 text-sm text-muted-foreground">
          Coming soon — Bernard will suggest topics based on your top posts.
        </p>
      </div>

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

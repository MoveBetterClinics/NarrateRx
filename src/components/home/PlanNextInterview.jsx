import { Link } from 'react-router-dom'
import { TrendingUp, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import Icon from '@/components/ui/Icon'

// Amber callout that shows high-search topic gaps and a "New Interview" CTA.
// Props:
//   gaps              — array of { topic, priority } from getSuggestedTopics
//                       (already filtered by activePrototypeId on the parent)
//   isEmpty           — true when no interviews exist yet (changes copy)
//   prototypes        — array of { id, label, emoji, description } from
//                       getPatientPrototypesUi(workspace). First entry has
//                       id === null and is the "all patients" affordance.
//                       Pass [] or a single-entry array to hide the chips
//                       (workspaces with no archetypes defined).
//   activePrototypeId — currently selected archetype id (or null for all)
//   onPrototypeChange — setter for activePrototypeId
export default function PlanNextInterview({
  gaps,
  isEmpty = false,
  prototypes = [],
  activePrototypeId = null,
  onPrototypeChange,
}) {
  // Hide the chip strip when the workspace hasn't defined any archetypes —
  // prototypesUi always returns at least one "All patients" sentinel, so
  // "no archetypes" means length <= 1.
  const showChips = prototypes.length > 1 && typeof onPrototypeChange === 'function'

  // Parent renders this whenever unfiltered gaps > 0, so we may legitimately
  // be called with gaps=[] when the active filter excludes everything. In
  // that case keep the card up so the user can clear the filter.
  const filteredEmpty = gaps.length === 0

  return (
    <div className="rounded-2xl border border-[#f3d3b5] bg-gradient-to-b from-white to-[#fefaf7] p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-18px_rgba(227,101,37,0.22)]">
      <div className="flex flex-col sm:flex-row items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span
              className="inline-block w-1 h-5 rounded-full shrink-0"
              style={{ background: 'hsl(var(--primary))' }}
              aria-hidden="true"
            />
            <Icon as={TrendingUp} size="md" className="text-primary" />
            <h2 className="text-xl font-bold tracking-tight text-foreground">
              {isEmpty ? 'Start with a high-impact topic' : 'Plan your next interview'}
            </h2>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            {isEmpty
              ? 'These are high-search topics in your area — pick one to kick off your first interview.'
              : 'High-search topics with no content yet — pick one to start an interview.'}
          </p>

          {showChips && (
            <div className="flex flex-wrap gap-1 items-center mb-3">
              <span className="text-3xs text-muted-foreground mr-1 uppercase tracking-wide">For:</span>
              {prototypes.map((p) => {
                const active = activePrototypeId === p.id
                return (
                  <button
                    key={String(p.id)}
                    type="button"
                    onClick={() => onPrototypeChange(p.id)}
                    title={p.description || p.label}
                    className={`inline-flex items-center gap-1 text-2xs px-2 py-0.5 rounded-full border transition-colors ${
                      active
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-accent border-primary/30 text-accent-foreground hover:bg-accent/80'
                    }`}
                  >
                    {p.emoji && <span>{p.emoji}</span>}
                    {p.label}
                  </button>
                )
              })}
            </div>
          )}

          {filteredEmpty ? (
            <p className="text-xs text-muted-foreground italic">
              No high-priority gaps tagged for this archetype. Clear the filter to see all topics,
              or tag more topics in workspace settings.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {gaps.map((t) => (
                <Link
                  key={t.topic}
                  to={`/new?topic=${encodeURIComponent(t.topic)}`}
                  className="text-xs px-2.5 py-1 rounded-full bg-accent border border-primary/30 text-accent-foreground hover:bg-primary/10 transition-colors"
                >
                  + {t.topic}
                </Link>
              ))}
            </div>
          )}
        </div>
        <Button asChild className="shrink-0">
          <Link to="/new">
            <Icon as={Plus} size="md" className="mr-1.5" />
            New Interview
          </Link>
        </Button>
      </div>
    </div>
  )
}

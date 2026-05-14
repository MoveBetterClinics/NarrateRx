import { Link } from 'react-router-dom'
import { TrendingUp, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'

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

          {showChips && (
            <div className="flex flex-wrap gap-1 items-center mb-3">
              <span className="text-[10px] text-amber-900/70 mr-1 uppercase tracking-wide">For:</span>
              {prototypes.map((p) => {
                const active = activePrototypeId === p.id
                return (
                  <button
                    key={String(p.id)}
                    type="button"
                    onClick={() => onPrototypeChange(p.id)}
                    title={p.description || p.label}
                    className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
                      active
                        ? 'bg-amber-900 text-amber-50 border-amber-900'
                        : 'bg-amber-100/60 border-amber-300 text-amber-900 hover:bg-amber-200'
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
            <p className="text-xs text-amber-800/80 italic">
              No high-priority gaps tagged for this archetype. Clear the filter to see all topics,
              or tag more topics in workspace settings.
            </p>
          ) : (
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
          )}
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

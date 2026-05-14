import { Link } from 'react-router-dom'
import { TrendingUp, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'

// Amber callout that shows high-search topic gaps and a "New Interview" CTA.
// Props:
//   gaps    — array of { topic, priority } from getSuggestedTopics
//   isEmpty — true when no interviews exist yet (changes copy)
export default function PlanNextInterview({ gaps, isEmpty = false }) {
  if (!gaps || gaps.length === 0) return null

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

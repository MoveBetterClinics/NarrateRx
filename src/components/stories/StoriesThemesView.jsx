import { useNavigate } from 'react-router-dom'
import { Users, ArrowRight, Layers } from 'lucide-react'

// ── Stage dot colours ────────────────────────────────────────────────────────

const STAGE_COLORS = {
  capture:   'bg-gray-400',
  drafting:  'bg-yellow-400',
  review:    'bg-blue-400',
  scheduled: 'bg-purple-400',
  published: 'bg-green-500',
}

const STAGE_LABELS = {
  capture:   'Capture',
  drafting:  'Drafting',
  review:    'Review',
  scheduled: 'Scheduled',
  published: 'Published',
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Return the first sentence of a string, or the full string if no sentence
 * boundary is found. Gracefully handles null/empty.
 */
function firstSentence(text) {
  if (!text) return null
  const match = text.match(/[^.!?]*[.!?]/)
  return match ? match[0].trim() : text.slice(0, 120).trim()
}

/**
 * Group stories by topic (case-insensitive, trimmed).
 * Returns an array of { topic, stories } sorted by story count desc.
 */
function groupByTopic(stories) {
  const map = new Map()
  for (const story of stories) {
    const key = (story.topic || '').trim().toLowerCase()
    const canonical = (story.topic || '').trim() || 'Untitled'
    if (!map.has(key)) {
      map.set(key, { topic: canonical, stories: [] })
    }
    map.get(key).stories.push(story)
  }
  return [...map.values()].sort((a, b) => b.stories.length - a.stories.length)
}

/**
 * Derive a short preview snippet for a story. Falls back to the topic itself
 * when there's no piece content (pieces are summarised without content field).
 */
function storySnippet(story) {
  // pieces in the Story shape are summarised (no content text),
  // so we fall back to the interview topic as a label.
  return story.topic || 'Interview completed'
}

// ── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonThemeCard() {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-5 animate-pulse">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="h-5 bg-gray-200 rounded w-2/3" />
        <div className="h-5 bg-gray-200 rounded-full w-20 shrink-0" />
      </div>
      <div className="flex gap-1.5 mb-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-7 w-7 bg-gray-200 rounded-full" />
        ))}
      </div>
      <div className="border-l-2 border-gray-200 pl-3 mb-4 space-y-2">
        <div className="h-3 bg-gray-200 rounded w-full" />
        <div className="h-3 bg-gray-200 rounded w-4/5" />
      </div>
      <div className="flex gap-1.5 mb-4">
        {[1, 2].map((i) => (
          <div key={i} className="h-3 w-3 bg-gray-200 rounded-full" />
        ))}
      </div>
      <div className="h-8 bg-gray-100 rounded w-full" />
    </div>
  )
}

// ── ThemeCard ─────────────────────────────────────────────────────────────────

function ThemeCard({ topic, stories }) {
  const navigate = useNavigate()

  // Clinician initials — deduplicated by clinician_id
  const seen = new Set()
  const clinicians = []
  for (const s of stories) {
    if (!seen.has(s.clinician_id)) {
      seen.add(s.clinician_id)
      clinicians.push({ id: s.clinician_id, name: s.clinician_name || '?' })
    }
  }

  // Stage distribution across all stories in this theme
  const stageCounts = {}
  for (const s of stories) {
    stageCounts[s.story_stage] = (stageCounts[s.story_stage] || 0) + 1
  }
  const stagesPresent = Object.entries(stageCounts).filter(([, n]) => n > 0)

  // Contrasting perspectives: first 2 stories when there are multiple
  const perspectives = stories.slice(0, 3).map((s) => ({
    name: s.clinician_name || 'Clinician',
    snippet: firstSentence(storySnippet(s)),
  }))

  const hasContrast = stories.length >= 2

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-5 flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-semibold text-gray-900 text-base leading-snug">{topic}</h3>
        <span className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 text-xs font-medium px-2.5 py-1 rounded-full shrink-0">
          <Users size={11} />
          {clinicians.length} {clinicians.length === 1 ? 'clinician' : 'clinicians'}
        </span>
      </div>

      {/* Clinician chips */}
      <div className="flex flex-wrap gap-1.5">
        {clinicians.map((c) => {
          const initials = c.name
            .split(' ')
            .slice(0, 2)
            .map((w) => w[0]?.toUpperCase() || '')
            .join('')
          return (
            <span
              key={c.id}
              title={c.name}
              className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-indigo-100 text-indigo-700 text-xs font-semibold select-none"
            >
              {initials || '?'}
            </span>
          )
        })}
        {clinicians.length > 5 && (
          <span className="inline-flex items-center justify-center h-7 px-2 rounded-full bg-gray-100 text-gray-500 text-xs">
            +{clinicians.length - 5}
          </span>
        )}
      </div>

      {/* Contrasting perspectives */}
      {hasContrast && (
        <div>
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">
            Contrasting views
          </p>
          <div className="space-y-2">
            {perspectives.map((p, i) => (
              <div
                key={i}
                className="flex gap-2.5 border-l-2 border-indigo-200 pl-3"
              >
                <p className="text-sm text-gray-600 leading-snug">
                  <span className="font-medium text-gray-700">{p.name}:</span>{' '}
                  {p.snippet}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stage distribution dots */}
      <div className="flex items-center gap-2 flex-wrap">
        {stagesPresent.map(([stage, count]) => (
          <span key={stage} className="inline-flex items-center gap-1.5 text-xs text-gray-500">
            <span
              className={`h-2.5 w-2.5 rounded-full shrink-0 ${STAGE_COLORS[stage] || 'bg-gray-300'}`}
              title={STAGE_LABELS[stage] || stage}
            />
            {count} {STAGE_LABELS[stage] || stage}
          </span>
        ))}
      </div>

      {/* CTA */}
      <button
        type="button"
        onClick={() => navigate(`/new?topic=${encodeURIComponent(topic)}`)}
        className="mt-auto w-full flex items-center justify-center gap-2 py-2 px-4 rounded-md bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-sm font-medium transition-colors"
      >
        Build content from this theme
        <ArrowRight size={14} />
      </button>
    </div>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────

function ThemesEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="h-12 w-12 rounded-full bg-indigo-50 flex items-center justify-center mb-4">
        <Layers size={22} className="text-indigo-400" />
      </div>
      <h3 className="text-base font-medium text-gray-700 mb-1">No shared themes yet</h3>
      <p className="text-sm text-gray-500 max-w-xs">
        No shared themes yet — more interviews will reveal patterns across your team.
      </p>
    </div>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────

/**
 * StoriesThemesView — cross-staff topic synthesis.
 *
 * Groups stories by topic, surfaces contrasting perspectives per theme,
 * and gives admins a "Build content from this theme" CTA.
 *
 * @param {{ stories: Array, isLoading: boolean }} props
 */
export default function StoriesThemesView({ stories = [], isLoading = false }) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonThemeCard key={i} />
        ))}
      </div>
    )
  }

  const groups = groupByTopic(stories)
  const sharedThemes = groups.filter((g) => g.stories.length >= 2)

  if (sharedThemes.length === 0) {
    return <ThemesEmptyState />
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {sharedThemes.map((g) => (
        <ThemeCard key={g.topic} topic={g.topic} stories={g.stories} />
      ))}
    </div>
  )
}

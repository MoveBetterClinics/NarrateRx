import { useNavigate } from 'react-router-dom'
import { useSearchParams } from 'react-router-dom'
import { Users, ArrowRight, Layers, MapPin } from 'lucide-react'
import { useLocations } from '@/lib/queries'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { getStoryArchetypes } from '@/lib/topicSuggestions'
import { getStageToken } from '@/lib/stageTokens'
import { ClinicianChip } from '@/components/ClinicianChip'

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
 * Best verbatim quote for a story. Uses the first pull_quote_candidate when
 * available (actual clinician voice), falls back to the topic label.
 */
function storySnippet(story) {
  return story.verbatim_snippet || story.topic || 'Interview completed'
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

// ── Archetype helpers ───────────────────────────────────────────────────────

/**
 * Build the per-card archetype-mix summary: how many stories in this theme
 * matched each archetype defined on the workspace, plus a count of stories
 * whose topic didn't match any tagged suggestion (the "untagged" bucket).
 *
 * Returns an array of { id, label, emoji, count } for archetypes with
 * count > 0, plus an `untagged` count. Order follows the workspace's
 * patient_context.prototypes[] order so cards line up visually.
 *
 * Stories can match multiple archetypes (when the topic's keywords match
 * suggestions tagged with different prototypes). Each match increments
 * that archetype's bucket; a story tagged for two archetypes contributes
 * to both totals. This is the right semantics for "archetype mix" — it
 * answers "how many stories in this theme speak to archetype X" rather
 * than partitioning stories into exclusive buckets.
 */
function archetypeMix(stories, workspace) {
  const prototypes = Array.isArray(workspace?.patient_context?.prototypes)
    ? workspace.patient_context.prototypes
    : []
  if (prototypes.length === 0) return { byArchetype: [], untagged: 0 }

  const counts = new Map()
  for (const p of prototypes) counts.set(p.id, 0)
  let untagged = 0

  for (const s of stories) {
    const ids = getStoryArchetypes(s.topic, workspace)
    if (ids.length === 0) {
      untagged += 1
      continue
    }
    for (const id of ids) {
      if (counts.has(id)) counts.set(id, counts.get(id) + 1)
    }
  }

  const byArchetype = prototypes
    .map((p) => ({
      id: p.id,
      label: p.shortLabel || p.label || p.id,
      emoji: p.emoji || '',
      count: counts.get(p.id) || 0,
    }))
    .filter((row) => row.count > 0)

  return { byArchetype, untagged }
}

// ── ThemeCard ─────────────────────────────────────────────────────────────────

function ThemeCard({ topic, stories, workspace }) {
  const navigate = useNavigate()
  const { byArchetype, untagged } = archetypeMix(stories, workspace)
  const showMix = byArchetype.length > 0 || untagged > 0

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

  // Contrasting perspectives: first 3 stories when there are multiple.
  // isVerbatim distinguishes actual pull-quote voice from topic-label fallback.
  const perspectives = stories.slice(0, 3).map((s) => ({
    clinicianId: s.clinician_id,
    name: s.clinician_name || 'Clinician',
    snippet: firstSentence(storySnippet(s)),
    isVerbatim: !!s.verbatim_snippet,
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

      {/* Archetype mix — surfaces the cross-archetype distribution for
          this theme without requiring a filter. Hidden when the workspace
          has no patient_context.prototypes[]. */}
      {showMix && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wide text-gray-400 mr-1">Archetypes</span>
          {byArchetype.map((row) => (
            <span
              key={row.id}
              className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-800 border border-indigo-200"
            >
              {row.emoji && <span>{row.emoji}</span>}
              {row.count} {row.label.toLowerCase()}
            </span>
          ))}
          {untagged > 0 && (
            <span
              className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 border border-gray-200"
              title="Story topics that didn't match any tagged topic_suggestions[] keyword"
            >
              untagged {untagged}
            </span>
          )}
        </div>
      )}

      {/* Clinician chips */}
      <div className="flex flex-wrap gap-1.5">
        {clinicians.slice(0, 5).map((c) => (
          <ClinicianChip key={c.id} id={c.id} name={c.name} />
        ))}
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
              <div key={i} className="flex items-start gap-2 border-l-2 border-indigo-200 pl-3">
                <ClinicianChip id={p.clinicianId} name={p.name} size="sm" className="mt-0.5 shrink-0" />
                <p className={`text-sm leading-snug ${p.isVerbatim ? 'text-gray-800 italic' : 'text-gray-500'}`}>
                  {p.isVerbatim ? `"${p.snippet}"` : p.snippet}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stage distribution dots */}
      <div className="flex items-center gap-2 flex-wrap">
        {stagesPresent.map(([stage, count]) => {
          const tok = getStageToken(stage)
          return (
            <span key={stage} className="inline-flex items-center gap-1.5 text-xs text-gray-500">
              <span
                className={`h-2.5 w-2.5 rounded-full shrink-0 ${tok.dot}`}
                title={tok.label}
              />
              {count} {tok.label}
            </span>
          )
        })}
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
  const [searchParams] = useSearchParams()
  const activeLocation = searchParams.get('location') || ''
  const activeArchetype = searchParams.get('archetype') || ''
  const { data: locations = [] } = useLocations()
  const workspace = useWorkspace()

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonThemeCard key={i} />
        ))}
      </div>
    )
  }

  // Apply the archetype filter at the story level before any grouping, so a
  // theme that loses every member to the filter falls out of "shared theme"
  // (≥2 stories) naturally rather than rendering as an empty card. The mix
  // row on surviving cards still shows the full per-archetype counts (it
  // recomputes from the filtered story slice, so a "Reconnect" filter
  // shows reconnect-only counts — consistent with what the user selected).
  const archetypeFiltered = activeArchetype
    ? stories.filter((s) =>
        getStoryArchetypes(s.topic, workspace).includes(activeArchetype)
      )
    : stories

  // When a location filter is active, show "This location" header then themes
  // filtered to that location. When no filter, show all shared themes as before.
  if (activeLocation) {
    const locationLabel = locations.find((l) => l.id === activeLocation)?.label
      || locations.find((l) => l.id === activeLocation)?.city
      || 'This location'
    const locationStories = archetypeFiltered.filter((s) => s.location_id === activeLocation)
    const groups = groupByTopic(locationStories)
    const sharedThemes = groups.filter((g) => g.stories.length >= 2)

    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-gray-700">{locationLabel}</h2>
          <span className="text-xs text-gray-400">{locationStories.length} stories</span>
        </div>
        {sharedThemes.length === 0 ? (
          <ThemesEmptyState />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {sharedThemes.map((g) => (
              <ThemeCard key={g.topic} topic={g.topic} stories={g.stories} workspace={workspace} />
            ))}
          </div>
        )}
      </div>
    )
  }

  const groups = groupByTopic(archetypeFiltered)
  const sharedThemes = groups.filter((g) => g.stories.length >= 2)

  if (sharedThemes.length === 0) {
    return <ThemesEmptyState />
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {sharedThemes.map((g) => (
        <ThemeCard key={g.topic} topic={g.topic} stories={g.stories} workspace={workspace} />
      ))}
    </div>
  )
}

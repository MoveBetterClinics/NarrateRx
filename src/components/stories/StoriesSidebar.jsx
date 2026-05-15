import { useState, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PLATFORM_META } from '@/lib/contentMeta'
import { useStories, useLocations } from '@/lib/queries'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { getPatientPrototypesUi } from '@/lib/prompts'

const STAGES = [
  { key: 'capture',   label: 'Capture' },
  { key: 'drafting',  label: 'Drafting' },
  { key: 'review',    label: 'Review' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'published', label: 'Published' },
]

const PLATFORMS = Object.keys(PLATFORM_META)

// Match a single story against the active filters, optionally skipping one
// dimension so we can compute "what would I see if I clicked this row?"
// counts that respect the user's other choices.
function matches(story, { stage, platform, location, archetype }, skip) {
  if (skip !== 'stage' && stage && story.story_stage !== stage) return false
  if (skip !== 'platform' && platform && !story.pieces?.some((p) => p.platform === platform)) return false
  if (skip !== 'location' && location && story.location_id !== location) return false
  if (skip !== 'archetype' && archetype && story.prototype_id !== archetype) return false
  return true
}

function Section({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70 hover:text-muted-foreground"
      >
        <span>{title}</span>
        <span className="text-muted-foreground/40">{open ? '−' : '+'}</span>
      </button>
      {open && <nav className="space-y-0.5 mt-1">{children}</nav>}
    </div>
  )
}

function Row({ label, count, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'w-full flex items-center justify-between text-left text-sm rounded-md px-2.5 py-1.5 transition-colors ' +
        (active
          ? 'bg-gray-900 text-white'
          : 'text-foreground/80 hover:bg-accent/40')
      }
    >
      <span className="truncate">{label}</span>
      {count != null && (
        <span className={'text-xs tabular-nums shrink-0 ml-2 ' + (active ? 'text-gray-300' : 'text-muted-foreground')}>
          {count}
        </span>
      )}
    </button>
  )
}

/**
 * Castmagic-style left rail for the Stories surface. Reads/writes the same
 * URL params (`?stage=`, `?platform=`, `?location=`, `?archetype=`) that the
 * view components already consume — swap-in replacement for StoriesFilters.
 *
 * Counts per row reflect the active filter intersection EXCLUDING the row's
 * own dimension, so each count answers "what would I see if I clicked this?"
 * given the user's other choices.
 */
export default function StoriesSidebar() {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeStage = searchParams.get('stage') || ''
  const activePlatform = searchParams.get('platform') || ''
  const activeLocation = searchParams.get('location') || ''
  const activeArchetype = searchParams.get('archetype') || ''

  const { data: stories = [] } = useStories()
  const { data: locations = [] } = useLocations()
  const workspace = useWorkspace()
  const prototypes = getPatientPrototypesUi(workspace).filter((p) => p.id != null)

  const showLocations = locations.length > 1
  const showArchetypes = prototypes.length > 0

  const active = { stage: activeStage, platform: activePlatform, location: activeLocation, archetype: activeArchetype }

  const counts = useMemo(() => {
    const stageCounts = { __all: 0 }
    const platformCounts = { __all: 0 }
    const locationCounts = { __all: 0 }
    const archetypeCounts = { __all: 0 }

    for (const s of stories) {
      if (matches(s, active, 'stage')) {
        stageCounts.__all += 1
        const k = s.story_stage
        if (k) stageCounts[k] = (stageCounts[k] || 0) + 1
      }
      if (matches(s, active, 'platform')) {
        platformCounts.__all += 1
        const seen = new Set()
        for (const p of s.pieces || []) {
          if (p.platform && !seen.has(p.platform)) {
            platformCounts[p.platform] = (platformCounts[p.platform] || 0) + 1
            seen.add(p.platform)
          }
        }
      }
      if (matches(s, active, 'location')) {
        locationCounts.__all += 1
        const k = s.location_id
        if (k) locationCounts[k] = (locationCounts[k] || 0) + 1
      }
      if (matches(s, active, 'archetype')) {
        archetypeCounts.__all += 1
        const k = s.prototype_id
        if (k) archetypeCounts[k] = (archetypeCounts[k] || 0) + 1
      }
    }
    return { stage: stageCounts, platform: platformCounts, location: locationCounts, archetype: archetypeCounts }
    // `active` itself is a new object literal each render, so the deps list
    // tracks the four primitive fields `matches()` actually reads. ESLint
    // can't see inside `matches` to verify, hence the disable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stories, active.stage, active.platform, active.location, active.archetype])

  function setParam(key, value) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (value) next.set(key, value)
      else next.delete(key)
      return next
    }, { replace: true })
  }

  const hasActiveFilters = activeStage || activePlatform || activeLocation || activeArchetype

  function clearAll() {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('stage'); next.delete('platform'); next.delete('location'); next.delete('archetype')
      return next
    }, { replace: true })
  }

  return (
    <div className="sticky top-20 space-y-5">
      <Row
        label="All stories"
        count={stories.length}
        active={!hasActiveFilters}
        onClick={clearAll}
      />

      <Section title="Stage">
        {STAGES.map((s) => (
          <Row
            key={s.key}
            label={s.label}
            count={counts.stage[s.key] || 0}
            active={activeStage === s.key}
            onClick={() => setParam('stage', activeStage === s.key ? '' : s.key)}
          />
        ))}
      </Section>

      <Section title="Platform">
        {PLATFORMS
          .filter((p) => (counts.platform[p] || 0) > 0 || activePlatform === p)
          .map((p) => (
            <Row
              key={p}
              label={PLATFORM_META[p].label}
              count={counts.platform[p] || 0}
              active={activePlatform === p}
              onClick={() => setParam('platform', activePlatform === p ? '' : p)}
            />
          ))}
      </Section>

      {showLocations && (
        <Section title="Location">
          {locations.map((loc) => (
            <Row
              key={loc.id}
              label={loc.label || loc.city}
              count={counts.location[loc.id] || 0}
              active={activeLocation === loc.id}
              onClick={() => setParam('location', activeLocation === loc.id ? '' : loc.id)}
            />
          ))}
        </Section>
      )}

      {showArchetypes && (
        <Section title="Archetype">
          {prototypes.map((p) => (
            <Row
              key={p.id}
              label={p.emoji ? `${p.emoji} ${p.label}` : p.label}
              count={counts.archetype[p.id] || 0}
              active={activeArchetype === p.id}
              onClick={() => setParam('archetype', activeArchetype === p.id ? '' : p.id)}
            />
          ))}
        </Section>
      )}
    </div>
  )
}

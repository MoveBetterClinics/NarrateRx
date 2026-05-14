import { useSearchParams } from 'react-router-dom'
import { PLATFORM_META } from '@/lib/contentMeta'
import { useLocations } from '@/lib/queries'

const PLATFORMS = Object.keys(PLATFORM_META)

const STAGES = [
  { key: '',          label: 'All' },
  { key: 'capture',   label: 'Capture' },
  { key: 'drafting',  label: 'Drafting' },
  { key: 'review',    label: 'Review' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'published', label: 'Published' },
]

function Chip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? 'px-2.5 py-1 text-xs font-medium rounded-full bg-gray-900 text-white transition-colors'
          : 'px-2.5 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors'
      }
    >
      {children}
    </button>
  )
}

/**
 * Horizontal filter chip row for platform, stage, and location.
 * Writes to `?platform=`, `?stage=`, and `?location=` in the URL.
 * The Location group only renders when the workspace has 2+ active locations.
 */
export default function StoriesFilters() {
  const [searchParams, setSearchParams] = useSearchParams()
  const activePlatform = searchParams.get('platform') || ''
  const activeStage = searchParams.get('stage') || ''
  const activeLocation = searchParams.get('location') || ''

  const { data: locations = [] } = useLocations()
  // Only show location filter when there are multiple locations
  const showLocations = locations.length > 1

  function setPlatform(key) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (key) next.set('platform', key)
      else next.delete('platform')
      return next
    }, { replace: true })
  }

  function setStage(key) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (key) next.set('stage', key)
      else next.delete('stage')
      return next
    }, { replace: true })
  }

  function setLocation(id) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (id) next.set('location', id)
      else next.delete('location')
      return next
    }, { replace: true })
  }

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
      {/* Platform filter */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-xs text-gray-400 font-medium mr-1">Platform</span>
        <Chip active={activePlatform === ''} onClick={() => setPlatform('')}>All</Chip>
        {PLATFORMS.map((p) => (
          <Chip key={p} active={activePlatform === p} onClick={() => setPlatform(p)}>
            {PLATFORM_META[p].label}
          </Chip>
        ))}
      </div>

      {/* Stage filter */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-xs text-gray-400 font-medium mr-1">Stage</span>
        {STAGES.map(({ key, label }) => (
          <Chip key={key || 'all'} active={activeStage === key} onClick={() => setStage(key)}>
            {label}
          </Chip>
        ))}
      </div>

      {/* Location filter — only when workspace has multiple locations */}
      {showLocations && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-gray-400 font-medium mr-1">Location</span>
          <Chip active={activeLocation === ''} onClick={() => setLocation('')}>All locations</Chip>
          {locations.map((loc) => (
            <Chip key={loc.id} active={activeLocation === loc.id} onClick={() => setLocation(loc.id)}>
              {loc.label || loc.city}
            </Chip>
          ))}
        </div>
      )}
    </div>
  )
}

import { Link } from 'react-router-dom'
import { formatRelativeDate } from '@/lib/utils'

// Stage badge colors aligned with the canonical stages from stories.js.
const STAGE_BADGE = {
  capture:   'bg-blue-100 text-blue-700',
  drafting:  'bg-yellow-100 text-yellow-700',
  review:    'bg-orange-100 text-orange-700',
  scheduled: 'bg-purple-100 text-purple-700',
  published: 'bg-green-100 text-green-700',
}

// Short labels for platform chips shown on the card.
const PLATFORM_SHORT = {
  blog:          'Blog',
  instagram:     'IG',
  facebook:      'FB',
  linkedin:      'LI',
  gbp:           'GBP',
  google_ads:    'G Ads',
  instagram_ads: 'IG Ads',
  landing_page:  'LP',
  youtube:       'YT',
  tiktok:        'TT',
  email:         'Email',
  pinterest:     'Pin',
}

// Platform chip colors (dot accent).
const PLATFORM_DOT = {
  blog:          'bg-slate-400',
  instagram:     'bg-pink-500',
  facebook:      'bg-blue-500',
  linkedin:      'bg-sky-600',
  gbp:           'bg-green-600',
  google_ads:    'bg-yellow-500',
  instagram_ads: 'bg-rose-500',
  landing_page:  'bg-purple-500',
  youtube:       'bg-red-500',
  tiktok:        'bg-fuchsia-500',
  email:         'bg-teal-500',
  pinterest:     'bg-red-400',
}

/**
 * StoryCard — single card in the Cards grid.
 *
 * @param {{ story: import('../../lib/stories').Story }} props
 */
export default function StoryCard({ story }) {
  const {
    id,
    clinician_name,
    topic,
    pieces,
    pieces_count,
    story_stage,
    last_activity_at,
  } = story

  // Unique platforms represented in this story's pieces.
  const platforms = [...new Set((pieces || []).map((p) => p.platform).filter(Boolean))]

  const badgeClass = STAGE_BADGE[story_stage] ?? 'bg-gray-100 text-gray-600'
  const stageLabel = story_stage
    ? story_stage.charAt(0).toUpperCase() + story_stage.slice(1)
    : 'Unknown'

  return (
    <Link
      to={`/stories/${id}`}
      className="block bg-white rounded-lg shadow-sm border border-gray-100 p-4 hover:shadow-md hover:border-gray-200 transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
    >
      {/* Top row: clinician name + stage badge */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="font-medium text-gray-900 text-sm leading-tight truncate">
          {clinician_name || 'Unknown clinician'}
        </span>
        <span className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${badgeClass}`}>
          {stageLabel}
        </span>
      </div>

      {/* Topic */}
      <p className="text-sm text-gray-600 line-clamp-2 mb-3 leading-snug">
        {topic || <span className="italic text-gray-400">No topic set</span>}
      </p>

      {/* Pieces count + platform chips */}
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <span className="text-xs text-gray-400">
          {pieces_count === 1 ? '1 piece' : `${pieces_count} pieces`}
        </span>
        {platforms.map((p) => (
          <span
            key={p}
            className="inline-flex items-center gap-1 text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded px-1.5 py-0.5"
          >
            <span className={`w-1.5 h-1.5 rounded-full ${PLATFORM_DOT[p] ?? 'bg-gray-400'}`} />
            {PLATFORM_SHORT[p] ?? p}
          </span>
        ))}
      </div>

      {/* Last activity */}
      <div className="text-xs text-gray-400">
        {last_activity_at ? formatRelativeDate(last_activity_at) : 'No activity recorded'}
      </div>
    </Link>
  )
}

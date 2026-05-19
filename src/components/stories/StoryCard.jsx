import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Target } from 'lucide-react'
import { formatRelativeDate } from '@/lib/utils'
import { queryKeys, fetchStory } from '@/lib/queries'
import { getStageToken } from '@/lib/stageTokens'
import { ClinicianChip } from '@/components/ClinicianChip'

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
  const qc = useQueryClient()
  const {
    id,
    clinician_id,
    clinician_name,
    topic,
    pieces,
    pieces_count,
    story_stage,
    last_activity_at,
    campaign_id,
    campaign_name,
  } = story

  // Unique platforms represented in this story's pieces.
  const platforms = [...new Set((pieces || []).map((p) => p.platform).filter(Boolean))]

  const { badge: badgeClass, label: stageLabel } = getStageToken(story_stage || '')

  return (
    <Link
      to={`/stories/${id}`}
      onMouseEnter={() => qc.prefetchQuery({
        queryKey: queryKeys.stories.detail(id),
        queryFn: () => fetchStory(id),
        staleTime: 30_000,
      })}
      className="block bg-white rounded-2xl border border-border p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)] hover:-translate-y-0.5 hover:border-[#fde0d2] hover:shadow-[0_8px_24px_-16px_rgba(15,23,42,0.18)] transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      {/* Top row: topic (primary, differentiating) + stage badge */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-sm font-semibold text-foreground line-clamp-2 leading-snug min-w-0">
          {topic || <span className="italic text-muted-foreground">No topic set</span>}
        </p>
        <span className={`shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full ${badgeClass}`}>
          {stageLabel}
        </span>
      </div>

      {/* Clinician — secondary context */}
      <div className="mb-3">
        <ClinicianChip
          id={clinician_id}
          name={clinician_name}
          size="sm"
          showName
          className="min-w-0"
          nameClassName="text-xs text-muted-foreground leading-tight"
        />
      </div>

      {/* Platform chips */}
      {platforms.length > 0 ? (
        <div className="flex items-center gap-1.5 flex-wrap mb-3">
          {platforms.map((p) => (
            <span
              key={p}
              className="inline-flex items-center gap-1 text-2xs font-semibold text-slate-600 bg-slate-50 border border-slate-200 rounded-full px-2 py-0.5"
            >
              <span className={`w-1.5 h-1.5 rounded-full ${PLATFORM_DOT[p] ?? 'bg-gray-400'}`} />
              {PLATFORM_SHORT[p] ?? p}
            </span>
          ))}
        </div>
      ) : null}

      {/* Footer: pieces · date  +  campaign chip on the right */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground truncate">
          {pieces_count === 1 ? '1 piece' : `${pieces_count} pieces`}
          {last_activity_at ? ` · ${formatRelativeDate(last_activity_at)}` : ''}
        </span>
        {campaign_id && campaign_name ? (
          <span className="inline-flex items-center gap-1 shrink-0 text-2xs font-semibold rounded-full px-2 py-0.5 border border-warning/30 bg-warning/10 text-warning">
            <Target className="w-3 h-3" aria-hidden="true" />
            {campaign_name}
          </span>
        ) : null}
      </div>
    </Link>
  )
}

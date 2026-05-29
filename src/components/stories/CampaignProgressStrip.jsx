import { useState } from 'react'
import { Target, ChevronDown, ChevronUp } from 'lucide-react'
import { StaffChip } from '@/components/StaffChip'

/**
 * Amber-tinted progress strip shown above the Stories grid when a campaign
 * filter is active. Expandable list of clinicians who haven't contributed yet.
 */
export default function CampaignProgressStrip({ campaign, clinicians = [] }) {
  const [showPending, setShowPending] = useState(false)

  const targetIds = Array.isArray(campaign.target_staff_ids)
    ? campaign.target_staff_ids
    : []
  const contributedIds = new Set(
    Array.isArray(campaign.contributed_staff_ids)
      ? campaign.contributed_staff_ids
      : [],
  )
  const targetTotal = targetIds.length
  const contributed = campaign.contributed_count || 0
  const pct = targetTotal > 0
    ? Math.min(100, Math.round((contributed / targetTotal) * 100))
    : 0

  if (targetTotal === 0) {
    return (
      <div className="nx-grad-ribbon flex items-center gap-3 flex-wrap">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 border border-white/30 px-2.5 py-0.5 text-xs font-semibold">
          <Target className="h-3.5 w-3.5" aria-hidden="true" />
          Active campaign
        </span>
        <span className="font-semibold text-sm">{campaign.name}</span>
        <span className="text-xs text-white/85">No clinicians targeted yet</span>
      </div>
    )
  }

  const pendingIds = targetIds.filter((id) => !contributedIds.has(id))
  const pendingClinicians = pendingIds.map((id) => {
    const match = clinicians.find((c) => c.id === id)
    return { id, name: match?.name || match?.full_name || 'Unknown clinician' }
  })

  return (
    <div className="nx-grad-ribbon">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 border border-white/30 px-2.5 py-0.5 text-xs font-semibold shrink-0">
            <Target className="h-3.5 w-3.5" aria-hidden="true" />
            Active campaign
          </span>
          <span className="font-semibold text-sm truncate">
            {campaign.name} — {contributed} of {targetTotal}{' '}
            {targetTotal === 1 ? 'clinician has' : 'clinicians have'} contributed
          </span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="h-1.5 w-32 sm:w-40 rounded-full bg-white/25 overflow-hidden">
            <div
              className="h-full bg-white transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-xs font-semibold opacity-90 tabular-nums">{pct}%</span>
        </div>
      </div>
      {pendingClinicians.length > 0 ? (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowPending((v) => !v)}
            className="inline-flex items-center gap-1 text-xs font-semibold text-white/90 hover:text-white hover:underline underline-offset-2"
          >
            {showPending ? 'Hide pending' : "View who's pending"}
            {showPending
              ? <ChevronUp className="h-3 w-3" aria-hidden="true" />
              : <ChevronDown className="h-3 w-3" aria-hidden="true" />}
          </button>
          {showPending ? (
            <ul className="mt-2 flex flex-wrap gap-2">
              {pendingClinicians.map(({ id, name }) => (
                <li key={id} className="flex items-center gap-2 bg-white/10 border border-white/15 rounded-full pl-1 pr-3 py-0.5">
                  <StaffChip id={id} name={name} size="sm" showName
                    nameClassName="text-white/95 text-xs font-medium"
                  />
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

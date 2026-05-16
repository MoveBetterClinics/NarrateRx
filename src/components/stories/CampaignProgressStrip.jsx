import { useState } from 'react'
import { Target, ChevronDown, ChevronUp } from 'lucide-react'
import { ClinicianChip } from '@/components/ClinicianChip'

/**
 * Amber-tinted progress strip shown above the Stories grid when a campaign
 * filter is active. Expandable list of clinicians who haven't contributed yet.
 */
export default function CampaignProgressStrip({ campaign, clinicians = [] }) {
  const [showPending, setShowPending] = useState(false)

  const targetIds = Array.isArray(campaign.target_clinician_ids)
    ? campaign.target_clinician_ids
    : []
  const contributedIds = new Set(
    Array.isArray(campaign.contributed_clinician_ids)
      ? campaign.contributed_clinician_ids
      : [],
  )
  const targetTotal = targetIds.length
  const contributed = campaign.contributed_count || 0
  const pct = targetTotal > 0
    ? Math.min(100, Math.round((contributed / targetTotal) * 100))
    : 0

  const pendingIds = targetIds.filter((id) => !contributedIds.has(id))
  const pendingClinicians = pendingIds.map((id) => {
    const match = clinicians.find((c) => c.id === id)
    return { id, name: match?.name || match?.full_name || 'Unknown clinician' }
  })

  return (
    <div className="rounded-lg border border-warning/30 bg-warning/10 text-warning p-4">
      <div className="flex items-start gap-3">
        <Target className="h-5 w-5 mt-0.5 shrink-0" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="font-medium">{campaign.name} campaign</span>
            <span className="text-sm text-warning/90">
              {contributed} of {targetTotal}{' '}
              {targetTotal === 1 ? 'clinician has' : 'clinicians have'} contributed
            </span>
          </div>
          <div className="mt-2 h-1.5 w-full rounded-full bg-warning/20 overflow-hidden">
            <div
              className="h-full bg-warning transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
          {pendingClinicians.length > 0 ? (
            <>
              <button
                type="button"
                onClick={() => setShowPending((v) => !v)}
                className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-warning hover:underline"
              >
                {showPending ? 'Hide pending' : "View who's pending"}
                {showPending
                  ? <ChevronUp className="h-3 w-3" aria-hidden="true" />
                  : <ChevronDown className="h-3 w-3" aria-hidden="true" />}
              </button>
              {showPending ? (
                <ul className="mt-3 flex flex-col gap-1.5">
                  {pendingClinicians.map(({ id, name }) => (
                    <li key={id} className="flex items-center gap-2">
                      <ClinicianChip id={id} name={name} size="sm" showName
                        nameClassName="text-warning/90 text-xs font-medium"
                      />
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            <p className="mt-2 text-xs font-medium text-warning/90">
              All targeted clinicians have contributed.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

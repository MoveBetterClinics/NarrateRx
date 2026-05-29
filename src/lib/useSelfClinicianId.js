// Resolve the signed-in user's "Self" clinician id in the current workspace.
// Returns null until the user's first interview creates their clinician row,
// or if the user is signed in but isn't a clinician at all (admin-only seats).
//
// Pattern lifted from Account.jsx's VoicePlaybackSection — the canonical
// "which clinician am I?" lookup. Uses the same useClinicianSummaries cache,
// so this is free when called alongside other consumers (e.g. Home).

import { useUser } from '@clerk/react'
import { useClinicianSummaries } from '@/lib/queries'

export function useSelfClinicianId() {
  const { user } = useUser()
  const { data: summaries = [] } = useClinicianSummaries()
  if (!user?.id) return null
  const match = summaries.find((c) => c?.user_id === user.id)
  return match?.id ?? null
}

// Ensure the signed-in user has a "Self" staff/clinician row in the current
// workspace, provisioning one on first load if needed.
//
// Why: an invited member (e.g. a clinician who just accepted an org invite)
// had no clinicians row until they started their first interview, so the
// "My staff profile" avatar-menu item (gated on selfStaffId) never showed
// and their profile didn't exist. This hook closes that gap by calling the
// idempotent /api/staff/ensure-self endpoint once, then refreshing the
// clinician summaries cache so useSelfStaffId resolves and the menu item
// appears — no interview required.
//
// Gated on CAP_INTERVIEW_START: only members who can be interviewed (the
// talent — owner + clinician tiers by default) get a Self row. Producer- and
// viewer-only seats are deliberately skipped so they don't get an empty
// staff profile they'll never use.
//
// One-shot per mount via a ref (mirrors the kickoff-effect guard pattern in
// CLAUDE.md) so a transient failure can't turn into a request storm.

import { useEffect, useRef } from 'react'
import { useUser } from '@clerk/react'
import { useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { usePermission } from '@/lib/usePermission'
import { useStaffSummaries } from '@/lib/queries'
import { CAP_INTERVIEW_START } from '@/lib/capabilities'

export function useEnsureSelfStaff() {
  const { user, isLoaded } = useUser()
  const ws = useWorkspace()
  const { has } = usePermission()
  // Snapshot to a stable boolean — `has` is a fresh closure every render, so
  // depending on it directly would re-run the effect on every parent re-render.
  const canInterview = has(CAP_INTERVIEW_START)
  const { data: summaries, isSuccess } = useStaffSummaries()
  const qc = useQueryClient()
  const attemptedRef = useRef(false)

  useEffect(() => {
    if (attemptedRef.current) return
    if (!isLoaded || !user?.id) return
    // Need a resolved workspace context (subdomain) before we can scope a row.
    // Note: switching workspace is always a hard subdomain navigation (full
    // reload), so ws.id never changes in place — the mount-scoped guard is safe.
    if (!ws?.id) return
    // Only the talent gets a Self profile; skip producer/viewer-only seats.
    if (!canInterview) return
    // Wait for the summaries fetch to actually resolve — a null match while the
    // query is still loading is not evidence that the row is missing.
    if (!isSuccess) return

    const match = Array.isArray(summaries)
      ? summaries.find((c) => c?.user_id === user.id)
      : null
    if (match) {
      // Already provisioned — record the attempt so we stop re-checking.
      attemptedRef.current = true
      return
    }

    attemptedRef.current = true
    ;(async () => {
      try {
        await apiFetch('/api/staff/ensure-self', {
          method: 'POST',
          body: JSON.stringify({ name: user.fullName || '' }),
        })
        // Refresh so useSelfStaffId picks up the new row and the avatar
        // menu's "My staff profile" item appears without a page reload.
        qc.invalidateQueries({ queryKey: ['staff'] })
      } catch (e) {
        // Non-fatal: the row will still be created lazily on first interview.
        // Reset the guard so a later navigation can retry.
        attemptedRef.current = false
        console.warn('[ensure-self-clinician] provisioning failed:', e?.message)
      }
    })()
  }, [isLoaded, user?.id, user?.fullName, ws?.id, canInterview, isSuccess, summaries, qc])
}

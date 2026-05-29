// usePermissionTier — read the calling user's per-workspace permission tier.
//
// Phase 4 PR 1 introduction. Independent axis from useUserRole — useUserRole
// stays the source of truth for the legacy admin/publisher/clinician role
// (Clerk publicMetadata), while this hook returns the per-workspace tier
// stored in clinicians.permission_tier.
//
// The tier is served by GET /api/workspace/me as `current_user_tier`. When
// the field is absent (legacy workspaces, unauth slim-branding shape, or
// users with no clinicians row in this workspace), the hook returns null
// and `isProducer` is false — meaning "no producer restrictions apply,"
// which preserves the existing UX for everyone except explicitly-tagged
// producers.
//
// Producer-restricted UX kicks in ONLY when tier === 'producer'. Owners,
// clinicians, viewers, and unknown all fall back to the legacy nav.

import { useWorkspace } from '@/lib/WorkspaceContext'
import {
  TIER_OWNER, TIER_PRODUCER, TIER_CLINICIAN, TIER_VIEWER,
} from '@/lib/roles'

/**
 * @typedef {object} PermissionTierState
 * @property {string|null} tier            Raw tier string or null.
 * @property {boolean}     isOwner         tier === 'owner'
 * @property {boolean}     isProducer      tier === 'producer'
 * @property {boolean}     isClinician     tier === 'clinician'
 * @property {boolean}     isViewer        tier === 'viewer'
 * @property {boolean}     isProducerOnly  True iff this user should get the
 *                                         restricted producer-only UX (Slate
 *                                         is home, no settings/billing/integrations
 *                                         nav). False for everyone else.
 * @property {boolean}     canManageSettings  False only for producers + viewers.
 */

/**
 * @returns {PermissionTierState}
 */
export function usePermissionTier() {
  const ws = useWorkspace()
  const tier = ws?.current_user_tier || null

  return {
    tier,
    isOwner:           tier === TIER_OWNER,
    isProducer:        tier === TIER_PRODUCER,
    isClinician:       tier === TIER_CLINICIAN,
    isViewer:          tier === TIER_VIEWER,
    isProducerOnly:    tier === TIER_PRODUCER,
    canManageSettings: tier !== TIER_PRODUCER && tier !== TIER_VIEWER,
  }
}

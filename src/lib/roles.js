// Canonical role tokens stored in Clerk publicMetadata.role.
//
// Three personas the product is designed around:
//   admin     — workspace owner; configures NarrateRx (voice, members,
//               brand kit, integrations, billing). One per workspace,
//               usually the clinic owner.
//   clinician — voices interviews and approves drafts for voice fidelity.
//               Owns the words.
//   publisher — takes approved content, attaches media from Library,
//               schedules, publishes, monitors. Owns the distribution.
//
// 'editor' is a LEGACY ALIAS for 'publisher'. New users should be created
// with role 'publisher'; existing 'editor' users continue to work because
// EDITOR_ROLES below accepts both. Once all Clerk users have been migrated
// to 'publisher', the alias can be dropped.

export const ROLE_ADMIN     = 'admin'
export const ROLE_PUBLISHER = 'publisher'
export const ROLE_CLINICIAN = 'clinician'

// Legacy alias — pre-2026-05 we called the publisher role "editor".
// Kept in EDITOR_ROLES so existing Clerk publicMetadata.role values still
// authorize correctly until they're migrated.
export const ROLE_EDITOR_LEGACY = 'editor'

// EDITOR_ROLES = anyone who can edit/archive/review/publish content (admin,
// publisher, and the legacy 'editor' alias). Admin is a superset of publisher
// in every gate, so it's included here. Renamed from STAFF_ROLES (2026-05-29):
// "staff" now refers to the team-member roster entity, not this authZ grouping.
export const EDITOR_ROLES = [ROLE_ADMIN, ROLE_PUBLISHER, ROLE_EDITOR_LEGACY]

// Any signed-in workspace member, including clinicians who only own their
// own uploads.
export const ALL_KNOWN_ROLES = [
  ROLE_ADMIN,
  ROLE_PUBLISHER,
  ROLE_EDITOR_LEGACY,
  ROLE_CLINICIAN,
]

/** @param {string} role @returns {boolean} */
export function isEditor(role) {
  return EDITOR_ROLES.includes(role)
}

/**
 * Display label for a role token. Use this for any user-facing copy — it
 * collapses the legacy 'editor' alias to 'Publisher' so admins never see
 * the old token name in UI.
 * @param {string} role
 * @returns {string}
 */
export function roleLabel(role) {
  switch (role) {
    case ROLE_ADMIN:           return 'Admin'
    case ROLE_PUBLISHER:       return 'Publisher'
    case ROLE_EDITOR_LEGACY:   return 'Publisher'
    case ROLE_CLINICIAN:       return 'Clinician'
    default:                   return role
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 4: per-workspace permission tier (mirror of api/_lib/roles.js values).
// ─────────────────────────────────────────────────────────────────────────────
// Independent axis from the legacy role above. Coexists — Phase 4 uses tier
// to drive the producer-restricted UX (nav filtering + default landing) while
// the existing role gates continue to work unchanged.
//
//   owner     — workspace owner; effectively unrestricted
//   producer  — operational editor; Slate-only nav, no settings/billing/integrations
//   clinician — default tier; full clinician UX
//   viewer    — read-only (defined for future use, no consumers yet)
export const TIER_OWNER     = 'owner'
export const TIER_PRODUCER  = 'producer'
export const TIER_CLINICIAN = 'clinician'
export const TIER_VIEWER    = 'viewer'

export const ALL_KNOWN_TIERS = [TIER_OWNER, TIER_PRODUCER, TIER_CLINICIAN, TIER_VIEWER]

/** @param {string} tier @returns {string} */
export function tierLabel(tier) {
  switch (tier) {
    case TIER_OWNER:     return 'Owner'
    case TIER_PRODUCER:  return 'Producer'
    case TIER_CLINICIAN: return 'Clinician'
    case TIER_VIEWER:    return 'Viewer'
    default:             return tier || ''
  }
}

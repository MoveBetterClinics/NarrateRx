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
// STAFF_ROLES below accepts both. Once all Clerk users have been migrated
// to 'publisher', the alias can be dropped.

export const ROLE_ADMIN     = 'admin'
export const ROLE_PUBLISHER = 'publisher'
export const ROLE_CLINICIAN = 'clinician'

// Legacy alias — pre-2026-05 we called the publisher role "editor".
// Kept in STAFF_ROLES so existing Clerk publicMetadata.role values still
// authorize correctly until they're migrated.
export const ROLE_EDITOR_LEGACY = 'editor'

// "Staff" = anyone who can edit/archive/review/publish content. Admin is a
// superset of publisher in every gate, so admin is included here.
export const STAFF_ROLES = [ROLE_ADMIN, ROLE_PUBLISHER, ROLE_EDITOR_LEGACY]

// Any signed-in workspace member, including clinicians who only own their
// own uploads.
export const ALL_KNOWN_ROLES = [
  ROLE_ADMIN,
  ROLE_PUBLISHER,
  ROLE_EDITOR_LEGACY,
  ROLE_CLINICIAN,
]

/** @param {string} role @returns {boolean} */
export function isStaff(role) {
  return STAFF_ROLES.includes(role)
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

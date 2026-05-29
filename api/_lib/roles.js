// Server-side mirror of src/lib/roles.js — kept separate because api/* and
// src/* don't share an import root in this project. The values must match.
//
// See src/lib/roles.js for the persona model (Admin / Clinician / Publisher).

export const ROLE_ADMIN     = 'admin'
export const ROLE_PUBLISHER = 'publisher'
export const ROLE_CLINICIAN = 'clinician'
export const ROLE_EDITOR_LEGACY = 'editor'

// Used by requireRole() in api routes that gate content / media writes.
export const STAFF_ROLES = [ROLE_ADMIN, ROLE_PUBLISHER, ROLE_EDITOR_LEGACY]

// Used by handshake routes (uploads) that any signed-in workspace member
// may initiate.
export const ALL_KNOWN_ROLES = [
  ROLE_ADMIN,
  ROLE_PUBLISHER,
  ROLE_EDITOR_LEGACY,
  ROLE_CLINICIAN,
]

// ─────────────────────────────────────────────────────────────────────────────
// Per-workspace permission tier (stored in clinicians.permission_tier).
// ─────────────────────────────────────────────────────────────────────────────
// Independent axis from the legacy Clerk publicMetadata.role above. The two
// coexist — Phase 4 PR 1 only uses tier to drive the producer-restricted UX
// (nav filtering + default landing). The existing role-based gates continue
// to work unchanged for admin/publisher/clinician.
//
//   owner     — workspace owner; same capabilities as legacy ROLE_ADMIN
//   producer  — operational editor; reviews/approves/publishes Story Slate
//               packages, blocked from workspace settings/billing/integrations
//   clinician — default tier; voice owner (matches legacy ROLE_CLINICIAN)
//   viewer    — read-only (defined for future use, no consumers yet)
//
// Phase 4 PR 2 will add server-side endpoint gates that read tier directly.
export const TIER_OWNER     = 'owner'
export const TIER_PRODUCER  = 'producer'
export const TIER_CLINICIAN = 'clinician'
export const TIER_VIEWER    = 'viewer'

export const ALL_KNOWN_TIERS = [TIER_OWNER, TIER_PRODUCER, TIER_CLINICIAN, TIER_VIEWER]

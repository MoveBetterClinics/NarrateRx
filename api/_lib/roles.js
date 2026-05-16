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

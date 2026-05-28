// Phase 4 PR 2 — Capability matrix for per-workspace permission customization.
//
// Architecture:
//   • Each user has a permission_tier (clinicians.permission_tier): owner /
//     producer / clinician / viewer. The tier is the *template key*.
//   • Each template maps to a set of capability strings.
//   • Default templates are baked into this file (DEFAULT_TEMPLATES below).
//   • Workspaces can override their templates via workspaces.role_templates
//     JSONB (migration 092). The override is a partial merge — only listed
//     templates override the defaults. Missing templates use the defaults.
//   • UI/API gates check INDIVIDUAL CAPABILITIES, not tier names.
//
// Why capabilities rather than tier-based gates:
//   Move Better's Producer needs near-admin access. Generic clinic's Producer
//   needs the locked-down Slate-only experience. Same code, two different
//   permission sets, configured per-workspace by editing role_templates.
//
// Adding a new capability:
//   1. Add the string constant below
//   2. Decide which default templates grant it (owner usually; producer often;
//      clinician sometimes; viewer rarely)
//   3. Update the relevant UI/API gate to check it
//
// Server-side mirror of src/lib/capabilities.js — kept separate because api/*
// and src/* don't share an import root. Values MUST match.

// ─── Capability constants ────────────────────────────────────────────────────

// Workspace administration
export const CAP_SETTINGS_VIEW       = 'settings.view'
export const CAP_SETTINGS_EDIT       = 'settings.edit'
export const CAP_BILLING_VIEW        = 'billing.view'
export const CAP_BILLING_EDIT        = 'billing.edit'
export const CAP_INTEGRATIONS_CONNECT = 'integrations.connect'
export const CAP_BRAND_KIT_EDIT      = 'brand_kit.edit'
export const CAP_MEMBERS_INVITE      = 'members.invite'

// Content production
export const CAP_INTERVIEW_START         = 'interview.start'
export const CAP_INTERVIEW_EDIT_OTHERS   = 'interview.edit_others'
export const CAP_CONTENT_APPROVE         = 'content.approve'
export const CAP_CONTENT_PUBLISH         = 'content.publish'

// Story Slate (Phase 3)
export const CAP_SLATE_GENERATE = 'slate.generate'
export const CAP_SLATE_APPROVE  = 'slate.approve'

export const ALL_CAPABILITIES = [
  CAP_SETTINGS_VIEW,
  CAP_SETTINGS_EDIT,
  CAP_BILLING_VIEW,
  CAP_BILLING_EDIT,
  CAP_INTEGRATIONS_CONNECT,
  CAP_BRAND_KIT_EDIT,
  CAP_MEMBERS_INVITE,
  CAP_INTERVIEW_START,
  CAP_INTERVIEW_EDIT_OTHERS,
  CAP_CONTENT_APPROVE,
  CAP_CONTENT_PUBLISH,
  CAP_SLATE_GENERATE,
  CAP_SLATE_APPROVE,
]

// ─── Default templates ───────────────────────────────────────────────────────
// One per known permission_tier. Workspaces.role_templates can override any
// of these (partial merge — see resolveTemplate below).

export const DEFAULT_TEMPLATES = Object.freeze({
  owner: {
    label: 'Owner',
    capabilities: [...ALL_CAPABILITIES],  // unrestricted
  },
  producer: {
    // Default Producer = locked-down Slate operator (the generic-clinic case).
    // Workspaces that want a fuller Producer (Move Better) override this
    // template in workspaces.role_templates.
    label: 'Producer',
    capabilities: [
      CAP_SLATE_GENERATE,
      CAP_SLATE_APPROVE,
      CAP_CONTENT_APPROVE,
      CAP_CONTENT_PUBLISH,
      CAP_INTEGRATIONS_CONNECT,
      CAP_BRAND_KIT_EDIT,
    ],
  },
  clinician: {
    label: 'Clinician',
    capabilities: [
      CAP_INTERVIEW_START,
      CAP_CONTENT_APPROVE,
      CAP_SLATE_APPROVE,
    ],
  },
  viewer: {
    label: 'Viewer',
    capabilities: [],  // read-only
  },
})

// ─── Resolution helpers ──────────────────────────────────────────────────────

/**
 * Resolve the effective template for a (tier, workspace) pair.
 * Workspace overrides take precedence over defaults — a partial override only
 * affects the listed fields, missing fields fall back to the default.
 *
 * @param {string} tier — one of 'owner' | 'producer' | 'clinician' | 'viewer'
 *                         (any unknown tier resolves to viewer = empty capabilities)
 * @param {{ role_templates?: object }} workspace
 * @returns {{ label: string, capabilities: string[] }}
 */
export function resolveTemplate(tier, workspace) {
  const tierKey = (tier && DEFAULT_TEMPLATES[tier]) ? tier : 'viewer'
  const def = DEFAULT_TEMPLATES[tierKey]
  const override = workspace?.role_templates?.[tierKey]
  if (!override) return { ...def, capabilities: [...def.capabilities] }
  return {
    label: typeof override.label === 'string' ? override.label : def.label,
    capabilities: Array.isArray(override.capabilities) ? [...override.capabilities] : [...def.capabilities],
  }
}

/**
 * Resolve the full capability set for a user in a workspace.
 *
 * @param {string} tier
 * @param {object} workspace
 * @returns {string[]}
 */
export function resolveCapabilities(tier, workspace) {
  return resolveTemplate(tier, workspace).capabilities
}

/**
 * Check whether a (tier, workspace) pair has a specific capability.
 *
 * @param {string} tier
 * @param {object} workspace
 * @param {string} capability
 * @returns {boolean}
 */
export function hasCapability(tier, workspace, capability) {
  return resolveCapabilities(tier, workspace).includes(capability)
}

// Phase 4 PR 2 — Capability matrix (client-side mirror of api/_lib/capabilities.js).
//
// Values MUST match the server. See api/_lib/capabilities.js for the full
// architecture explanation.
//
// The actual capability resolution happens server-side in /api/workspace/me,
// which returns `current_user_capabilities` as a resolved array. The client
// just checks membership via usePermission().

// ─── Capability constants ────────────────────────────────────────────────────

export const CAP_SETTINGS_VIEW       = 'settings.view'
export const CAP_SETTINGS_EDIT       = 'settings.edit'
export const CAP_BILLING_VIEW        = 'billing.view'
export const CAP_BILLING_EDIT        = 'billing.edit'
export const CAP_INTEGRATIONS_CONNECT = 'integrations.connect'
export const CAP_BRAND_KIT_EDIT      = 'brand_kit.edit'
export const CAP_MEMBERS_INVITE      = 'members.invite'

export const CAP_INTERVIEW_START         = 'interview.start'
export const CAP_INTERVIEW_EDIT_OTHERS   = 'interview.edit_others'
export const CAP_CONTENT_APPROVE         = 'content.approve'
export const CAP_CONTENT_PUBLISH         = 'content.publish'

export const CAP_SLATE_GENERATE = 'slate.generate'
export const CAP_SLATE_APPROVE  = 'slate.approve'

// Tentpole planner (Phase 4 PR 4) — campaign window management.
export const CAP_CAMPAIGNS_EDIT = 'campaigns.edit'

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
  CAP_CAMPAIGNS_EDIT,
]

// ─── Default templates (UI display only — server is authoritative) ───────────

export const DEFAULT_TEMPLATES = Object.freeze({
  owner: {
    label: 'Owner',
    capabilities: [...ALL_CAPABILITIES],
  },
  producer: {
    label: 'Producer',
    capabilities: [
      CAP_SLATE_GENERATE,
      CAP_SLATE_APPROVE,
      CAP_CONTENT_APPROVE,
      CAP_CONTENT_PUBLISH,
      CAP_INTEGRATIONS_CONNECT,
      CAP_BRAND_KIT_EDIT,
      CAP_CAMPAIGNS_EDIT,
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
    capabilities: [],
  },
})

/**
 * Human-readable label for a capability constant. Used by the (future)
 * template-editor UI.
 */
export function capabilityLabel(cap) {
  return {
    [CAP_SETTINGS_VIEW]:        'View workspace settings',
    [CAP_SETTINGS_EDIT]:        'Edit workspace settings',
    [CAP_BILLING_VIEW]:         'View billing',
    [CAP_BILLING_EDIT]:         'Manage billing',
    [CAP_INTEGRATIONS_CONNECT]: 'Connect integrations',
    [CAP_BRAND_KIT_EDIT]:       'Edit Brand Kit',
    [CAP_MEMBERS_INVITE]:       'Invite & manage members',
    [CAP_INTERVIEW_START]:      'Start new interviews',
    [CAP_INTERVIEW_EDIT_OTHERS]:'Edit others’ interviews',
    [CAP_CONTENT_APPROVE]:      'Approve content drafts',
    [CAP_CONTENT_PUBLISH]:      'Publish content',
    [CAP_SLATE_GENERATE]:       'Generate Story Slate',
    [CAP_SLATE_APPROVE]:        'Approve Slate packages',
    [CAP_CAMPAIGNS_EDIT]:       'Plan tentpole campaigns',
  }[cap] || cap
}

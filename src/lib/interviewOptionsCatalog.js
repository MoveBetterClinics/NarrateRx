// Master catalogs for pre-interview options that workspace admins curate
// into a fixed set of slots shown on the New Interview form. The patterns
// here exist so admins pick from a sensible starter list rather than typing
// freeform labels from scratch — but the workspace stores the chosen items
// as full objects (key, label, emoji, description, is_custom), so admins
// can rename catalog items and add up to 2 custom slots beyond the catalog.
//
// Catalog keys are stable identifiers used by prompt-building code; labels
// are display-only and editable. When the model receives an interview's
// audience or story type, it gets the LABEL (not the key) so user renames
// flow through to the prompt.
//
// Slot caps (enforced server-side in api/workspace/me.js):
//   • audience_options: up to 6 from catalog + up to 2 custom (8 max)
//   • story_type_options: up to 6 from catalog + up to 2 custom (8 max)
//
// Per the "honor clinicians as individuals" principle, these workspace-
// level options define the *available canvas* for clinicians; individual
// clinician recipes (Phase 4) carve their personal subset within it.

export const MAX_CATALOG_SLOTS = 6
export const MAX_CUSTOM_SLOTS  = 2
export const MAX_TOTAL_SLOTS   = MAX_CATALOG_SLOTS + MAX_CUSTOM_SLOTS

// ─── Audience catalog ──────────────────────────────────────────────────────
// Final list confirmed 2026-05-17. People-paradigm leaning but most items
// work across paradigms (a vet workspace can use "Other clinicians" the
// same way a PT workspace does). Equine/animal-specific entries can be
// added as custom slots until those paradigms warrant their own catalog.

export const AUDIENCE_CATALOG = [
  { key: 'general_public',       label: 'General public',         emoji: '👥', description: 'Anyone with the condition' },
  { key: 'active_adults',        label: 'Active adults',          emoji: '🏃', description: 'Runners, lifters, weekend warriors' },
  { key: 'chronic_pain',         label: 'Chronic pain',           emoji: '🩹', description: 'Long-standing or recurring pain' },
  { key: 'post_surgical',        label: 'Post-surgical recovery', emoji: '🩼', description: 'Patients recovering from surgery' },
  { key: 'senior_fall_prev',     label: 'Senior fall prevention', emoji: '🧓', description: 'Older adults focused on stability' },
  { key: 'expectant_postpartum', label: 'Expectant / postpartum', emoji: '🤰', description: 'Pregnancy + postpartum care' },
  { key: 'athletes_performance', label: 'Athletes & performance', emoji: '🏅', description: 'Competitive or elite training' },
  { key: 'referring_providers',  label: 'Referring providers',    emoji: '🩺', description: 'GPs, orthos, sports med' },
  { key: 'surgeons',             label: 'Surgeons',               emoji: '🔪', description: 'Surgical specialists' },
  { key: 'other_clinicians',     label: 'Other clinicians',       emoji: '🧑‍⚕️', description: 'Peer PTs, chiros, DOs' },
  { key: 'coaches_trainers',     label: 'Coaches & trainers',     emoji: '🧑‍🏫', description: 'S&C coaches, trainers, instructors' },
  { key: 'automotive_accident',  label: 'Automotive accident',    emoji: '🚗', description: 'Post-MVA patients' },
  { key: 'fibromyalgia',         label: 'Fibromyalgia',           emoji: '🌿', description: 'Patients managing fibromyalgia' },
]

// ─── Story-type catalog ────────────────────────────────────────────────────
// What kind of piece are we making? Drives how the interviewer probes
// (case studies need timeline questions; principles need analogies; myth-
// busters need "what does everyone get wrong?"). Universal across paradigms.

export const STORY_TYPE_CATALOG = [
  { key: 'patient_case',         label: 'Patient case',          emoji: '👤', description: 'Walk through a specific case' },
  { key: 'principle_explainer',  label: 'Principle explainer',   emoji: '💡', description: 'How a concept works' },
  { key: 'myth_buster',          label: 'Myth-buster',           emoji: '⚡', description: 'What people get wrong' },
  { key: 'process_walkthrough',  label: 'Process walkthrough',   emoji: '🔧', description: 'What treatment looks like' },
  { key: 'personal_opinion',     label: 'Personal opinion',      emoji: '💬', description: 'A clinician’s take' },
  { key: 'patient_qa',           label: 'Q&A from real patients', emoji: '❓', description: 'Common questions answered' },
  { key: 'behind_the_scenes',    label: 'Behind-the-scenes',     emoji: '🎬', description: 'A look inside the practice' },
  { key: 'journal_commentary',   label: 'Conference / journal',  emoji: '📰', description: 'Reaction to new research' },
  { key: 'tools_of_the_trade',   label: 'Tools of the trade',    emoji: '🛠️', description: 'A technique or device explained' },
  { key: 'year_in_review',       label: 'Year-in-review',        emoji: '📅', description: 'Reflection on a period of practice' },
]

// ─── Default seed slots (applied via migration to all workspaces) ──────────
// New workspaces and any existing workspace with no slots set get these.
// Admins curate from the WorkspaceSettings UI after onboarding.

export const DEFAULT_AUDIENCE_SLOT_KEYS = [
  'general_public',
  'active_adults',
  'referring_providers',
  'other_clinicians',
]

export const DEFAULT_STORY_TYPE_SLOT_KEYS = [
  'principle_explainer',
  'myth_buster',
  'process_walkthrough',
  'patient_case',
]

// ─── Helpers ───────────────────────────────────────────────────────────────

const AUDIENCE_BY_KEY   = Object.fromEntries(AUDIENCE_CATALOG.map((a) => [a.key, a]))
const STORY_TYPE_BY_KEY = Object.fromEntries(STORY_TYPE_CATALOG.map((s) => [s.key, s]))

export function getAudienceFromCatalog(key) {
  return AUDIENCE_BY_KEY[key] ?? null
}

export function getStoryTypeFromCatalog(key) {
  return STORY_TYPE_BY_KEY[key] ?? null
}

/**
 * Inflate a catalog key into a full slot object suitable for storage on
 * workspaces.audience_options / workspaces.story_type_options. Returns null
 * for unknown keys.
 */
export function audienceSlotFromCatalogKey(key) {
  const entry = AUDIENCE_BY_KEY[key]
  if (!entry) return null
  return { ...entry, is_custom: false }
}

export function storyTypeSlotFromCatalogKey(key) {
  const entry = STORY_TYPE_BY_KEY[key]
  if (!entry) return null
  return { ...entry, is_custom: false }
}

export function defaultAudienceSlots() {
  return DEFAULT_AUDIENCE_SLOT_KEYS.map(audienceSlotFromCatalogKey).filter(Boolean)
}

export function defaultStoryTypeSlots() {
  return DEFAULT_STORY_TYPE_SLOT_KEYS.map(storyTypeSlotFromCatalogKey).filter(Boolean)
}

// Content atomization blueprint — which platforms get multiple atoms,
// how many slots (weeks), and what angle each targets.
// Single-output platforms (blog, email, landing_page, youtube, google_ads,
// instagram_ads) are not listed here; they stay as one-shot generations.

export const ATOM_DEFINITIONS = {
  instagram: [
    {
      slot: 1,
      angle: 'hook',
      label: 'The Hook',
      description: 'Scroll-stopping myth-buster or bold claim — impossible to scroll past',
    },
    {
      slot: 2,
      angle: 'patient_scenario',
      label: 'Patient Story',
      description: 'Anonymized scenario showing the before/after transformation',
    },
    {
      slot: 3,
      angle: 'clinical_insight',
      label: 'Clinical Insight',
      description: 'The one thing most people get wrong about this condition',
    },
    {
      slot: 4,
      angle: 'cta',
      label: 'Call to Action',
      description: 'Book-now post with a condition-specific hook',
    },
  ],
  linkedin: [
    {
      slot: 1,
      angle: 'clinical_perspective',
      label: 'Clinical Perspective',
      description: 'What this clinic approaches differently — for clinicians and referrers',
    },
    {
      slot: 2,
      angle: 'referring_provider',
      label: 'For Referring Providers',
      description: 'What other clinicians should know before referring this condition',
    },
    {
      slot: 3,
      angle: 'movement_principle',
      label: 'Movement Principle',
      description: 'The underlying science or approach that sets this clinic apart',
    },
  ],
  facebook: [
    {
      slot: 1,
      angle: 'community',
      label: 'Community Story',
      description: 'Local + personal angle for the clinic community',
    },
    {
      slot: 2,
      angle: 'educational',
      label: 'Educational Post',
      description: 'Myth-buster or FAQ format for patients and families',
    },
  ],
  gbp: [
    {
      slot: 1,
      angle: 'local_authority',
      label: 'Local Authority',
      description: 'Local keywords, what makes us different, strong book CTA',
    },
    {
      slot: 2,
      angle: 'patient_outcome',
      label: 'Patient Outcome',
      description: 'What recovery looks like — condition-specific results framing',
    },
  ],
  pinterest: [
    {
      slot: 1,
      angle: 'pin_batch',
      label: '3 Pin Variations',
      description: '3 keyword-optimized pins with titles, descriptions, and board suggestions',
    },
  ],
  tiktok: [
    {
      slot: 1,
      angle: 'myth_buster',
      label: 'Myth-Buster Script',
      description: '45–60 second script leading with a counterintuitive claim',
    },
    {
      slot: 2,
      angle: 'process',
      label: 'The Process Script',
      description: '45–60 second script showing what treatment or recovery looks like',
    },
  ],
  twitter: [
    {
      slot: 1,
      angle: 'hook',
      label: 'The Hook (Tweet)',
      description: 'Single 280-char zinger from the blog’s sharpest claim — built to be quoted and shared',
    },
  ],
  threads: [
    {
      slot: 1,
      angle: 'community_take',
      label: 'Community Take',
      description: 'Conversational 500-char post that opens a question and invites replies',
    },
  ],
  bluesky: [
    {
      slot: 1,
      angle: 'clinical_share',
      label: 'Clinical Share',
      description: 'Considered clinician-to-clinician share for the Bluesky audience — no hashtags',
    },
  ],
  mastodon: [
    {
      slot: 1,
      angle: 'educational',
      label: 'Educational Toot',
      description: 'Plain-language educational post with an optional content warning, inclusive of the federated community',
    },
  ],
}

// Suggested publish date for an atom slot: anchor + (slot - 1) weeks at 9am UTC.
// Used by the draft endpoint to pre-fill content_items.scheduled_at so each
// drafted atom is auto-placed on the calendar at the cadence the Plan implies.
// Returns an ISO string; the anchor is typically interview.created_at.
export function suggestedScheduledAt(anchorIso, slot) {
  const d = new Date(anchorIso)
  d.setDate(d.getDate() + (Math.max(1, slot) - 1) * 7)
  d.setUTCHours(9, 0, 0, 0)
  return d.toISOString()
}

// Map a workspace enabled_outputs channel id (from src/lib/outputChannels.js)
// to the ATOM_DEFINITIONS platform key it corresponds to. Most channel ids
// match an atom platform 1:1 (facebook, linkedin, gbp, pinterest, tiktok,
// twitter, threads, bluesky, mastodon). Instagram is the exception: the
// registry splits it into instagram_post and instagram_reel for the settings
// UI, but the atom plan keys both under `instagram` (they share the same
// 4-atom angle set today). Either id enables Instagram atoms.
function atomPlatformsFromEnabledOutputs(enabledOutputs) {
  if (!enabledOutputs) return null
  const set = new Set()
  for (const id of enabledOutputs) {
    if (id === 'instagram_post' || id === 'instagram_reel') set.add('instagram')
    else set.add(id)
  }
  return set
}

// Build the flat list of atom rows to insert for a new interview plan.
// Called once when the blog post is first saved.
//
// enabledOutputs — the workspace's enabled_outputs array (from workspaces row).
// When provided, only platforms present in that array are seeded. Channel ids
// are normalized via atomPlatformsFromEnabledOutputs so instagram_post /
// instagram_reel both map to the `instagram` atom platform. Platforms absent
// from enabled_outputs are silently skipped so the Plan tab never shows atoms
// for disabled channels. Pass null/undefined to include all platforms (e.g.
// for backfill scripts).
export function buildPlanRows(interviewId, workspaceId, enabledOutputs) {
  const rows = []
  const allowed = atomPlatformsFromEnabledOutputs(enabledOutputs)
  for (const [platform, atoms] of Object.entries(ATOM_DEFINITIONS)) {
    // Skip platforms the workspace hasn't enabled, when a filter is provided.
    if (allowed && !allowed.has(platform)) continue
    for (const { slot, angle, label, description } of atoms) {
      rows.push({
        interview_id:      interviewId,
        workspace_id:      workspaceId,
        platform,
        slot,
        angle,
        angle_label:       label,
        angle_description: description,
        status:            'pending',
      })
    }
  }
  return rows
}

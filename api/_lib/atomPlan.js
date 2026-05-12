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
}

// Build the flat list of atom rows to insert for a new interview plan.
// Called once when the blog post is first saved.
export function buildPlanRows(interviewId, workspaceId) {
  const rows = []
  for (const [platform, atoms] of Object.entries(ATOM_DEFINITIONS)) {
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

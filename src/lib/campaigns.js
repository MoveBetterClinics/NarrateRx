// Workspace-singleton campaign settings — one active mode per workspace at a
// time, stored on clinic_settings (campaign_mode, campaign_notes,
// campaign_cta_url, campaign_cta_label, campaign_event_at).
//
// IMPORTANT: this context applies only to DERIVATIVE content (atom-based
// social posts, email/newsletter excerpts, video scripts). The keystone
// long-form blog post is intentionally EVERGREEN and never receives this
// context — getBlogPostSystemPrompt does not (and should not) accept a
// campaign parameter. If you find yourself wanting to wire blog → campaign
// CTAs, stop and reconsider: that is by design.

export const CAMPAIGN_MODES = {
  bookings: {
    label: 'Drive Online Bookings',
    description: 'All content drives prospective patients to book a visit at the clinic.',
    showNotes: false,
    showCta: false, // Defaults to workspace booking URL — no per-campaign override needed.
    showEventDate: false,
  },
  seminars: {
    label: 'Free Public Seminars',
    description: 'Content promotes free community education events at the clinic — inviting the public in, not just selling appointments.',
    showNotes: true,
    notesPlaceholder: 'Topic, what attendees will learn, host clinician(s), anything else worth grounding the content in…',
    showCta: true,
    ctaUrlLabel: 'RSVP / registration URL',
    ctaUrlPlaceholder: 'https://your-landing-page/seminar',
    ctaLabelLabel: 'Button text (short, used on platforms with a literal button)',
    ctaLabelPlaceholder: 'Reserve your free seat',
    showCtaPitch: true,
    ctaPitchLabel: 'Invitation sentence (used in social caption / email body)',
    ctaPitchPlaceholder: 'Come to our free back pain seminar on June 14 — open to anyone tired of guessing what\'s wrong.',
    showEventDate: true,
    eventDateLabel: 'Event date & time',
  },
  referrals: {
    label: 'Build Referral Network',
    description: 'Content is framed for coaches, trainers, and other providers who can refer patients to the clinic.',
    showNotes: true,
    notesPlaceholder: 'Referral targets or messaging context (e.g. "targeting trail running coaches and CrossFit gyms")…',
    showCta: true,
    ctaUrlLabel: 'Referral / contact URL',
    ctaUrlPlaceholder: 'https://your-landing-page/refer',
    ctaLabelLabel: 'Button text (short, used on platforms with a literal button)',
    ctaLabelPlaceholder: 'Connect with our team',
    showCtaPitch: true,
    ctaPitchLabel: 'Invitation sentence (used in social caption / email body)',
    ctaPitchPlaceholder: 'Working with a patient who needs more than what you offer? We\'d love to be a resource.',
    showEventDate: false,
  },
}

// Format an ISO timestamp into a human-readable seminar date.
// Returns '' for missing/invalid input so callers can concat safely.
function formatEventDate(iso) {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    return d.toLocaleString('en-US', {
      weekday: 'long',
      month:   'long',
      day:     'numeric',
      year:    'numeric',
      hour:    'numeric',
      minute:  '2-digit',
      timeZoneName: 'short',
    })
  } catch {
    return ''
  }
}

// Build the CAMPAIGN CONTEXT block that gets appended to derivative-content
// system prompts (atom posts: social, video, email/newsletter). Returns ''
// for bookings mode or missing campaign — caller can concatenate safely.
//
// `ws` is the resolved workspace row. We use ws.app_name / ws.display_name /
// ws.location to keep the prompt grounded; fall back to neutral wording if
// fields are missing so the function works in both server (DB row) and
// client (useWorkspace) contexts.
export function getCampaignPromptContext(campaign, ws = {}) {
  if (!campaign || !campaign.mode || campaign.mode === 'bookings') return ''

  const wsName = ws.app_name || ws.display_name || ws.name || 'the clinic'
  const location = ws.location || ws.location_keyword || ''

  if (campaign.mode === 'seminars') {
    const lines = [
      '',
      'CAMPAIGN FOCUS — FREE PUBLIC SEMINARS:',
      `${wsName} is hosting a free educational seminar for the public${location ? ` at their ${location} clinic` : ''}. This reflects a core value: sharing clinical knowledge openly with the community, not just selling appointments. CTAs in this content must invite readers to reserve a seat at the upcoming free seminar — not simply book a one-on-one visit.`,
    ]
    const eventDate = formatEventDate(campaign.event_at)
    if (eventDate) lines.push(`Event date & time: ${eventDate}.`)
    if (campaign.cta_url) {
      lines.push(`Registration URL: ${campaign.cta_url}`)
      lines.push('Use exactly this URL as the link target in any CTA — do not invent or alter it.')
    }
    if (campaign.cta_pitch) {
      lines.push(`Workspace-supplied invitation sentence (use this verbatim — or lightly adapted for platform tone — as the body-copy CTA that wraps the link): "${campaign.cta_pitch}"`)
    }
    if (campaign.cta_label) lines.push(`Preferred CTA button text (for platforms with a literal button — Instagram overlay, GBP): "${campaign.cta_label}".`)
    if (campaign.notes)     lines.push(`Additional context from the workspace: ${campaign.notes}`)
    if (!campaign.cta_pitch) {
      lines.push('Preferred CTA phrasing variants: "Reserve your free seat", "Join us for a free community talk", "Save your spot — it\'s free and open to everyone".')
    }
    lines.push(`Tone: lean into education and community generosity. ${wsName} is giving something valuable away.`)
    return lines.join('\n')
  }

  if (campaign.mode === 'referrals') {
    const lines = [
      '',
      'CAMPAIGN FOCUS — REFERRAL NETWORK:',
      `${wsName} is currently building relationships with coaches, personal trainers, physical therapists, orthopedic surgeons, and other ${location ? `${location}-area ` : ''}healthcare providers who can refer patients. Frame content with a professional, peer-to-peer voice — clinicians speaking to fellow health and fitness professionals.`,
    ]
    if (campaign.cta_url) {
      lines.push(`Referral / contact URL: ${campaign.cta_url}`)
      lines.push('Use exactly this URL as the link target in any CTA — do not invent or alter it.')
    }
    if (campaign.cta_pitch) {
      lines.push(`Workspace-supplied invitation sentence (use this verbatim — or lightly adapted for platform tone — as the body-copy CTA that wraps the link): "${campaign.cta_pitch}"`)
    }
    if (campaign.cta_label) lines.push(`Preferred CTA button text (for platforms with a literal button — Instagram overlay, GBP): "${campaign.cta_label}".`)
    if (campaign.notes)     lines.push(`Additional context: ${campaign.notes}`)
    if (!campaign.cta_pitch) {
      lines.push(`Preferred CTA phrasing variants: "Refer a patient to ${wsName}", "Connect with our team", "We'd love to collaborate", "Happy to be a resource for your patients or clients".`)
    }
    lines.push('Tone: authoritative and collegial — professionals talking to professionals.')
    return lines.join('\n')
  }

  return ''
}

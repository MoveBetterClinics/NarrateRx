import { workspace } from './workspace'

export const CAMPAIGN_MODES = {
  bookings: {
    label: 'Drive Online Bookings',
    description: `All content drives prospective patients to book a visit at ${workspace.name}.`,
    showNotes: false,
  },
  seminars: {
    label: 'Free Public Seminars',
    description: 'Content promotes free community education events at the clinic — inviting the public in, not just selling appointments.',
    showNotes: true,
    notesPlaceholder: 'Event details: date, time, location, topic, registration link…',
  },
  referrals: {
    label: 'Build Referral Network',
    description: `Content is framed for coaches, trainers, and other providers who can refer patients to ${workspace.name}.`,
    showNotes: true,
    notesPlaceholder: 'Referral targets or messaging context (e.g. "targeting trail running coaches and CrossFit gyms")…',
  },
}

export function getCampaignPromptContext(campaign) {
  if (!campaign || campaign.mode === 'bookings') return ''

  if (campaign.mode === 'seminars') {
    return `

CAMPAIGN FOCUS — FREE PUBLIC SEMINARS:
${workspace.name} is hosting free educational seminars for the public at their ${workspace.prompt.locationKeyword} clinic. This reflects a core value: sharing clinical knowledge openly with the community, not just selling appointments. All CTAs in this content must invite readers to attend the upcoming free seminar — not simply book a one-on-one visit.
${campaign.notes ? `Event details: ${campaign.notes}` : 'Reference "our upcoming free seminar" — specific event details will be added separately.'}
CTA language to use: "Join us for a free seminar", "Attend our free community talk", "Reserve your spot — it's free and open to everyone", "This event is free and open to the public"
Tone: lean into education and community generosity. ${workspace.name} is giving something valuable away.`
  }

  if (campaign.mode === 'referrals') {
    return `

CAMPAIGN FOCUS — REFERRAL NETWORK:
${workspace.name} is currently building relationships with coaches, personal trainers, physical therapists, orthopedic surgeons, and other ${workspace.prompt.locationKeyword}-area healthcare providers who can refer patients. Frame content with a professional, peer-to-peer voice — clinicians speaking to fellow health and fitness professionals.
${campaign.notes ? `Context: ${campaign.notes}` : ''}
CTA language to use: "Refer a patient to ${workspace.name}", "Connect with our team", "We'd love to collaborate", "Happy to be a resource for your patients or clients"
Tone: authoritative and collegial — professionals talking to professionals.`
  }

  return ''
}

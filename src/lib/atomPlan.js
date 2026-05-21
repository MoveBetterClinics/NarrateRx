// Client-side atom definitions — mirrors api/_lib/atomPlan.js.
// Used for UI rendering (labels, descriptions, icons, slot badges).
// Keep in sync with the server-side file when adding new platforms/angles.

import { Instagram, Linkedin, Facebook, MapPin, Pin, Music2, Twitter, AtSign, Cloud, Hash } from 'lucide-react'

export const ATOM_DEFINITIONS = {
  instagram: [
    { slot: 1, angle: 'hook',             label: 'The Hook',             description: 'Scroll-stopping myth-buster or bold claim — impossible to scroll past' },
    { slot: 2, angle: 'patient_scenario', label: 'Patient Story',        description: 'Anonymized scenario showing the before/after transformation' },
    { slot: 3, angle: 'clinical_insight', label: 'Clinical Insight',     description: 'The one thing most people get wrong about this condition' },
    { slot: 4, angle: 'cta',              label: 'Call to Action',       description: 'Book-now post with a condition-specific hook' },
  ],
  linkedin: [
    { slot: 1, angle: 'clinical_perspective', label: 'Clinical Perspective',    description: 'What this clinic approaches differently — for clinicians and referrers' },
    { slot: 2, angle: 'referring_provider',   label: 'For Referring Providers', description: 'What other clinicians should know before referring this condition' },
    { slot: 3, angle: 'movement_principle',   label: 'Movement Principle',      description: 'The underlying science or approach that sets this clinic apart' },
  ],
  facebook: [
    { slot: 1, angle: 'community',   label: 'Community Story',  description: 'Local + personal angle for the clinic community' },
    { slot: 2, angle: 'educational', label: 'Educational Post', description: 'Myth-buster or FAQ format for patients and families' },
  ],
  gbp: [
    { slot: 1, angle: 'local_authority', label: 'Local Authority',  description: 'Local keywords, what makes us different, strong book CTA' },
    { slot: 2, angle: 'patient_outcome', label: 'Patient Outcome',  description: 'What recovery looks like — condition-specific results framing' },
  ],
  pinterest: [
    { slot: 1, angle: 'pin_batch', label: '3 Pin Variations', description: '3 keyword-optimized pins with titles, descriptions, and board suggestions' },
  ],
  tiktok: [
    { slot: 1, angle: 'myth_buster', label: 'Myth-Buster Script', description: '45–60 second script leading with a counterintuitive claim' },
    { slot: 2, angle: 'process',     label: 'The Process Script', description: '45–60 second script showing what treatment or recovery looks like' },
  ],
  twitter: [
    { slot: 1, angle: 'hook',           label: 'The Hook (Tweet)',  description: 'Single 280-char zinger from the blog’s sharpest claim — built to be quoted and shared' },
  ],
  threads: [
    { slot: 1, angle: 'community_take', label: 'Community Take',    description: 'Conversational 500-char post that opens a question and invites replies' },
  ],
  bluesky: [
    { slot: 1, angle: 'clinical_share', label: 'Clinical Share',    description: 'Considered clinician-to-clinician share for the Bluesky audience — no hashtags' },
  ],
  mastodon: [
    { slot: 1, angle: 'educational',    label: 'Educational Toot',  description: 'Plain-language educational post with an optional content warning, inclusive of the federated community' },
  ],
}

export const PLATFORM_UI = {
  instagram: { label: 'Instagram',         icon: Instagram, color: 'text-pink-600',    bg: 'bg-pink-50',    border: 'border-pink-200',    dot: 'bg-pink-500'    },
  linkedin:  { label: 'LinkedIn',          icon: Linkedin,  color: 'text-sky-700',     bg: 'bg-sky-50',     border: 'border-sky-200',     dot: 'bg-sky-600'     },
  facebook:  { label: 'Facebook',          icon: Facebook,  color: 'text-blue-600',    bg: 'bg-blue-50',    border: 'border-blue-200',    dot: 'bg-blue-600'    },
  gbp:       { label: 'Google Business',   icon: MapPin,    color: 'text-green-700',   bg: 'bg-green-50',   border: 'border-green-200',   dot: 'bg-green-600'   },
  pinterest: { label: 'Pinterest',         icon: Pin,       color: 'text-red-500',     bg: 'bg-red-50',     border: 'border-red-200',     dot: 'bg-red-500'     },
  tiktok:    { label: 'TikTok / Reels',    icon: Music2,    color: 'text-fuchsia-600', bg: 'bg-fuchsia-50', border: 'border-fuchsia-200', dot: 'bg-fuchsia-600' },
  twitter:   { label: 'X / Twitter',       icon: Twitter,   color: 'text-slate-700',   bg: 'bg-slate-50',   border: 'border-slate-200',   dot: 'bg-slate-700'   },
  threads:   { label: 'Threads',           icon: AtSign,    color: 'text-zinc-700',    bg: 'bg-zinc-50',    border: 'border-zinc-200',    dot: 'bg-zinc-700'    },
  bluesky:   { label: 'Bluesky',           icon: Cloud,     color: 'text-sky-600',     bg: 'bg-sky-50',     border: 'border-sky-200',     dot: 'bg-sky-500'     },
  mastodon:  { label: 'Mastodon',          icon: Hash,      color: 'text-violet-600',  bg: 'bg-violet-50',  border: 'border-violet-200',  dot: 'bg-violet-600'  },
}

export const SLOT_LABELS = ['Week 1', 'Week 2', 'Week 3', 'Week 4']

// Suggested publish date: interview created_at + (slot - 1) weeks
export function suggestedDate(interviewCreatedAt, slot) {
  const d = new Date(interviewCreatedAt)
  d.setDate(d.getDate() + (slot - 1) * 7)
  return d
}

export function formatSlotDate(interviewCreatedAt, slot) {
  const d = suggestedDate(interviewCreatedAt, slot)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

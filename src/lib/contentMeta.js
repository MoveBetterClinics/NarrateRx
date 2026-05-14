// Shared content-meta constants used across the publishing surfaces
// (ContentHub, ContentCalendar, ReviewQueue, ReviewPost, PipelineKanban,
// and the upcoming Stories views). Lifted out of ContentHub.jsx in the
// IA refactor (PR 1/6) so the Stories surface can consume them without a
// circular page dependency.
//
// Keep purely declarative — no React state, no hooks. Icons are
// lucide-react components, referenced by symbol so consumers can render
// them however they like (color via tailwind classes on the wrapper).

import {
  Instagram, Facebook, Linkedin, FileText, Mail,
  MapPin, Clock, CheckCircle2, Send, CalendarDays,
  MousePointer2, LayoutTemplate, Youtube, Music2, Megaphone,
  Pin, Archive,
} from 'lucide-react'

export const PLATFORM_META = {
  blog:         { label: 'Blog Post',       icon: FileText,   color: 'text-slate-600',  bg: 'bg-slate-100' },
  instagram:    { label: 'Instagram',       icon: Instagram,  color: 'text-pink-600',   bg: 'bg-pink-50' },
  facebook:     { label: 'Facebook',        icon: Facebook,   color: 'text-blue-600',   bg: 'bg-blue-50' },
  linkedin:     { label: 'LinkedIn',        icon: Linkedin,   color: 'text-sky-700',    bg: 'bg-sky-50' },
  gbp:          { label: 'Google Business', icon: MapPin,     color: 'text-green-700',  bg: 'bg-green-50' },
  google_ads:   { label: 'Google Ads',      icon: MousePointer2, color: 'text-yellow-700', bg: 'bg-yellow-50' },
  instagram_ads:{ label: 'Instagram Ads',   icon: Megaphone,  color: 'text-rose-600',   bg: 'bg-rose-50' },
  landing_page: { label: 'Landing Page',    icon: LayoutTemplate, color: 'text-purple-600', bg: 'bg-purple-50' },
  youtube:      { label: 'YouTube Script',  icon: Youtube,       color: 'text-red-600',    bg: 'bg-red-50' },
  tiktok:       { label: 'TikTok / Reels', icon: Music2,        color: 'text-fuchsia-600', bg: 'bg-fuchsia-50' },
  email:        { label: 'Email',           icon: Mail,       color: 'text-teal-600',   bg: 'bg-teal-50' },
  pinterest:    { label: 'Pinterest',       icon: Pin,        color: 'text-red-500',    bg: 'bg-red-50' },
}

export const STATUS_META = {
  draft:      { label: 'Draft',      color: 'bg-slate-100 text-slate-700',   icon: FileText },
  in_review:  { label: 'In Review',  color: 'bg-amber-100 text-amber-700',   icon: Clock },
  approved:   { label: 'Approved',   color: 'bg-blue-100 text-blue-700',     icon: CheckCircle2 },
  scheduled:  { label: 'Scheduled',  color: 'bg-purple-100 text-purple-700', icon: CalendarDays },
  published:  { label: 'Published',  color: 'bg-green-100 text-green-700',   icon: Send },
  archived:   { label: 'Archived',   color: 'bg-zinc-100 text-zinc-600',     icon: Archive },
}

// 'archived' is a UI-only pseudo-tab — there's no `archived` value on the
// status enum. Selecting it switches the list query to `archived=only` so
// rows with archived_at set come back regardless of their underlying status.
export const STATUS_TABS = ['all', 'draft', 'in_review', 'approved', 'scheduled', 'published', 'archived']

// Chip groups for the platform filter — IG Ads sits alone between Social and Google.
export const PLATFORM_GROUPS = [
  ['blog'],
  ['instagram', 'facebook', 'linkedin', 'gbp'],
  ['instagram_ads'],
  ['google_ads', 'landing_page'],
  ['youtube', 'tiktok', 'pinterest'],
  ['email'],
]

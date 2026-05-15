import {
  Mic, FileText, Image as ImageIcon, Send,
} from 'lucide-react'

// Versioned announcement registry. Each entry is shown once per user on next
// login, in the order defined here. To ship a new announcement (e.g. when a
// feature launches), append a new entry with a fresh `key` — every signed-in
// user will see it the next time they load the app.
//
// Conventions:
//   - `key` is permanent and unique. Never rename or reorder existing keys —
//     they're stored on each user's Clerk metadata as proof-of-seen.
//   - `kind` controls the heading: 'welcome' for first-time intro, 'whatsnew'
//     for feature announcements.
//   - `steps` is 1–N cards. Single-step announcements are rendered without
//     pagination dots.
export const ANNOUNCEMENTS = [
  {
    key: 'welcome-v1',
    kind: 'welcome',
    eyebrow: 'Welcome',
    steps: [
      {
        icon: Mic,
        title: 'Start with a conversation',
        body: 'Pick a clinician and a topic, then run a 15–30 minute interview. The AI asks the questions, you (or your clinician) just talk. No writing required.',
        accent: 'bg-amber-100 text-amber-700',
      },
      {
        icon: FileText,
        title: 'AI drafts patient-facing content',
        body: 'Each completed interview produces a full content set — long-form article, social posts, email, and ad copy — written in your clinician’s voice from the recorded answers.',
        accent: 'bg-sky-100 text-sky-700',
      },
      {
        icon: ImageIcon,
        title: 'Pair drafts with your media',
        body: 'Upload photos and videos to the Library, organize them into collections, and attach them to posts before publishing. Your library stays searchable across every campaign.',
        accent: 'bg-emerald-100 text-emerald-700',
      },
      {
        icon: Send,
        title: 'Review, schedule, and publish',
        body: 'Edit drafts in Stories, move them through the pipeline, and publish to your connected channels. You stay in control of every word that ships.',
        accent: 'bg-violet-100 text-violet-700',
      },
    ],
  },

  // Example for the next launch — uncomment & adapt when shipping a feature:
  //
  // {
  //   key: 'collections-2026-05',
  //   kind: 'whatsnew',
  //   eyebrow: "What's new",
  //   steps: [
  //     {
  //       icon: FolderTree,
  //       title: 'Collections in the Media Hub',
  //       body: 'Group related photos and videos into reusable sets. Attach a whole collection to a post in one click.',
  //       accent: 'bg-emerald-100 text-emerald-700',
  //     },
  //   ],
  // },
]

// Returns the next announcement the user hasn't seen, or null if they're
// caught up. Reads from `unsafeMetadata.seenAnnouncements` (an array of keys).
export function getPendingAnnouncement(user) {
  const seen = user?.unsafeMetadata?.seenAnnouncements
  const seenSet = new Set(Array.isArray(seen) ? seen : [])
  return ANNOUNCEMENTS.find((a) => !seenSet.has(a.key)) || null
}

// Records the announcement as seen on the user's Clerk metadata. Best-effort —
// caller should not block UI on the result.
export async function markAnnouncementSeen(user, key) {
  if (!user) return
  const seen = user.unsafeMetadata?.seenAnnouncements
  const next = Array.isArray(seen) ? Array.from(new Set([...seen, key])) : [key]
  await user.update({
    unsafeMetadata: { ...(user.unsafeMetadata || {}), seenAnnouncements: next },
  })
}

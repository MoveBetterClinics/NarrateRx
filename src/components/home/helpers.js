// Helpers shared by Home page sub-components.
// greetingFor and formatInterviewerName are lifted verbatim from Dashboard.jsx;
// getInitials lives in src/lib/utils.js and is re-exported here for convenience.

export { getInitials } from '@/lib/utils'

// Personalized greeting. Prefers the user's configured display name
// (unsafeMetadata.display_name, set on the clinician profile — e.g. "Dr. Q"),
// then falls back through Clerk firstName, fullName, email local-part, and
// finally the workspace app name. Time-of-day suffix is natural.
//
// The display name is used whole, not split to a first token: it's a
// deliberate identity label ("Dr. Q", "Dr. Quasney") where the leading word
// is meaningful — splitting "Dr. Q" to "Dr." would be wrong. Only the
// firstName/fullName fallbacks take the first token.
export function greetingFor(user, workspace) {
  const fallback = workspace?.app_name || workspace?.appName || 'Welcome'
  if (!user) return fallback
  const displayName = user.unsafeMetadata?.display_name?.trim()
  const name =
    displayName ||
    user.firstName ||
    user.fullName?.split(' ')[0] ||
    user.primaryEmailAddress?.emailAddress?.split('@')[0]
  if (!name) return fallback
  const hour = new Date().getHours()
  const tod =
    hour < 5 ? 'evening' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'
  return `Good ${tod}, ${name}`
}

// "brian.smith@example.com" → "Brian Smith"
export function formatInterviewerName(email) {
  if (!email || email === 'unknown') return 'Unknown'
  const [local] = email.split('@')
  return local
    .split('.')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ')
}

/**
 * Resolve the owner of an interview to a human-readable display name.
 *
 * Preference order (best → worst):
 *   1. A workspace clinician whose `user_id` matches `interview.owner_id`.
 *      This is the case when a Self-clinician runs their own interview —
 *      the clinician's full configured name ("Dr. Zachary Cullen") wins.
 *   2. The local-part of `owner_email` parsed with formatInterviewerName.
 *      Only useful when the local-part actually has dot-separated tokens
 *      ("brian.smith" → "Brian Smith"). Single-token emails ("drzach")
 *      capitalize to garbage ("Drzach"); when that's the only signal we
 *      have, we'd rather return null than render a garbled label.
 *   3. null — caller should hide the "by …" suffix entirely.
 */
export function resolveOwnerName(interview, clinicians) {
  if (!interview) return null
  if (Array.isArray(clinicians) && interview.owner_id) {
    const match = clinicians.find((c) => c && c.user_id === interview.owner_id)
    if (match?.name) return match.name
  }
  const email = interview.owner_email
  if (!email || email === 'unknown') return null
  const [local] = email.split('@')
  // Only fall back to the email parser when the local-part has a real
  // first.last shape. Single-token locals produce "Drzach" / "Operations" /
  // "Admin" which read worse than no attribution at all.
  if (!local || !local.includes('.')) return null
  return formatInterviewerName(email)
}

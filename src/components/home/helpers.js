// Helpers shared by Home page sub-components.
// greetingFor and formatInterviewerName are lifted verbatim from Dashboard.jsx;
// getInitials lives in src/lib/utils.js and is re-exported here for convenience.

export { getInitials } from '@/lib/utils'

// Personalized greeting. Prefers Clerk firstName, falls back through fullName,
// email local-part, then workspace app name. Time-of-day suffix is natural.
export function greetingFor(user, workspace) {
  const fallback = workspace?.app_name || workspace?.appName || 'Welcome'
  if (!user) return fallback
  const first =
    user.firstName ||
    user.fullName?.split(' ')[0] ||
    user.primaryEmailAddress?.emailAddress?.split('@')[0]
  if (!first) return fallback
  const hour = new Date().getHours()
  const tod =
    hour < 5 ? 'evening' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'
  return `Good ${tod}, ${first}`
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

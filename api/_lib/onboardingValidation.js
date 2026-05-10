// Slug + workspace input validation for the Phase 1E onboarding wizard.

// Reserved subdomains. Anything that could be confused with a system surface,
// a future Vercel rewrite target, or the apex marketing site goes here.
export const RESERVED_SLUGS = new Set([
  'www', 'api', 'app', 'admin', 'assets', 'static', 'cdn',
  'mail', 'email', 'smtp', 'imap', 'webmail',
  'docs', 'help', 'support', 'status', 'blog',
  'narraterx', 'vercel', '_vercel', 'preview', 'staging',
  'auth', 'sso', 'oauth', 'login', 'signup', 'signin', 'register',
  'onboard', 'onboarding', 'dashboard', 'settings',
  'me', 'us', 'about', 'pricing', 'terms', 'privacy', 'legal',
  'public', 'private', 'internal', 'test', 'tests', 'demo',
])

// 3–32 chars, lowercase alphanum + hyphen, no leading/trailing hyphen.
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$/

export function validateSlug(raw) {
  if (typeof raw !== 'string') return { ok: false, reason: 'invalid-format' }
  const slug = raw.trim().toLowerCase()
  if (!slug) return { ok: false, reason: 'required' }
  if (slug.length < 3) return { ok: false, reason: 'too-short' }
  if (slug.length > 32) return { ok: false, reason: 'too-long' }
  if (!SLUG_RE.test(slug)) return { ok: false, reason: 'invalid-format' }
  if (slug.startsWith('-') || slug.endsWith('-')) return { ok: false, reason: 'invalid-format' }
  if (slug.includes('--')) return { ok: false, reason: 'invalid-format' }
  if (RESERVED_SLUGS.has(slug)) return { ok: false, reason: 'reserved' }
  return { ok: true, slug }
}

// Founding-owner program cap. The first 10 *external* workspaces — i.e.
// excluding Move Better's three pre-seeded slugs.
export const FOUNDING_CAP = 10
export const SEED_SLUGS = new Set([
  'movebetter-people',
  'movebetter-equine',
  'movebetter-animals',
])

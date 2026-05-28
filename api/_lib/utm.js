// UTM parameter utilities for auto-published content.
//
// Schema agreed at Phase 5 scope:
//   utm_source=<channel>       e.g. gbp, instagram, blog
//   utm_medium=organic
//   utm_campaign=<tentpole>    active tentpole slug, or 'narraterx' fallback
//   utm_content=pkg_<short_id> first 8 chars of the package UUID
//
// applyUtmToUrl is idempotent — if UTM params are already present it
// replaces them rather than stacking duplicates. Returns the original
// url unchanged on parse errors.

/**
 * Append or replace UTM params on a URL string.
 * @param {string} url
 * @param {{ channel: string, packageId?: string, campaignSlug?: string }} opts
 * @returns {string}
 */
export function applyUtmToUrl(url, { channel, packageId, campaignSlug } = {}) {
  if (!url || typeof url !== 'string') return url
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return url
  }
  parsed.searchParams.set('utm_source',   channel || 'narraterx')
  parsed.searchParams.set('utm_medium',   'organic')
  parsed.searchParams.set('utm_campaign', campaignSlug || 'narraterx')
  if (packageId) {
    parsed.searchParams.set('utm_content', `pkg_${packageId.replace(/-/g, '').slice(0, 8)}`)
  }
  return parsed.toString()
}

/**
 * Extract the package short-id from utm_content (e.g. "pkg_abc12345" → "abc12345").
 * Returns null if the param is absent or malformed.
 * @param {string} url
 * @returns {string | null}
 */
export function extractPackageShortId(url) {
  if (!url || typeof url !== 'string') return null
  try {
    const params = new URL(url).searchParams
    const content = params.get('utm_content') || ''
    const match = content.match(/^pkg_([a-f0-9]{8})$/)
    return match ? match[1] : null
  } catch {
    return null
  }
}

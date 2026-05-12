// Exemplar feedback loop — Tier 1.
//
// Editors mark published content_items as `performed_well` (a thumbs-up in
// ContentHub / ReviewPost). When the AI generates new content for the same
// platform, we pass the top N flagged rows in-context as "this is the style
// that works for our audience." Manual now; Buffer/GA4 auto-flagging can
// flip the same column later without changing this reader path.

import { fetchContentItems } from './publish'

export async function fetchTopExemplars({ platform, limit = 5 } = {}) {
  if (!platform) return []
  // We over-fetch from the published pool and filter client-side rather than
  // adding a `performed_well` query param to the API — keeps the API surface
  // small and the pool is tiny in practice (only flagged rows count).
  const items = await fetchContentItems({ platform, status: 'published', limit: 100 })
  return (items || [])
    .filter((i) => i.performed_well)
    .slice(0, limit)
}

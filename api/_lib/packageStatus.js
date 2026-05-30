// api/_lib/packageStatus.js
//
// Single source of truth for the story_packages statuses that count as "still in
// flight." A package in one of these states is (a) cancelable by the producer
// (Slate "Stop" → packages/[id].js flips it to status='canceled') and (b) the
// ONLY set of statuses a background render's TERMINAL write may land on.
//
// Cooperative cancel (see MEMORY: "Cooperative cancel for Vercel waitUntil jobs"):
// the cancel PATCH and every terminal render PATCH append the `status=in.(...)`
// filter built here. A canceled row no longer matches, so a late finish updates
// zero rows and can't resurrect the card to complete/failed. All three call
// sites — packages/[id].js, renderPackageChannels.js, syntheticBroll.js — MUST
// import from here; a missed copy reopens the resurrection race.
//
// NOTE: these are CHECK-constrained values on story_packages.status. Adding a new
// in-flight status requires a constraint migration, not just an edit here.

export const CANCELABLE_STATUSES = ['generating', 'pending', 'pending_broll']

// PostgREST `status=in.(...)` filter fragment (no leading `&`). Byte-identical to
// the previously hardcoded `status=in.(generating,pending,pending_broll)`.
export function cancelableStatusFilter() {
  return `status=in.(${CANCELABLE_STATUSES.join(',')})`
}

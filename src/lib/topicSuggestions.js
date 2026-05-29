// Topic suggestions are stored per-workspace in workspaces.topic_suggestions
// (jsonb array of { topic, category, priority, keywords[], pnwNote,
// prototypes? }). prototypes is an optional array of archetype ids (matching
// workspace.patient_context.prototypes[].id) the topic primarily serves —
// empty or missing means "applies to all archetypes".
// The ranking helper is paradigm-neutral and ranks by coverage gap +
// priority. Workspaces with no topic_suggestions return an empty array.

const PRIORITY_RANK = { high: 3, medium: 2, low: 1 }

/**
 * Rank a workspace's configured topic suggestions for the Slate / coverage views.
 *
 * V5 (engagement loop): `provenTopics` is an optional array of topic-title
 * strings whose past published content was flagged `performed_well` (the
 * audience responded). Within the same coverage/priority tier, proven topics
 * float up so the daily slate resurfaces formats the audience has rewarded.
 * Defaults to `[]` — a no-op — so existing callers are unaffected.
 */
export function getSuggestedTopics(workspace, existingTopics = [], selectedPrototypeId = null, provenTopics = []) {
  const list = Array.isArray(workspace?.topic_suggestions) ? workspace.topic_suggestions : []
  if (list.length === 0) return []

  const normalized = (existingTopics || []).map((t) => String(t).toLowerCase())
  const provenSet = new Set((provenTopics || []).map((t) => String(t).toLowerCase()).filter(Boolean))

  function coverageCount(suggestion) {
    const keywords = Array.isArray(suggestion.keywords) ? suggestion.keywords : []
    return normalized.filter((t) =>
      keywords.some((k) => t.includes(String(k).toLowerCase()))
    ).length
  }

  // A suggestion is "proven" if its own title performed well, or any proven
  // topic title overlaps one of its keyword aliases (same fuzzy match the
  // coverage rollup uses to attribute packages to a suggestion).
  function isProven(suggestion) {
    if (provenSet.size === 0) return false
    const title = String(suggestion.topic || '').toLowerCase()
    if (provenSet.has(title)) return true
    const keywords = Array.isArray(suggestion.keywords) ? suggestion.keywords.map((k) => String(k).toLowerCase()) : []
    if (!keywords.length) return false
    for (const proven of provenSet) {
      if (keywords.some((k) => proven.includes(k))) return true
    }
    return false
  }

  const filtered = selectedPrototypeId
    ? list.filter((s) => {
        const tags = Array.isArray(s.prototypes) ? s.prototypes : []
        // Empty/missing prototypes = universal, always included
        return tags.length === 0 || tags.includes(selectedPrototypeId)
      })
    : list

  return filtered.map((s) => ({
    ...s,
    interviewCount: coverageCount(s),
    proven: isProven(s),
  })).sort((a, b) => {
    if (a.interviewCount === 0 && b.interviewCount > 0) return -1
    if (a.interviewCount > 0 && b.interviewCount === 0) return 1
    const pd = (PRIORITY_RANK[b.priority] || 0) - (PRIORITY_RANK[a.priority] || 0)
    if (pd !== 0) return pd
    // V5: within the same gap/priority tier, proven topics resurface first.
    if (a.proven !== b.proven) return a.proven ? -1 : 1
    return a.interviewCount - b.interviewCount
  })
}

/**
 * Derive the set of archetype ids a story serves, by matching its topic
 * against the workspace's topic_suggestions[] keyword aliases (the same
 * matcher used by getSuggestedTopics). Returns the union of `prototypes`
 * from every matching suggestion.
 *
 * Returns an empty array when:
 *   - the workspace has no topic_suggestions,
 *   - the story's topic matches no suggestion (custom topics), or
 *   - matching suggestions exist but none carry a `prototypes` tag.
 *
 * Callers should treat `[]` as "untagged" — neither universal nor
 * filtered-out, but explicitly unknown. The Themes view surfaces this
 * as an "untagged N" pill on each card's archetype-mix row.
 *
 * Intentionally does NOT consult interviews.prototype_id today. That
 * field exists on the row but isn't projected onto the Story shape by
 * buildStories(), so reading it would require a schema/builder change.
 * If/when buildStories starts copying prototype_id, this helper should
 * accept the story object (not just the topic string) and prefer the
 * explicit value over the derived one.
 */
export function getStoryArchetypes(storyTopic, workspace) {
  const list = Array.isArray(workspace?.topic_suggestions) ? workspace.topic_suggestions : []
  if (list.length === 0 || !storyTopic) return []
  const lc = String(storyTopic).toLowerCase()
  const ids = new Set()
  for (const s of list) {
    const keywords = Array.isArray(s.keywords) ? s.keywords : []
    const matches = keywords.some((k) => lc.includes(String(k).toLowerCase()))
    if (!matches) continue
    const tags = Array.isArray(s.prototypes) ? s.prototypes : []
    for (const id of tags) ids.add(id)
  }
  return [...ids]
}

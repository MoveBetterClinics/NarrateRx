// Topic suggestions are stored per-workspace in workspaces.topic_suggestions
// (jsonb array of { topic, category, priority, keywords[], pnwNote }).
// The ranking helper is paradigm-neutral and ranks by coverage gap +
// priority. Workspaces with no topic_suggestions return an empty array.

const PRIORITY_RANK = { high: 3, medium: 2, low: 1 }

export function getSuggestedTopics(workspace, existingTopics = []) {
  const list = Array.isArray(workspace?.topic_suggestions) ? workspace.topic_suggestions : []
  if (list.length === 0) return []

  const normalized = (existingTopics || []).map((t) => String(t).toLowerCase())

  function coverageCount(suggestion) {
    const keywords = Array.isArray(suggestion.keywords) ? suggestion.keywords : []
    return normalized.filter((t) =>
      keywords.some((k) => t.includes(String(k).toLowerCase()))
    ).length
  }

  return list.map((s) => ({
    ...s,
    interviewCount: coverageCount(s),
  })).sort((a, b) => {
    if (a.interviewCount === 0 && b.interviewCount > 0) return -1
    if (a.interviewCount > 0 && b.interviewCount === 0) return 1
    const pd = (PRIORITY_RANK[b.priority] || 0) - (PRIORITY_RANK[a.priority] || 0)
    if (pd !== 0) return pd
    return a.interviewCount - b.interviewCount
  })
}

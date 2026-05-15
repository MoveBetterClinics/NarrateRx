// Retrieval helper for the Phase 4 self-deepening knowledge graph.
//
// Returns top workspace_concepts for a given workspace (optionally filtered
// by topic keyword) formatted for injection into interview + content prompts.
// Falls back gracefully to empty strings when no concepts exist yet (e.g. new
// workspaces, first interviews).
//
// Callers treat the returned block as an ADDITIVE context supplement — it
// augments the existing patient_context / interview_context JSONB blocks, it
// does not replace them.

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const CACHE_TTL_MS = 5 * 60 * 1000 // 5-minute in-process cache per workspace+topic
const cache = new Map()

function sb(path) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey:        SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
  })
}

// ── Core fetch ───────────────────────────────────────────────────────────────

async function fetchTopConcepts(workspaceId, topicKeyword, limit = 12) {
  const key = `${workspaceId}:${topicKeyword ?? ''}:${limit}`
  const cached = cache.get(key)
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.data

  let qs = `workspace_concepts?workspace_id=eq.${workspaceId}&evidence_count=gte.1`
  qs += `&order=weight.desc,last_seen_at.desc&limit=${limit}`
  qs += `&select=kind,label,weight,evidence_count`

  // Narrow to topic-relevant concepts using label/alias text overlap.
  // This is a lightweight ilike filter; richer embedding-based retrieval
  // can be added in a later phase when the graph is large enough to benefit.
  if (topicKeyword?.trim()) {
    const kw = encodeURIComponent(`%${topicKeyword.trim().slice(0, 40)}%`)
    qs += `&or=(label.ilike.${kw},aliases.cs.{${encodeURIComponent(topicKeyword.trim())}})`
  }

  try {
    const r = await sb(qs)
    if (!r.ok) return []
    const rows = await r.json()
    cache.set(key, { ts: Date.now(), data: rows })
    return rows
  } catch {
    return []
  }
}

// ── Formatting ───────────────────────────────────────────────────────────────

function groupByKind(concepts) {
  const groups = {}
  for (const c of concepts) {
    if (!groups[c.kind]) groups[c.kind] = []
    groups[c.kind].push(c.label)
  }
  return groups
}

const KIND_LABELS = {
  archetype:  'Patient archetypes this practice serves',
  condition:  'Conditions this practice commonly treats',
  paradigm:   'Practice philosophy and approach phrases',
  value:      'Core practice values',
  objection:  'Common patient hesitations to address',
}

/**
 * getContextBlock({ workspaceId, topic?, limit? })
 *
 * Returns a formatted string block ready to append to a system prompt.
 * Returns '' when no concepts exist for the workspace yet.
 */
export async function getContextBlock({ workspaceId, topic = null, limit = 12 }) {
  if (!workspaceId) return ''
  const concepts = await fetchTopConcepts(workspaceId, topic, limit)
  if (!concepts.length) return ''

  const groups = groupByKind(concepts)
  const sections = Object.entries(KIND_LABELS)
    .filter(([kind]) => groups[kind]?.length)
    .map(([kind, label]) => `${label}:\n${groups[kind].map(l => `  • ${l}`).join('\n')}`)
    .join('\n\n')

  return `
LEARNED PRACTICE KNOWLEDGE (derived from past interviews and approved content at this workspace):
${sections}

Use this knowledge to sharpen questions, frame content for real patient needs, and stay in the practice's authentic clinical voice.`
}

/**
 * getRawConcepts({ workspaceId, topic?, limit? })
 *
 * Returns the raw concept array for cases where the caller needs structured
 * data rather than a formatted block (e.g. the /api/concepts/context endpoint).
 */
export async function getRawConcepts({ workspaceId, topic = null, limit = 12 }) {
  if (!workspaceId) return []
  return fetchTopConcepts(workspaceId, topic, limit)
}

/**
 * invalidateCache(workspaceId)
 *
 * Call after bulk concept extraction to clear stale in-process cache.
 */
export function invalidateCache(workspaceId) {
  for (const key of cache.keys()) {
    if (key.startsWith(`${workspaceId}:`)) cache.delete(key)
  }
}

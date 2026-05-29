// Concept extraction for the Phase 4 self-deepening knowledge graph.
//
// Extracts workspace_concepts (archetypes, conditions, paradigm phrases, values,
// objections) from interview transcripts and approved content. Runs fire-and-
// forget from the interview-completion and content-approval paths — never adds
// latency to the caller.
//
// Deduplication strategy: pull existing workspace concepts before the LLM call,
// include them in the prompt so the model reuses exact labels when the meaning
// matches. The unique DB index on (workspace_id, kind, lower(label)) handles
// exact-case collisions; semantic deduplication is LLM-assisted.
//
// Each (source_kind, source_id) pair is processed at most once (enforced by
// the unique index on concept_mentions). Re-runs are safe and idempotent.

import { generateText } from 'ai'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// Max clinician-turn words to send for extraction (keeps token cost bounded).
const MAX_WORDS = 1500
const MODEL = 'anthropic/claude-sonnet-4-6'

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey:        SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer:        'return=representation',
      ...init.headers,
    },
  })
}

// ── Existing concept lookup ──────────────────────────────────────────────────

async function fetchExistingConcepts(workspaceId) {
  const r = await sb(
    `workspace_concepts?workspace_id=eq.${workspaceId}&select=id,kind,label,weight&order=weight.desc&limit=200`
  )
  if (!r.ok) return []
  return r.json()
}

// ── LLM extraction ───────────────────────────────────────────────────────────

function buildPrompt(text, existingConcepts) {
  const existingBlock = existingConcepts.length
    ? `\n\nEXISTING LABELS (reuse these exact strings when the meaning clearly matches; do not create a near-duplicate):\n${existingConcepts.map(c => `  [${c.kind}] ${c.label}`).join('\n')}`
    : ''

  return `You are analyzing clinical practice content to build a structured knowledge graph. Extract concepts from the text below into five categories:

- archetype: patient/client types and profiles (e.g. "Post-surgical athlete", "Sedentary desk worker over 50")
- condition: physical conditions, injuries, diagnoses (e.g. "ACL tear", "Chronic low back pain", "Rotator cuff impingement")
- paradigm: practice philosophy phrases, clinical approach statements (e.g. "Movement-first approach", "Whole-body rehabilitation")
- value: practice values and principles (e.g. "Evidence-based care", "Patient autonomy", "Long-term function over short-term relief")
- objection: common patient hesitations or concerns (e.g. "Concern about treatment cost", "Fear of re-injury", "Skepticism about exercise therapy")

Rules:
- Only extract concepts that are genuinely present in the text. Do not infer or hallucinate.
- Labels must be short noun phrases (2–6 words), in title case.
- Skip generic filler ("The patient", "Good results"). Only extract specific, reusable practice vocabulary.
- If a concept clearly matches an existing label listed below, use that exact string.
- Return JSON only — no commentary, no markdown fences.
- Format: { "concepts": [{ "kind": "...", "label": "...", "excerpt": "..." }] }
  where excerpt is the shortest phrase from the text that evidences this concept (max 80 chars).${existingBlock}

TEXT:
"""
${text}
"""

Return only valid JSON.`
}

async function extractFromText(text, existingConcepts) {
  const truncated = text.split(/\s+/).slice(0, MAX_WORDS).join(' ')
  if (!truncated.trim()) return []

  try {
    const { text: raw } = await generateText({
      model: MODEL,
      messages: [{ role: 'user', content: buildPrompt(truncated, existingConcepts) }],
      maxOutputTokens: 1024,
    })

    // Strip accidental markdown fences
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
    const parsed = JSON.parse(cleaned)
    if (!Array.isArray(parsed?.concepts)) return []

    const VALID_KINDS = new Set(['archetype', 'condition', 'paradigm', 'value', 'objection'])
    return parsed.concepts.filter(
      c => c.kind && VALID_KINDS.has(c.kind) && typeof c.label === 'string' && c.label.trim()
    )
  } catch (e) {
    console.error('[conceptExtractor] LLM or parse error:', e?.message)
    return []
  }
}

// ── Upsert helpers ───────────────────────────────────────────────────────────

async function upsertConcept(workspaceId, kind, label, existingConcepts) {
  const normalLabel = label.trim()
  const lowerLabel  = normalLabel.toLowerCase()

  // Check if concept already exists (case-insensitive exact match).
  const existing = existingConcepts.find(
    c => c.kind === kind && c.label.toLowerCase() === lowerLabel
  )

  if (existing) {
    // Bump weight + recency on the existing concept.
    await sb(`workspace_concepts?id=eq.${existing.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        evidence_count:     existing.evidence_count + 1,
        weight:             Math.min(existing.weight + 0.2, 10.0),
        last_seen_at:       new Date().toISOString(),
        last_reinforced_at: new Date().toISOString(),
      }),
      headers: { Prefer: 'return=minimal' },
    })
    return existing.id
  }

  // Insert new concept.
  const r = await sb('workspace_concepts', {
    method: 'POST',
    body: JSON.stringify({
      workspace_id:       workspaceId,
      kind,
      label:              normalLabel,
      evidence_count:     1,
      weight:             1.0,
      first_seen_at:      new Date().toISOString(),
      last_seen_at:       new Date().toISOString(),
      last_reinforced_at: new Date().toISOString(),
    }),
    headers: { Prefer: 'return=representation' },
  })
  if (!r.ok) {
    const body = await r.text().catch(() => '')
    // 23505 = unique violation — race with another extractor run; safe to ignore
    if (body.includes('23505')) {
      const existing2Res = await sb(
        `workspace_concepts?workspace_id=eq.${workspaceId}&kind=eq.${kind}&label=ilike.${encodeURIComponent(normalLabel)}&select=id&limit=1`
      )
      if (existing2Res.ok) {
        const rows = await existing2Res.json()
        return rows[0]?.id ?? null
      }
    }
    console.error('[conceptExtractor] insert concept failed:', body.slice(0, 300))
    return null
  }
  const rows = await r.json()
  return rows[0]?.id ?? null
}

async function insertMention({ conceptId, workspaceId, sourceKind, sourceId, staffId, weightDelta, excerpt }) {
  const r = await sb('concept_mentions', {
    method: 'POST',
    body: JSON.stringify({
      concept_id:   conceptId,
      workspace_id: workspaceId,
      source_kind:  sourceKind,
      source_id:    sourceId ?? null,
      staff_id: staffId ?? null,
      weight_delta: weightDelta,
      excerpt:      excerpt ?? null,
      created_at:   new Date().toISOString(),
    }),
    headers: { Prefer: 'return=minimal' },
  })
  if (!r.ok) {
    const body = await r.text().catch(() => '')
    // 23505 = unique violation — already extracted this source+concept pair
    if (!body.includes('23505')) {
      console.error('[conceptExtractor] insert mention failed:', body.slice(0, 200))
    }
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * extractConcepts({ workspaceId, sourceKind, sourceId, text, staffId, weightDelta? })
 *
 * Fire-and-forget. Throws nothing — all errors are logged to console.error so
 * they land in Vercel function logs tagged [conceptExtractor].
 *
 * sourceKind: 'interview_turn' | 'content_item' | 'approved_edit' | 'rejected_edit'
 * weightDelta: positive to reinforce, negative to demote (default 1.0)
 */
export async function extractConcepts({
  workspaceId,
  sourceKind,
  sourceId,
  text,
  staffId,
  weightDelta = 1.0,
}) {
  try {
    if (!text?.trim()) return

    const existing    = await fetchExistingConcepts(workspaceId)
    const extracted   = await extractFromText(text, existing)
    if (!extracted.length) return

    for (const { kind, label, excerpt } of extracted) {
      const conceptId = await upsertConcept(workspaceId, kind, label, existing)
      if (!conceptId) continue
      await insertMention({ conceptId, workspaceId, sourceKind, sourceId, staffId, weightDelta, excerpt })
    }

    console.info(`[conceptExtractor] workspace=${workspaceId} source=${sourceKind}/${sourceId} extracted=${extracted.length}`)
  } catch (e) {
    console.error('[conceptExtractor] unhandled error:', e?.message)
  }
}

/**
 * buildInterviewText(messages)
 *
 * Joins only the clinician (user-role) turns from a cleaned_messages or
 * messages array into a single string for extraction. Excludes Bernard's
 * questions — we want the clinician's vocabulary, not the interviewer's.
 */
export function buildInterviewText(messages) {
  if (!Array.isArray(messages)) return ''
  return messages
    .filter(m => m.role === 'user' && m.content?.trim())
    .map(m => m.content.trim())
    .join('\n\n')
}

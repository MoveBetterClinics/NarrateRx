// Server-side practice-memory fetcher. Wraps Supabase REST calls so any
// generation handler (regenerate, content-plan/draft, split-into-series,
// etc.) can inject the same YOUR PRIOR THINKING block the interview path
// already gets via the client-side helper in src/lib/practiceMemory.js.
//
// The builder itself (pickPriorInterviews, buildOwnHistoryBlock) lives in
// src/lib/practiceMemory.js so client and server produce byte-identical
// blocks — a divergence would mean prompts shift subtly depending on which
// path triggered generation.

import { buildOwnHistoryBlock, pickPriorInterviews } from '../../src/lib/practiceMemory.js'
import { searchPracticeMemory } from './practiceMemoryRag.js'

// Cap the query text sent to the embedding API. A 90-minute transcript is
// far more than the semantic signal we need; topic + leading turns are enough.
const QUERY_MAX_CHARS = 1500
const CHUNK_PREVIEW_CHARS = 500
const RAG_TOP_K = 6

/**
 * Build a compact RAG query string from an interview row. Topic is the
 * highest-signal anchor; the first couple of clinician turns add nuance
 * for the cosine search without bloating the embed input.
 */
export function buildRagQuery(interview) {
  if (!interview) return ''
  const topic = (interview.topic || '').trim()
  const turns = (interview.messages || [])
    .filter((m) => m?.role === 'user' && typeof m?.content === 'string')
    .slice(0, 2)
    .map((m) => m.content.trim())
    .filter(Boolean)
    .join('\n')
  return [topic, turns].filter(Boolean).join('\n\n').slice(0, QUERY_MAX_CHARS)
}

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey:        SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}

// Mirror src/lib/api.js → fetchClinician shape. Pulls the embedded
// interview list with summary_text so the builder can prefer summaries
// over raw turns.
const INTERVIEW_FIELDS = 'id,topic,status,created_at,messages,summary_text,summary_generated_at'

async function fetchClinicianInterviews(workspaceId, clinicianId) {
  const qs = `clinicians?id=eq.${clinicianId}&workspace_id=eq.${workspaceId}&select=name,interviews(${INTERVIEW_FIELDS})`
  const r = await sb(qs)
  if (!r.ok) {
    console.error(`[practiceMemory] clinician fetch ${r.status} ws=${workspaceId} clinician=${clinicianId}`)
    return null
  }
  const rows = await r.json()
  return rows[0] || null
}

async function fetchRecentApprovedContent(workspaceId, clinicianId, limit = 3) {
  const qs = `content_items?workspace_id=eq.${workspaceId}&clinician_id=eq.${clinicianId}&status=in.(approved,published)&archived_at=is.null&select=id,topic,platform,content&order=created_at.desc&limit=${limit}`
  const r = await sb(qs)
  if (!r.ok) {
    console.error(`[practiceMemory] content fetch ${r.status} ws=${workspaceId} clinician=${clinicianId}`)
    return []
  }
  return await r.json()
}

/**
 * Resolve the YOUR PRIOR THINKING block for a generation prompt.
 * Never throws — always returns a string ('' on failure or no signal).
 *
 * Hot tier (always-on): last ~6 interview summaries + last ~3 approved content
 * items for this clinician. Composes a stable, bounded block.
 *
 * RAG tier (when `query` is passed): vector-searches the full corpus for
 * snippets topically relevant to `query`, deduped against the hot tier so
 * the block doesn't echo itself. Adds a RELATED section.
 *
 * @param {object} args
 * @param {string} args.workspaceId
 * @param {string} args.clinicianId
 * @param {string=} args.excludeInterviewId   — current interview, excluded from both tiers
 * @param {string=} args.query                — optional natural-language query (topic + leading turns)
 */
export async function resolveOwnHistoryBlock({ workspaceId, clinicianId, excludeInterviewId, query }) {
  try {
    if (!workspaceId || !clinicianId) return ''
    const [clinicianRow, recentContent] = await Promise.all([
      fetchClinicianInterviews(workspaceId, clinicianId),
      fetchRecentApprovedContent(workspaceId, clinicianId),
    ])
    if (!clinicianRow) return ''
    const priorInterviews = pickPriorInterviews(clinicianRow.interviews || [], excludeInterviewId)

    let relatedSnippets = []
    if (query && String(query).trim()) {
      const excludeSourceIds = [
        ...(excludeInterviewId ? [excludeInterviewId] : []),
        ...priorInterviews.map((iv) => iv.id),
        ...recentContent.map((c) => c.id),
      ]
      relatedSnippets = await searchPracticeMemory({
        workspaceId,
        clinicianId,
        query:           String(query).slice(0, QUERY_MAX_CHARS),
        topK:            RAG_TOP_K,
        excludeSourceIds,
      })
    }

    return buildOwnHistoryBlock({
      clinicianName: clinicianRow.name || 'this clinician',
      priorInterviews,
      priorContent: recentContent,
      relatedSnippets,
    })
  } catch (e) {
    console.error(`[practiceMemory] resolveOwnHistoryBlock threw: ${e?.message}`)
    return ''
  }
}

/**
 * Resolve a flat array of prior-corpus text snippets for the provenance
 * matcher. Mirrors the source pool that feeds `resolveOwnHistoryBlock` —
 * interview summaries + approved/published content bodies — so the matcher
 * scores paragraphs against the same material the model saw in the
 * YOUR PRIOR THINKING block. Returns [] on failure or no signal.
 *
 * Pulls a bit wider than the generation block (more interviews, more
 * content, no per-piece truncation) because the matcher benefits from
 * recall — false positives are cheap (mislabels a paragraph as drawn from
 * prior work instead of synthesis) and false negatives are the bug we're
 * trying to fix.
 *
 * @param {object} args
 * @param {string} args.workspaceId
 * @param {string} args.clinicianId
 * @param {string=} args.excludeInterviewId
 * @returns {Promise<string[]>}
 */
/**
 * Topic-scoped YOUR PRIOR THINKING block (V6 RAG hot-tier replacement).
 *
 * Instead of injecting the latest N interviews regardless of topic, this
 * retrieves the top-K practice chunks most relevant to `topic` via vector
 * search. Produces sharper, smaller prompts. Use behind ws.rag_hot_tier_enabled.
 *
 * Falls back to buildOwnHistoryBlock([]) (empty block) when no chunks exist,
 * so the prompt stays quiet rather than breaking.
 *
 * @param {object} args
 * @param {string}  args.topic
 * @param {string}  args.workspaceId
 * @param {string=} args.clinicianId
 * @param {number}  [args.k=6]
 * @returns {Promise<string>}
 */
export async function buildTopicScopedHistoryBlock({ topic, workspaceId, clinicianId, k = 6 }) {
  try {
    if (!workspaceId || !topic) return ''
    const chunks = await searchPracticeMemory({
      workspaceId,
      clinicianId: clinicianId || null,
      query: String(topic).slice(0, QUERY_MAX_CHARS),
      topK: k,
    })
    if (!chunks.length) return buildOwnHistoryBlock({ clinicianName: 'this clinician' })

    // Format chunks as the RELATED section of the standard block so the
    // prompt directive and label structure stay identical.
    return buildOwnHistoryBlock({
      clinicianName: 'this clinician',
      priorInterviews: [],
      priorContent: [],
      relatedSnippets: chunks.map((c) => ({
        text: String(c.text || '').slice(0, CHUNK_PREVIEW_CHARS),
        source_label: c.source_label || 'Earlier',
        similarity: c.similarity,
      })),
    })
  } catch (e) {
    console.error(`[practiceMemory] buildTopicScopedHistoryBlock threw: ${e?.message}`)
    return ''
  }
}

export async function resolvePriorCorpusSnippets({ workspaceId, clinicianId, excludeInterviewId }) {
  try {
    if (!workspaceId || !clinicianId) return []
    const [clinicianRow, recentContent] = await Promise.all([
      fetchClinicianInterviews(workspaceId, clinicianId),
      fetchRecentApprovedContent(workspaceId, clinicianId, 6),
    ])
    if (!clinicianRow) return []
    const snippets = []
    for (const iv of (clinicianRow.interviews || [])) {
      if (!iv || iv.id === excludeInterviewId) continue
      if (typeof iv.summary_text === 'string' && iv.summary_text.trim()) {
        snippets.push(iv.summary_text.trim())
        continue
      }
      // Fall back to raw user turns when summary hasn't been generated yet.
      if (Array.isArray(iv.messages)) {
        const turns = iv.messages
          .filter((m) => m?.role === 'user' && typeof m?.content === 'string' && m.content.trim())
          .map((m) => m.content.trim())
          .join('\n')
        if (turns) snippets.push(turns)
      }
    }
    for (const ci of recentContent) {
      if (typeof ci?.content === 'string' && ci.content.trim()) {
        snippets.push(ci.content.trim())
      }
    }
    return snippets
  } catch (e) {
    console.error(`[practiceMemory] resolvePriorCorpusSnippets threw: ${e?.message}`)
    return []
  }
}

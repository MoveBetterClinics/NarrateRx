// V6 RAG fusion layer — makes clip-pull framing-aware.
//
// Two retrieval pipelines existed independently:
//   1. Practice-memory RAG  — clinician's prior thinking on a topic
//   2. Visual-memory RAG    — clips matching a topic
//
// This module fuses them: practice chunks rewrite the visual query so clips
// are retrieved through the clinician's specific clinical framing rather than
// a bare topic string.
//
// Primary export: fetchFusedRagContext()
// Called by: api/editorial/generate-package.js (behind ws.rag_fusion_enabled)

import { generateText } from 'ai'
import { searchPracticeMemory } from './practiceMemoryRag.js'
import { searchClips } from './clipSearch.js'

// Max chunks to merge when blending multiple clinicians.
// 3 clinicians × 6 each = 18; cap avoids ballooning the Haiku prompt.
const MAX_MERGED_CHUNKS = 18

/**
 * Fetch fused RAG context for a topic + clinician scope.
 *
 * Flow:
 *   1. searchPracticeMemory per staffId in parallel → merge, dedupe, sort
 *   2. composeVisualQuery (Haiku) → expanded query string using practice framing
 *   3. searchClips with expanded query → visual chunks
 *
 * Graceful degradation: when no practice chunks exist, falls back to bare
 * searchClips on the original topic. fallbackReason records why.
 *
 * @param {object} args
 * @param {string}   args.topic
 * @param {string}   args.workspaceId
 * @param {string[]} args.staffIds     — array; pass [staffId] for single-clinician
 * @param {number}   [args.practiceK=6]   — chunks per clinician
 * @param {number}   [args.visualK=8]     — visual clips to retrieve
 * @param {string}   [args.visualKind]    — 'photo' | 'video' | null
 * @param {number}   [args.minPracticeScore=0.5]
 * @param {number}   [args.minVisualScore=0.5]
 *
 * @returns {Promise<{
 *   practiceChunks: object[],
 *   visualChunks:   object[],
 *   queryExpansion: string,
 *   fallbackReason: string|null,
 *   timing: { practiceMs: number, expansionMs: number, visualMs: number, totalMs: number }
 * }>}
 */
export async function fetchFusedRagContext({
  topic,
  workspaceId,
  staffIds = [],
  practiceK = 6,
  visualK = 8,
  visualKind = null,
  minPracticeScore = 0.5,
  minVisualScore = 0.5,
}) {
  const t0 = Date.now()
  let practiceChunks = []
  let queryExpansion = topic
  let fallbackReason = null

  // --- 1. Retrieve practice chunks (parallel per clinician) -----------------
  let practiceMs = 0
  try {
    const tp0 = Date.now()
    const perClinician = staffIds.length > 0
      ? staffIds.map((cid) => searchPracticeMemory({
          workspaceId,
          staffId: cid,
          query: topic,
          topK: practiceK,
        }))
      : [searchPracticeMemory({ workspaceId, staffId: null, query: topic, topK: practiceK })]

    const results = await Promise.all(perClinician)
    practiceMs = Date.now() - tp0

    // Merge, dedupe by chunk id, sort by similarity desc, cap at MAX_MERGED_CHUNKS
    const seen = new Set()
    const merged = []
    for (const rows of results) {
      for (const row of (rows || [])) {
        const key = row.source_type + ':' + row.source_id + ':' + (row.chunk_index ?? 0)
        if (seen.has(key)) continue
        seen.add(key)
        merged.push(row)
      }
    }
    merged.sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
    practiceChunks = merged
      .filter((c) => (c.similarity ?? 1) >= minPracticeScore)
      .slice(0, MAX_MERGED_CHUNKS)
  } catch (e) {
    console.error('[ragFusion] practice retrieval failed:', e?.message)
    fallbackReason = 'embedding_error'
  }

  if (!practiceChunks.length && !fallbackReason) {
    fallbackReason = 'no_practice_chunks'
  }

  // --- 2. Compose expanded visual query via Haiku ---------------------------
  let expansionMs = 0
  if (practiceChunks.length > 0) {
    try {
      const te0 = Date.now()
      queryExpansion = await composeVisualQuery(topic, practiceChunks)
      expansionMs = Date.now() - te0
    } catch (e) {
      console.error('[ragFusion] composeVisualQuery failed:', e?.message)
      // Fall back to bare topic — still better than nothing
      queryExpansion = topic
    }
  }

  // --- 3. Retrieve visual chunks with expanded query ------------------------
  let visualChunks = []
  let visualMs = 0
  try {
    const tv0 = Date.now()
    visualChunks = await searchClips({
      query: queryExpansion,
      workspaceId,
      k: visualK,
      kind: visualKind,
      minScore: minVisualScore,
    })
    visualMs = Date.now() - tv0
  } catch (e) {
    console.error('[ragFusion] searchClips failed:', e?.message)
  }

  const totalMs = Date.now() - t0
  return {
    practiceChunks,
    visualChunks,
    queryExpansion,
    fallbackReason,
    timing: { practiceMs, expansionMs, visualMs, totalMs },
  }
}

/**
 * Use Haiku to rewrite a visual search query using the clinician's prior
 * clinical framing of the topic. ~150–200 output tokens.
 *
 * @param {string}   topic
 * @param {object[]} practiceChunks — top practice chunks; text field
 * @returns {Promise<string>}
 */
async function composeVisualQuery(topic, practiceChunks) {
  // Build a preview of the clinician's prior thinking (max 800 chars total)
  const priorThinking = practiceChunks
    .slice(0, 4)
    .map((c) => (c.text || '').slice(0, 200).trim())
    .filter(Boolean)
    .join(' … ')
    .slice(0, 800)

  if (!priorThinking) return topic

  const { text } = await generateText({
    model: 'anthropic/claude-haiku-4-5',
    system: `You rewrite a visual content search query for a clinical practitioner.
Given the topic and the practitioner's prior thinking, write a 1-3 sentence expanded
query that captures their specific clinical framing. Output only the expanded query —
no preamble, no labels, no markdown.`,
    messages: [{
      role: 'user',
      content: `Topic: ${topic}\n\nPrior thinking: ${priorThinking}\n\nExpanded visual query:`,
    }],
    maxOutputTokens: 200,
  })

  return (text || '').trim() || topic
}

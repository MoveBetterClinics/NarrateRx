// Multi-piece extract detection core (PR 4)
// .claude/design-interview-output-voice-fidelity.md, decision 3 + PR 4.
//
// A lightweight, read-only pass that decides whether an interview's blog draft
// should PROPOSE a split into a multi-part series. It does NOT split anything —
// the actual split (cluster + write pipeline) lives in
// api/content-items/split-into-series.js and only runs if the user accepts the
// proposal surfaced from this detection.
//
// Two gates, cheapest first:
//   1. WORD GATE (free) — count the clinician's own transcript words. Below a
//      floor, a single post is the only sensible output; we return
//      recommended_parts=1 without spending a model call.
//   2. MODEL GATE (~$0.005, Sonnet) — for long-enough transcripts, ask the
//      model whether there are genuinely distinct, post-worthy threads. Biased
//      hard toward 1; only proposes a split when keeping one post would force
//      good separable material to be cut.
//
// detectInterviewThreads never throws: any failure returns a recommended_parts
// of 1 (the safe default — no proposal shown) plus an error marker, so the
// caller can treat detection as best-effort.

import { generateObject } from 'ai'
import { z } from 'zod'
import { getThreadDetectionSystemPrompt } from '../../src/lib/prompts.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const MODEL = 'anthropic/claude-sonnet-4-6'

// Below this many clinician-spoken words, an interview can't sustain two full
// standalone posts — skip the model call and recommend one post. Tunable;
// the design lists the multi-piece threshold as an open question to calibrate
// empirically against past long interviews.
const MIN_WORDS_FOR_SPLIT = 700

// Hard ceiling — the split pipeline only supports 2|3|4 parts.
const MAX_PARTS = 4

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

const detectionSchema = z.object({
  recommended_parts: z.number().int().min(1).max(MAX_PARTS)
    .describe('1 = keep as a single blog post (the common case). 2-4 = propose a split into that many standalone posts.'),
  rationale: z.string()
    .describe('One sentence a busy clinician can judge at a glance — why one post, or why this many.'),
  titles: z.array(z.string())
    .describe('Provisional standalone title per proposed part. Empty when recommended_parts is 1.'),
})

function countWords(str) {
  if (!str) return 0
  return str.trim().split(/\s+/).filter(Boolean).length
}

/**
 * Decide whether a blog content_item's source interview should propose a split.
 * Read-only and workspace-scoped. Never throws.
 *
 * @param {{ id: string }} ws  Resolved workspace (from workspaceContext).
 * @param {string} contentItemId  The blog content_item to evaluate.
 * @returns {Promise<{
 *   eligible: boolean,            // false → caller should show no proposal
 *   recommended_parts: number,    // 1 = no split; 2-4 = propose split
 *   rationale?: string,
 *   titles?: string[],
 *   word_count?: number,
 *   reason?: string,              // why ineligible / why no model call
 *   error?: string,
 * }>}
 */
export async function detectInterviewThreads(ws, contentItemId) {
  if (!ws?.id) return { eligible: false, recommended_parts: 1, reason: 'no_workspace' }
  if (!contentItemId) return { eligible: false, recommended_parts: 1, reason: 'no_content_item' }
  const wsFilter = `workspace_id=eq.${ws.id}`

  // Load the target item — must be a blog, not already part of a series.
  const itemRes = await sb(
    `content_items?id=eq.${contentItemId}&${wsFilter}` +
    `&select=id,interview_id,clinician_id,platform,series_id,status`,
  )
  if (!itemRes.ok) return { eligible: false, recommended_parts: 1, reason: 'item_fetch_failed' }
  const itemRows = await itemRes.json().catch(() => [])
  if (!itemRows.length) return { eligible: false, recommended_parts: 1, reason: 'item_not_found' }
  const item = itemRows[0]

  if (item.platform !== 'blog') return { eligible: false, recommended_parts: 1, reason: 'not_blog' }
  if (item.series_id) return { eligible: false, recommended_parts: 1, reason: 'already_series' }
  if (!item.interview_id) return { eligible: false, recommended_parts: 1, reason: 'no_interview' }

  // Load the transcript.
  const ivRes = await sb(
    `interviews?id=eq.${item.interview_id}&${wsFilter}` +
    `&select=messages,cleaned_messages,voice_mode,topic,clinician_id`,
  )
  if (!ivRes.ok) return { eligible: false, recommended_parts: 1, reason: 'interview_fetch_failed' }
  const ivRows = await ivRes.json().catch(() => [])
  if (!ivRows.length) return { eligible: false, recommended_parts: 1, reason: 'interview_not_found' }
  const interview = ivRows[0]

  const voiceMode = interview.voice_mode === 'personal' ? 'personal' : 'practice'
  const raw = interview.cleaned_messages || interview.messages || []
  const clinicianTurns = (Array.isArray(raw) ? raw : [])
    .filter((m) => m?.role === 'user' && typeof m?.content === 'string')
    .map((m) => m.content.trim())
    .filter(Boolean)
  const transcript = clinicianTurns.join('\n\n---\n\n')
  const wordCount = countWords(transcript)

  // WORD GATE — too short to ever be more than one post.
  if (wordCount < MIN_WORDS_FOR_SPLIT) {
    return {
      eligible: true,
      recommended_parts: 1,
      rationale: 'Short enough to read as a single focused post.',
      titles: [],
      word_count: wordCount,
      reason: 'below_word_floor',
    }
  }

  // Resolve clinician name for the prompt (best-effort).
  let clinicianName = 'the clinician'
  const clinicianId = item.clinician_id || interview.clinician_id
  if (clinicianId) {
    const cRes = await sb(`clinicians?id=eq.${clinicianId}&${wsFilter}&select=name`).catch(() => null)
    if (cRes?.ok) {
      const rows = await cRes.json().catch(() => [])
      if (rows.length && rows[0].name) clinicianName = rows[0].name
    }
  }

  // MODEL GATE — ask whether the material splits into distinct threads.
  const systemPrompt = getThreadDetectionSystemPrompt(clinicianName, interview.topic || 'this topic', { voiceMode })
  let detection
  try {
    const { object } = await generateObject({
      model: MODEL,
      schema: detectionSchema,
      system: systemPrompt,
      messages: [{ role: 'user', content: `TRANSCRIPT (${clinicianName}'s verbatim words):\n\n${transcript}` }],
      temperature: 0.1,
    })
    detection = object
  } catch (e) {
    console.error(`[detectThreads] model call failed for ${contentItemId}: ${e?.message}`)
    // Safe default — no proposal shown.
    return { eligible: true, recommended_parts: 1, word_count: wordCount, error: 'detection_failed' }
  }

  // Clamp and sanity-check the model output against the part ceiling and the
  // titles it actually returned — never propose more parts than it named.
  let parts = Math.max(1, Math.min(MAX_PARTS, Math.round(detection.recommended_parts || 1)))
  const titles = Array.isArray(detection.titles) ? detection.titles.filter((t) => typeof t === 'string' && t.trim()) : []
  if (parts >= 2 && titles.length >= 2) {
    parts = Math.min(parts, titles.length)
  } else if (parts >= 2) {
    // Recommended a split but didn't name enough standalone titles — don't trust it.
    parts = 1
  }

  return {
    eligible: true,
    recommended_parts: parts,
    rationale: detection.rationale || '',
    titles: parts >= 2 ? titles.slice(0, parts) : [],
    word_count: wordCount,
  }
}

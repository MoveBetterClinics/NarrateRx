// Phase 5 Feature 2 (PR 2) — interview summarization for practice memory.
//
// Generates a 3–5 sentence distillation of a completed interview's clinical
// thinking and writes it to interviews.summary_text. The hot-context block
// in subsequent interview prompts uses these summaries instead of raw turns
// so prompt size stays bounded as a clinician's corpus grows.
//
// Runs fire-and-forget from the interview-completion path (api/db/interviews.js
// PATCH handler, alongside extractConcepts). Idempotent: skips rows that
// already have summary_text. Errors are logged to console.error and tagged
// [interviewSummarizer] so they surface in `vercel logs`.

import { generateText } from 'ai'
import { indexInterviewSummary } from './practiceMemoryRag.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const MODEL = 'anthropic/claude-sonnet-4-6'

// Hard caps so a stalled AI Gateway call or Supabase write can't silently burn
// the waitUntil budget to the 300s function wall (which strands the summary +
// chunk: a killed function never runs a finally, so nothing recovers). The
// model call is the only slow step; the PATCH should be sub-second.
const MODEL_TIMEOUT_MS  = 90_000
const MODEL_MAX_RETRIES = 2          // AI SDK retries transient gateway errors
const PATCH_TIMEOUT_MS  = 20_000

// Cap clinician-turn words sent to the model. A 90-min interview can be
// ~10k words of just the clinician's side; the summary should still fit
// in a single Sonnet call comfortably under this cap.
const MAX_WORDS = 4000

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

function buildPrompt({ staffName, topic, transcriptText }) {
  const who = staffName || 'the clinician'
  const what = topic || 'a clinical topic'
  return `You are distilling a clinician's interview into a 3–5 sentence summary that captures THEIR specific thinking — the perspective, the philosophy, the concrete examples, the counterintuitive takes that make their approach distinct.

Clinician: ${who}
Topic: ${what}

The summary will be re-injected into future interview prompts as context so the AI interviewer can reference what ${who} has already said. Therefore:

- Lead with the clinical philosophy or principle, not biography.
- Preserve specific phrases or framings the clinician uses when they're distinctive.
- Mention 1–2 concrete patient examples or clinical observations if present.
- Skip introductions, small talk, logistics.
- Skip anything that's just the interviewer's framing — capture only what ${who} contributed.
- Plain text. No markdown, no bullet points, no headings. Sentences only.
- Strict 3–5 sentence ceiling. Brevity over completeness.

Clinician's turns from the interview:

${transcriptText}

Return only the summary text — no preamble, no labels.`
}

/**
 * @typedef {object} SummarizeArgs
 * @property {string} interviewId
 * @property {string} workspaceId
 * @property {string=} staffId
 * @property {string=} staffName
 * @property {string=} topic
 * @property {Array<{role:string,content:string}>} messages   — preferred cleaned_messages, else raw
 */

/**
 * Summarize an interview and persist to interviews.summary_text.
 * Fire-and-forget — never throws. Skips when transcript is empty.
 *
 * @param {SummarizeArgs} args
 */
export async function summarizeInterview({ interviewId, workspaceId, staffId, staffName, topic, messages }) {
  try {
    if (!interviewId || !workspaceId) return

    const transcriptText = (messages || [])
      .filter((m) => m?.role === 'user' && typeof m.content === 'string' && m.content.trim())
      .map((m) => m.content.trim())
      .join('\n\n')
    if (!transcriptText) {
      console.info(`[interviewSummarizer] interview=${interviewId} skipped — empty transcript`)
      return
    }

    const truncated = transcriptText.split(/\s+/).slice(0, MAX_WORDS).join(' ')

    const startedAt = Date.now()
    const { text } = await generateText({
      model: MODEL,
      messages: [{ role: 'user', content: buildPrompt({ staffName, topic, transcriptText: truncated }) }],
      maxOutputTokens: 512,
      maxRetries:  MODEL_MAX_RETRIES,
      abortSignal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
    })

    const summary = (text || '').trim()
    if (!summary) {
      console.error(`[interviewSummarizer] interview=${interviewId} — model returned empty`)
      return
    }

    const r = await sb(`interviews?id=eq.${interviewId}&workspace_id=eq.${workspaceId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        summary_text: summary,
        summary_generated_at: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(PATCH_TIMEOUT_MS),
    })
    if (!r.ok) {
      const body = await r.text().catch(() => '')
      console.error(`[interviewSummarizer] PATCH ${r.status} interview=${interviewId}: ${body.slice(0, 300)}`)
      return
    }

    console.info(`[interviewSummarizer] interview=${interviewId} summarized (${summary.length} chars, ${Date.now() - startedAt}ms)`)

    // Phase 5 Feature 2 PR3 — embed the summary so it joins the RAG corpus.
    // This MUST be awaited. summarizeInterview is dispatched from the
    // interview-completion PATCH via waitUntil(), which only keeps the function
    // instance alive for work that is part of THIS promise. The previous bare
    // fire-and-forget resolved summarizeInterview before the embed ran, so the
    // platform froze the instance and the chunk was never written — every
    // interview completed after the 2026-05-24 backfill landed summary_text but
    // zero practice_memory_chunks. indexInterviewSummary never throws (it
    // retries once and swallows internally), so awaiting it is safe.
    const idxResult = await indexInterviewSummary({
      workspaceId,
      staffId,
      interviewId,
      summaryText: summary,
      topic,
      createdAt:   new Date().toISOString(),
    })
    console.info(`[interviewSummarizer] interview=${interviewId} indexed ${JSON.stringify(idxResult)}`)
  } catch (e) {
    const timedOut = e?.name === 'TimeoutError' || e?.name === 'AbortError'
    console.error(
      `[interviewSummarizer] interview=${interviewId} ` +
      `${timedOut ? 'TIMED OUT (hard cap hit — summary/chunk may be unwritten)' : 'threw'}: ` +
      `${e?.stack || e?.message}`
    )
  }
}

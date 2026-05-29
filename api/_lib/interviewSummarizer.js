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

    const { text } = await generateText({
      model: MODEL,
      messages: [{ role: 'user', content: buildPrompt({ staffName, topic, transcriptText: truncated }) }],
      maxOutputTokens: 512,
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
    })
    if (!r.ok) {
      const body = await r.text().catch(() => '')
      console.error(`[interviewSummarizer] PATCH ${r.status} interview=${interviewId}: ${body.slice(0, 300)}`)
      return
    }

    console.info(`[interviewSummarizer] interview=${interviewId} summarized (${summary.length} chars)`)

    // Phase 5 Feature 2 PR3 — embed the summary so it joins the RAG corpus.
    // Fire-and-forget; failures log but never break the summarization path.
    indexInterviewSummary({
      workspaceId,
      staffId,
      interviewId,
      summaryText: summary,
      topic,
      createdAt:   new Date().toISOString(),
    })
  } catch (e) {
    console.error(`[interviewSummarizer] interview=${interviewId} threw: ${e?.message}`)
  }
}

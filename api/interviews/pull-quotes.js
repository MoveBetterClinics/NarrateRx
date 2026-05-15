// POST /api/interviews/pull-quotes  { interviewId: string }
// Extracts 3-5 verbatim pull-quote candidates from the interview transcript.
// Hard constraint: every returned quote must be an exact substring of the
// transcript (the concatenated user messages). The model is prompted to
// extract — not paraphrase — but server-side validation drops any quote
// that doesn't match a substring before save.
export const config = { runtime: 'nodejs', maxDuration: 60 }

import { randomUUID } from 'node:crypto'
import { generateText } from 'ai'
import { workspaceContext } from '../_lib/workspaceContext.js'
import { enforceLimit } from '../_lib/ratelimit.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

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

const ok  = (res, data, status = 200) => res.status(status).json(data)
const err = (res, msg, status = 400)  => res.status(status).json({ error: msg })

function buildPrompt(transcript, topic) {
  return `Extract 3-5 exact verbatim sentences from the interview transcript below that would work as shareable pull quotes — sentences that are punchy, specific, opinionated, or memorable on their own.

Topic: ${topic}

Transcript (clinician's words):
"""
${transcript}
"""

HARD CONSTRAINT: Each "quote" field MUST be an exact substring of the transcript above — same words, same punctuation, same casing. Do NOT rephrase, summarize, combine multiple sentences, or invent. If a sentence is too long, trim it from the END only and keep the beginning verbatim. Return start_offset and end_offset as character indices into the transcript string between the triple-quotes (0-indexed).

Return ONLY a JSON array, no other text. Shape:
[
  { "quote": "...", "start_offset": 123, "end_offset": 245 },
  ...
]

Aim for 3-5 candidates, ranked most shareable first.`
}

function parseQuotes(text) {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end === -1 || end <= start) return []
  try {
    const arr = JSON.parse(text.slice(start, end + 1))
    if (!Array.isArray(arr)) return []
    return arr.filter((x) => x && typeof x.quote === 'string')
  } catch {
    return []
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405)
  if (!(await enforceLimit(req, res, 'ai'))) return

  const ws = await workspaceContext(req)
  if (!ws) return err(res, 'Workspace not resolved', 400)
  const wsFilter = `workspace_id=eq.${ws.id}`

  const { interviewId } = req.body || {}
  if (!interviewId) return err(res, 'Missing interviewId')

  const ivRes = await sb(`interviews?id=eq.${interviewId}&${wsFilter}&select=id,topic,messages`)
  if (!ivRes.ok) return err(res, 'Database error', 500)
  const ivRows = await ivRes.json()
  const iv = ivRows[0]
  if (!iv) return err(res, 'Interview not found', 404)

  const transcript = (iv.messages || [])
    .filter((m) => m.role === 'user')
    .map((m) => m.content || '')
    .join('\n\n')

  if (transcript.trim().length < 100) {
    return err(res, 'Transcript is too short for pull-quote extraction', 422)
  }

  const prompt = buildPrompt(transcript.slice(0, 12000), iv.topic || '')

  let text
  try {
    const result = await generateText({
      model: 'anthropic/claude-sonnet-4-6',
      system: prompt,
      messages: [{ role: 'user', content: 'Extract pull quotes now.' }],
      maxTokens: 1500,
    })
    text = result.text
  } catch (e) {
    console.error('[interviews/pull-quotes] AI call failed:', e?.message)
    return err(res, e?.message || 'AI extraction failed', 500)
  }

  const raw = parseQuotes(text || '')

  // The verbatim guarantee. The model is well-aligned to it with the prompt
  // above, but we enforce it server-side so a slip never ships an invented
  // quote attributed to the clinician.
  const validated = []
  const seen = new Set()
  for (const q of raw) {
    const quote = String(q.quote || '').trim()
    if (quote.length < 20) continue
    if (seen.has(quote)) continue
    const idx = transcript.indexOf(quote)
    if (idx === -1) continue // not verbatim — drop
    seen.add(quote)
    validated.push({
      id: randomUUID(),
      quote,
      start_offset: idx,
      end_offset: idx + quote.length,
    })
    if (validated.length >= 5) break
  }

  if (validated.length === 0) {
    return err(res, 'No verbatim pull quotes could be extracted — try again', 422)
  }

  const upd = await sb(`interviews?id=eq.${interviewId}&${wsFilter}`, {
    method: 'PATCH',
    body: JSON.stringify({ pull_quote_candidates: validated }),
  })
  if (!upd.ok) {
    const body = await upd.text().catch(() => '')
    console.error(`[interviews/pull-quotes] save failed — supabase ${upd.status}: ${body.slice(0, 300)}`)
    return err(res, 'Database error', 500)
  }

  return ok(res, { candidates: validated })
}

// POST /api/staff/refresh-voice-notes  { staff_id }
//
// Distills how this clinician edits AI drafts into a short "voice notes" block
// that is injected into every future prompt for their content. Reads up to N
// recent content_items where ai_original_content !== content (i.e. the clinician
// actually edited the draft), asks an AI to summarize the consistent patterns,
// and saves the result to clinicians.voice_notes.
//
// Manual trigger only (clinician profile button). Cheap to re-run — uses one
// AI call per refresh.
export const config = { runtime: 'nodejs', maxDuration: 60 }

import { generateText } from 'ai'
import { workspaceContext } from '../_lib/workspaceContext.js'
import { requireRole } from '../_lib/auth.js'
import { enforceLimit } from '../_lib/ratelimit.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const MAX_PAIRS = 12       // most recent edit pairs to analyze
const MIN_PAIRS = 3        // minimum needed before we even try

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

function buildAnalysisPrompt(staffName, workspaceName, editPairs) {
  const examples = editPairs
    .map((p, i) => `### EXAMPLE ${i + 1} — ${p.platform} post on ${p.topic}

AI ORIGINAL:
${p.ai_original_content}

WHAT ${staffName.toUpperCase()} CHANGED IT TO:
${p.content}
`)
    .join('\n')

  return `You are analyzing how a clinician at ${workspaceName} edits AI-generated content drafts. Identify the consistent patterns in how they revise drafts — things they routinely cut, add, rephrase, or restructure.

Your output will be injected directly into future prompts as guidance, so:
- Write actionable rules, not observations ("Cut hedging phrases like 'we believe'" — not "Tends to remove hedging phrases")
- 3 to 6 bullet points, one short line each
- Skip anything that only happened once or twice — only include patterns you see repeated across multiple examples
- Skip generic writing advice ("be specific," "use active voice") — only call out patterns SPECIFIC to this clinician's voice
- Skip stylistic preferences too vague to act on ("more conversational tone")
- If there are not enough consistent patterns to be useful, return the single line: "NO CLEAR PATTERN"

OUTPUT FORMAT — your full response must be just the bulleted rules, nothing else. No preamble, no commentary, no markdown headers.

EDIT EXAMPLES:

${examples}

Now write the rules.`
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405)
  if (!(await enforceLimit(req, res, 'ai'))) return

  const ws = await workspaceContext(req)
  if (!ws) return err(res, 'Workspace not resolved', 400)
  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  const wsFilter = `workspace_id=eq.${ws.id}`

  const staffId = req.body?.staff_id
  if (!staffId) return err(res, 'Missing staff_id')

  // Fetch clinician (and confirm they belong to this workspace)
  const clinRes = await sb(`staff?id=eq.${staffId}&${wsFilter}&select=id,name`)
  if (!clinRes.ok) return err(res, 'Database error', 500)
  const clinRows = await clinRes.json()
  if (!clinRows.length) return err(res, 'Clinician not found', 404)
  const clinician = clinRows[0]

  // Pull recent content_items where the clinician edited the AI draft.
  // We compare in JS rather than via a PostgREST filter because content
  // can be long and PostgREST `neq` on text columns is brittle.
  const itemsRes = await sb(
    `content_items?staff_id=eq.${staffId}&${wsFilter}` +
    `&select=platform,topic,content,ai_original_content` +
    `&ai_original_content=not.is.null` +
    `&order=created_at.desc&limit=40`
  )
  if (!itemsRes.ok) return err(res, 'Database error', 500)
  const items = await itemsRes.json()

  const editPairs = items
    .filter((it) =>
      it.ai_original_content &&
      it.content &&
      it.ai_original_content.trim() !== it.content.trim()
    )
    .slice(0, MAX_PAIRS)

  if (editPairs.length < MIN_PAIRS) {
    // Save a marker so the UI can show "need more edits" instead of looking broken
    await sb(`staff?id=eq.${staffId}&${wsFilter}`, {
      method: 'PATCH',
      body: JSON.stringify({
        voice_notes: null,
        voice_notes_refreshed_at: new Date().toISOString(),
        voice_notes_edits_analyzed: editPairs.length,
      }),
    })
    return ok(res, {
      ok: true,
      edits_analyzed: editPairs.length,
      voice_notes: null,
      message: `Need at least ${MIN_PAIRS} edited drafts to find a pattern (found ${editPairs.length}). Edit a few more drafts and try again.`,
    })
  }

  const systemPrompt = buildAnalysisPrompt(clinician.name, ws.display_name, editPairs)

  let analysisText
  try {
    const result = await generateText({
      model: 'anthropic/claude-sonnet-4-6',
      system: systemPrompt,
      messages: [{ role: 'user', content: 'Analyze the edits and write the rules now.' }],
      maxTokens: 600,
    })
    analysisText = (result.text || '').trim()
  } catch (e) {
    console.error('[clinicians/refresh-voice-notes] AI call failed:', e.message)
    return err(res, e.message || 'AI analysis failed', 500)
  }

  // "NO CLEAR PATTERN" means the AI found nothing actionable
  const voiceNotes = /^NO CLEAR PATTERN/i.test(analysisText) ? null : analysisText

  const patchRes = await sb(`staff?id=eq.${staffId}&${wsFilter}`, {
    method: 'PATCH',
    body: JSON.stringify({
      voice_notes: voiceNotes,
      voice_notes_refreshed_at: new Date().toISOString(),
      voice_notes_edits_analyzed: editPairs.length,
    }),
  })
  if (!patchRes.ok) return err(res, 'Database error', 500)

  return ok(res, {
    ok: true,
    edits_analyzed: editPairs.length,
    voice_notes: voiceNotes,
  })
}

// Caption fidelity scoring helper.
//
// Called via waitUntil() from the render paths (renderPackageChannels,
// longformEngine, packages/[id] rerender) after a story_packages row reaches
// status='complete', so scoring runs in the background without adding latency
// to the user-facing response. The standalone scorer at
// scripts/voice-fidelity-captions.mjs shares the SAME rubric via
// api/_lib/captionFidelityRubric.js (single source of truth — no drift).
//
// 2026-05-31 rewrite: the rubric now grades the caption against WHAT THE
// CLINICIAN ACTUALLY SAID (the clip transcript) plus their voice, and no longer
// rewards clinical/technical register for its own sake. See captionFidelityRubric.js
// for the full rationale. This helper fetches the transcript (segment excerpt if
// the caller passes one, else the source asset's transcription) and feeds it in.
//
// Scope discipline: this helper is workspace-agnostic at the helper level
// (no workspaceContext call), but each call must already be inside a
// workspace-scoped request that confirmed pkg.workspace_id matches the
// caller's workspace. The caller is responsible for that gate.

import { generateText } from 'ai'
import { buildFidelityPrompt, parseFidelity } from './captionFidelityRubric.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const EVAL_MODEL   = 'anthropic/claude-haiku-4-5'

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}

/**
 * Score one story package's caption + topic and persist score + breakdown.
 *
 * @param {object} args
 * @param {string} args.packageId       — story_packages.id
 * @param {string} args.workspaceId     — story_packages.workspace_id (used for cross-check + lookup)
 * @param {string} args.workspaceName   — for evaluator prompt
 * @param {string|null} args.staffId
 * @param {string} args.topic
 * @param {string} args.captionText
 * @param {string} [args.transcript]    — the exact clip transcript used to write the
 *                                         caption (e.g. a segment excerpt). When omitted,
 *                                         the source asset's transcription is fetched.
 * @returns {Promise<{ ok: boolean, score?: number, reason?: string }>}
 */
export async function scoreCaptionFidelity({
  packageId, workspaceId, workspaceName, staffId, topic, captionText, transcript = '',
}) {
  if (!packageId || !workspaceId) return { ok: false, reason: 'missing_ids' }
  if (!process.env.AI_GATEWAY_API_KEY) return { ok: false, reason: 'no_ai_key' }

  const text = (captionText || '').trim()
  const title = (topic || '').trim()
  if (!text && !title) return { ok: false, reason: 'empty' }

  // Look up clinician + voice phrases. Failures here are non-fatal — we
  // still score, just with empty phrase corpus.
  let staffName = 'unknown clinician'
  let phrases = []
  if (staffId) {
    try {
      const cRes = await sb(`staff?id=eq.${staffId}&select=name`)
      if (cRes.ok) {
        const rows = await cRes.json()
        staffName = rows?.[0]?.name || staffName
      }
      const pRes = await sb(`staff_voice_phrases?staff_id=eq.${staffId}&select=phrase,weight&order=weight.desc&limit=8`)
      if (pRes.ok) phrases = await pRes.json()
    } catch {
      // ignore — we'll score with whatever we have
    }
  }

  // Resolve the transcript the caption should be faithful to. Prefer an explicit
  // excerpt from the caller; otherwise fall back to the source asset's whole-clip
  // transcription via the package's source_asset_id. Non-fatal — empty just means
  // said_fidelity is scored neutral (the no-audio path).
  let clipTranscript = String(transcript || '').trim()
  if (!clipTranscript) {
    try {
      const pkgRes = await sb(
        `story_packages?id=eq.${packageId}&workspace_id=eq.${workspaceId}` +
        `&select=source_asset:media_assets(transcription)&limit=1`,
      )
      if (pkgRes.ok) {
        const rows = await pkgRes.json()
        clipTranscript = String(rows?.[0]?.source_asset?.transcription || '').trim()
      }
    } catch {
      // ignore — score without a faithfulness reference
    }
  }

  const prompt = buildFidelityPrompt({
    topic: title, caption: text, transcript: clipTranscript, phrases, staffName,
    workspaceName: workspaceName || 'workspace',
  })

  let raw = ''
  try {
    const res = await generateText({
      model: EVAL_MODEL,
      system: prompt.system,
      messages: [{ role: 'user', content: prompt.user }],
      maxOutputTokens: 240,
    })
    raw = res.text
  } catch (err) {
    console.error('[captionFidelity] LLM call failed:', err?.message || err)
    return { ok: false, reason: 'llm_error' }
  }

  const parsed = parseFidelity(raw, {
    has_phrases:    phrases.length > 0,
    phrase_count:   phrases.length,
    has_transcript: clipTranscript.length > 0,
    scored_at:      new Date().toISOString(),
    model:          EVAL_MODEL,
    rubric:         'faithfulness-v2',
  })
  if (!parsed) return { ok: false, reason: 'no_dims_parsed' }
  const { overall, breakdown } = parsed

  // Persist — scoped by workspace_id as a belt-and-braces guard against
  // a renamed/deleted package being mutated under us.
  const patchRes = await sb(`story_packages?id=eq.${packageId}&workspace_id=eq.${workspaceId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      voice_fidelity_score: overall,
      voice_fidelity_breakdown: breakdown,
    }),
  })
  if (!patchRes.ok) {
    const errText = await patchRes.text().catch(() => '')
    console.error('[captionFidelity] persist failed:', patchRes.status, errText.slice(0, 200))
    return { ok: false, reason: 'persist_failed', score: overall }
  }

  return { ok: true, score: overall }
}

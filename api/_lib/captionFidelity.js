// Caption voice-fidelity scoring helper.
//
// V1 of the "Deepen the video build" extension set. Called via waitUntil()
// from generate-package + rerender-package after the row reaches
// status='complete', so scoring runs in the background without adding
// latency to the user-facing response. The standalone scorer at
// scripts/voice-fidelity-captions.mjs mirrors this logic for offline
// fixture refresh.
//
// Scope discipline: this helper is workspace-agnostic at the helper level
// (no workspaceContext call), but each call must already be inside a
// workspace-scoped request that confirmed pkg.workspace_id matches the
// caller's workspace. The caller is responsible for that gate.

import { generateText } from 'ai'

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

function buildEvalPrompt({ topic, caption, staffName, phrases, workspaceName }) {
  const phraseExamples = (phrases || []).slice(0, 8).map((p) => `- "${p.phrase}"`).join('\n')
  const hasPhrases = phraseExamples.length > 0
  return {
    system:
`You are a precise content quality evaluator for SHORT social-distribution copy
(captions + thumbnail titles). Score the package on multiple voice fidelity
dimensions. Return ONLY valid JSON — no markdown, no preamble, no commentary.`,
    user:
`Evaluate this story package — a thumbnail title + accompanying caption that
will be burned into video subtitles and posted as the social caption. Written
for ${staffName} at ${workspaceName}.

${hasPhrases
  ? `CLINICIAN'S AUTHENTIC VOICE PHRASES (use these to judge fidelity):\n${phraseExamples}`
  : `(No voice phrases on record for this clinician yet — score voice_fidelity at 5 if you can't compare.)`}

TITLE (thumbnail text, ${(topic || '').length} chars):
"${topic || ''}"

CAPTION (subtitle + social copy, ${(caption || '').length} chars):
"${caption || ''}"

Score each dimension 1–10 and return this exact JSON shape (no other keys):
{
  "voice_fidelity": <1-10; rhythm + word choice match to the voice phrases above${hasPhrases ? '' : '; score 5 if no phrases'}>,
  "clinical_texture": <1-10; sounds like a real practitioner, not generic content-mill>,
  "redundancy": <1-10 INVERSE — 10=tight no repetition, 1=title and caption restate each other>,
  "specificity": <1-10; concrete vs vague (real anatomy, technique names, situations, not platitudes)>,
  "brand_fit": <1-10; feels like an authentic practice voice, not a corporate template>,
  "red_flag": "<one short phrase: the single biggest issue, or 'none'>"
}`,
  }
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
 * @returns {Promise<{ ok: boolean, score?: number, reason?: string }>}
 */
export async function scoreCaptionFidelity({
  packageId, workspaceId, workspaceName, staffId, topic, captionText,
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

  const prompt = buildEvalPrompt({
    topic: title, caption: text, staffName, phrases,
    workspaceName: workspaceName || 'workspace',
  })

  let evalResult = {}
  try {
    const { text: raw } = await generateText({
      model: EVAL_MODEL,
      system: prompt.system,
      messages: [{ role: 'user', content: prompt.user }],
      maxOutputTokens: 220,
    })
    try {
      evalResult = JSON.parse(raw.trim())
    } catch {
      const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
      try { evalResult = JSON.parse(cleaned) } catch { /* keep empty */ }
    }
  } catch (err) {
    console.error('[captionFidelity] LLM call failed:', err?.message || err)
    return { ok: false, reason: 'llm_error' }
  }

  const dims = ['voice_fidelity', 'clinical_texture', 'redundancy', 'specificity', 'brand_fit']
  const valid = dims.filter((d) => typeof evalResult[d] === 'number')
  if (!valid.length) return { ok: false, reason: 'no_dims_parsed' }
  const overall = Number((valid.reduce((s, d) => s + evalResult[d], 0) / valid.length).toFixed(2))

  const breakdown = {
    voice_fidelity:   evalResult.voice_fidelity   ?? null,
    clinical_texture: evalResult.clinical_texture ?? null,
    redundancy:       evalResult.redundancy       ?? null,
    specificity:      evalResult.specificity      ?? null,
    brand_fit:        evalResult.brand_fit        ?? null,
    red_flag:         evalResult.red_flag         || null,
    has_phrases:      phrases.length > 0,
    phrase_count:     phrases.length,
    scored_at:        new Date().toISOString(),
    model:            EVAL_MODEL,
  }

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

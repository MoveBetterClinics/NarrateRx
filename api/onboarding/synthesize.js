// Synthesizer for the onboarding interview (P3). Reads a `completed` row,
// runs the transcript through Claude with the structured-output synthesis
// prompt, and writes results to:
//   - workspaces.brand_voice              (replace)
//   - workspaces.patient_context          (additive merge — never clobbers
//                                          existing prototypes, summary, etc.)
//   - workspaces.topic_suggestions        (replace)
//   - workspaces.onboarding_interview_completed_at  (set to now)
//   - staff_voice_phrases             (upsert on normalized phrase)
//   - workspace_onboarding_interviews.*   (status='synthesized', audit fields)
//
// Synchronous (no queue). Typical run: ~20–40s on Sonnet for a 15-message
// transcript at 4096 maxOutputTokens. Well within Vercel's 300s ceiling.
export const config = { runtime: 'nodejs', maxDuration: 300 }

import { generateText } from 'ai'
import { workspaceContext, invalidateWorkspaceCacheById, invalidateWorkspaceCacheBySlug } from '../_lib/workspaceContext.js'
import { requireRole } from '../_lib/auth.js'
import { enforceLimit } from '../_lib/ratelimit.js'
import {
  getOnboardingSynthesisSystemPrompt,
  SYNTHESIS_PROMPT_VERSION,
} from '../../src/lib/onboardingSynthesisPrompt.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const MODEL_ID = 'claude-sonnet-4-6'

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...init.headers,
    },
  })
}

const ok  = (res, data, status = 200) => res.status(status).json(data)
const err = (res, msg, status = 400)  => res.status(status).json({ error: msg })

async function dbErr(res, r, msg = 'Database error', status = 500) {
  const body = await r.text().catch(() => '')
  console.error(`[onboarding/synthesize] ${msg} — supabase ${r.status}: ${body.slice(0, 500)}`)
  return res.status(status).json({ error: msg })
}

// Normalize a phrase for the unique-index lookup on staff_voice_phrases
// (matches the migration-042 contract: lowercase, trimmed, terminal punctuation
// stripped). Application-layer normalization keeps the index column simple
// (text instead of a generated column).
function normalizePhrase(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[.,;:!?…]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Strip a leading ```json fence (and trailing ```) some models occasionally emit
// even with strict "no markdown" instructions. Tolerate so a single misbehaving
// turn doesn't sink a 20-minute interview.
function stripFences(text) {
  const trimmed = String(text || '').trim()
  if (!trimmed.startsWith('```')) return trimmed
  return trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim()
}

// Validate the parsed synthesis JSON has the right SHAPE (not the right
// CONTENT — that's the model's job). Throws on missing or wrong-typed required
// fields. Returns a normalized object so downstream code doesn't have to
// re-defend.
function validateSynthesis(parsed) {
  if (!parsed || typeof parsed !== 'object') throw new Error('Synthesis output not an object')

  const brandVoice = typeof parsed.brand_voice === 'string' ? parsed.brand_voice.trim() : ''
  if (!brandVoice) throw new Error('brand_voice missing or empty')

  const pc = parsed.patient_context || {}
  const summaryBlurb = typeof pc.summaryBlurb === 'string' ? pc.summaryBlurb.trim() : ''
  const prototype = pc.prototype && typeof pc.prototype === 'object' ? pc.prototype : null
  const painPoints = Array.isArray(pc.priorProviderPainPoints)
    ? pc.priorProviderPainPoints.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim())
    : []

  const topics = Array.isArray(parsed.topic_suggestions)
    ? parsed.topic_suggestions
        .filter((t) => t && typeof t.topic === 'string' && t.topic.trim())
        .map((t) => ({
          topic: t.topic.trim(),
          category: typeof t.category === 'string' ? t.category.trim() : 'general',
          priority: ['high', 'medium', 'low'].includes(t.priority) ? t.priority : 'medium',
          keywords: Array.isArray(t.keywords)
            ? t.keywords.filter((k) => typeof k === 'string' && k.trim()).map((k) => k.toLowerCase().trim())
            : [],
        }))
    : []

  const voicePhrases = Array.isArray(parsed.voice_phrases)
    ? parsed.voice_phrases
        .filter((p) => p && typeof p.phrase === 'string' && p.phrase.trim())
        .map((p) => ({
          phrase: p.phrase.trim(),
          context: typeof p.context === 'string' ? p.context.trim() : '',
        }))
    : []

  return { brandVoice, summaryBlurb, prototype, painPoints, topics, voicePhrases }
}

// Build the user message: the transcript serialized as Founder/Bernard turns.
// Keeping it human-readable in the prompt (vs. JSON dump) helps the model
// reason about who said what.
function formatTranscript(messages, founderName) {
  return messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
    .map((m) => {
      const speaker = m.role === 'user' ? founderName : 'Bernard'
      return `${speaker}:\n${String(m.content || '').trim()}`
    })
    .join('\n\n')
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405)

  const ws = await workspaceContext(req)
  if (!ws) return err(res, 'Workspace not resolved', 400)

  const auth = await requireRole(req, ['admin'], { orgId: ws.clerk_org_id })
  if (!auth.ok) return err(res, auth.reason, auth.reason === 'forbidden' ? 403 : 401)

  if (!(await enforceLimit(req, res, 'ai'))) return

  if (!process.env.AI_GATEWAY_API_KEY) {
    return err(res, 'AI_GATEWAY_API_KEY is not set on this deployment', 500)
  }

  const { id, founderName, dryRun } = req.body || {}
  if (!id) return err(res, 'Missing id')
  // Dry-run mode runs the LLM and returns the synthesis result but performs
  // NO writes — no workspace PATCH, no voice_phrases insert, no interview
  // status flip. Used during P5 prompt-tuning so we can iterate without
  // clobbering production workspace voice / topic_suggestions.
  const isDryRun = dryRun === true

  // Load the interview row. Workspace filter is the multi-tenant fence.
  const loadR = await sb(
    `workspace_onboarding_interviews?id=eq.${encodeURIComponent(id)}&workspace_id=eq.${ws.id}&select=id,staff_id,owner_id,messages,status`
  )
  if (!loadR.ok) return dbErr(res, loadR, 'Load failed')
  const interview = (await loadR.json())[0]
  if (!interview) return err(res, 'Not found', 404)
  if (interview.owner_id !== auth.userId) return err(res, 'Forbidden', 403)

  // Real runs require status='completed' — `synthesized` blocks re-write,
  // `in_progress` is premature, `abandoned` is the explicit throwaway.
  // Dry runs additionally accept `synthesized` so we can compare a new
  // prompt's output against a previous run on the same transcript without
  // resetting status.
  const allowedStatuses = isDryRun ? ['completed', 'synthesized'] : ['completed']
  if (!allowedStatuses.includes(interview.status)) {
    return err(res, `Cannot synthesize ${interview.status} interview${isDryRun ? ' (dry-run)' : ''}`, 409)
  }

  const messages = Array.isArray(interview.messages) ? interview.messages : []
  if (messages.length < 2) return err(res, 'Transcript too short to synthesize', 422)

  // ── Atomic claim (real runs only) ──────────────────────────────────────
  // Flip status from 'completed' → 'synthesizing' with a conditional PATCH
  // (filter: status=eq.completed). Concurrent callers race here; only one
  // PATCH returns a row, the other gets zero rows back and bails with 409.
  // Without this, two requests can both pass the status gate above, both
  // run a ~30s Claude call, and both clobber workspaces.brand_voice /
  // patient_context / topic_suggestions while doubling voice_phrases
  // upserts (P0-2, audit 2026-05-24). Dry runs skip the claim — they
  // don't write, so there's nothing to race on.
  if (!isDryRun) {
    const claimR = await sb(
      `workspace_onboarding_interviews?id=eq.${encodeURIComponent(id)}&workspace_id=eq.${ws.id}&status=eq.completed`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'synthesizing',
          updated_at: new Date().toISOString(),
        }),
      }
    )
    if (!claimR.ok) return dbErr(res, claimR, 'Claim failed')
    const claimRows = await claimR.json()
    if (!claimRows.length) {
      return err(res, 'Another synthesis is already in flight or has already completed', 409)
    }
  }

  // After the claim and BEFORE the workspace PATCH succeeds, any failure
  // should revert status to 'completed' so the user can retry safely.
  // IMPORTANT: do NOT call revertClaim() after the workspace PATCH has
  // succeeded — the workspace fields are already correct, and reverting
  // would allow a retry that re-runs the merge, doubling pain_points (the
  // AI rarely produces byte-identical strings so Set-dedup won't catch it).
  // The markR failure path intentionally omits revertClaim for this reason.
  const revertClaim = async () => {
    try {
      await sb(
        `workspace_onboarding_interviews?id=eq.${encodeURIComponent(id)}&workspace_id=eq.${ws.id}&status=eq.synthesizing`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            status: 'completed',
            updated_at: new Date().toISOString(),
          }),
        }
      )
    } catch (e) {
      console.error('[onboarding/synthesize] revert claim failed:', e?.message)
    }
  }

  // Load the founder's clinician row + the current workspace patient_context
  // so we can merge additively. One round-trip; both lookups are cheap.
  const fname = (founderName || '').trim() || 'Founder'
  const [clinR, wsR] = await Promise.all([
    interview.staff_id
      ? sb(`staff?id=eq.${interview.staff_id}&workspace_id=eq.${ws.id}&select=id,name`)
      : Promise.resolve({ ok: true, json: async () => [] }),
    sb(`workspaces?id=eq.${ws.id}&select=patient_context,topic_suggestions,brand_voice,display_name`),
  ])
  if (!clinR.ok) { await revertClaim(); return dbErr(res, clinR, 'Clinician load failed') }
  if (!wsR.ok)   { await revertClaim(); return dbErr(res, wsR,   'Workspace load failed') }

  const clinician = (await clinR.json())[0] || null
  const wsRow     = (await wsR.json())[0] || {}
  const wsForPrompt = { display_name: wsRow.display_name || ws.display_name }
  const founderDisplayName = clinician?.name || fname

  // Run synthesis.
  const systemPrompt = getOnboardingSynthesisSystemPrompt(wsForPrompt, founderDisplayName)
  const userContent = `TRANSCRIPT:\n\n${formatTranscript(messages, founderDisplayName)}`

  let rawText
  try {
    const { text } = await generateText({
      model: `anthropic/${MODEL_ID}`,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
      maxOutputTokens: 4096,
    })
    rawText = text
  } catch (e) {
    console.error('[onboarding/synthesize] generateText failed:', e?.message)
    await revertClaim()
    return err(res, e?.message || 'Synthesis call failed', 502)
  }

  let parsed
  try {
    parsed = JSON.parse(stripFences(rawText))
  } catch {
    console.error('[onboarding/synthesize] JSON parse failed; raw output (first 1000):', String(rawText).slice(0, 1000))
    await revertClaim()
    return err(res, 'Synthesizer returned non-JSON output', 502)
  }

  let normalized
  try {
    normalized = validateSynthesis(parsed)
  } catch (e) {
    console.error('[onboarding/synthesize] validation failed:', e?.message, 'parsed:', JSON.stringify(parsed).slice(0, 1000))
    await revertClaim()
    return err(res, `Synthesis validation failed: ${e?.message}`, 502)
  }

  // ── DRY RUN: short-circuit before any writes ────────────────────────────
  // Returns the same shape as a real run plus `dryRun: true` and the full
  // synthesisResult payload for inspection. Nothing is written: no workspace
  // PATCH, no voice_phrases insert, no interview status flip.
  if (isDryRun) {
    return ok(res, {
      ok: true,
      dryRun: true,
      counts: {
        brand_voice_chars: normalized.brandVoice.length,
        topics: normalized.topics.length,
        voice_phrases: normalized.voicePhrases.length,
        has_prototype: !!normalized.prototype,
        pain_points: normalized.painPoints.length,
      },
      synthesisResult: {
        brand_voice: normalized.brandVoice,
        patient_context: {
          summaryBlurb: normalized.summaryBlurb,
          prototype: normalized.prototype,
          priorProviderPainPoints: normalized.painPoints,
        },
        topic_suggestions: normalized.topics,
        voice_phrases: normalized.voicePhrases,
        model: MODEL_ID,
        prompt_version: SYNTHESIS_PROMPT_VERSION,
      },
    })
  }

  // ── Build workspace PATCH ───────────────────────────────────────────────
  // patient_context is ADDITIVE: read existing, layer synthesis on top
  // without clobbering existing prototypes or other fields.
  const existingPC = (wsRow.patient_context && typeof wsRow.patient_context === 'object') ? wsRow.patient_context : {}
  const existingPrototypes = Array.isArray(existingPC.prototypes) ? existingPC.prototypes : []
  const existingPainPoints = Array.isArray(existingPC.priorProviderPainPoints) ? existingPC.priorProviderPainPoints : []

  const mergedPC = { ...existingPC }
  if (normalized.summaryBlurb) mergedPC.summaryBlurb = normalized.summaryBlurb
  if (normalized.prototype) {
    // Dedupe by id — if a 'founder-ideal' already exists (re-synthesis), replace it.
    const filtered = existingPrototypes.filter((p) => p?.id !== normalized.prototype.id)
    mergedPC.prototypes = [...filtered, normalized.prototype]
  } else if (existingPrototypes.length) {
    mergedPC.prototypes = existingPrototypes
  }
  if (normalized.painPoints.length) {
    // Union (dedupe by exact match) to preserve any pre-existing entries.
    const set = new Set([...existingPainPoints, ...normalized.painPoints])
    mergedPC.priorProviderPainPoints = Array.from(set)
  } else if (existingPainPoints.length) {
    mergedPC.priorProviderPainPoints = existingPainPoints
  }

  const wsPatch = {
    brand_voice: normalized.brandVoice,
    patient_context: mergedPC,
    topic_suggestions: normalized.topics.length ? normalized.topics : (wsRow.topic_suggestions ?? []),
    onboarding_interview_completed_at: new Date().toISOString(),
  }

  const patchR = await sb(`workspaces?id=eq.${ws.id}`, {
    method: 'PATCH',
    body: JSON.stringify(wsPatch),
  })
  if (!patchR.ok) { await revertClaim(); return dbErr(res, patchR, 'Workspace update failed') }
  // The synthesize step writes patient_context / topic_suggestions /
  // brand_voice / display_name onto the workspace, and the user is redirected
  // straight to Settings. Drop the per-instance cache so the first GET on
  // this instance sees the synthesized values.
  invalidateWorkspaceCacheById(ws.id)
  invalidateWorkspaceCacheBySlug(ws.slug)

  // ── Upsert voice phrases ────────────────────────────────────────────────
  // Skip silently if we have no staff_id (orphaned interview) or no phrases
  // (a thin transcript). The synthesis row still gets marked 'synthesized'.
  if (clinician?.id && normalized.voicePhrases.length) {
    const rows = []
    const seen = new Set()
    for (const p of normalized.voicePhrases) {
      const norm = normalizePhrase(p.phrase)
      if (!norm || seen.has(norm)) continue
      seen.add(norm)
      rows.push({
        workspace_id: ws.id,
        staff_id: clinician.id,
        phrase: p.phrase,
        phrase_normalized: norm,
        weight: 1.0,
        approve_count: 0,
        reject_count: 0,
        last_seen_at: new Date().toISOString(),
      })
    }
    if (rows.length) {
      // PostgREST upsert: on_conflict in URL + Prefer: resolution=merge-duplicates.
      // Per project memory (feedback_postgrest_upsert): missing on_conflict in URL
      // causes 409 even with the Prefer header set.
      const upsertR = await sb(
        'staff_voice_phrases?on_conflict=workspace_id,staff_id,phrase_normalized',
        {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates, return=minimal' },
          body: JSON.stringify(rows),
        }
      )
      if (!upsertR.ok) {
        // Don't fail the whole synthesis just because phrase upsert hiccupped —
        // workspace voice config still landed and is the bigger win. Log loudly.
        const body = await upsertR.text().catch(() => '')
        console.error(`[onboarding/synthesize] phrase upsert failed: ${upsertR.status}: ${body.slice(0, 400)}`)
      }
    }
  }

  // ── Mark synthesis complete on the interview row ────────────────────────
  const synthesisAudit = {
    brand_voice: normalized.brandVoice,
    patient_context: {
      summaryBlurb: normalized.summaryBlurb,
      prototype: normalized.prototype,
      priorProviderPainPoints: normalized.painPoints,
    },
    topic_suggestions: normalized.topics,
    voice_phrases: normalized.voicePhrases,
    model: MODEL_ID,
    prompt_version: SYNTHESIS_PROMPT_VERSION,
    synthesized_at: new Date().toISOString(),
  }

  const markR = await sb(`workspace_onboarding_interviews?id=eq.${encodeURIComponent(id)}&workspace_id=eq.${ws.id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      status: 'synthesized',
      synthesized_at: new Date().toISOString(),
      synthesis_result: synthesisAudit,
      updated_at: new Date().toISOString(),
    }),
  })
  if (!markR.ok) {
    // Do NOT revert here. The workspace write above already succeeded —
    // brand_voice, patient_context, and topic_suggestions are persisted.
    // Reverting to 'completed' would enable a retry that re-runs Claude and
    // re-merges potentially different AI output into the workspace (pain points
    // are Set-deduped by exact string, but model non-determinism means a second
    // run can produce slightly different phrasing and create duplicates).
    //
    // Leaving the interview in 'synthesizing' is the safer failure mode: an
    // admin can manually flip it to 'synthesized' in the DB. The workspace is
    // already correctly updated.
    console.error(`[onboarding/synthesize] markR failed after workspace write — interview ${id} stuck in synthesizing. Manual DB fix: UPDATE workspace_onboarding_interviews SET status='synthesized' WHERE id='${id}'`)
    return dbErr(res, markR, 'Workspace context saved but interview status update failed — your voice context is ready. Contact support if this message persists.')
  }

  return ok(res, {
    ok: true,
    counts: {
      brand_voice_chars: normalized.brandVoice.length,
      topics: normalized.topics.length,
      voice_phrases: normalized.voicePhrases.length,
      has_prototype: !!normalized.prototype,
      pain_points: normalized.painPoints.length,
    },
  })
}

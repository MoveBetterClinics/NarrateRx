// Two-pass voice-fidelity audit core (PR 3)
// .claude/design-interview-output-voice-fidelity.md, section 6.
//
// Shared by the HTTP endpoint (api/content-items/voice-audit.js, called
// fire-and-forget after interview→blog generation) and the regen path
// (api/content-items/blog-regen-finalize.js, which re-audits after a redraft
// so the score never goes stale).
//
// Pass 1 (generation) happens elsewhere. This is pass 2: score the stored
// draft against (1) the transcript, (2) the clinician's voice profile, and
// (3) practice memory (We-lane only), then persist voice_fidelity_score +
// voice_audit onto the content_item. Flag-only — never mutates the draft body.
//
// auditContentItem never throws: every failure path records a marker on
// voice_audit and returns a structured result so callers can fire-and-forget.

import { generateObject } from 'ai'
import { z } from 'zod'
import { getVoiceAuditSystemPrompt } from '../../src/lib/prompts.js'
import { resolveOwnHistoryBlock, buildRagQuery } from './practiceMemory.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const MODEL = 'anthropic/claude-sonnet-4-6'

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

const flagSchema = z.object({
  type: z.enum([
    'vocabulary_swap',
    'imposed_structure',
    'smoothed_opinion',
    'fabricated_claim',
  ]).describe('The drift category.'),
  severity: z.enum(['low', 'medium', 'high']),
  excerpt: z.string().describe('The exact draft text exhibiting the drift — quoted verbatim, never paraphrased.'),
  issue: z.string().describe('One sentence: what drifted and from what.'),
  suggestion: z.string().describe("Concrete fix. For a vocabulary_swap, usually the clinician's original word."),
})

const auditSchema = z.object({
  voice_fidelity_score: z.number().int().min(0).max(100),
  summary: z.string().describe("One sentence overall assessment of the draft's voice fidelity."),
  flags: z.array(flagSchema),
})

async function patchItem(wsId, contentItemId, patch) {
  return sb(`content_items?id=eq.${contentItemId}&workspace_id=eq.${wsId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  }).catch((err) => {
    console.error('[voiceAudit] patchItem network error:', err?.message || err)
    return null
  })
}

/**
 * Audit one content_item and persist the result. Workspace-scoped.
 * @param {{ id: string }} ws  Resolved workspace (from workspaceContext).
 * @param {string} contentItemId
 * @returns {Promise<{ ok: boolean, audited: boolean, score?: number, reason?: string }>}
 */
export async function auditContentItem(ws, contentItemId) {
  if (!ws?.id) return { ok: false, audited: false, reason: 'no_workspace' }
  if (!contentItemId) return { ok: false, audited: false, reason: 'no_content_item' }
  const wsFilter = `workspace_id=eq.${ws.id}`

  // Load the target content_item.
  const itemRes = await sb(`content_items?id=eq.${contentItemId}&${wsFilter}&select=id,interview_id,clinician_id,content,platform`)
  if (!itemRes.ok) return { ok: false, audited: false, reason: 'item_fetch_failed' }
  const itemRows = await itemRes.json().catch(() => [])
  if (!itemRows.length) return { ok: false, audited: false, reason: 'item_not_found' }
  const item = itemRows[0]
  if (!item.content?.trim()) return { ok: false, audited: false, reason: 'empty_content' }

  // Load transcript + voice profile in parallel.
  let interview = null
  let transcript = ''
  let voiceMode = 'practice'
  let voiceNotes = ''
  let clinicianName = 'the clinician'
  let voicePhrases = []
  const fetches = []

  if (item.interview_id) {
    fetches.push(
      sb(`interviews?id=eq.${item.interview_id}&${wsFilter}&select=messages,cleaned_messages,voice_mode,topic`)
        .then(async (r) => {
          if (!r.ok) return
          const rows = await r.json()
          if (!rows.length) return
          interview = rows[0]
          voiceMode = interview.voice_mode === 'personal' ? 'personal' : 'practice'
          const raw = interview.cleaned_messages || interview.messages || []
          transcript = raw
            .filter((m) => m?.role === 'user' && typeof m?.content === 'string')
            .map((m) => m.content.trim())
            .filter(Boolean)
            .join('\n\n---\n\n')
        })
        .catch(() => {}),
    )
  }

  if (item.clinician_id) {
    fetches.push(
      sb(`clinicians?id=eq.${item.clinician_id}&${wsFilter}&select=name,voice_notes`)
        .then(async (r) => {
          if (!r.ok) return
          const rows = await r.json()
          if (rows.length) {
            clinicianName = rows[0].name || clinicianName
            voiceNotes = rows[0].voice_notes || ''
          }
        })
        .catch(() => {}),
    )
    fetches.push(
      sb(
        `clinician_voice_phrases?clinician_id=eq.${item.clinician_id}&${wsFilter}` +
        `&select=phrase&order=weight.desc,last_seen_at.desc&limit=12`,
      )
        .then(async (r) => { if (r.ok) voicePhrases = await r.json() })
        .catch(() => {}),
    )
  }

  await Promise.all(fetches)

  if (!transcript.trim()) {
    await patchItem(ws.id, contentItemId, {
      voice_fidelity_score: null,
      voice_audit: { error: 'no_transcript', audited_at: new Date().toISOString() },
    })
    return { ok: true, audited: false, reason: 'no_transcript' }
  }

  // Practice memory — We-lane only.
  let practiceMemoryBlock = ''
  if (voiceMode === 'practice' && item.clinician_id) {
    practiceMemoryBlock = await resolveOwnHistoryBlock({
      workspaceId: ws.id,
      clinicianId: item.clinician_id,
      excludeInterviewId: item.interview_id,
      query: buildRagQuery(interview),
    }).catch(() => '')
  }

  const systemPrompt = getVoiceAuditSystemPrompt(clinicianName, {
    voiceMode,
    voiceNotes,
    voicePhrases,
    practiceMemoryBlock,
  })

  const userContent =
    `ORIGINAL TRANSCRIPT (${clinicianName}'s verbatim words):\n${transcript}\n\n` +
    `========================================\n\n` +
    `GENERATED DRAFT TO AUDIT:\n${item.content}`

  let audit = null
  try {
    const { object } = await generateObject({
      model: MODEL,
      schema: auditSchema,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
      temperature: 0.2,
    })
    audit = object
  } catch (e) {
    console.error(`[voiceAudit] model call failed for ${contentItemId}: ${e?.message}`)
    await patchItem(ws.id, contentItemId, {
      voice_fidelity_score: null,
      voice_audit: { error: 'audit_failed', audited_at: new Date().toISOString() },
    })
    return { ok: false, audited: false, reason: 'audit_failed' }
  }

  const sources = ['transcript']
  if (voiceNotes.trim() || voicePhrases.length) sources.push('voice_profile')
  if (practiceMemoryBlock.trim()) sources.push('practice_memory')

  const voiceAudit = {
    score: audit.voice_fidelity_score,
    summary: audit.summary,
    flags: audit.flags || [],
    sources,
    voice_mode: voiceMode,
    model: MODEL,
    audited_at: new Date().toISOString(),
  }

  const upd = await patchItem(ws.id, contentItemId, {
    voice_fidelity_score: audit.voice_fidelity_score,
    voice_audit: voiceAudit,
  })
  if (!upd || !upd.ok) {
    console.error(`[voiceAudit] persist failed for ${contentItemId}`)
    return { ok: false, audited: false, reason: 'persist_failed' }
  }

  return { ok: true, audited: true, score: audit.voice_fidelity_score }
}

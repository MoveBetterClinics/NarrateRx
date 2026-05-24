// POST /api/content-items/regenerate  { id }
//
// Regenerates the AI content for an existing atom-derived content_item,
// updating the row in place (preserves attached media, comments,
// scheduled_at). Re-runs the atom prompt with the interview transcript as
// the primary source and the approved blog as <editorial-summary> context.
// Same shape as /api/content-plan/draft but UPDATEs instead of INSERTs.
//
// Blog regeneration is NOT handled here. As of PR #800 (2026-05-24) the
// blog path is a streamed pipeline:
//   /api/content-items/blog-regen-prepare  → /api/stream  → blog-regen-finalize
// Calls with item.platform === 'blog' are rejected with a 422 pointing at
// the streamed endpoint.
//
// On success the row's status is reset to 'draft' and approved_by/at are
// cleared — regenerated content needs fresh review.

export const config = { runtime: 'nodejs' }

import { generateText } from 'ai'
import { workspaceContext } from '../_lib/workspaceContext.js'
import { requireRole } from '../_lib/auth.js'
import { enforceLimit } from '../_lib/ratelimit.js'
import { getAtomSystemPrompt } from '../_lib/atomPrompts.js'
import { getContextBlock } from '../_lib/conceptRetrieval.js'
import { resolveOwnHistoryBlock } from '../_lib/practiceMemory.js'
import { loadActiveCampaign } from '../_lib/campaignSettings.js'
import { getCampaignPromptContext } from '../../src/lib/campaigns.js'
import { extractProvenanceBlock } from '../../src/lib/provenance.js'

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

async function dbErr(res, r, msg = 'Database error', status = 500) {
  const body = await r.text().catch(() => '')
  console.error(`[content-items/regenerate] ${msg} — supabase ${r.status}: ${body.slice(0, 500)}`)
  return res.status(status).json({ error: msg })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405)
  if (!(await enforceLimit(req, res, 'ai'))) return

  const ws = await workspaceContext(req)
  if (!ws) return err(res, 'Workspace not resolved', 400)
  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  const wsFilter = `workspace_id=eq.${ws.id}`

  const { id } = req.body || {}
  if (!id) return err(res, 'Missing id')

  // Load the content_item under workspace scope.
  const itemRes = await sb(`content_items?id=eq.${id}&${wsFilter}&select=*`)
  if (!itemRes.ok) return dbErr(res, itemRes)
  const itemRows = await itemRes.json()
  if (!itemRows.length) return err(res, 'Content item not found', 404)
  const item = itemRows[0]

  if (!item.interview_id) {
    return err(res, 'Content item has no source interview — regenerate not supported', 422)
  }

  // Blog regen moved to the streamed pipeline in PR #800. The client should
  // never call this endpoint for blogs; bail loudly if it does rather than
  // running the atom prompt against blog-shaped data.
  if (item.platform === 'blog') {
    return err(
      res,
      'Blog regeneration runs via /api/content-items/blog-regen-prepare + /api/stream + blog-regen-finalize, not /api/content-items/regenerate',
      422,
    )
  }

  // Load the interview (everything we might need across both paths).
  const ivRes = await sb(
    `interviews?id=eq.${item.interview_id}&${wsFilter}` +
    `&select=id,clinician_id,topic,tone,voice_mode,prototype_id,verbatim_flags,location_id,messages,cleaned_messages,outputs,created_at,audience,story_type,generation_style`,
  )
  if (!ivRes.ok) return dbErr(res, ivRes)
  const ivRows = await ivRes.json()
  if (!ivRows.length) return err(res, 'Interview not found', 404)
  const interview = ivRows[0]

  // Load clinician (name + voice_notes) — workspace-scoped to prevent FK leakage.
  let clinicianName = ''
  let voiceNotes = ''
  let voicePhrases = []
  if (interview.clinician_id) {
    const [clinRes, phrasesRes] = await Promise.all([
      sb(`clinicians?id=eq.${interview.clinician_id}&${wsFilter}&select=name,voice_notes`),
      // Top voice phrase anchors (Phase C.2). Weight desc → strongest first.
      sb(
        `clinician_voice_phrases?clinician_id=eq.${interview.clinician_id}&${wsFilter}` +
        `&select=phrase&order=weight.desc,last_seen_at.desc&limit=8`
      ),
    ])
    if (clinRes.ok) {
      const rows = await clinRes.json()
      clinicianName = rows[0]?.name ?? ''
      voiceNotes    = rows[0]?.voice_notes ?? ''
    }
    if (phrasesRes.ok) {
      voicePhrases = await phrasesRes.json()
    }
  }

  // Phase 5 Feature 2 — hot practice-memory block for THIS clinician.
  // Same shape the interview prompt already injects.
  const ownHistoryBlock = interview.clinician_id
    ? await resolveOwnHistoryBlock({
        workspaceId:        ws.id,
        clinicianId:        interview.clinician_id,
        excludeInterviewId: interview.id,
      })
    : ''

  // Look up the content_plan_atom that owns this piece. Required — non-atom
  // pieces other than blog (which is guarded above) shouldn't exist today.
  const atomRes = await sb(
    `content_plan_atoms?content_piece_id=eq.${id}&${wsFilter}&select=*&limit=1`,
  )
  const atomRows = atomRes.ok ? await atomRes.json() : []
  const atom = atomRows[0] ?? null
  if (!atom) {
    return err(
      res,
      `Regeneration not supported for platform "${item.platform}" — no source atom found`,
      422,
    )
  }

  try {
    let newContent
    let newOverlayText = item.overlay_text ?? null

    const blogPost = interview.outputs?.blogPost
    if (!blogPost) {
      return err(res, 'Blog post not generated yet — regenerate the blog first', 422)
    }

    const atomTurns = Array.isArray(interview.messages) ? interview.messages : []
    if (!atomTurns.length) {
      return err(res, 'Interview transcript missing — cannot regenerate atom', 422)
    }

    const conceptBlock = await getContextBlock({ workspaceId: ws.id, topic: interview.topic })
    const audienceLabel = interview.audience
      ? (Array.isArray(ws.audience_options) ? ws.audience_options.find(s => s.key === interview.audience) : null)?.label ?? interview.audience
      : null
    const storyTypeLabel = interview.story_type
      ? (Array.isArray(ws.story_type_options) ? ws.story_type_options.find(s => s.key === interview.story_type) : null)?.label ?? interview.story_type
      : null
    // Active campaign (mode + structured CTA) flows into derivative content
    // only. Per-clinician override wins over workspace default; both fall
    // back cleanly when missing.
    const activeCampaign = await loadActiveCampaign(ws.id, interview.clinician_id)
    const campaignContext = getCampaignPromptContext(activeCampaign, ws)
    const systemPrompt = getAtomSystemPrompt(
      ws,
      clinicianName,
      interview.topic,
      atom.platform,
      atom.angle,
      interview.voice_mode || 'practice',
      interview.tone || 'smart',
      voiceNotes,
      (ws.brand_guidelines || '') + conceptBlock,
      voicePhrases,
      audienceLabel,
      storyTypeLabel,
      campaignContext,
      ownHistoryBlock,
    )
    if (!systemPrompt) {
      return err(res, `No prompt defined for ${atom.platform}/${atom.angle}`, 422)
    }

    // Transcript = primary source; blog = editorial context. Mirrors the
    // shape used in /api/content-plan/draft.js so first-draft and regen
    // produce comparable output.
    const aiMessages = [
      ...atomTurns.map((m) => ({ role: m.role, content: m.content })),
      {
        role: 'user',
        content:
          `Here is the editorial summary that has already been written and approved on this topic:\n\n` +
          `<editorial-summary>\n${blogPost}\n</editorial-summary>\n\n` +
          `Now write the ${atom.platform} piece (angle: ${atom.angle}) per the instructions in the system prompt. ` +
          `Pull voice, examples, and specifics from our conversation above — that is the source of truth. ` +
          `Use the editorial summary only for thematic alignment, not as the source of wording.`,
      },
    ]

    const { text } = await generateText({
      model: 'anthropic/claude-sonnet-4-6',
      system: systemPrompt,
      messages: aiMessages,
      maxTokens: 1500,
    })
    if (!text?.trim()) throw new Error('AI returned empty content')

    // Mirror draft.js: split optional ---OVERLAY--- block for Instagram,
    // and strip the <PROVENANCE> trailer (per-paragraph source metadata
    // that the prompt asks the model to append — must not reach the editor).
    const [captionRaw, overlayRaw] = extractProvenanceBlock(text.trim()).content.split('---OVERLAY---')
    newContent = captionRaw.trim()

    if (overlayRaw) {
      const hookMatch    = overlayRaw.match(/^HOOK:\s*(.+)$/m)
      const subheadMatch = overlayRaw.match(/^SUBHEAD:\s*(.+)$/m)
      const ctaMatch     = overlayRaw.match(/^CTA:\s*(.+)$/m)
      if (hookMatch || subheadMatch || ctaMatch) {
        newOverlayText = {
          hook:    hookMatch?.[1]?.trim()    ?? '',
          subhead: subheadMatch?.[1]?.trim() ?? '',
          cta:     ctaMatch?.[1]?.trim()     ?? '',
        }
      }
    }

    // ── Update content_item in place ──────────────────────────────────────
    // Reset to draft + clear approval audit so regenerated content needs
    // fresh review before publish.
    const patch = {
      content:             newContent,
      ai_original_content: newContent,
      overlay_text:        newOverlayText,
      status:              'draft',
      approved_by:         null,
      approved_at:         null,
      reviewed_by:         null,
      updated_at:          new Date().toISOString(),
    }
    const upd = await sb(`content_items?id=eq.${id}&${wsFilter}`, {
      method: 'PATCH',
      body:   JSON.stringify(patch),
    })
    if (!upd.ok) return dbErr(res, upd, 'Update failed')
    const updRows = await upd.json()

    return ok(res, updRows[0] ?? null)
  } catch (e) {
    console.error('[content-items/regenerate]', e?.message || e)
    return err(res, e?.message || 'Regeneration failed', 500)
  }
}

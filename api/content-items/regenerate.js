// POST /api/content-items/regenerate  { id }
//
// Regenerates the AI content for an existing content_item, updating the row in
// place (preserves attached media, comments, scheduled_at). Two paths:
//
//   1. Atom-derived piece (instagram, facebook, linkedin, gbp, pinterest,
//      tiktok, …) — re-runs the atom prompt with the interview transcript
//      as the primary source and the approved blog as <editorial-summary>
//      context. Same shape as /api/content-plan/draft but UPDATEs instead of
//      INSERTs.
//
//   2. Blog piece (or any interview-output platform) — re-runs the blog
//      prompt against the interview transcript and also updates
//      interview.outputs.blogPost so downstream atom regeneration uses the
//      fresh editorial summary.
//
// On success the row's status is reset to 'draft' and approved_by/at are
// cleared — regenerated content needs fresh review.

export const config = { runtime: 'nodejs', maxDuration: 60 }

import { generateText } from 'ai'
import { workspaceContext } from '../_lib/workspaceContext.js'
import { requireRole } from '../_lib/auth.js'
import { enforceLimit } from '../_lib/ratelimit.js'
import { getAtomSystemPrompt } from '../_lib/atomPrompts.js'
import { getContextBlock } from '../_lib/conceptRetrieval.js'
import {
  getBlogPostSystemPrompt,
  getMinimalEditSystemPrompt,
  buildVerbatimBlock,
} from '../../src/lib/prompts.js'
import { applyLocationOverlay } from '../../src/lib/locationOverlay.js'
import { extractProvenanceBlock } from '../../src/lib/provenance.js'
import { resolveLengthPreset, LENGTH_PRESETS } from '../../src/lib/lengthPresets.js'

const VALID_LENGTH_PRESETS = new Set(LENGTH_PRESETS.map((p) => p.id))
const VALID_GENERATION_STYLES = new Set(['blog_post', 'minimal_edits'])

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

  const {
    id,
    length_preset: bodyLengthPreset,
    generation_style: bodyGenerationStyle,
  } = req.body || {}
  if (!id) return err(res, 'Missing id')
  if (bodyLengthPreset != null && !VALID_LENGTH_PRESETS.has(bodyLengthPreset)) {
    return err(res, `Invalid length_preset: ${bodyLengthPreset}`)
  }
  if (bodyGenerationStyle != null && !VALID_GENERATION_STYLES.has(bodyGenerationStyle)) {
    return err(res, `Invalid generation_style: ${bodyGenerationStyle}`)
  }

  // Load the content_item under workspace scope.
  const itemRes = await sb(`content_items?id=eq.${id}&${wsFilter}&select=*`)
  if (!itemRes.ok) return dbErr(res, itemRes)
  const itemRows = await itemRes.json()
  if (!itemRows.length) return err(res, 'Content item not found', 404)
  const item = itemRows[0]

  if (!item.interview_id) {
    return err(res, 'Content item has no source interview — regenerate not supported', 422)
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

  // Load clinician (name + voice_notes + preferred_length) — workspace-scoped to prevent FK leakage.
  let clinicianName = ''
  let voiceNotes = ''
  let voicePhrases = []
  let clinicianPreferredLength = null
  if (interview.clinician_id) {
    const [clinRes, phrasesRes] = await Promise.all([
      sb(`clinicians?id=eq.${interview.clinician_id}&${wsFilter}&select=name,voice_notes,preferred_length`),
      // Top voice phrase anchors (Phase C.2). Weight desc → strongest first.
      sb(
        `clinician_voice_phrases?clinician_id=eq.${interview.clinician_id}&${wsFilter}` +
        `&select=phrase&order=weight.desc,last_seen_at.desc&limit=8`
      ),
    ])
    if (clinRes.ok) {
      const rows = await clinRes.json()
      clinicianName            = rows[0]?.name ?? ''
      voiceNotes               = rows[0]?.voice_notes ?? ''
      clinicianPreferredLength = rows[0]?.preferred_length ?? null
    }
    if (phrasesRes.ok) {
      voicePhrases = await phrasesRes.json()
    }
  }

  // Resolve length preset: explicit request body wins, else persisted on the
  // piece, else clinician default, else 'standard'. Only consulted by the
  // blog path below.
  const effectiveLengthPreset = resolveLengthPreset(
    bodyLengthPreset ?? item.length_preset,
    clinicianPreferredLength,
  )

  // Look up a content_plan_atom that owns this piece, if any.
  const atomRes = await sb(
    `content_plan_atoms?content_piece_id=eq.${id}&${wsFilter}&select=*&limit=1`,
  )
  const atomRows = atomRes.ok ? await atomRes.json() : []
  const atom = atomRows[0] ?? null

  try {
    let newContent
    let newOverlayText = item.overlay_text ?? null
    let updatedBlogPost = null

    if (atom) {
      // ── Atom-derived regeneration ───────────────────────────────────────
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
    } else {
      // ── Blog / interview-output regeneration ────────────────────────────
      // Only blog has a server-side prompt today. Other interview-output
      // platforms (email, google_ads, landing_page, youtube, instagram_ads)
      // were never wired into outputs generation, so they shouldn't appear
      // as content_items without an atom. Guard explicitly.
      if (item.platform !== 'blog') {
        return err(
          res,
          `Regeneration not supported for platform "${item.platform}" — no source atom or prompt found`,
          422,
        )
      }

      const turns = Array.isArray(interview.messages) ? interview.messages : []
      if (!turns.length) {
        return err(res, 'Interview transcript missing — cannot regenerate', 422)
      }

      // Pull the per-post workspace_location overlay (city/region/keyword/hashtag)
      // so prompts that reference workspace.location pick up the local values.
      let interviewLocation = null
      if (interview.location_id) {
        const locRes = await sb(
          `workspace_locations?id=eq.${interview.location_id}&${wsFilter}&select=*&limit=1`,
        )
        if (locRes.ok) {
          const rows = await locRes.json()
          interviewLocation = rows[0] ?? null
        }
      }
      const overlaidWorkspace = applyLocationOverlay(ws, interviewLocation)

      // Resolve effective generation style: body wins, else persisted on the
      // interview, else default to 'blog_post'. Minimal-edits ('Cleaned
      // transcript') swaps the system prompt for a verbatim cleanup pass —
      // no narrative restructuring, no length target, no verbatim block.
      const effectiveStyle = bodyGenerationStyle || interview.generation_style || 'blog_post'
      const isMinimal = effectiveStyle === 'minimal_edits'

      const systemPrompt = isMinimal
        ? getMinimalEditSystemPrompt(
            clinicianName,
            interview.voice_mode || 'practice',
            voiceNotes,
            voicePhrases,
          )
        : getBlogPostSystemPrompt(
            overlaidWorkspace,
            clinicianName,
            interview.topic,
            interview.tone || 'smart',
            interview.voice_mode || 'practice',
            interview.prototype_id,
            voiceNotes,
            voicePhrases,
            null, // audienceSlot — not currently threaded through regenerate
            null, // storyTypeSlot — not currently threaded through regenerate
            effectiveLengthPreset,
          ) + buildVerbatimBlock(interview.verbatim_flags)

      const messages = [
        ...turns.map((m) => ({ role: m.role, content: m.content })),
        {
          role: 'user',
          content: isMinimal
            ? 'Please clean up the transcript now using minimal edits only.'
            : 'Please write the blog post now based on our interview.',
        },
      ]

      const { text } = await generateText({
        model: 'anthropic/claude-opus-4-7',
        system: systemPrompt,
        messages,
        maxTokens: 4096,
      })
      if (!text?.trim()) throw new Error('AI returned empty content')

      // Strip the <PROVENANCE> trailer — both blog and minimal-edits prompts
      // append per-paragraph source attribution, but only the body copy
      // belongs in content_items.content.
      newContent = extractProvenanceBlock(text.trim()).content
      updatedBlogPost = newContent
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
    // Persist the length preset on the piece only when the request explicitly
    // supplied one. Leaves legacy pieces with NULL → 'inherit clinician default'.
    if (bodyLengthPreset != null && updatedBlogPost) {
      patch.length_preset = bodyLengthPreset
    }
    const upd = await sb(`content_items?id=eq.${id}&${wsFilter}`, {
      method: 'PATCH',
      body:   JSON.stringify(patch),
    })
    if (!upd.ok) return dbErr(res, upd, 'Update failed')
    const updRows = await upd.json()

    // Keep interview.outputs.blogPost in sync with the blog editorial summary
    // that atoms regenerate against. Rules:
    //   • Single-post blog (no series_id) — always refresh on regen.
    //   • Series Part 1 — refresh (Part 1 is the editorial summary for atoms).
    //   • Series Part 2+ — DO NOT refresh (would clobber Part 1's content with
    //     a tangential thread's content, polluting downstream atoms).
    const shouldSyncOutputs = updatedBlogPost && (
      !item.series_id || item.series_part === 1
    )
    // Persist the chosen generation_style on the interview when the request
    // explicitly supplied one and it differs from the current setting. This
    // is what makes the StoryDetail switcher sticky — next time the user
    // visits, the pills reflect the style currently in use.
    const stylePatch = (
      bodyGenerationStyle != null &&
      bodyGenerationStyle !== interview.generation_style
    ) ? { generation_style: bodyGenerationStyle } : null

    if (shouldSyncOutputs || stylePatch) {
      const ivPatch = {}
      if (shouldSyncOutputs) {
        ivPatch.outputs = { ...(interview.outputs || {}), blogPost: updatedBlogPost }
      }
      if (stylePatch) {
        Object.assign(ivPatch, stylePatch)
      }
      await sb(`interviews?id=eq.${interview.id}&${wsFilter}`, {
        method: 'PATCH',
        body: JSON.stringify(ivPatch),
        headers: { Prefer: 'return=minimal' },
      })
    }

    return ok(res, updRows[0] ?? null)
  } catch (e) {
    console.error('[content-items/regenerate]', e?.message || e)
    return err(res, e?.message || 'Regeneration failed', 500)
  }
}

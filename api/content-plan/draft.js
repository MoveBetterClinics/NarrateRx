// POST /api/content-plan/draft  { atom_id }
// Generates content for one atom from the interview transcript (primary
// source) with the approved blog post passed in as editorial context.
// Creates a content_item and marks the atom as drafted.
export const config = { runtime: 'nodejs', maxDuration: 120 }

import { generateText } from 'ai'
import { workspaceContext } from '../_lib/workspaceContext.js'
import { enforceLimit } from '../_lib/ratelimit.js'
import { getAtomSystemPrompt } from '../_lib/atomPrompts.js'
import { getContextBlock } from '../_lib/conceptRetrieval.js'
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

export default async function handler(req, res) {
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405)
  if (!(await enforceLimit(req, res, 'ai'))) return

  const ws = await workspaceContext(req)
  if (!ws) return err(res, 'Workspace not resolved', 400)
  const wsFilter = `workspace_id=eq.${ws.id}`

  const { atom_id } = req.body || {}
  if (!atom_id) return err(res, 'Missing atom_id')

  // Fetch the atom
  const atomRes = await sb(`content_plan_atoms?id=eq.${atom_id}&${wsFilter}&select=*`)
  if (!atomRes.ok) return err(res, 'Database error', 500)
  const atomRows = await atomRes.json()
  if (!atomRows.length) return err(res, 'Atom not found', 404)
  const atom = atomRows[0]

  if (atom.status === 'drafted') return err(res, 'Already drafted')
  if (atom.status === 'skipped') return err(res, 'Atom is skipped — reset to pending first')

  // Mark drafting so concurrent clicks don't double-generate
  await sb(`content_plan_atoms?id=eq.${atom_id}&${wsFilter}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'drafting', updated_at: new Date().toISOString() }),
    headers: { Prefer: 'return=minimal' },
  })

  try {
    // Fetch the interview (transcript = primary source; blog = editorial context)
    const ivRes = await sb(
      `interviews?id=eq.${atom.interview_id}&${wsFilter}&select=outputs,topic,tone,voice_mode,clinician_id,location_id,created_at,messages,audience,story_type`
    )
    if (!ivRes.ok) throw new Error('Could not fetch interview')
    const ivRows = await ivRes.json()
    if (!ivRows.length) throw new Error('Interview not found')
    const interview = ivRows[0]

    const blogPost = interview.outputs?.blogPost
    if (!blogPost) throw new Error('Blog post not generated yet — generate the blog post first')

    const turns = Array.isArray(interview.messages) ? interview.messages : []
    if (!turns.length) throw new Error('Interview transcript missing — cannot generate atom')

    // Fetch clinician name + voice substrate
    let clinicianName = ''
    let voiceNotes    = ''
    let voicePhrases  = []
    const [clinRes, phrasesRes] = await Promise.all([
      sb(`clinicians?id=eq.${interview.clinician_id}&${wsFilter}&select=name,voice_notes`),
      sb(
        `clinician_voice_phrases?clinician_id=eq.${interview.clinician_id}&${wsFilter}` +
        `&select=phrase&order=weight.desc,last_seen_at.desc&limit=8`,
      ),
    ])
    if (clinRes.ok) {
      const clinRows = await clinRes.json()
      clinicianName = clinRows[0]?.name ?? ''
      voiceNotes    = clinRows[0]?.voice_notes ?? ''
    }
    if (phrasesRes.ok) {
      voicePhrases = await phrasesRes.json()
    }

    // Augment with learned practice knowledge from the concept graph (non-blocking).
    const conceptBlock = await getContextBlock({ workspaceId: ws.id, topic: interview.topic })

    // Resolve audience + story_type keys to display labels for prompt injection.
    // Prefer the workspace's current slot object (admin may have renamed the label)
    // over the raw key string.
    const audienceLabel = interview.audience
      ? (Array.isArray(ws.audience_options) ? ws.audience_options.find(s => s.key === interview.audience) : null)?.label ?? interview.audience
      : null
    const storyTypeLabel = interview.story_type
      ? (Array.isArray(ws.story_type_options) ? ws.story_type_options.find(s => s.key === interview.story_type) : null)?.label ?? interview.story_type
      : null

    // Build the focused atom prompt
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
    if (!systemPrompt) throw new Error(`No prompt defined for ${atom.platform}/${atom.angle}`)

    // Replay the interview as the original conversation, then hand the model
    // the approved blog as <editorial-summary> and ask for the atom.
    // Voice and specifics come from the conversation; the summary is only
    // there to keep the channel piece thematically aligned with what's been
    // approved long-form.
    const aiMessages = [
      ...turns.map((m) => ({ role: m.role, content: m.content })),
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

    // Call the AI
    const { text } = await generateText({
      model: 'anthropic/claude-sonnet-4-6',
      system: systemPrompt,
      messages: aiMessages,
      maxTokens: 1000,
    })

    if (!text?.trim()) throw new Error('AI returned empty content')

    // Split overlay block from caption. Instagram prompts append a
    // ---OVERLAY--- section; other platforms don't, so this is a no-op for them.
    // Also strip the <PROVENANCE> trailer — long-form prompts append it as
    // per-paragraph source attribution, but the trailer is metadata, not body
    // copy, and must never reach the editor surface.
    const [captionRaw, overlayRaw] = extractProvenanceBlock(text.trim()).content.split('---OVERLAY---')
    const caption = captionRaw.trim()

    let overlay_text = null
    if (overlayRaw) {
      const hookMatch    = overlayRaw.match(/^HOOK:\s*(.+)$/m)
      const subheadMatch = overlayRaw.match(/^SUBHEAD:\s*(.+)$/m)
      const ctaMatch     = overlayRaw.match(/^CTA:\s*(.+)$/m)
      if (hookMatch || subheadMatch || ctaMatch) {
        overlay_text = {
          hook:    hookMatch?.[1]?.trim()    ?? '',
          subhead: subheadMatch?.[1]?.trim() ?? '',
          cta:     ctaMatch?.[1]?.trim()     ?? '',
        }
      }
    }

    // Create the content_item. scheduled_at stays null until a reviewer
    // approves and picks a time — the prior "anchor + (slot-1) weeks"
    // pre-fill made every draft look committed to a calendar date before
    // anyone had agreed to it.
    const itemPayload = {
      workspace_id:   ws.id,
      interview_id:   atom.interview_id,
      clinician_id:   interview.clinician_id,
      clinician_name: clinicianName,
      topic:          interview.topic,
      platform:       atom.platform,
      content:        caption,
      ai_original_content: caption,
      overlay_text,
      status:         'draft',
      media_urls:     [],
      location_id:    interview.location_id ?? null,
    }
    const itemRes = await sb('content_items', {
      method: 'POST',
      body: JSON.stringify(itemPayload),
    })
    if (!itemRes.ok) {
      const body = await itemRes.text()
      throw new Error(`Could not create content item: ${body}`)
    }
    const itemRows = await itemRes.json()
    const contentPiece = itemRows[0]

    // For GBP atoms: generate a per-location variant for every workspace_location
    // that has a gbp_location_id configured. Each variant uses the same interview
    // conversation but a location-patched system prompt (different location_keyword /
    // city), so Google sees genuinely distinct local copy on each listing rather
    // than the same text fanned out. Failures are non-blocking — canonical is kept.
    if (atom.platform === 'gbp') {
      const locsRes = await sb(
        `workspace_locations?workspace_id=eq.${ws.id}&status=eq.active&gbp_location_id=not.is.null` +
        `&select=id,label,city,location_keyword`,
      )
      const locations = locsRes.ok ? ((await locsRes.json()) ?? []) : []
      if (locations.length > 0) {
        const variantEntries = await Promise.all(
          locations.map(async (loc) => {
            try {
              const locWs = { ...ws, location_keyword: loc.location_keyword ?? loc.city }
              const locPrompt = getAtomSystemPrompt(
                locWs,
                clinicianName,
                interview.topic,
                'gbp',
                atom.angle,
                interview.voice_mode || 'practice',
                interview.tone || 'smart',
                voiceNotes,
                (ws.brand_guidelines || '') + conceptBlock,
                voicePhrases,
                audienceLabel,
                storyTypeLabel,
              )
              if (!locPrompt) return null
              const { text: locText } = await generateText({
                model: 'anthropic/claude-sonnet-4-6',
                system: locPrompt,
                messages: aiMessages,
                maxTokens: 1000,
              })
              if (!locText?.trim()) return null
              return [loc.id, {
                content:       extractProvenanceBlock(locText.trim()).content,
                location_name: loc.label ?? loc.city,
                generated_at:  new Date().toISOString(),
              }]
            } catch (locErr) {
              console.error('[content-plan/draft] location variant failed', loc.id, locErr.message)
              return null
            }
          }),
        )
        const overrides = Object.fromEntries(variantEntries.filter(Boolean))
        if (Object.keys(overrides).length > 0) {
          await sb(`content_items?id=eq.${contentPiece.id}&${wsFilter}`, {
            method: 'PATCH',
            body: JSON.stringify({ location_overrides: overrides, updated_at: new Date().toISOString() }),
            headers: { Prefer: 'return=minimal' },
          })
          contentPiece.location_overrides = overrides
        }
      }
    }

    // Mark the atom as drafted
    const updatedAtomRes = await sb(`content_plan_atoms?id=eq.${atom_id}&${wsFilter}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status:           'drafted',
        content_piece_id: contentPiece.id,
        updated_at:       new Date().toISOString(),
      }),
    })
    const updatedAtomRows = updatedAtomRes.ok ? await updatedAtomRes.json() : []

    return ok(res, {
      atom:          updatedAtomRows[0] ?? { ...atom, status: 'drafted', content_piece_id: contentPiece.id },
      content_piece: contentPiece,
    })
  } catch (e) {
    // Reset atom to pending so the user can retry
    await sb(`content_plan_atoms?id=eq.${atom_id}&${wsFilter}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'pending', updated_at: new Date().toISOString() }),
      headers: { Prefer: 'return=minimal' },
    })
    console.error('[content-plan/draft]', e.message)
    return err(res, e.message || 'Draft generation failed', 500)
  }
}

// POST /api/content-plan/draft  { atom_id }
// Generates content for one atom using the interview's blog post as source,
// creates a content_item, and marks the atom as drafted.
export const config = { runtime: 'nodejs', maxDuration: 60 }

import { generateText } from 'ai'
import { workspaceContext } from '../_lib/workspaceContext.js'
import { enforceLimit } from '../_lib/ratelimit.js'
import { getAtomSystemPrompt } from '../_lib/atomPrompts.js'
import { suggestedScheduledAt } from '../_lib/atomPlan.js'

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
    // Fetch the interview (blog post + metadata, + created_at for slot anchoring)
    const ivRes = await sb(
      `interviews?id=eq.${atom.interview_id}&${wsFilter}&select=outputs,topic,tone,voice_mode,clinician_id,location_id,created_at`
    )
    if (!ivRes.ok) throw new Error('Could not fetch interview')
    const ivRows = await ivRes.json()
    if (!ivRows.length) throw new Error('Interview not found')
    const interview = ivRows[0]

    const blogPost = interview.outputs?.blogPost
    if (!blogPost) throw new Error('Blog post not generated yet — generate the blog post first')

    // Fetch clinician name
    let clinicianName = ''
    let voiceNotes = ''
    const clinRes = await sb(
      `clinicians?id=eq.${interview.clinician_id}&${wsFilter}&select=name,voice_notes`
    )
    if (clinRes.ok) {
      const clinRows = await clinRes.json()
      clinicianName = clinRows[0]?.name ?? ''
      voiceNotes    = clinRows[0]?.voice_notes ?? ''
    }

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
      ws.brand_guidelines || '',
    )
    if (!systemPrompt) throw new Error(`No prompt defined for ${atom.platform}/${atom.angle}`)

    // Call the AI
    const { text } = await generateText({
      model: 'anthropic/claude-sonnet-4-6',
      system: systemPrompt,
      messages: [{ role: 'user', content: blogPost }],
      maxTokens: 1000,
    })

    if (!text?.trim()) throw new Error('AI returned empty content')

    // Split overlay block from caption. Instagram prompts append a
    // ---OVERLAY--- section; other platforms don't, so this is a no-op for them.
    const [captionRaw, overlayRaw] = text.trim().split('---OVERLAY---')
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

    // Create the content_item. Auto-anchor the suggested publish date based on
    // the atom's slot (interview.created_at + (slot - 1) weeks) so drafted
    // atoms land on the calendar at the cadence the Plan implies. Clinician
    // can always override before scheduling.
    const itemPayload = {
      workspace_id:   ws.id,
      interview_id:   atom.interview_id,
      clinician_id:   interview.clinician_id,
      clinician_name: clinicianName,
      topic:          interview.topic,
      platform:       atom.platform,
      content:        caption,
      // Snapshot the AI's output so future edits can be diffed for voice memory
      ai_original_content: caption,
      overlay_text,
      status:         'draft',
      scheduled_at:   suggestedScheduledAt(interview.created_at, atom.slot),
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

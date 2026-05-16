// POST /api/interviews/preview  { tone, prototypeId?, clinicianName? }
//
// Generates a single sample Bernard opening question using the workspace's
// current voice config. Used by the Voice Settings "hear Bernard" preview
// panel — admin-only, not persisted anywhere.
export const config = { runtime: 'nodejs', maxDuration: 30 }

import { generateText } from 'ai'
import { workspaceContext } from '../_lib/workspaceContext.js'
import { requireRole } from '../_lib/auth.js'
import { enforceLimit } from '../_lib/ratelimit.js'
import { TONES } from '../../src/lib/prompts.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const limited = await enforceLimit(req, res, 'interview-preview')
  if (limited) return

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })

  const auth = await requireRole(req, ['admin'], { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    const status = auth.reason === 'forbidden' ? 403 : auth.reason === 'no-token' ? 401 : 403
    return res.status(status).json({ error: auth.reason })
  }

  const { tone = 'smart', prototypeId = null, clinicianName = 'your clinician' } = req.body || {}

  const toneObj = TONES.find(t => t.id === tone) ?? TONES[0]
  const toneModifier = ws.tone_modifiers?.[tone] || ''

  const prototypes = ws.patient_context?.prototypes || []
  const proto = prototypeId ? prototypes.find(p => p.id === prototypeId) : null

  const interviewerName = ws.interviewer_name || 'Bernard'
  const clinicName = ws.display_name || 'your clinic'

  const systemPrompt = [
    `You are ${interviewerName}, a content facilitator at ${clinicName}.`,
    ws.clinic_context ? `Clinic context: ${ws.clinic_context}` : '',
    ws.brand_voice ? `Brand voice: ${ws.brand_voice}` : '',
    ws.audience_short ? `Audience: ${ws.audience_short}` : '',
    toneModifier ? `Tone (${toneObj.label}): ${toneModifier}` : '',
    proto ? `Archetype in focus: ${proto.label} — ${proto.coreDesire || ''}` : '',
  ].filter(Boolean).join('\n\n')

  const userPrompt = `Write ONE warm, natural opening question you'd ask ${clinicianName} at the start of a new interview. Sound like a curious colleague over coffee, not a survey. One sentence only — the opening question itself, nothing else.`

  const { text } = await generateText({
    model: 'anthropic/claude-haiku-4-5-20251001',
    system: systemPrompt,
    prompt: userPrompt,
    maxTokens: 120,
  })

  return res.status(200).json({ opener: text.trim() })
}

// POST /api/voice-preview
//
// Generates a single sample Bernard opener using the workspace's current voice
// settings (brand_voice + voice_context + tone modifiers + topic suggestions).
// Used by the Voice Settings "Preview Bernard's voice" CTA — admin-only, not
// persisted anywhere.
export const config = { runtime: 'nodejs', maxDuration: 30 }

import { generateText } from 'ai'
import { workspaceContext } from './_lib/workspaceContext.js'
import { requireRole } from './_lib/auth.js'
import { enforceLimit } from './_lib/ratelimit.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (!(await enforceLimit(req, res, 'ai'))) return

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })

  const auth = await requireRole(req, ['admin'], { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    const status = auth.reason === 'no-token' ? 401 : 403
    return res.status(status).json({ error: auth.reason })
  }

  const interviewerName = ws.interviewer_name || 'Bernard'
  const clinicName = ws.display_name || 'your clinic'
  const toneMods = ws.tone_modifiers || {}
  const toneLines = Object.entries(toneMods)
    .filter(([, v]) => v && String(v).trim())
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n')

  // Topic_suggestions can be a JSON array of objects with a `topic` field.
  const topics = Array.isArray(ws.topic_suggestions)
    ? ws.topic_suggestions.slice(0, 5).map(t => t?.topic || t?.label || '').filter(Boolean)
    : []

  const systemPrompt = [
    `You are ${interviewerName}, an interviewer for ${clinicName}.`,
    ws.brand_voice ? `Brand voice:\n${ws.brand_voice}` : '',
    ws.clinic_context ? `Clinic context:\n${ws.clinic_context}` : '',
    ws.audience_short ? `Audience: ${ws.audience_short}` : '',
    toneLines ? `Tone modifiers:\n${toneLines}` : '',
    topics.length ? `Common topics: ${topics.join(', ')}` : '',
    `Given this clinician's voice settings, write the FIRST SENTENCE you'd open an interview with for a returning patient. Return only the sentence, no quotes, no preamble. One sentence.`,
  ].filter(Boolean).join('\n\n')

  try {
    const { text } = await generateText({
      model: 'anthropic/claude-sonnet-4-6',
      system: systemPrompt,
      messages: [{ role: 'user', content: 'Generate the opener.' }],
      maxTokens: 120,
    })
    const opener = (text || '').trim().replace(/^["']|["']$/g, '')
    if (!opener) return res.status(500).json({ error: 'Empty response' })
    return res.status(200).json({ opener })
  } catch (e) {
    console.error('[voice-preview]', e?.message || e)
    return res.status(500).json({ error: e?.message || 'Preview failed' })
  }
}

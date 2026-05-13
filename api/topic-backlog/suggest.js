// POST /api/topic-backlog/suggest  { count?: number }
// Generates AI-suggested topics based on the workspace's clinical paradigm and
// what's already been covered (existing interview topics + existing backlog).
// Inserts the suggestions as pending rows with source='ai_suggested'.
export const config = { runtime: 'nodejs', maxDuration: 60 }

import { generateText } from 'ai'
import { workspaceContext } from '../_lib/workspaceContext.js'
import { enforceLimit } from '../_lib/ratelimit.js'

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

function buildPrompt(ws, coveredTopics, backlogTopics, count) {
  const covered = coveredTopics.length
    ? coveredTopics.map((t) => `- ${t}`).join('\n')
    : '(none yet)'
  const planned = backlogTopics.length
    ? backlogTopics.map((t) => `- ${t}`).join('\n')
    : '(none yet)'

  const paradigm = ws.clinic_context
    || ws.audience_description
    || `${ws.display_name} is a clinic practicing under a paradigm not yet captured in workspace settings.`

  return `You are a content strategist for ${ws.display_name}, a clinic in ${ws.location_keyword || 'their area'}.

CLINIC CONTEXT:
${paradigm}

AUDIENCE:
${ws.audience_description || 'Patients dealing with movement, pain, or rehabilitation concerns.'}

TOPICS ALREADY COVERED IN INTERVIEWS:
${covered}

TOPICS ALREADY IN THE BACKLOG (do NOT suggest these again):
${planned}

Suggest ${count} NEW interview topics this clinic should cover next. Each topic must be:
- A specific condition, pattern, or clinical scenario (not a vague category)
- Relevant to this clinic's paradigm and patient base
- Not already covered or planned above
- Something patients actively search for or struggle with

For each suggestion, return a single line in this exact format:
TOPIC: <name of the condition or scenario>
RATIONALE: <one sentence on why this matters now for this clinic — coverage gap, common search, seasonal angle, related to already-covered work>

Separate suggestions with a blank line. Do not number them. Do not include any preamble or commentary.`
}

function parseSuggestions(text) {
  const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean)
  const out = []
  for (const block of blocks) {
    const topicMatch = block.match(/TOPIC:\s*(.+)/i)
    const rationaleMatch = block.match(/RATIONALE:\s*(.+)/i)
    if (!topicMatch) continue
    out.push({
      topic:     topicMatch[1].trim(),
      rationale: rationaleMatch ? rationaleMatch[1].trim() : null,
    })
  }
  return out
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405)
  if (!(await enforceLimit(req, res, 'ai'))) return

  const ws = await workspaceContext(req)
  if (!ws) return err(res, 'Workspace not resolved', 400)
  const wsFilter = `workspace_id=eq.${ws.id}`

  const requested = Number(req.body?.count ?? 5)
  const count = Math.max(1, Math.min(10, Number.isFinite(requested) ? requested : 5))

  // What's already covered
  const ivRes = await sb(`interviews?${wsFilter}&select=topic&order=created_at.desc&limit=200`)
  const ivRows = ivRes.ok ? await ivRes.json() : []
  const coveredSet = new Set(
    ivRows.map((r) => (r.topic || '').trim().toLowerCase()).filter(Boolean)
  )

  const blRes = await sb(`topic_backlog?${wsFilter}&select=topic,status&status=in.(pending,in_progress)`)
  const blRows = blRes.ok ? await blRes.json() : []
  const backlogSet = new Set(
    blRows.map((r) => (r.topic || '').trim().toLowerCase()).filter(Boolean)
  )

  const coveredTopics = [...coveredSet].slice(0, 50)
  const backlogTopics = [...backlogSet].slice(0, 50)

  const systemPrompt = buildPrompt(ws, coveredTopics, backlogTopics, count)

  let text
  try {
    const result = await generateText({
      model: 'anthropic/claude-sonnet-4-6',
      system: systemPrompt,
      messages: [{ role: 'user', content: `Suggest ${count} topics now.` }],
      maxTokens: 1200,
    })
    text = result.text
  } catch (e) {
    console.error('[topic-backlog/suggest] AI call failed:', e.message)
    return err(res, e.message || 'AI suggestion failed', 500)
  }

  const suggestions = parseSuggestions(text || '')
    .filter((s) => {
      const lc = s.topic.toLowerCase()
      return !coveredSet.has(lc) && !backlogSet.has(lc)
    })

  if (suggestions.length === 0) {
    return err(res, 'AI returned no parseable suggestions — try again')
  }

  const inserts = suggestions.map((s, i) => ({
    workspace_id: ws.id,
    topic:        s.topic,
    rationale:    s.rationale,
    source:       'ai_suggested',
    priority:     60 - i,
  }))

  const insRes = await sb('topic_backlog', { method: 'POST', body: JSON.stringify(inserts) })
  if (!insRes.ok) return err(res, 'Database error', 500)
  return ok(res, await insRes.json(), 201)
}

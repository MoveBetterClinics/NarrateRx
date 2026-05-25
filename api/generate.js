import { withSentry } from './_lib/sentry.js'
import { generateText } from 'ai'
import { enforceLimit } from './_lib/ratelimit.js'
import { requireRole } from './_lib/auth.js'
import { workspaceContext } from './_lib/workspaceContext.js'

// Pinned to Node runtime so the Edge whole-graph bundler doesn't follow
// the ratelimit.js → @clerk/backend → node:crypto chain into middleware.
// 300s — sync generation (pull quotes, topic suggestions) can be slow on Opus.
export const config = { runtime: 'nodejs', maxDuration: 300 }

// Generates a Claude completion via the Vercel AI Gateway.
//
// Wire format is kept Anthropic-shaped on purpose: callers
// (src/lib/claude.js#generateContent and src/pages/ReviewPost.jsx) read
// `data.content[0].text`, so we return `{ content: [{ type: 'text', text }] }`
// to preserve that contract.
async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json')

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'No workspace resolved for this request' })
  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  if (!(await enforceLimit(req, res, 'ai'))) return

  let messages, systemPrompt, model
  try {
    ;({ messages, systemPrompt, model } = req.body || {})
  } catch {
    res.status(400).json({ error: 'Invalid request body' })
    return
  }

  if (!messages || !systemPrompt) {
    res.status(400).json({ error: 'Missing messages or systemPrompt' })
    return
  }

  if (!process.env.AI_GATEWAY_API_KEY) {
    res.status(500).json({ error: 'AI_GATEWAY_API_KEY is not set on this deployment' })
    return
  }

  // Callers pass either a bare Anthropic model id ("claude-sonnet-4-6",
  // "claude-opus-4-7") or nothing. Normalize to AI Gateway's "anthropic/<id>".
  const requested = model || 'claude-sonnet-4-6'
  const gatewayModel = requested.includes('/') ? requested : `anthropic/${requested}`

  try {
    const { text } = await generateText({
      model: gatewayModel,
      system: systemPrompt,
      messages,
      maxOutputTokens: 4096,
    })

    res.status(200).json({
      content: [{ type: 'text', text }],
    })
  } catch (e) {
    res.status(500).json({ error: e?.message || 'Internal server error' })
  }
}

export default withSentry(handler)

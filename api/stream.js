import { withSentry } from './_lib/sentry.js'
import { streamText } from 'ai'
import { enforceLimit } from './_lib/ratelimit.js'

// Pinned to Node runtime (was Edge) so the Edge whole-graph bundler doesn't
// follow the ratelimit.js → @clerk/backend → node:crypto chain into middleware.
// Web-style (Request → Response) handlers silently hang on Vercel's Node
// runtime — Vercel ignores the returned Response and the function times out at
// maxDuration. Stream via res.write() instead. (Caused the prod 504s after
// the runtime flip in #293.)
export const config = { runtime: 'nodejs', maxDuration: 60 }

// Streams a Claude completion via the Vercel AI Gateway.
//
// Wire format is intentionally kept Anthropic-shaped SSE so the existing
// client parser in src/lib/claude.js#streamMessage keeps working without
// changes. We emit one `data: { type: 'content_block_delta', delta: { text } }`
// event per text chunk and finish with `data: [DONE]`.
async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  if (!(await enforceLimit(req, res, 'ai'))) return

  const { messages, systemPrompt, model, maxOutputTokens } = req.body || {}

  if (!messages || !systemPrompt) {
    res.status(400).json({ error: 'Missing messages or systemPrompt' })
    return
  }

  if (!process.env.AI_GATEWAY_API_KEY) {
    res.status(500).json({ error: 'AI_GATEWAY_API_KEY is not set on this deployment' })
    return
  }

  // Normalize bare Anthropic ids to AI Gateway form.
  const requested = model || 'claude-sonnet-4-6'
  const gatewayModel = requested.includes('/') ? requested : `anthropic/${requested}`

  // Default keeps short interview turns cheap; blog/long-form callers pass
  // a higher cap. Clamp to 8192 so a malicious caller can't burn the budget.
  const cap = Number.isFinite(maxOutputTokens)
    ? Math.min(Math.max(parseInt(maxOutputTokens, 10) || 1024, 256), 8192)
    : 1024

  let result
  try {
    result = streamText({
      model: gatewayModel,
      system: systemPrompt,
      messages,
      maxOutputTokens: cap,
    })
  } catch (e) {
    res.status(500).json({ error: e?.message || 'Stream init failed' })
    return
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  // Tell upstream proxies (Vercel edge / nginx-style) not to buffer the stream.
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders?.()

  // Iterate fullStream rather than textStream so we can see error parts.
  // textStream silently filters them out, which meant an upstream auth /
  // model failure surfaced to the client as an empty assistant turn — see
  // PR #249.
  let errored = false
  const sendError = (message) => {
    errored = true
    const payload = JSON.stringify({
      type: 'error',
      error: { message: message || 'Stream error' },
    })
    res.write(`data: ${payload}\n\n`)
  }

  try {
    for await (const part of result.fullStream) {
      if (part?.type === 'text-delta') {
        const text = part.text ?? part.delta
        if (!text) continue
        const payload = JSON.stringify({
          type: 'content_block_delta',
          delta: { type: 'text_delta', text },
        })
        res.write(`data: ${payload}\n\n`)
      } else if (part?.type === 'error') {
        const message = part.error?.message || part.errorText || String(part.error || 'Stream error')
        sendError(message)
        break
      }
    }
    if (!errored) res.write('data: [DONE]\n\n')
  } catch (e) {
    sendError(e?.message)
  } finally {
    res.end()
  }
}

export default withSentry(handler)

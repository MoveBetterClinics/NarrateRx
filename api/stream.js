import { streamText } from 'ai'
import { enforceLimitEdge } from './_lib/ratelimit.js'

export const config = { runtime: 'edge' }

// Streams a Claude completion via the Vercel AI Gateway.
//
// Wire format is intentionally kept Anthropic-shaped SSE so the existing
// client parser in src/lib/claude.js#streamMessage keeps working without
// changes. We emit one `data: { type: 'content_block_delta', delta: { text } }`
// event per text chunk and finish with `data: [DONE]`.
export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const limited = await enforceLimitEdge(req, 'ai')
  if (limited) return limited

  let body
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const { messages, systemPrompt, model } = body || {}

  if (!messages || !systemPrompt) {
    return new Response(JSON.stringify({ error: 'Missing messages or systemPrompt' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (!process.env.AI_GATEWAY_API_KEY) {
    return new Response(
      JSON.stringify({ error: 'AI_GATEWAY_API_KEY is not set on this deployment' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // Normalize bare Anthropic ids to AI Gateway form.
  const requested = model || 'claude-sonnet-4-6'
  const gatewayModel = requested.includes('/') ? requested : `anthropic/${requested}`

  let result
  try {
    result = streamText({
      model: gatewayModel,
      system: systemPrompt,
      messages,
      maxOutputTokens: 1024,
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: e?.message || 'Stream init failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const encoder = new TextEncoder()
  // We iterate fullStream rather than textStream so we can see error parts.
  // textStream silently filters them out, which meant an upstream auth /
  // model failure surfaced to the client as an empty assistant turn — see
  // PR fixing the "interview not prompting questions" regression.
  const sse = new ReadableStream({
    async start(controller) {
      let errored = false
      const sendError = (message) => {
        errored = true
        const payload = JSON.stringify({
          type: 'error',
          error: { message: message || 'Stream error' },
        })
        controller.enqueue(encoder.encode(`data: ${payload}\n\n`))
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
            controller.enqueue(encoder.encode(`data: ${payload}\n\n`))
          } else if (part?.type === 'error') {
            const message = part.error?.message || part.errorText || String(part.error || 'Stream error')
            sendError(message)
            break
          }
        }
        if (!errored) controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      } catch (e) {
        sendError(e?.message)
      } finally {
        controller.close()
      }
    },
  })

  return new Response(sse, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}

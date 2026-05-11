import { streamText } from 'ai'

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
  const sse = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of result.textStream) {
          if (!chunk) continue
          const payload = JSON.stringify({
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: chunk },
          })
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`))
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      } catch (e) {
        const payload = JSON.stringify({
          type: 'error',
          error: { message: e?.message || 'Stream error' },
        })
        controller.enqueue(encoder.encode(`data: ${payload}\n\n`))
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

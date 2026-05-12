import { throwApiError } from '@/lib/apiError'

// Best-effort Clerk session token so /api/generate + /api/stream can key
// rate-limit buckets on Clerk user.id instead of falling back to IP.
// Unauthenticated callers (e.g. SSR-style preflight) still work — the
// server-side limiter falls back to x-forwarded-for.
async function authHeaders() {
  if (typeof window === 'undefined') return {}
  try {
    const token = await window.Clerk?.session?.getToken?.()
    return token ? { Authorization: `Bearer ${token}` } : {}
  } catch {
    return {}
  }
}

export async function* streamMessage(messages, systemPrompt, { model } = {}) {
  const response = await fetch('/api/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({ messages, systemPrompt, model }),
  })

  if (!response.ok) await throwApiError(response)

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop()
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6).trim()
      if (data === '[DONE]') return
      let parsed
      try {
        parsed = JSON.parse(data)
      } catch {
        continue
      }
      if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
        yield parsed.delta.text
      } else if (parsed.type === 'error') {
        throw new Error(parsed.error?.message || 'Stream error')
      }
    }
  }
}

export async function generateContent(messages, systemPrompt, { model } = {}) {
  const response = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({ messages, systemPrompt, model }),
  })

  if (!response.ok) await throwApiError(response)

  const data = await response.json()
  const text = data?.content?.[0]?.text
  if (!text) throw new Error('Empty response from AI')
  return text
}

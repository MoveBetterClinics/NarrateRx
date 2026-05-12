export async function* streamMessage(messages, systemPrompt, { model } = {}) {
  const response = await fetch('/api/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, systemPrompt, model }),
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.error || `API error ${response.status}`)
  }

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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, systemPrompt, model }),
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.error || `API error ${response.status}`)
  }

  const data = await response.json()
  return data.content[0].text
}

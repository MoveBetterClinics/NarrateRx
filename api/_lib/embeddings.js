// OpenAI text-embedding-3-small wrapper for the practice-memory RAG layer.
//
// Used by api/_lib/practiceMemoryRag.js (indexer) and the future retrieval
// path. Kept dependency-free (raw fetch) so the module loads in both the
// Node and Edge runtimes without pulling the openai SDK into edge bundles.

const OPENAI_URL = 'https://api.openai.com/v1/embeddings'

export const EMBEDDING_MODEL = 'text-embedding-3-small'
export const EMBEDDING_DIMS = 1536

// OpenAI accepts up to 2048 inputs per request. Cap at 96 so a transient
// 5xx retry doesn't re-embed an unreasonable batch.
const MAX_BATCH = 96
const MAX_ATTEMPTS = 3
// Hard cap per embeddings HTTP call. Without it a hung connection (no response,
// never a 5xx) would never hit the 429/5xx retry branch and would stall the
// caller to the 300s function wall — which on Vercel's Node runtime strands the
// practice-memory chunk (the waitUntil budget is consumed, no finally runs).
const REQUEST_TIMEOUT_MS = 20_000

export async function embedTexts(texts) {
  if (!Array.isArray(texts) || texts.length === 0) return []
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('[embeddings] OPENAI_API_KEY not set')

  const clean = texts.map((t) => String(t || '').trim())
  const out = new Array(clean.length).fill(null)

  // Embed only non-empty entries, preserve input ordering for the caller.
  const indices = []
  const inputs = []
  for (let i = 0; i < clean.length; i++) {
    if (clean[i].length === 0) continue
    indices.push(i)
    inputs.push(clean[i])
  }

  for (let i = 0; i < inputs.length; i += MAX_BATCH) {
    const slice = inputs.slice(i, i + MAX_BATCH)
    const vectors = await embedBatch(slice, key)
    for (let j = 0; j < vectors.length; j++) {
      out[indices[i + j]] = vectors[j]
    }
  }
  return out
}

export async function embedText(text) {
  const [v] = await embedTexts([text])
  return v
}

async function embedBatch(batch, key, attempt = 1) {
  let r
  try {
    r = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: batch }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (e) {
    // A network error or the AbortSignal.timeout firing (TimeoutError/AbortError)
    // is transient — retry on the same backoff schedule as a 429/5xx, then give
    // up so withRetry() upstream can log + swallow rather than stalling forever.
    if (attempt < MAX_ATTEMPTS) {
      const backoffMs = 500 * 2 ** (attempt - 1)
      await new Promise((res) => setTimeout(res, backoffMs))
      return embedBatch(batch, key, attempt + 1)
    }
    throw new Error(`[embeddings] request failed after ${MAX_ATTEMPTS} attempts: ${e?.name || ''} ${e?.message || e}`)
  }

  if (r.ok) {
    const json = await r.json()
    return json.data.map((d) => d.embedding)
  }

  if ((r.status === 429 || r.status >= 500) && attempt < MAX_ATTEMPTS) {
    const backoffMs = 500 * 2 ** (attempt - 1)
    await new Promise((res) => setTimeout(res, backoffMs))
    return embedBatch(batch, key, attempt + 1)
  }

  const body = await r.text().catch(() => '')
  throw new Error(`[embeddings] ${r.status} ${body.slice(0, 300)}`)
}

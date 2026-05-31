import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the OpenAI embeddings wrapper and the AI gateway (topic tags) so the
// indexer's logic can be exercised without network/keys.
vi.mock('../../api/_lib/embeddings.js', () => ({
  embedTexts: vi.fn(async (texts) => texts.map(() => [0.1, 0.2, 0.3])),
  embedText:  vi.fn(async () => [0.1, 0.2, 0.3]),
  EMBEDDING_MODEL: 'text-embedding-3-small',
  EMBEDDING_DIMS:  1536,
}))
vi.mock('ai', () => ({
  generateText: vi.fn(async () => ({ text: '["movement","low back"]' })),
}))

import { indexInterviewSummary } from '../../api/_lib/practiceMemoryRag.js'
import { embedTexts } from '../../api/_lib/embeddings.js'

// Regression guard for the 2026-05-30 bug: every interview completed after the
// 2026-05-24 backfill wrote summary_text but produced ZERO practice_memory_chunks
// because the live indexing hook was silently dropped. These tests pin the
// indexer's contract: it embeds, upserts exactly one interview_summary chunk,
// reports {indexed:1}, and survives one transient failure rather than vanishing.
describe('indexInterviewSummary', () => {
  let calls
  beforeEach(() => {
    calls = []
    embedTexts.mockClear()
    globalThis.fetch = vi.fn(async (url, init) => {
      calls.push({ url: String(url), method: init?.method || 'GET', body: init?.body })
      return { ok: true, status: 200, text: async () => '', json: async () => [] }
    })
  })

  it('embeds + upserts a single interview_summary chunk and reports indexed:1', async () => {
    const res = await indexInterviewSummary({
      workspaceId: 'ws-1', staffId: 'st-1', interviewId: 'iv-1',
      summaryText: 'A distinctive clinical philosophy about movement-first care.',
      topic: 'low back pain', createdAt: '2026-05-30T00:00:00.000Z',
    })

    expect(res).toEqual({ indexed: 1 })
    expect(embedTexts).toHaveBeenCalledOnce()

    const upsert = calls.find((c) => c.method === 'POST' && c.url.includes('practice_memory_chunks'))
    expect(upsert).toBeTruthy()
    const payload = JSON.parse(upsert.body)
    expect(payload).toHaveLength(1)
    expect(payload[0].source_type).toBe('interview_summary')
    expect(payload[0].source_id).toBe('iv-1')
    expect(payload[0].chunk_index).toBe(0)
    expect(payload[0].workspace_id).toBe('ws-1')
    expect(payload[0].staff_id).toBe('st-1')
  })

  it('skips empty summaries without embedding or writing', async () => {
    const res = await indexInterviewSummary({ workspaceId: 'ws-1', interviewId: 'iv-1', summaryText: '   ' })
    expect(res).toEqual({ indexed: 0, skipped: 'empty-summary' })
    expect(embedTexts).not.toHaveBeenCalled()
    expect(calls).toHaveLength(0)
  })

  it('retries once when the upsert fails transiently, then succeeds', async () => {
    let postAttempts = 0
    globalThis.fetch = vi.fn(async (url, init) => {
      const method = init?.method || 'GET'
      const u = String(url)
      if (method === 'POST' && u.includes('practice_memory_chunks')) {
        postAttempts++
        if (postAttempts === 1) return { ok: false, status: 503, text: async () => 'upstream blip' }
      }
      return { ok: true, status: 200, text: async () => '', json: async () => [] }
    })

    const res = await indexInterviewSummary({
      workspaceId: 'ws-1', staffId: 'st-1', interviewId: 'iv-2',
      summaryText: 'Another summary worth indexing.', topic: 't',
    })

    expect(postAttempts).toBe(2) // first attempt threw, retried, second succeeded
    expect(res).toEqual({ indexed: 1 })
  })

  it('never throws and reports {indexed:0} when the upsert keeps failing', async () => {
    globalThis.fetch = vi.fn(async (url, init) => {
      const method = init?.method || 'GET'
      if (method === 'POST' && String(url).includes('practice_memory_chunks')) {
        return { ok: false, status: 500, text: async () => 'down' }
      }
      return { ok: true, status: 200, text: async () => '', json: async () => [] }
    })

    const res = await indexInterviewSummary({
      workspaceId: 'ws-1', interviewId: 'iv-3', summaryText: 'Summary.', topic: 't',
    })
    expect(res.indexed).toBe(0)
    expect(res.error).toBeTruthy()
  })
})

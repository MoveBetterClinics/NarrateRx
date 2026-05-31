import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the RAG indexer so we can observe HOW summarizeInterview dispatches it,
// and the AI summary call so no network/keys are needed.
vi.mock('../../api/_lib/practiceMemoryRag.js', () => ({
  indexInterviewSummary: vi.fn(async () => ({ indexed: 1 })),
}))
vi.mock('ai', () => ({
  generateText: vi.fn(async () => ({ text: 'A distilled, distinctive clinical summary.' })),
}))

import { summarizeInterview } from '../../api/_lib/interviewSummarizer.js'
import { indexInterviewSummary } from '../../api/_lib/practiceMemoryRag.js'

// Regression guard for the 2026-05-30 bug. summarizeInterview is dispatched from
// the interview-completion PATCH via waitUntil(), which only keeps the function
// instance alive for work that is part of summarizeInterview's own promise.
// The original code fire-and-forgot indexInterviewSummary, so it resolved before
// the embed ran and the platform froze the instance — summary_text was written
// but no chunk. This test fails if the `await` is ever dropped again.
describe('summarizeInterview → RAG indexing wiring', () => {
  beforeEach(() => {
    indexInterviewSummary.mockClear()
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, text: async () => '', json: async () => [{}] }))
    process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost'
    process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'svc'
  })

  it('awaits indexInterviewSummary so it completes before summarizeInterview resolves', async () => {
    let indexCompleted = false
    indexInterviewSummary.mockImplementation(async () => {
      // Resolve on a later macrotask. A fire-and-forget caller would return
      // before this fires; an awaiting caller will not.
      await new Promise((r) => setTimeout(r, 10))
      indexCompleted = true
      return { indexed: 1 }
    })

    await summarizeInterview({
      interviewId: 'iv-1',
      workspaceId: 'ws-1',
      staffId: 'st-1',
      staffName: 'Dr Q',
      topic: 'low back pain',
      messages: [{ role: 'user', content: 'My approach to low back pain is movement-first, load it early.' }],
    })

    expect(indexInterviewSummary).toHaveBeenCalledOnce()
    expect(indexCompleted).toBe(true)
  })

  it('passes the persisted summary text + interview identifiers into the indexer', async () => {
    await summarizeInterview({
      interviewId: 'iv-2',
      workspaceId: 'ws-2',
      staffId: 'st-2',
      staffName: 'Whitney',
      topic: 'equine gait',
      messages: [{ role: 'user', content: 'Gait tells you everything about compensation.' }],
    })

    expect(indexInterviewSummary).toHaveBeenCalledOnce()
    const arg = indexInterviewSummary.mock.calls[0][0]
    expect(arg.interviewId).toBe('iv-2')
    expect(arg.workspaceId).toBe('ws-2')
    expect(arg.staffId).toBe('st-2')
    expect(arg.summaryText).toBe('A distilled, distinctive clinical summary.')
  })

  it('does not index when the transcript has no clinician turns', async () => {
    await summarizeInterview({
      interviewId: 'iv-3',
      workspaceId: 'ws-3',
      messages: [{ role: 'assistant', content: 'Tell me about your approach.' }],
    })
    expect(indexInterviewSummary).not.toHaveBeenCalled()
  })
})

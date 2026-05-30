// POST /api/corpus/search
//
// Semantic search over the clinician's practice-memory corpus for Author Mode.
// Wraps searchPracticeMemory (RAG vector search against practice_memory_chunks)
// and filters to author-relevant source types:
//   interview_summary, content_item, uploaded_draft
//
// Body: { query: string, topK?: number }
// Returns: Array<{ source_type, source_id, source_label, text, similarity }>
export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../_lib/workspaceContext.js'
import { requireRole } from '../_lib/auth.js'
import { enforceLimit } from '../_lib/ratelimit.js'
import { searchPracticeMemory } from '../_lib/practiceMemoryRag.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const err = (res, msg, status = 400) => res.status(status).json({ error: msg })

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed')

  const ws = await workspaceContext(req)
  if (!ws) return err(res, 'Workspace not resolved', 400)

  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  if (!(await enforceLimit(req, res, 'ai'))) return

  const { query, topK = 5 } = req.body || {}
  if (!query || typeof query !== 'string' || !query.trim()) {
    return res.status(200).json([])
  }

  // Resolve the clinician row so results are scoped to this user's corpus.
  const staffRes = await fetch(
    `${SUPABASE_URL}/rest/v1/staff?workspace_id=eq.${ws.id}&user_id=eq.${auth.userId}&select=id&limit=1`,
    {
      headers: {
        apikey:        SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    }
  )
  let staffId = null
  if (staffRes.ok) {
    const rows = await staffRes.json().catch(() => [])
    staffId = rows[0]?.id ?? null
  }

  // Author Mode raw-voice substrate — Q's own spoken and written words only.
  // NEVER include AI-generated types (interview_summary, content_item) here:
  // the whole point of Author Mode is to surface the clinician's own voice,
  // not AI-synthesised output.
  const AUTHOR_SOURCE_TYPES = ['interview_transcript_full', 'original_blog', 'uploaded_draft']

  const results = await searchPracticeMemory({
    workspaceId:      ws.id,
    staffId,
    query:            query.trim(),
    topK:             Math.min(Math.max(Number(topK) || 5, 1), 10),
    excludeSourceIds: [],
    sourceTypes:      AUTHOR_SOURCE_TYPES,
  })

  const filtered = results

  return res.status(200).json(filtered)
}

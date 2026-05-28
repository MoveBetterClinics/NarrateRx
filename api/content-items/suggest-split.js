// POST /api/content-items/suggest-split
//
// Multi-piece extract detection (PR 4 —
// .claude/design-interview-output-voice-fidelity.md, decision 3 + PR 4).
//
// Thin HTTP wrapper over detectInterviewThreads() in api/_lib/detectThreads.js.
// Read-only: it evaluates a blog content_item's source transcript and returns
// a recommendation { recommended_parts, rationale, titles }. It does NOT split
// anything — Story Detail uses the result to OPTIONALLY surface a "split into N
// posts?" banner. Accepting the proposal calls /api/content-items/split-into-
// series, which runs the actual cluster + write pipeline.
//
// Called on demand from Story Detail (cached client-side by React Query), not
// fire-and-forget, so a fresh load reflects the current piece state.
//
// Body: { id }   (content_item id)
// Returns: { id, eligible, recommended_parts, rationale?, titles?, reason? }

export const config = { runtime: 'nodejs', maxDuration: 30 }

import { workspaceContext } from '../_lib/workspaceContext.js'
import { requireRole } from '../_lib/auth.js'
import { enforceLimit } from '../_lib/ratelimit.js'
import { detectInterviewThreads } from '../_lib/detectThreads.js'

const err = (res, msg, status = 400) => res.status(status).json({ error: msg })

export default async function handler(req, res) {
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405)
  if (!(await enforceLimit(req, res, 'ai'))) return

  const ws = await workspaceContext(req)
  if (!ws) return err(res, 'Workspace not resolved', 400)
  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  const { id } = req.body || {}
  if (!id) return err(res, 'Missing id')

  const result = await detectInterviewThreads(ws, id)
  const status = result.reason === 'item_not_found' ? 404 : 200
  return res.status(status).json({ id, ...result })
}

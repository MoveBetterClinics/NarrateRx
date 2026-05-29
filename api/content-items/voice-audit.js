// POST /api/content-items/voice-audit
//
// Pass 2 of the two-pass voice-fidelity guard
// (.claude/design-interview-output-voice-fidelity.md, section 6).
//
// Thin HTTP wrapper over auditContentItem() in api/_lib/voiceAudit.js, which
// scores the stored draft against the transcript + voice profile (+ practice
// memory for We-lane) and persists voice_fidelity_score + voice_audit.
//
// Designed to be called fire-and-forget after content_item creation, the same
// way provenance.js is. It never blocks the user: failures are recorded on
// voice_audit and returned as { audited: false }.
//
// Body: { contentItemId }
// Returns: { ok, contentItemId, score?, audited, reason? }

export const config = { runtime: 'nodejs', maxDuration: 60 }

import { workspaceContext } from '../_lib/workspaceContext.js'
import { requireRole } from '../_lib/auth.js'
import { enforceLimit } from '../_lib/ratelimit.js'
import { auditContentItem } from '../_lib/voiceAudit.js'

const err = (res, msg, status = 400) => res.status(status).json({ error: msg })

export default async function handler(req, res) {
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405)
  if (!(await enforceLimit(req, res, 'media'))) return

  const ws = await workspaceContext(req)
  if (!ws) return err(res, 'Workspace not resolved', 400)
  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  const { contentItemId } = req.body || {}
  if (!contentItemId) return err(res, 'Missing contentItemId')

  const result = await auditContentItem(ws, contentItemId)
  const status = result.ok ? 200 : (result.reason === 'item_not_found' ? 404 : 200)
  return res.status(status).json({ contentItemId, ...result })
}

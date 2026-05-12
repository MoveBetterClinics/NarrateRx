import { withSentry } from '../_lib/sentry.js'
// Destructive workspace operations. Admin-only, typed-confirm gated.
//
// POST /api/workspace/danger { action: 'archive', confirm_slug }
//   → { ok: true, status: 'archived' }
//
// The endpoint deliberately serves a *small* set of actions. Each one is
// gated by a "type the workspace's slug to confirm" check that runs
// server-side — the client UI surfaces the same requirement, but having
// it duplicated server-side closes the path where a caller hits the API
// directly with a JSON tool.
//
// Audit log: every dangerous action records to media_audit (we reuse the
// existing audit table — `action` distinguishes 'workspace.archive' from
// the media-level actions already there). The forensics column captures
// who, when, and what the workspace looked like immediately before.
//
// Not yet implemented (deferred to follow-up PRs):
//   - rename (slug change + Vercel domain re-register + redirect)
//   - transfer (Clerk org ownership swap)
//   - hard delete (cascade across tables + blob storage + Clerk org)

import { requireRole } from '../_lib/auth.js'
import { workspaceContext } from '../_lib/workspaceContext.js'
import { recordAudit, actorFromRequest, ipFromRequest, uaFromRequest } from '../_lib/audit.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...init.headers,
    },
  })
}

const SUPPORTED_ACTIONS = new Set(['archive'])

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method-not-allowed' })
  }

  const workspace = await workspaceContext(req)
  if (!workspace) return res.status(404).json({ error: 'no-workspace-context' })

  // Admin-only AND must be active on the matching Clerk org for this workspace.
  // The orgId guard is what stops a global admin on workspace A from
  // archiving workspace B by sending a forged Host header — only an admin
  // whose JWT carries this workspace's clerk_org_id can act here.
  const auth = await requireRole(req, ['admin'], { orgId: workspace.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  const { action, confirm_slug } = req.body || {}
  if (!action || !SUPPORTED_ACTIONS.has(action)) {
    return res.status(400).json({ error: 'unsupported-action' })
  }

  // Typed-confirm guard. Trim + case-fold so a stray space or capital
  // doesn't reject a legitimate confirmation; the slug itself is
  // already lowercase by validateSlug() at create time.
  const submitted = String(confirm_slug || '').trim().toLowerCase()
  if (submitted !== workspace.slug) {
    return res.status(400).json({ error: 'confirm-slug-mismatch' })
  }

  if (action === 'archive') {
    const r = await sb(`workspaces?id=eq.${encodeURIComponent(workspace.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'archived' }),
    })
    if (!r.ok) {
      const text = await r.text().catch(() => '')
      console.error('[danger] archive failed:', r.status, text)
      return res.status(500).json({ error: 'archive-failed' })
    }
    // Record to the existing media_audit table — same actor / IP / UA
    // fingerprint shape, distinguished by the action prefix. Best-effort;
    // archive completes regardless of audit write success.
    await recordAudit({
      action: 'workspace.archive',
      actor:  actorFromRequest(req),
      before: { slug: workspace.slug, status: workspace.status, display_name: workspace.display_name },
      after:  { slug: workspace.slug, status: 'archived' },
      scope:  { column: 'workspace_id', id: workspace.id, workspace },
      req: { headers: { 'x-forwarded-for': ipFromRequest(req), 'user-agent': uaFromRequest(req) } },
    }).catch(() => {})
    return res.status(200).json({ ok: true, status: 'archived' })
  }

  // Unreachable — SUPPORTED_ACTIONS keeps the switch honest.
  return res.status(400).json({ error: 'unsupported-action' })
}

export default withSentry(handler)

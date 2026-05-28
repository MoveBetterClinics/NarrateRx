// GET  /api/onboarding/progress
//   Returns { steps, trialDaysLeft, completed }
//   steps[] = { key, done, label }
//
// POST /api/onboarding/progress
//   body: { step: 'onboarding_interview'|'run_first_interview'|'approve_draft'|'publish' }
//   Marks the step done in onboarding_steps_done JSONB. When all steps are
//   done, also sets onboarding_completed_at = now(). Returns updated progress.
//
// Auth: Bearer JWT required. Workspace resolved from Host subdomain.
// Runtime: nodejs (uses @clerk/backend, req/res shape — not Edge).

export const config = { runtime: 'nodejs' }

import { workspaceContext, invalidateWorkspaceCacheById, invalidateWorkspaceCacheBySlug } from '../_lib/workspaceContext.js'
import { requireRole } from '../_lib/auth.js'
import { withSentry } from '../_lib/sentry.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const STEP_KEYS = ['onboarding_interview', 'run_first_interview', 'approve_draft', 'publish']

const STEP_LABELS = {
  onboarding_interview: 'Complete your voice setup',
  run_first_interview:  'Run your first interview',
  approve_draft:        'Approve your first draft',
  publish:              'Publish your first piece',
}

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

// Auto-detect step completion from real DB state for a given workspace.
// Does NOT rely solely on the stored JSONB — verifies against live counts.
async function detectDoneSteps(ws) {
  const wsId = ws.id

  // onboarding_interview: the founder voice setup interview was completed
  // (synthesis landing sets onboarding_interview_completed_at on the row)
  const onboardingInterviewDone = Boolean(ws.onboarding_interview_completed_at)

  // run_first_interview: at least one regular interview with status=completed
  let interviewDone = false
  try {
    const r = await sb(
      `interviews?workspace_id=eq.${wsId}&status=eq.completed&select=id&limit=1`
    )
    if (r.ok) {
      const rows = await r.json()
      interviewDone = Array.isArray(rows) && rows.length > 0
    }
  } catch { /* leave false */ }

  // approve_draft: at least one content_item with status=approved
  let approveDone = false
  try {
    const r = await sb(
      `content_items?workspace_id=eq.${wsId}&status=eq.approved&select=id&limit=1`
    )
    if (r.ok) {
      const rows = await r.json()
      approveDone = Array.isArray(rows) && rows.length > 0
    }
  } catch { /* leave false */ }

  // publish: at least one content_item with status=published
  let publishDone = false
  try {
    const r = await sb(
      `content_items?workspace_id=eq.${wsId}&status=eq.published&select=id&limit=1`
    )
    if (r.ok) {
      const rows = await r.json()
      publishDone = Array.isArray(rows) && rows.length > 0
    }
  } catch { /* leave false */ }

  return {
    onboarding_interview: onboardingInterviewDone,
    run_first_interview:  interviewDone,
    approve_draft:        approveDone,
    publish:              publishDone,
  }
}

function trialDaysLeft(ws) {
  if (!ws.trial_ends_at) return null
  const ms = new Date(ws.trial_ends_at).getTime() - Date.now()
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)))
}

async function handler(req, res) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('[onboarding/progress] Supabase env not configured')
    return res.status(500).json({ error: 'server-misconfigured' })
  }

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'workspace-not-resolved' })

  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  // ── GET ──────────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const doneMap = await detectDoneSteps(ws)
    const allDone = STEP_KEYS.every((k) => doneMap[k])

    const steps = STEP_KEYS.map((key) => ({
      key,
      label: STEP_LABELS[key],
      done: doneMap[key],
    }))

    return res.status(200).json({
      steps,
      trialDaysLeft: trialDaysLeft(ws),
      completed: Boolean(ws.onboarding_completed_at) || allDone,
      plan: ws.plan || 'trial',
    })
  }

  // ── POST ─────────────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const body = req.body || {}
    const step = body.step
    if (!STEP_KEYS.includes(step)) {
      return res.status(400).json({ error: 'invalid-step' })
    }

    // Merge step into the JSONB array (deduplicated).
    const existing = Array.isArray(ws.onboarding_steps_done) ? ws.onboarding_steps_done : []
    const updated  = Array.from(new Set([...existing, step]))
    const allDone  = STEP_KEYS.every((k) => updated.includes(k))

    const patch = {
      onboarding_steps_done: updated,
      ...(allDone && !ws.onboarding_completed_at ? { onboarding_completed_at: new Date().toISOString() } : {}),
    }

    const r = await sb(
      `workspaces?id=eq.${ws.id}`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(patch),
      }
    )
    if (!r.ok) {
      const body2 = await r.text().catch(() => '')
      console.error(`[onboarding/progress] patch failed ${r.status}: ${body2.slice(0, 300)}`)
      return res.status(500).json({ error: 'db-error' })
    }
    const rows = await r.json()
    const updatedWs = rows?.[0] ?? { ...ws, ...patch }
    // Drop the in-process workspace cache so subsequent step-tick reads (on
    // this instance) see the updated onboarding_steps_done / completed_at
    // immediately. Sibling instances still TTL out at 60s.
    invalidateWorkspaceCacheById(ws.id)
    invalidateWorkspaceCacheBySlug(ws.slug)

    const doneMap = await detectDoneSteps(updatedWs)
    const steps = STEP_KEYS.map((key) => ({
      key,
      label: STEP_LABELS[key],
      done: doneMap[key],
    }))

    return res.status(200).json({
      steps,
      trialDaysLeft: trialDaysLeft(updatedWs),
      completed: Boolean(updatedWs.onboarding_completed_at) || allDone,
      plan: updatedWs.plan || 'trial',
    })
  }

  return res.status(405).json({ error: 'method-not-allowed' })
}

export default withSentry(handler)

// GET /api/concepts/synthesis
//
// Returns the full cross-staff knowledge picture for the /synthesis admin page:
//   concepts  — all workspace concepts with per-kind grouping, weight, and
//               staff coverage (who has / hasn't mentioned each)
//   staff     — all staff who have at least one completed interview at
//               this workspace (name + id)
//   coverage   — summary stats (total concepts, total mentions, coverage %)
//
// Admin-only: enforced via workspaceContext role check.
// Plan-gated: requires 'practice' plan or above (cross_staff_synthesis feature).
export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../_lib/workspaceContext.js'
import { requireRole }      from '../_lib/auth.js'
import { requirePlan }      from '../_lib/planGate.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

function sb(path) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey:        SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
  })
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })

  const auth = await requireRole(req, ['admin'], { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  const planGate = requirePlan(res, ws, 'cross_staff_synthesis')
  if (planGate) return planGate

  // ── Fetch all workspace concepts ─────────────────────────────────────────────
  const conceptsRes = await sb(
    `workspace_concepts?workspace_id=eq.${ws.id}&evidence_count=gte.1` +
    `&order=weight.desc,last_seen_at.desc&limit=200` +
    `&select=id,kind,label,weight,evidence_count,first_seen_at,last_seen_at`
  )
  if (!conceptsRes.ok) return res.status(500).json({ error: 'Failed to fetch concepts' })
  const rawConcepts = await conceptsRes.json()
  if (!rawConcepts.length) {
    return res.status(200).json({ concepts: [], staff: [], coverage: { total: 0, totalMentions: 0, coveragePercent: 0 } })
  }

  // ── Fetch all staff×concept mention pairs ────────────────────────────────────
  const mentionsRes = await sb(
    `concept_mentions?workspace_id=eq.${ws.id}&staff_id=not.is.null` +
    `&select=concept_id,staff_id&limit=2000`
  )
  const mentions = mentionsRes.ok ? await mentionsRes.json() : []

  // Build concept → Set<staffId> map
  const conceptStaff = new Map()
  for (const m of mentions) {
    if (!conceptStaff.has(m.concept_id)) conceptStaff.set(m.concept_id, new Set())
    conceptStaff.get(m.concept_id).add(m.staff_id)
  }

  // All distinct staff IDs who have mentioned anything
  const allStaffIds = [...new Set(mentions.map(m => m.staff_id))]

  // ── Fetch staff names ────────────────────────────────────────────────────────
  let staffById = {}
  if (allStaffIds.length) {
    const cRes = await sb(
      `staff?id=in.(${allStaffIds.join(',')})&workspace_id=eq.${ws.id}` +
      `&select=id,name&limit=100`
    )
    if (cRes.ok) {
      const cRows = await cRes.json()
      for (const c of cRows) staffById[c.id] = c.name
    }
  }

  const staffList = allStaffIds
    .map(id => ({ id, name: staffById[id] || 'Unknown' }))
    .sort((a, b) => a.name.localeCompare(b.name))

  // ── Assemble concept objects with per-staff coverage ─────────────────────────
  const concepts = rawConcepts.map(c => {
    const mentioned  = conceptStaff.get(c.id) ?? new Set()
    const missingIds = allStaffIds.filter(id => !mentioned.has(id))
    return {
      id:             c.id,
      kind:           c.kind,
      label:          c.label,
      weight:         Number(c.weight),
      evidenceCount:  c.evidence_count,
      firstSeenAt:    c.first_seen_at,
      lastSeenAt:     c.last_seen_at,
      mentionedBy:    [...mentioned].map(id => ({ id, name: staffById[id] || 'Unknown' })),
      notMentionedBy: missingIds.map(id => ({ id, name: staffById[id] || 'Unknown' })),
    }
  })

  // ── Coverage stats ───────────────────────────────────────────────────────────
  const totalPossible = rawConcepts.length * Math.max(allStaffIds.length, 1)
  const totalMentioned = concepts.reduce((sum, c) => sum + c.mentionedBy.length, 0)
  const coveragePercent = Math.round((totalMentioned / totalPossible) * 100)

  return res.status(200).json({
    concepts,
    staff: staffList,
    coverage: {
      total:           rawConcepts.length,
      totalMentions:   totalMentioned,
      coveragePercent,
    },
  })
}

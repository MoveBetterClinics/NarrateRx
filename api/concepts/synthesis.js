// GET /api/concepts/synthesis
//
// Returns the full cross-staff knowledge picture for the /synthesis admin page:
//   concepts  — all workspace concepts with per-kind grouping, weight, and
//               clinician coverage (who has / hasn't mentioned each)
//   clinicians — all clinicians who have at least one completed interview at
//                this workspace (name + id)
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
    return res.status(200).json({ concepts: [], clinicians: [], coverage: { total: 0, totalMentions: 0, coveragePercent: 0 } })
  }

  // ── Fetch all clinician×concept mention pairs ────────────────────────────────
  const mentionsRes = await sb(
    `concept_mentions?workspace_id=eq.${ws.id}&clinician_id=not.is.null` +
    `&select=concept_id,clinician_id&limit=2000`
  )
  const mentions = mentionsRes.ok ? await mentionsRes.json() : []

  // Build concept → Set<clinicianId> map
  const conceptClinicians = new Map()
  for (const m of mentions) {
    if (!conceptClinicians.has(m.concept_id)) conceptClinicians.set(m.concept_id, new Set())
    conceptClinicians.get(m.concept_id).add(m.clinician_id)
  }

  // All distinct clinician IDs who have mentioned anything
  const allClinicianIds = [...new Set(mentions.map(m => m.clinician_id))]

  // ── Fetch clinician names ────────────────────────────────────────────────────
  let cliniciansById = {}
  if (allClinicianIds.length) {
    const cRes = await sb(
      `clinicians?id=in.(${allClinicianIds.join(',')})&workspace_id=eq.${ws.id}` +
      `&select=id,name&limit=100`
    )
    if (cRes.ok) {
      const cRows = await cRes.json()
      for (const c of cRows) cliniciansById[c.id] = c.name
    }
  }

  const clinicianList = allClinicianIds
    .map(id => ({ id, name: cliniciansById[id] || 'Unknown' }))
    .sort((a, b) => a.name.localeCompare(b.name))

  // ── Assemble concept objects with per-clinician coverage ─────────────────────
  const concepts = rawConcepts.map(c => {
    const mentioned  = conceptClinicians.get(c.id) ?? new Set()
    const missingIds = allClinicianIds.filter(id => !mentioned.has(id))
    return {
      id:             c.id,
      kind:           c.kind,
      label:          c.label,
      weight:         Number(c.weight),
      evidenceCount:  c.evidence_count,
      firstSeenAt:    c.first_seen_at,
      lastSeenAt:     c.last_seen_at,
      mentionedBy:    [...mentioned].map(id => ({ id, name: cliniciansById[id] || 'Unknown' })),
      notMentionedBy: missingIds.map(id => ({ id, name: cliniciansById[id] || 'Unknown' })),
    }
  })

  // ── Coverage stats ───────────────────────────────────────────────────────────
  const totalPossible = rawConcepts.length * Math.max(allClinicianIds.length, 1)
  const totalMentioned = concepts.reduce((sum, c) => sum + c.mentionedBy.length, 0)
  const coveragePercent = Math.round((totalMentioned / totalPossible) * 100)

  return res.status(200).json({
    concepts,
    clinicians: clinicianList,
    coverage: {
      total:           rawConcepts.length,
      totalMentions:   totalMentioned,
      coveragePercent,
    },
  })
}

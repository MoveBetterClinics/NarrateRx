// GET /api/concepts/context?topic=<str>&clinician_id=<uuid>
//
// Returns top workspace concepts as a formatted block + raw array, plus
// agreement and gap probe suggestions for the active interview session.
//
// agreement_probes: concepts covered by ≥2 distinct clinicians — Bernard can
//   surface these as "others here have said X — is that your experience?"
// gap_probes: concepts relevant to the topic not yet mentioned by THIS clinician
//   — Bernard can surface these as "no one has told us about Y yet — can you?"
export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../_lib/workspaceContext.js'
import { getContextBlock, getRawConcepts } from '../_lib/conceptRetrieval.js'

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

// ── Agreement probes ─────────────────────────────────────────────────────────
// Concepts mentioned by 2+ distinct clinicians, sorted by distinct-clinician
// count desc. These are the practice's "shared knowledge" — agreement territory.

async function fetchAgreementProbes(workspaceId, topic, limit = 3) {
  // Pull mentions grouped by concept + clinician (distinct pairs).
  // Filter to topic-relevant concepts via the concept label (simple ilike).
  let qs = `concept_mentions?workspace_id=eq.${workspaceId}&clinician_id=not.is.null`
  qs += `&select=concept_id,clinician_id,workspace_concepts(kind,label,weight)`
  qs += `&workspace_concepts.workspace_id=eq.${workspaceId}`
  if (topic?.trim()) {
    // We can't filter on the joined table via REST easily, so we pull broadly
    // and filter in-process on label overlap with the topic.
  }
  qs += `&order=concept_id&limit=500`

  const r = await sb(qs)
  if (!r.ok) return []
  const rows = await r.json()

  // Group by concept_id → count distinct clinicians
  const map = new Map()
  for (const row of rows) {
    const concept = row.workspace_concepts
    if (!concept) continue
    if (!map.has(row.concept_id)) {
      map.set(row.concept_id, { label: concept.label, kind: concept.kind, weight: concept.weight, clinicians: new Set() })
    }
    map.get(row.concept_id).clinicians.add(row.clinician_id)
  }

  const topicLower = (topic || '').toLowerCase()

  return [...map.values()]
    .filter(c => c.clinicians.size >= 2)
    .filter(c => !topicLower || c.label.toLowerCase().includes(topicLower.split(/\s+/)[0] || '') || true)
    .sort((a, b) => b.clinicians.size - a.clinicians.size || b.weight - a.weight)
    .slice(0, limit)
    .map(c => ({ label: c.label, kind: c.kind, count: c.clinicians.size }))
}

// ── Gap probes ───────────────────────────────────────────────────────────────
// Concepts in the graph not yet mentioned by THIS specific clinician.
// These represent coverage gaps — stories the practice hasn't heard from them.

async function fetchGapProbes(workspaceId, clinicianId, topic, limit = 3) {
  if (!clinicianId) return []

  // All concepts for the workspace (topic-relevant, top by weight)
  const allConcepts = await getRawConcepts({ workspaceId, topic, limit: 20 })
  if (!allConcepts.length) return []

  // Concepts already mentioned by this clinician
  const mentionedRes = await sb(
    `concept_mentions?workspace_id=eq.${workspaceId}&clinician_id=eq.${clinicianId}&select=concept_id&limit=200`
  )
  const mentionedIds = new Set(
    mentionedRes.ok ? (await mentionedRes.json()).map(r => r.concept_id) : []
  )

  return allConcepts
    .filter(c => !mentionedIds.has(c.id))
    .slice(0, limit)
    .map(c => ({ label: c.label, kind: c.kind, weight: c.weight }))
}

// ── Prompt blocks ────────────────────────────────────────────────────────────

function buildAgreementBlock(probes) {
  if (!probes.length) return ''
  const lines = probes.map(p => `  • "${p.label}" — mentioned by ${p.count} clinicians at the practice`).join('\n')
  return `
AGREEMENT TERRITORY — when these topics come up naturally, surface the shared perspective as a gentle probe. Prefix your message with [AGREEMENT] so the UI can label it. If you can attribute the prior view to a specific recent colleague's interview (e.g. from the CROSS-STAFF PERSPECTIVES block above), append their name in the same form as the contrast token: [AGREEMENT][ColleagueName]. Otherwise just use [AGREEMENT].
${lines}
Example framing: "Several colleagues here have mentioned [X] — does that match what you see, or do you experience it differently?"
Only use this probe once per topic, and only if it connects naturally to what the clinician is saying.`
}

function buildGapBlock(probes) {
  if (!probes.length) return ''
  const lines = probes.map(p => `  • "${p.label}"`).join('\n')
  return `
COVERAGE GAPS — these are topics your practice has knowledge about, but this specific clinician hasn't shared their perspective on yet. If a natural opening arises, invite them in. Prefix your message with [GAP] so the UI can label it.
${lines}
Example framing: "We haven't heard your take on [X] yet — has that come up in your work?"
Only surface a gap probe if it fits naturally; never force it.`
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })

  const { searchParams } = new URL(req.url, 'http://localhost')
  const topic       = searchParams.get('topic') || null
  const clinicianId = searchParams.get('clinician_id') || null

  const [block, concepts, agreementProbes, gapProbes] = await Promise.all([
    getContextBlock({ workspaceId: ws.id, topic }),
    getRawConcepts({ workspaceId: ws.id, topic, limit: 20 }),
    fetchAgreementProbes(ws.id, topic),
    fetchGapProbes(ws.id, clinicianId, topic),
  ])

  const agreementBlock = buildAgreementBlock(agreementProbes)
  const gapBlock       = buildGapBlock(gapProbes)

  return res.status(200).json({
    block,
    concepts,
    agreementBlock,
    gapBlock,
    agreementProbes,
    gapProbes,
  })
}

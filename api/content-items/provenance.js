// POST /api/content-items/provenance
//
// Populates content_items.provenance — the voice-fidelity substrate that
// powers P0-A (transcript ↔ asset highlight), P0-C (verbatim/paraphrase/
// synthesis scorecard on ApprovalPanel), and P0-G (Themes verbatim contrast).
//
// Hybrid pipeline:
//   1. If the caller passes a <PROVENANCE> trailer captured from the model's
//      stream output, parse + validate it against the content + transcript.
//      On pass → store with source: "model_emit_validated".
//   2. If no trailer is passed OR validation fails → fall back to algorithmic
//      similarity matching → store with source: "algorithmic_fallback".
//
// Either path produces the same shape (see migration 043 for schema).
//
// Body: { contentItemId, trailer? }
// Returns: { ok: true, contentItemId, source, summary }

export const config = { runtime: 'nodejs', maxDuration: 30 }

import { workspaceContext } from '../_lib/workspaceContext.js'
import { enforceLimit } from '../_lib/ratelimit.js'
import {
  parseProvenance,
  validateProvenance,
} from '../_lib/provenanceValidator.js'
import {
  computeProvenance,
  summarize,
  enrichWithVoicePhrases,
} from '../_lib/provenanceMatcher.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey:        SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer:        'return=representation',
      ...init.headers,
    },
  })
}

const ok  = (res, data, status = 200) => res.status(status).json(data)
const err = (res, msg, status = 400)  => res.status(status).json({ error: msg })

async function dbErr(res, r, msg = 'Database error', status = 500) {
  const body = await r.text().catch(() => '')
  console.error(`[content-items/provenance] ${msg} — supabase ${r.status}: ${body.slice(0, 500)}`)
  return res.status(status).json({ error: msg })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405)
  if (!(await enforceLimit(req, res, 'media'))) return

  const ws = await workspaceContext(req)
  if (!ws) return err(res, 'Workspace not resolved', 400)
  const wsFilter = `workspace_id=eq.${ws.id}`

  const { contentItemId, trailer } = req.body || {}
  if (!contentItemId) return err(res, 'Missing contentItemId')

  // Load the target content_item (workspace-scoped).
  const itemRes = await sb(`content_items?id=eq.${contentItemId}&${wsFilter}&select=id,interview_id,clinician_id,content,platform`)
  if (!itemRes.ok) return dbErr(res, itemRes)
  const itemRows = await itemRes.json()
  if (!itemRows.length) return err(res, 'Content item not found', 404)
  const item = itemRows[0]
  if (!item.content?.trim()) return err(res, 'Content item has no body to attribute', 422)

  // Load interview messages + voice phrases in parallel (non-blocking on phrases).
  let userMessages = []
  let voicePhrases = []

  const parallelFetches = []

  if (item.interview_id) {
    parallelFetches.push(
      sb(`interviews?id=eq.${item.interview_id}&${wsFilter}&select=messages,cleaned_messages`)
        .then(async (r) => {
          if (!r.ok) return
          const rows = await r.json()
          if (rows.length) {
            const raw = rows[0].cleaned_messages || rows[0].messages || []
            userMessages = raw
              .filter((m) => m?.role === 'user' && typeof m?.content === 'string')
              .map((m) => m.content)
          }
        })
        .catch(() => {}),
    )
  }

  const clinicianId = item.clinician_id
  if (clinicianId) {
    parallelFetches.push(
      sb(
        `clinician_voice_phrases?clinician_id=eq.${clinicianId}&${wsFilter}` +
        `&select=phrase&order=weight.desc,last_seen_at.desc&limit=12`,
      )
        .then(async (r) => { if (r.ok) voicePhrases = await r.json() })
        .catch(() => {}),
    )
  }

  await Promise.all(parallelFetches)

  // Pipeline: try model emission first, fall back to algorithmic.
  let provenance = null

  if (typeof trailer === 'string' && trailer.trim()) {
    const parsed = parseProvenance(trailer)
    if (parsed.ok) {
      const v = validateProvenance(parsed.blocks, item.content, userMessages)
      if (v.ok) {
        provenance = {
          version: 1,
          granularity: 'paragraph',
          blocks: v.normalized,
          summary: summarize(v.normalized, 'model_emit_validated'),
        }
      } else {
        console.warn(`[content-items/provenance] validation failed for ${contentItemId}: ${v.error} — falling back to algorithmic`)
      }
    } else {
      console.warn(`[content-items/provenance] parse failed for ${contentItemId}: ${parsed.error} — falling back to algorithmic`)
    }
  }

  if (!provenance) {
    provenance = computeProvenance(item.content, userMessages, { source: 'algorithmic_fallback' })
  }

  // Enrich all blocks with voice-phrase echo annotations (non-destructive post-pass).
  if (voicePhrases.length) {
    provenance = enrichWithVoicePhrases(provenance, item.content, voicePhrases)
  }

  // Persist.
  const updRes = await sb(`content_items?id=eq.${contentItemId}&${wsFilter}`, {
    method: 'PATCH',
    body: JSON.stringify({ provenance }),
  })
  if (!updRes.ok) return dbErr(res, updRes, 'Update failed')

  return ok(res, {
    ok: true,
    contentItemId,
    source: provenance.summary.source,
    summary: provenance.summary,
  })
}

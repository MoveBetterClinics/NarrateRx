// POST /api/content-items/blog-regen-finalize
// Body: { id, content, length_preset?, generation_style? }
//
// Phase 2 of the streamed blog-regen flow. Takes the model output the client
// just streamed from /api/stream, strips the <PROVENANCE> trailer, and
// performs the exact DB writes the old non-streaming /regenerate handler did
// for the blog branch:
//
//   • PATCH content_items: content/ai_original_content, status='draft',
//     clear approved_by/at + reviewed_by, optional length_preset.
//   • Sync interview.outputs.blogPost (single-post + series Part 1 only —
//     Part 2+ leaves the editorial summary untouched so downstream atoms
//     keep pulling from Part 1).
//   • Persist interview.generation_style if explicitly requested.

export const config = { runtime: 'nodejs', maxDuration: 30 }

import { workspaceContext } from '../_lib/workspaceContext.js'
import { requireRole } from '../_lib/auth.js'
import { enforceLimit } from '../_lib/ratelimit.js'
import { extractProvenanceBlock } from '../../src/lib/provenance.js'
import { LENGTH_PRESETS } from '../../src/lib/lengthPresets.js'

const VALID_LENGTH_PRESETS = new Set(LENGTH_PRESETS.map((p) => p.id))
const VALID_GENERATION_STYLES = new Set(['blog_post', 'minimal_edits'])

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
const err = (res, msg, status = 400) => res.status(status).json({ error: msg })

async function dbErr(res, r, msg = 'Database error', status = 500) {
  const body = await r.text().catch(() => '')
  console.error(`[content-items/blog-regen-finalize] ${msg} — supabase ${r.status}: ${body.slice(0, 500)}`)
  return res.status(status).json({ error: msg })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405)
  if (!(await enforceLimit(req, res, 'generic'))) return

  const ws = await workspaceContext(req)
  if (!ws) return err(res, 'Workspace not resolved', 400)
  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  const wsFilter = `workspace_id=eq.${ws.id}`

  const {
    id,
    content: rawContent,
    length_preset: bodyLengthPreset,
    generation_style: bodyGenerationStyle,
  } = req.body || {}
  if (!id) return err(res, 'Missing id')
  if (typeof rawContent !== 'string' || !rawContent.trim()) {
    return err(res, 'Missing content')
  }
  if (bodyLengthPreset != null && !VALID_LENGTH_PRESETS.has(bodyLengthPreset)) {
    return err(res, `Invalid length_preset: ${bodyLengthPreset}`)
  }
  if (bodyGenerationStyle != null && !VALID_GENERATION_STYLES.has(bodyGenerationStyle)) {
    return err(res, `Invalid generation_style: ${bodyGenerationStyle}`)
  }

  const itemRes = await sb(`content_items?id=eq.${id}&${wsFilter}&select=*`)
  if (!itemRes.ok) return dbErr(res, itemRes)
  const itemRows = await itemRes.json()
  if (!itemRows.length) return err(res, 'Content item not found', 404)
  const item = itemRows[0]
  if (item.platform !== 'blog') {
    return err(res, `blog-regen-finalize only supports blog pieces (got ${item.platform})`, 422)
  }

  const ivRes = await sb(
    `interviews?id=eq.${item.interview_id}&${wsFilter}&select=id,outputs,generation_style`,
  )
  if (!ivRes.ok) return dbErr(res, ivRes)
  const ivRows = await ivRes.json()
  if (!ivRows.length) return err(res, 'Interview not found', 404)
  const interview = ivRows[0]

  const newContent = extractProvenanceBlock(rawContent.trim()).content
  if (!newContent.trim()) return err(res, 'Empty content after provenance strip', 422)

  const patch = {
    content:             newContent,
    ai_original_content: newContent,
    status:              'draft',
    approved_by:         null,
    approved_at:         null,
    reviewed_by:         null,
    updated_at:          new Date().toISOString(),
  }
  if (bodyLengthPreset != null) patch.length_preset = bodyLengthPreset

  const upd = await sb(`content_items?id=eq.${id}&${wsFilter}`, {
    method: 'PATCH',
    body:   JSON.stringify(patch),
  })
  if (!upd.ok) return dbErr(res, upd, 'Update failed')
  const updRows = await upd.json()

  // Sync interview.outputs.blogPost for single-post + series Part 1 only;
  // Part 2+ would clobber Part 1's editorial summary and corrupt atoms.
  const shouldSyncOutputs = !item.series_id || item.series_part === 1
  const stylePatch = (
    bodyGenerationStyle != null &&
    bodyGenerationStyle !== interview.generation_style
  ) ? { generation_style: bodyGenerationStyle } : null

  if (shouldSyncOutputs || stylePatch) {
    const ivPatch = {}
    if (shouldSyncOutputs) {
      ivPatch.outputs = { ...(interview.outputs || {}), blogPost: newContent }
    }
    if (stylePatch) Object.assign(ivPatch, stylePatch)
    await sb(`interviews?id=eq.${interview.id}&${wsFilter}`, {
      method:  'PATCH',
      body:    JSON.stringify(ivPatch),
      headers: { Prefer: 'return=minimal' },
    })
  }

  return ok(res, updRows[0] ?? null)
}

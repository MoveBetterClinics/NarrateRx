// GET    /api/book/excluded-sources — list current exclusions
// POST   /api/book/excluded-sources — add an exclusion
// DELETE /api/book/excluded-sources?source_table=…&source_id=… — remove
//
// Admin-only escape hatch for "don't feed this source into the book". The
// synthesis pass (api/_lib/bookSynthesis.js) subtracts excluded rows from
// the source pull before sending to the model.
//
// POST body: { source_table: 'interviews' | 'clinician_corpus_documents',
//              source_id:    uuid,
//              reason?:      string }
//
// No UI consumes this yet — landed alongside the pin-chapter UI to keep
// the schema and the API in lockstep. A follow-up adds source-detail-page
// exclude toggles.

export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../_lib/workspaceContext.js'
import { requireRole } from '../_lib/auth.js'
import { enforceLimit } from '../_lib/ratelimit.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const VALID_TABLES = new Set(['interviews', 'clinician_corpus_documents'])

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

export default async function handler(req, res) {
  if (!(await enforceLimit(req, res, 'generic'))) return

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })

  const auth = await requireRole(req, ['admin'], { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    const status = auth.reason === 'no-token' ? 401 : 403
    return res.status(status).json({ error: auth.reason })
  }

  if (req.method === 'GET') {
    const r = await sb(
      `book_excluded_sources?workspace_id=eq.${ws.id}` +
      `&select=id,source_table,source_id,excluded_at,excluded_by,reason` +
      `&order=excluded_at.desc`
    )
    if (!r.ok) {
      const body = await r.text().catch(() => '')
      console.error(`[book/excluded-sources GET] supabase ${r.status}: ${body.slice(0, 300)}`)
      return res.status(500).json({ error: 'Database error' })
    }
    return res.status(200).json(await r.json())
  }

  if (req.method === 'POST') {
    const sourceTable = String(req.body?.source_table || '').trim()
    const sourceId    = String(req.body?.source_id || '').trim()
    const reason      = req.body?.reason ? String(req.body.reason).slice(0, 500) : null

    if (!VALID_TABLES.has(sourceTable)) {
      return res.status(400).json({ error: 'source_table must be interviews or clinician_corpus_documents' })
    }
    if (!sourceId) return res.status(400).json({ error: 'source_id required' })

    const r = await sb(`book_excluded_sources?on_conflict=workspace_id,source_table,source_id`, {
      method: 'POST',
      headers: { Prefer: 'return=minimal,resolution=merge-duplicates' },
      body: JSON.stringify({
        workspace_id: ws.id,
        source_table: sourceTable,
        source_id:    sourceId,
        excluded_by:  auth.userId || null,
        reason,
      }),
    })
    if (!r.ok) {
      const body = await r.text().catch(() => '')
      console.error(`[book/excluded-sources POST] supabase ${r.status}: ${body.slice(0, 300)}`)
      return res.status(500).json({ error: 'Exclude failed' })
    }
    return res.status(200).json({ ok: true })
  }

  if (req.method === 'DELETE') {
    const { searchParams } = new URL(req.url, 'http://localhost')
    const sourceTable = (searchParams.get('source_table') || '').trim()
    const sourceId    = (searchParams.get('source_id') || '').trim()
    if (!VALID_TABLES.has(sourceTable)) {
      return res.status(400).json({ error: 'source_table invalid' })
    }
    if (!sourceId) return res.status(400).json({ error: 'source_id required' })

    const r = await sb(
      `book_excluded_sources?workspace_id=eq.${ws.id}` +
      `&source_table=eq.${encodeURIComponent(sourceTable)}` +
      `&source_id=eq.${encodeURIComponent(sourceId)}`,
      { method: 'DELETE', headers: { Prefer: 'return=minimal' } }
    )
    if (!r.ok) {
      const body = await r.text().catch(() => '')
      console.error(`[book/excluded-sources DELETE] supabase ${r.status}: ${body.slice(0, 300)}`)
      return res.status(500).json({ error: 'Include failed' })
    }
    return res.status(200).json({ ok: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}

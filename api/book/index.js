// GET /api/book
//
// Returns the current state of the workspace's book — manuscript_md plus
// metadata (chapters, source_counts, last_regen_at, stale_at, regen_status,
// regen_error). All authenticated workspace members can read; the book is
// the practice's collective work.
//
// Returns an empty shape (manuscript_md: null, chapters: []) when the book
// has never been regenerated. The UI distinguishes "never generated" from
// "regenerating now" via regen_status.

export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../_lib/workspaceContext.js'
import { requireRole } from '../_lib/auth.js'
import { enforceLimit } from '../_lib/ratelimit.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  if (!(await enforceLimit(req, res, 'generic'))) return

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })

  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    const status = auth.reason === 'no-token' ? 401 : 403
    return res.status(status).json({ error: auth.reason })
  }

  const headers = {
    apikey:        SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
  }

  // Pull the book row and the pinned-chapter slugs in parallel; merging the
  // pinned flag onto each chapter lets the UI render Pin/Unpin without a
  // second client-side fetch.
  const [bookRes, pinnedRes] = await Promise.all([
    fetch(
      `${SUPABASE_URL}/rest/v1/workspace_books` +
      `?workspace_id=eq.${ws.id}` +
      `&select=manuscript_md,chapters,source_counts,last_regen_at,stale_at,regen_status,regen_error,updated_at`,
      { headers }
    ),
    fetch(
      `${SUPABASE_URL}/rest/v1/book_pinned_chapters` +
      `?workspace_id=eq.${ws.id}&select=chapter_slug`,
      { headers }
    ),
  ])
  if (!bookRes.ok) {
    const body = await bookRes.text().catch(() => '')
    console.error(`[book/get] supabase ${bookRes.status}: ${body.slice(0, 300)}`)
    return res.status(500).json({ error: 'Database error' })
  }
  const rows = await bookRes.json()
  const row = rows[0]
  const pinnedSlugs = new Set(
    pinnedRes.ok ? (await pinnedRes.json()).map((p) => p.chapter_slug) : []
  )
  const chapters = Array.isArray(row?.chapters) ? row.chapters : []
  const chaptersWithPin = chapters.map((c) => ({
    ...c,
    pinned: pinnedSlugs.has(c?.slug),
  }))

  // Cache-buster header: the workspaceContext 60s in-process cache memory
  // (feedback_workspace_cache_304_stale) doesn't apply to this table, but
  // we still want fresh reads after a regen completes — no-store ensures
  // the conditional-GET 304 path can't return stale manuscript bodies.
  res.setHeader('Cache-Control', 'no-store')

  return res.status(200).json({
    workspace_id:   ws.id,
    book_mode:      ws.book_mode || 'personal',
    manuscript_md:  row?.manuscript_md || null,
    chapters:       chaptersWithPin,
    source_counts:  row?.source_counts || {},
    last_regen_at:  row?.last_regen_at || null,
    stale_at:       row?.stale_at || null,
    regen_status:   row?.regen_status || 'idle',
    regen_error:    row?.regen_error || null,
    updated_at:     row?.updated_at || null,
  })
}

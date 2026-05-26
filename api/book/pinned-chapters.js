// POST   /api/book/pinned-chapters — pin a chapter from the current manuscript
// DELETE /api/book/pinned-chapters?chapter_slug=foo — unpin
//
// Admin-only. Snapshots the chapter body verbatim at pin time so the synthesis
// pass can splice it back in unchanged across future regenerations.
//
// POST body: { chapter_slug: string }
//   The slug must exist in workspace_books.chapters at the moment of pinning.
//   Title + body + position_hint are looked up server-side from the current
//   chapters JSONB — the client never sends chapter content, so two admins
//   can't race-pin different versions of the same slug.

export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../_lib/workspaceContext.js'
import { requireRole } from '../_lib/auth.js'
import { enforceLimit } from '../_lib/ratelimit.js'

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

export default async function handler(req, res) {
  if (!(await enforceLimit(req, res, 'generic'))) return

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })

  const auth = await requireRole(req, ['admin'], { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    const status = auth.reason === 'no-token' ? 401 : 403
    return res.status(status).json({ error: auth.reason })
  }

  if (req.method === 'POST') {
    const slug = (req.body?.chapter_slug || '').trim()
    if (!slug) return res.status(400).json({ error: 'chapter_slug required' })

    // Look up the current chapter content from workspace_books.chapters jsonb.
    const bookRes = await sb(`workspace_books?workspace_id=eq.${ws.id}&select=chapters`)
    if (!bookRes.ok) return res.status(500).json({ error: 'Book read failed' })
    const rows = await bookRes.json()
    const chapters = Array.isArray(rows[0]?.chapters) ? rows[0].chapters : []
    const target = chapters.find((c) => c?.slug === slug)
    if (!target) return res.status(404).json({ error: 'Chapter not found in current manuscript' })

    const r = await sb(`book_pinned_chapters?on_conflict=workspace_id,chapter_slug`, {
      method: 'POST',
      headers: { Prefer: 'return=minimal,resolution=merge-duplicates' },
      body: JSON.stringify({
        workspace_id:  ws.id,
        chapter_slug:  slug,
        chapter_title: target.title || slug,
        chapter_md:    target.body_md || '',
        position_hint: Number.isInteger(target.position) ? target.position : null,
        pinned_by:     auth.userId || null,
      }),
    })
    if (!r.ok) {
      const body = await r.text().catch(() => '')
      console.error(`[book/pinned-chapters POST] supabase ${r.status}: ${body.slice(0, 300)}`)
      return res.status(500).json({ error: 'Pin failed' })
    }
    return res.status(200).json({ ok: true, chapter_slug: slug })
  }

  if (req.method === 'DELETE') {
    const { searchParams } = new URL(req.url, 'http://localhost')
    const slug = (searchParams.get('chapter_slug') || '').trim()
    if (!slug) return res.status(400).json({ error: 'chapter_slug required' })

    const r = await sb(
      `book_pinned_chapters?workspace_id=eq.${ws.id}&chapter_slug=eq.${encodeURIComponent(slug)}`,
      { method: 'DELETE', headers: { Prefer: 'return=minimal' } }
    )
    if (!r.ok) {
      const body = await r.text().catch(() => '')
      console.error(`[book/pinned-chapters DELETE] supabase ${r.status}: ${body.slice(0, 300)}`)
      return res.status(500).json({ error: 'Unpin failed' })
    }
    return res.status(200).json({ ok: true, chapter_slug: slug })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}

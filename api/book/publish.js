// POST /api/book/publish
//
// Admin-only. Publishes the workspace's current book manuscript to the
// tenant's website via the Astro+GitHub publish lane, using a NEW `kind: 'book'`
// payload variant on the existing receiver contract.
//
// Contract additions vs. blog publish (kind: 'blog' or absent → backward-compatible):
//   • slug is fixed to 'book' — the receiver writes/overwrites a single page,
//     not a content-collection entry.
//   • Receivers that recognize kind:'book' MUST overwrite the existing file
//     (no slug-taken 409). Receivers that don't recognize the field SHOULD
//     return 400 invalid_payload so we surface "your site doesn't support
//     book publish yet" rather than silently appearing to succeed.
//   • Expected page path on the receiver: src/pages/book.astro (the receiver
//     owns the exact path; the contract only requires "render this manuscript
//     at /book on the public site").
//   • TOC: payload includes `chapters: [{ slug, title }]` so the receiver
//     can render a table of contents without re-parsing the markdown.
//
// WordPress branch is intentionally not implemented in v1 — equine deferred
// per the 2026-05-26 scoping conversation. WP-credentialed workspaces get a
// clear 501 with a message pointing at that decision.
//
// Runtime: nodejs. The receiver typically replies in ~2–5s (GitHub commit
// latency), so the default 300s ceiling is plenty of headroom.

export const config = { runtime: 'nodejs' }

import { withSentry } from '../_lib/sentry.js'
import { workspaceContext } from '../_lib/workspaceContext.js'
import { requireRole } from '../_lib/auth.js'
import { enforceLimit } from '../_lib/ratelimit.js'
import { getCredential } from '../_lib/getCredential.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  if (!(await enforceLimit(req, res, 'generic'))) return

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'workspace_not_resolved' })

  const auth = await requireRole(req, ['admin'], { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    const status = auth.reason === 'no-token' ? 401 : 403
    return res.status(status).json({ error: auth.reason })
  }

  // 1. Load the current book row.
  const bookRes = await fetch(
    `${SUPABASE_URL}/rest/v1/workspace_books` +
    `?workspace_id=eq.${ws.id}` +
    `&select=manuscript_md,chapters,last_regen_at,regen_status`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
  )
  if (!bookRes.ok) {
    const body = await bookRes.text().catch(() => '')
    console.error(`[book/publish] supabase ${bookRes.status}: ${body.slice(0, 300)}`)
    return res.status(500).json({ error: 'database_error' })
  }
  const rows = await bookRes.json()
  const book = rows[0]
  const manuscript = (book?.manuscript_md || '').trim()
  if (!manuscript) {
    return res.status(409).json({
      error:   'book_not_generated',
      message: 'The book has not been generated yet. Regenerate it first, then publish.',
    })
  }
  if (book?.regen_status === 'regenerating') {
    return res.status(409).json({
      error:   'book_regenerating',
      message: 'The book is currently regenerating. Wait for it to finish, then publish.',
    })
  }

  // 2. Pick the publish target. WordPress isn't supported in v1.
  const wpCred = await getCredential(ws.id, 'wordpress')
  if (wpCred?.secret && wpCred?.config?.user) {
    return res.status(501).json({
      error:   'wordpress_book_publish_not_implemented',
      message: 'Book publishing to WordPress is not implemented yet. Equine is deferred to a future PR; for now only Astro+GitHub-backed sites can receive the book.',
    })
  }

  const astroCred =
    (await getCredential(ws.id, 'astro_github')) ||
    (await getCredential(ws.id, 'website'))
  if (!astroCred?.secret) {
    return res.status(503).json({
      error:   'not_configured',
      message: `No Astro+GitHub publish target is configured for this workspace${ws.slug ? ` (${ws.slug})` : ''}. Add credentials in Workspace Settings → Publishing credentials.`,
    })
  }
  const receiverUrl = astroCred.config?.url
  if (!receiverUrl) {
    return res.status(503).json({
      error:   'not_configured',
      message: 'Astro+GitHub publish URL is not set in the workspace credential config.',
    })
  }

  // 3. Build the payload. `slug: 'book'` signals the overwrite path; older
  // receivers that don't yet handle kind:'book' will collide on a real blog
  // post named "book" and return 409 — surfaceable as a "receiver out of
  // date" error in the UI.
  const chapters = Array.isArray(book?.chapters) ? book.chapters : []
  const toc = chapters
    .filter((c) => c && typeof c.slug === 'string' && typeof c.title === 'string')
    .map((c) => ({ slug: c.slug, title: c.title }))

  const title = `${ws.display_name || ws.app_name || 'Our'} — Book`
  const description = `A living manuscript woven from ${ws.display_name || 'our practice'}'s interviews and original work.`
  const updatedDate = book?.last_regen_at || new Date().toISOString()

  const body = {
    kind:        'book',
    slug:        'book',
    title,
    description,
    pubDate:     updatedDate,
    updatedDate,
    markdown:    manuscript,
    chapters:    toc,
  }

  // 4. POST to receiver.
  let upstream
  try {
    upstream = await fetch(receiverUrl, {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${astroCred.secret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  } catch (e) {
    console.error('[book/publish] receiver network error:', e?.message)
    return res.status(502).json({
      error:   'network_error',
      message: `Could not reach the website: ${e?.message || 'unknown'}`,
    })
  }

  let data = {}
  try { data = await upstream.json() } catch { /* empty */ }

  if (upstream.status === 200 && data.success) {
    // Receiver returns postUrl (the live /book URL). Fall back to deriving it
    // from the receiver URL if the receiver hasn't been updated yet to send
    // postUrl for book payloads.
    const fallbackUrl = receiverUrl.replace(/\/api\/publish\/?$/, '/book')
    return res.status(200).json({
      success:    true,
      postUrl:    data.postUrl || fallbackUrl,
      commitUrl:  data.commitUrl || null,
    })
  }

  if (upstream.status === 400) {
    // Receiver is out of date — doesn't know about kind:'book' yet.
    const msg = data.message || ''
    if (/kind|book/i.test(msg)) {
      return res.status(409).json({
        error:   'receiver_out_of_date',
        message: 'The receiving website hasn\'t been updated to accept the book yet. Update its /api/publish receiver to handle kind:"book", then try again.',
      })
    }
    return res.status(400).json({ error: 'invalid_payload', message: data.message || 'Receiver rejected the payload.' })
  }
  if (upstream.status === 401) {
    return res.status(502).json({
      error:   'auth_failed',
      message: 'The website rejected the bearer token. Re-paste the Astro+GitHub secret in Workspace Settings.',
    })
  }
  if (upstream.status === 409) {
    return res.status(409).json({
      error:   'receiver_out_of_date',
      message: 'The website treated "book" as a duplicate blog slug, which means it hasn\'t been updated to handle kind:"book" yet. Update its /api/publish receiver first.',
    })
  }
  if (upstream.status >= 500 && upstream.status < 600) {
    return res.status(502).json({
      error:    upstream.status === 502 ? 'github_error' : 'website_misconfigured',
      message:  data.message || `Website returned ${upstream.status}.`,
      retriable: upstream.status === 502,
    })
  }

  return res.status(502).json({
    error:   'upstream_error',
    message: data.message || `Website returned ${upstream.status}.`,
    status:  upstream.status,
  })
}

export default withSentry(handler)

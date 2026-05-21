import { withSentry } from '../_lib/sentry.js'
export const config = { runtime: 'nodejs' }
// Beehiiv publish endpoint — Node.js runtime.
//
// Sends a blog piece to Beehiiv as a DRAFT post. The tenant finishes the
// post inside Beehiiv (thumbnail review, scheduling, audience picker,
// email-capture choice). This intentionally does NOT auto-send: first-touch
// newsletter publishes benefit from a human-in-the-loop review, and Beehiiv's
// own UI is the right surface for the segmentation + scheduling decisions.
//
// Credential shape (workspace_credentials row, service='beehiiv'):
//   { config: { publication_id: 'pub_xxx' }, secret: <api_key> }
//
// API contract used:
//   POST https://api.beehiiv.com/v2/publications/{publication_id}/posts
//     headers: Authorization: Bearer <api_key>
//     body:    { title, subtitle, body_content (HTML), status: 'draft',
//                thumbnail_url? }
//     returns: 201 { data: { id, web_url, status, ... } }
//
// Payload contract (callers pass these in):
//   title, markdown           — required
//   description / subtitle    — optional (used as Beehiiv subtitle)
//   heroImage                 — optional URL — sent as thumbnail_url
//   slug                      — optional (Beehiiv assigns its own slug; we
//                               echo this back so callers can correlate)
//
// Per the hybrid-storage decision (project_media_library_philosophy),
// heroImage is expected to be the web variant URL (resized, public). Beehiiv
// fetches it server-side to store as the post thumbnail.

import { marked } from 'marked'
import { getCredential } from '../_lib/getCredential.js'
import { workspaceScope } from '../_lib/workspaceScope.js'
import { enforceLimit } from '../_lib/ratelimit.js'

const BEEHIIV_API = 'https://api.beehiiv.com/v2'

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed', message: 'POST only' })
  }

  // Rate limit. enforceLimit returns TRUE when allowed, FALSE when limited
  // (and has already written the 429 response in the latter case).
  // See feedback_enforce_limit_polarity — easy to invert.
  if (!(await enforceLimit(req, res, 'publish-beehiiv'))) return

  const payload = (typeof req.body === 'object' && req.body) ? req.body : null
  if (!payload) {
    return res.status(400).json({ error: 'invalid_json', message: 'Request body is not valid JSON.' })
  }

  const required = ['title', 'markdown']
  const missing = required.filter((k) => !payload[k] || (typeof payload[k] === 'string' && !payload[k].trim()))
  if (missing.length) {
    return res.status(400).json({
      error:   'invalid_payload',
      message: `Missing required field(s): ${missing.join(', ')}`,
    })
  }

  const scope = await workspaceScope(req)
  const workspaceId = scope?.workspace?.id

  const cred = await getCredential(workspaceId, 'beehiiv')
  if (!cred?.secret) {
    return res.status(503).json({
      error:   'not_configured',
      message: `Beehiiv is not connected for this workspace${scope?.workspace?.slug ? ` (${scope.workspace.slug})` : ''}. Add a Beehiiv API key in Settings → Integrations → Beehiiv.`,
    })
  }
  const rawPublicationId = cred.config?.publication_id
  if (!rawPublicationId) {
    return res.status(503).json({
      error:   'not_configured',
      message: 'Beehiiv credential is missing the publication_id. Reconnect in Settings → Integrations → Beehiiv.',
    })
  }
  // Auto-normalize: Beehiiv's API requires the "pub_" prefix, but most users
  // paste the bare UUID from app.beehiiv.com/publications/<uuid>/... Accept
  // either form so we don't reject valid intent on a 7-char detail.
  const publicationId = String(rawPublicationId).startsWith('pub_')
    ? String(rawPublicationId)
    : `pub_${rawPublicationId}`

  // Beehiiv stores body_content as HTML. Inline images from the NarrateRx
  // blob store stay hot-linked — Beehiiv's renderer fetches and caches them
  // at send-time. We do NOT mirror images into Beehiiv's media library at
  // v1 (no public Beehiiv media API endpoint for inline images yet); the
  // tenant can re-upload from Beehiiv's editor if they want to.
  const html = markdownToHtml(payload.markdown)

  const body = {
    title:        payload.title,
    body_content: html,
    status:       'draft',
  }
  if (payload.description && typeof payload.description === 'string') {
    body.subtitle = payload.description.slice(0, 200)
  }
  if (payload.heroImage && typeof payload.heroImage === 'string') {
    body.thumbnail_url = payload.heroImage
  }
  if (Array.isArray(payload.tags) && payload.tags.length) {
    body.content_tags = payload.tags.map(String).slice(0, 10)
  }

  const tag = `[publish/beehiiv pub=${publicationId} slug=${payload.slug || '-'}]`

  let upstream
  try {
    upstream = await fetch(`${BEEHIIV_API}/publications/${encodeURIComponent(publicationId)}/posts`, {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${cred.secret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  } catch (e) {
    console.error(tag, 'network_error:', e.message)
    return res.status(502).json({
      error:   'network_error',
      message: `Could not reach Beehiiv: ${e.message}`,
    })
  }

  let data = {}
  try { data = await upstream.json() } catch { /* empty */ }

  if (upstream.status === 200 || upstream.status === 201) {
    const post = data?.data || data || {}
    return res.status(200).json({
      success:  true,
      postId:   post.id || null,
      postUrl:  post.web_url || null,
      status:   post.status || 'draft',
      // Echo the source slug back so the caller can correlate the Beehiiv
      // post with the originating NarrateRx piece. Beehiiv assigns its own
      // slug from the title; we don't try to override it.
      slug:     payload.slug || null,
    })
  }
  if (upstream.status === 401 || upstream.status === 403) {
    console.error(tag, 'auth_failed:', upstream.status, data?.errors || data?.message)
    return res.status(502).json({
      error:   'auth_failed',
      message: 'Beehiiv rejected the API key (401/403). Re-paste it in Settings → Integrations → Beehiiv.',
    })
  }
  if (upstream.status === 404) {
    console.error(tag, 'publication_not_found')
    return res.status(502).json({
      error:   'publication_not_found',
      message: `Beehiiv could not find publication ${publicationId}. Check the Publication ID in Settings → Integrations → Beehiiv.`,
    })
  }
  if (upstream.status === 400 || upstream.status === 422) {
    const msg = beehiivErrorMessage(data) || 'Beehiiv rejected the payload as invalid.'
    console.error(tag, 'invalid_payload:', msg)
    return res.status(400).json({ error: 'invalid_payload', message: msg })
  }
  if (upstream.status === 429) {
    console.error(tag, 'rate_limited')
    return res.status(502).json({
      error:     'rate_limited',
      message:   'Beehiiv rate-limited the request. Wait a minute and try again.',
      retriable: true,
    })
  }
  console.error(tag, 'upstream_error:', upstream.status, data?.errors || data?.message)
  return res.status(502).json({
    error:   'upstream_error',
    message: beehiivErrorMessage(data) || `Beehiiv returned ${upstream.status}.`,
    status:  upstream.status,
  })
}

// Beehiiv returns errors as either { errors: [{ message }] } or { message }
// depending on the failure mode. Normalize.
function beehiivErrorMessage(data) {
  if (!data || typeof data !== 'object') return null
  if (Array.isArray(data.errors) && data.errors[0]?.message) return data.errors[0].message
  if (typeof data.message === 'string') return data.message
  return null
}

function markdownToHtml(md) {
  // Beehiiv's body_content accepts a wide range of HTML. We render with
  // marked the same way the WordPress path does — GFM on, breaks off
  // (paragraphs separated by blank lines, matching CMS expectations).
  return marked.parse(md, { gfm: true, breaks: false })
}

export default withSentry(handler)

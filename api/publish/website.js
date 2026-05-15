import { withSentry } from '../_lib/sentry.js'
export const config = { runtime: 'nodejs' }
// Website publish endpoint — Node.js runtime.
//
// Two receiving modes are supported, dispatched on which credential the
// workspace has configured (resolved per-workspace via getCredential):
//
//   • WordPress mode (equine → movebetterequine.com)
//     getCredential('wordpress') = { config: { site_url, user }, secret: app_password }
//     site_url must include /wp-json/ — e.g. https://example.com/wp-json/wp/v2/posts.
//     Calls the WP REST API directly: markdown → HTML, hero upload to /media,
//     tag-name → term-ID resolution. HTTP Basic + WP Application Password.
//
//   • Astro mode (animals → movebetteranimalchiro.com)
//     getCredential('astro_github') = { config: { url }, secret: shared_secret }
//     POSTs JSON to a single webhook on the receiving site, which commits a
//     markdown file to GitHub and lets Vercel rebuild. Contract:
//     docs/api-publish-contract.md in the movebetteranimal repo.
//
// Mode selection: if 'wordpress' creds resolve, use WP. Else if 'astro_github'
// or generic 'website' creds resolve, use Astro. The legacy env-var fallback in
// getCredential keeps per-brand deployments working — WORDPRESS_USER/PASSWORD
// surfaces as 'wordpress' creds, NARRATERX_PUBLISH_SECRET as 'website'.

import { marked } from 'marked'
import { getCredential } from '../_lib/getCredential.js'
import { workspaceScope } from '../_lib/workspaceScope.js'
import { rewriteMarkdownImageUrls } from '../_lib/publishImageMirror.js'

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed', message: 'POST only' })

  const payload = (typeof req.body === 'object' && req.body) ? req.body : null
  if (!payload) return res.status(400).json({ error: 'invalid_json', message: 'Request body is not valid JSON.' })

  const required = ['slug', 'title', 'description', 'pubDate', 'markdown']
  const missing = required.filter((k) => !payload[k] || (typeof payload[k] === 'string' && !payload[k].trim()))
  if (missing.length) {
    return res.status(400).json({ error: 'invalid_payload', message: `Missing required field(s): ${missing.join(', ')}` })
  }

  const scope = await workspaceScope(req)
  const workspaceId = scope?.workspace?.id

  const wpCred = await getCredential(workspaceId, 'wordpress')
  if (wpCred?.secret && wpCred?.config?.user) {
    return publishToWordPress(res, payload, wpCred)
  }

  const astroCred =
    (await getCredential(workspaceId, 'astro_github')) ||
    (await getCredential(workspaceId, 'website'))
  if (astroCred?.secret) {
    return publishToAstro(res, payload, astroCred)
  }

  return res.status(503).json({
    error:   'not_configured',
    message: `No publish target is configured for this workspace${scope?.workspace?.slug ? ` (${scope.workspace.slug})` : ''}. Add WordPress or Astro+GitHub credentials in Workspace Settings → Publishing credentials.`,
  })
}

// ── Astro mode ────────────────────────────────────────────────────────────────

async function publishToAstro(res, payload, cred) {
  const secret = cred.secret
  const url = cred.config?.url
  if (!url) {
    return res.status(503).json({ error: 'not_configured', message: 'Astro+GitHub publish URL is not set in the workspace credential config.' })
  }

  const body = {
    slug:        payload.slug,
    title:       payload.title,
    description: payload.description,
    pubDate:     payload.pubDate,
    markdown:    payload.markdown,
  }
  if (payload.updatedDate)  body.updatedDate  = payload.updatedDate
  if (payload.author)       body.author       = payload.author
  if (payload.heroImage)    body.heroImage    = payload.heroImage
  if (payload.heroImageAlt) body.heroImageAlt = payload.heroImageAlt
  if (Array.isArray(payload.tags) && payload.tags.length) body.tags = payload.tags
  if (typeof payload.draft === 'boolean') body.draft = payload.draft
  // Inline image manifest — each entry is { url, alt, filename, mirrorable }.
  // Receivers committing to GitHub should fetch each `url`, write the bytes
  // to `src/assets/blog/<slug>/<filename>`, and rewrite the markdown's
  // `![alt](url)` → `![alt](./<filename>)` (or `~/assets/...`) before committing.
  // Older receivers that ignore the field still render correctly via hotlinks.
  if (Array.isArray(payload.images) && payload.images.length) body.images = payload.images
  // Kebab-case topic slug — used by movebetter.co's blog schema (mapped
  // into `topic` frontmatter on receive). Animal's receiver ignores
  // unknown fields, so this is safe for both tenants.
  if (typeof payload.topic === 'string' && payload.topic.trim()) body.topic = payload.topic.trim()

  let upstream
  try {
    upstream = await fetch(url, {
      method:  'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })
  } catch (e) {
    return res.status(502).json({ error: 'network_error', message: `Could not reach the website: ${e.message}` })
  }

  let data = {}
  try { data = await upstream.json() } catch { /* empty */ }

  if (upstream.status === 200 && data.success) {
    return res.status(200).json({ success: true, slug: data.slug, commitUrl: data.commitUrl, postUrl: data.postUrl })
  }
  if (upstream.status === 409) {
    return res.status(409).json({ error: 'slug_taken', slug: payload.slug, message: data.message || `The slug "${payload.slug}" is already published. Rename and try again — the website never overwrites.` })
  }
  if (upstream.status === 400) {
    return res.status(400).json({ error: 'invalid_payload', message: data.message || 'The website rejected the payload as invalid.', issues: data.issues })
  }
  if (upstream.status === 401) {
    return res.status(502).json({ error: 'auth_failed', message: 'The website rejected the bearer token. Re-paste the Astro+GitHub secret in Workspace Settings.' })
  }
  if (upstream.status === 500) {
    return res.status(502).json({ error: 'website_misconfigured', message: data.message || 'The website is misconfigured (missing GitHub token or env vars). Not retriable from here.' })
  }
  if (upstream.status === 502) {
    return res.status(502).json({ error: 'github_error', message: data.message || 'The website could not commit to GitHub. Safe to retry shortly.', retriable: true })
  }
  return res.status(502).json({ error: 'upstream_error', message: data.message || `Website returned ${upstream.status}.`, status: upstream.status })
}

// ── WordPress mode ────────────────────────────────────────────────────────────

async function publishToWordPress(res, payload, cred) {
  const baseUrl = cred.config?.site_url
  if (!baseUrl) {
    return res.status(503).json({ error: 'not_configured', message: 'WordPress site_url is not set in the workspace credential config. It must point at /wp-json/wp/v2/posts on the receiving site.' })
  }
  const wpRoot = wpRestRoot(baseUrl)
  if (!wpRoot) {
    return res.status(503).json({ error: 'not_configured', message: `WordPress site_url must include /wp-json/ (got ${baseUrl}). Expected something like https://example.com/wp-json/wp/v2/posts.` })
  }

  const user = cred.config?.user
  const appPassword = String(cred.secret || '').replace(/\s+/g, '')
  const authHeader = `Basic ${base64(`${user}:${appPassword}`)}`
  const wp = (path, init = {}) => fetch(`${wpRoot}${path}`, {
    ...init,
    headers: { Authorization: authHeader, ...(init.headers || {}) },
  })

  const tag = `[publish/website slug=${payload.slug}]`

  // 1. Slug collision check — WP auto-suffixes duplicate slugs by default;
  // we explicitly reject so the UI can prompt for a rename, matching the
  // animals-side "never overwrite" contract.
  try {
    const collisionRes = await wp(`/wp/v2/posts?slug=${encodeURIComponent(payload.slug)}&status=any&per_page=1&_fields=id,slug,link`)
    if (collisionRes.ok) {
      const existing = await collisionRes.json()
      if (Array.isArray(existing) && existing.length) {
        console.error(tag, 'slug_taken')
        return res.status(409).json({ error: 'slug_taken', slug: payload.slug, message: `The slug "${payload.slug}" is already used on the website. Rename and try again.` })
      }
    } else if (collisionRes.status === 401 || collisionRes.status === 403) {
      console.error(tag, 'auth_failed on collision check:', collisionRes.status)
      return res.status(502).json({ error: 'auth_failed', message: 'The WordPress site rejected the credentials. Re-paste WordPress user / app password in Workspace Settings.' })
    }
  } catch (e) {
    console.error(tag, 'network_error on collision check:', e.message)
    return res.status(502).json({ error: 'network_error', message: `Could not reach WordPress: ${e.message}` })
  }

  // 2. Hero image — fetch the source URL, upload binary to /media, capture
  // the media ID and (optionally) set its alt text.
  let featuredMediaId = null
  if (payload.heroImage) {
    try {
      const media = await uploadMedia(wp, payload.heroImage, payload.heroImageAlt)
      featuredMediaId = media.id
    } catch (e) {
      console.error(tag, 'media_upload_failed (hero):', e.message)
      return res.status(502).json({ error: 'media_upload_failed', message: `Hero image upload failed: ${e.message}` })
    }
  }

  // 3. Tags — resolve each name to an ID, creating tags that don't exist.
  let tagIds = []
  if (Array.isArray(payload.tags) && payload.tags.length) {
    try {
      tagIds = await resolveTags(wp, payload.tags)
    } catch (e) {
      console.error(tag, 'tag_resolve_failed:', e.message)
      return res.status(502).json({ error: 'tag_resolve_failed', message: `Tag resolution failed: ${e.message}` })
    }
  }

  // 4. Inline body images — mirror each into the WordPress Media Library and
  // build a {oldUrl → newWpUrl} map. The markdown body is rewritten so the
  // emitted HTML references WP-hosted images, severing the dependency on
  // NarrateRx blob storage. Non-mirrorable URLs (external CDNs, etc.) are
  // left as hotlinks.
  let mirroredMarkdown = payload.markdown
  if (Array.isArray(payload.images) && payload.images.length) {
    const urlMap = {}
    for (const img of payload.images) {
      if (!img?.url || img.mirrorable === false) continue
      try {
        const wpMediaUrl = await uploadMediaForRewrite(wp, img.url, img.alt)
        if (wpMediaUrl) urlMap[img.url] = wpMediaUrl
      } catch (e) {
        console.error(tag, 'media_upload_failed (inline):', img.url, e.message)
        return res.status(502).json({ error: 'media_upload_failed', message: `Inline image upload failed for ${img.url}: ${e.message}` })
      }
    }
    mirroredMarkdown = rewriteMarkdownImageUrls(payload.markdown, urlMap)
  }

  // 5. Create the post.
  const html = markdownToHtml(mirroredMarkdown)
  const postBody = {
    title:   payload.title,
    slug:    payload.slug,
    status:  payload.draft ? 'draft' : 'publish',
    content: html,
    excerpt: payload.description,
    date:    isoDate(payload.pubDate),
  }
  if (featuredMediaId) postBody.featured_media = featuredMediaId
  if (tagIds.length)   postBody.tags = tagIds

  let postRes
  try {
    postRes = await wp('/wp/v2/posts', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(postBody),
    })
  } catch (e) {
    console.error(tag, 'network_error on post create:', e.message)
    return res.status(502).json({ error: 'network_error', message: `Could not reach WordPress: ${e.message}` })
  }

  let postData = {}
  try { postData = await postRes.json() } catch { /* empty */ }

  if (postRes.status === 201 || postRes.status === 200) {
    return res.status(200).json({
      success: true,
      slug:    postData.slug || payload.slug,
      postUrl: postData.link,
      postId:  postData.id,
    })
  }
  if (postRes.status === 401 || postRes.status === 403) {
    console.error(tag, 'auth_failed on post create:', postRes.status)
    return res.status(502).json({ error: 'auth_failed', message: 'WordPress rejected the credentials. The Application Password may be revoked or the user lacks publish_posts permission.' })
  }
  if (postRes.status === 400) {
    console.error(tag, 'invalid_payload on post create:', postData.message, postData.code)
    return res.status(400).json({ error: 'invalid_payload', message: postData.message || 'WordPress rejected the post as invalid.', code: postData.code })
  }
  console.error(tag, 'upstream_error on post create:', postRes.status, postData.message)
  return res.status(502).json({ error: 'upstream_error', message: postData.message || `WordPress returned ${postRes.status}.`, status: postRes.status })
}

async function uploadMedia(wp, sourceUrl, altText, overrideFilename = null) {
  const sourceRes = await fetch(sourceUrl)
  if (!sourceRes.ok) throw new Error(`Could not download image from ${sourceUrl} (${sourceRes.status})`)
  const contentType = sourceRes.headers.get('content-type') || 'application/octet-stream'
  const bytes = await sourceRes.arrayBuffer()
  const filename = overrideFilename || filenameFromUrl(sourceUrl, contentType)

  const uploadRes = await wp('/wp/v2/media', {
    method:  'POST',
    headers: {
      'Content-Type':        contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
    body: Buffer.from(bytes),
  })
  if (!uploadRes.ok) {
    const errText = await uploadRes.text().catch(() => '')
    throw new Error(`media POST returned ${uploadRes.status}: ${errText.slice(0, 200)}`)
  }
  const media = await uploadRes.json()

  if (altText) {
    await wp(`/wp/v2/media/${media.id}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ alt_text: altText }),
    }).catch(() => {})
  }
  return { id: media.id, source_url: media.source_url }
}

// Thin wrapper used by the inline-image rewrite path — returns the WP-hosted
// URL so the markdown can be rewritten to point at it.
async function uploadMediaForRewrite(wp, sourceUrl, altText) {
  const media = await uploadMedia(wp, sourceUrl, altText)
  return media.source_url || null
}

async function resolveTags(wp, names) {
  const ids = []
  for (const raw of names) {
    const name = String(raw).trim()
    if (!name) continue
    const searchRes = await wp(`/wp/v2/tags?search=${encodeURIComponent(name)}&per_page=20&_fields=id,name`)
    let existing = []
    if (searchRes.ok) existing = await searchRes.json()
    const lower = name.toLowerCase()
    const match = existing.find((t) => String(t.name).toLowerCase() === lower)
    if (match) {
      ids.push(match.id)
      continue
    }
    const createRes = await wp('/wp/v2/tags', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name }),
    })
    if (createRes.ok) {
      const created = await createRes.json()
      ids.push(created.id)
    } else if (createRes.status === 400) {
      // term_exists race — re-fetch by exact name.
      const refetch = await wp(`/wp/v2/tags?search=${encodeURIComponent(name)}&per_page=20&_fields=id,name`)
      if (refetch.ok) {
        const list = await refetch.json()
        const m = list.find((t) => String(t.name).toLowerCase() === lower)
        if (m) ids.push(m.id)
      }
    } else {
      throw new Error(`tag create returned ${createRes.status} for "${name}"`)
    }
  }
  return ids
}

// ── helpers ───────────────────────────────────────────────────────────────────

function wpRestRoot(url) {
  const idx = url.indexOf('/wp-json/')
  if (idx < 0) return null
  return url.slice(0, idx + '/wp-json'.length)
}

function base64(str) {
  return Buffer.from(str, 'utf8').toString('base64')
}

function isoDate(input) {
  // Accept either YYYY-MM-DD (from the date input) or a full ISO string. WP
  // accepts ISO 8601; pad bare dates to noon UTC so the post doesn't slip into
  // the prior day in western timezones.
  if (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input)) {
    return `${input}T12:00:00`
  }
  return input
}

function filenameFromUrl(url, contentType) {
  try {
    const u = new URL(url)
    const last = u.pathname.split('/').pop() || 'image'
    if (last.includes('.')) return last
    const ext = (contentType.split('/')[1] || 'jpg').split(';')[0]
    return `${last}.${ext}`
  } catch {
    const ext = (contentType.split('/')[1] || 'jpg').split(';')[0]
    return `image.${ext}`
  }
}

function markdownToHtml(md) {
  // marked v12 sync API. GFM is on by default; breaks: false matches the
  // semantics readers expect from a CMS (paragraphs separated by blank lines).
  return marked.parse(md, { gfm: true, breaks: false })
}

export default withSentry(handler)

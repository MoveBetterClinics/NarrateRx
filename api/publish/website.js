import { marked } from 'marked'

export const config = { runtime: 'edge' }

// Publishes a generated blog post to the workspace's marketing site. Two
// receiving modes are supported, dispatched on env vars set by each
// workspace's deployment:
//
//   • Astro mode (animals → movebetteranimal.co)
//     Required: NARRATERX_PUBLISH_SECRET, WEBSITE_PUBLISH_URL
//     Posts JSON to a single webhook on the receiving site, which commits a
//     markdown file to GitHub and lets Vercel rebuild. Contract:
//     docs/api-publish-contract.md in the movebetteranimal repo.
//
//   • WordPress mode (equine → movebetterequine.com)
//     Required: WORDPRESS_USER, WORDPRESS_APP_PASSWORD, WEBSITE_PUBLISH_URL
//     (URL must point at /wp-json/wp/v2/posts). Calls the WP REST API directly,
//     converting markdown → HTML, uploading the hero image to the media library,
//     and resolving tag names to term IDs. Authenticates with HTTP Basic and a
//     WordPress Application Password.
//
// Mode selection: presence of WORDPRESS_USER + WORDPRESS_APP_PASSWORD switches
// to WordPress mode. Otherwise falls back to Astro mode (existing animals flow).

const ok  = (data)              => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } })
const err = (body, status = 400) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

export default async function handler(req) {
  if (req.method !== 'POST') return err({ error: 'method_not_allowed', message: 'POST only' }, 405)

  let payload
  try {
    payload = await req.json()
  } catch {
    return err({ error: 'invalid_json', message: 'Request body is not valid JSON.' }, 400)
  }

  const required = ['slug', 'title', 'description', 'pubDate', 'markdown']
  const missing = required.filter((k) => !payload[k] || (typeof payload[k] === 'string' && !payload[k].trim()))
  if (missing.length) {
    return err({ error: 'invalid_payload', message: `Missing required field(s): ${missing.join(', ')}` }, 400)
  }

  if (process.env.WORDPRESS_USER && process.env.WORDPRESS_APP_PASSWORD) {
    return publishToWordPress(payload)
  }

  if (process.env.NARRATERX_PUBLISH_SECRET) {
    return publishToAstro(payload)
  }

  return err({
    error:   'not_configured',
    message: 'No publish target is configured. Set WORDPRESS_USER + WORDPRESS_APP_PASSWORD (WordPress mode) or NARRATERX_PUBLISH_SECRET (Astro mode) on this Vercel deployment.',
  }, 503)
}

// ── Astro mode ────────────────────────────────────────────────────────────────

async function publishToAstro(payload) {
  const secret = process.env.NARRATERX_PUBLISH_SECRET
  const url = process.env.WEBSITE_PUBLISH_URL
  if (!url) {
    return err({ error: 'not_configured', message: 'WEBSITE_PUBLISH_URL is not set on this NarrateRx deployment.' }, 503)
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

  let upstream
  try {
    upstream = await fetch(url, {
      method:  'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })
  } catch (e) {
    return err({ error: 'network_error', message: `Could not reach the website: ${e.message}` }, 502)
  }

  let data = {}
  try { data = await upstream.json() } catch {}

  if (upstream.status === 200 && data.success) {
    return ok({ success: true, slug: data.slug, commitUrl: data.commitUrl, postUrl: data.postUrl })
  }
  if (upstream.status === 409) {
    return err({ error: 'slug_taken', slug: payload.slug, message: data.message || `The slug "${payload.slug}" is already published. Rename and try again — the website never overwrites.` }, 409)
  }
  if (upstream.status === 400) {
    return err({ error: 'invalid_payload', message: data.message || 'The website rejected the payload as invalid.', issues: data.issues }, 400)
  }
  if (upstream.status === 401) {
    return err({ error: 'auth_failed', message: 'The website rejected the bearer token. Check that NARRATERX_PUBLISH_SECRET on this deployment matches the secret set on the website.' }, 502)
  }
  if (upstream.status === 500) {
    return err({ error: 'website_misconfigured', message: data.message || 'The website is misconfigured (missing GitHub token or env vars). Not retriable from here.' }, 502)
  }
  if (upstream.status === 502) {
    return err({ error: 'github_error', message: data.message || 'The website could not commit to GitHub. Safe to retry shortly.', retriable: true }, 502)
  }
  return err({ error: 'upstream_error', message: data.message || `Website returned ${upstream.status}.`, status: upstream.status }, 502)
}

// ── WordPress mode ────────────────────────────────────────────────────────────

async function publishToWordPress(payload) {
  const baseUrl = process.env.WEBSITE_PUBLISH_URL
  if (!baseUrl) {
    return err({ error: 'not_configured', message: 'WEBSITE_PUBLISH_URL is not set. For WordPress mode it must point at /wp-json/wp/v2/posts on the receiving site.' }, 503)
  }
  const wpRoot = wpRestRoot(baseUrl)
  if (!wpRoot) {
    return err({ error: 'not_configured', message: `WEBSITE_PUBLISH_URL must include /wp-json/ (got ${baseUrl}). Expected something like https://example.com/wp-json/wp/v2/posts.` }, 503)
  }

  const user = process.env.WORDPRESS_USER
  const appPassword = process.env.WORDPRESS_APP_PASSWORD.replace(/\s+/g, '')
  const authHeader = `Basic ${base64(`${user}:${appPassword}`)}`
  const wp = (path, init = {}) => fetch(`${wpRoot}${path}`, {
    ...init,
    headers: { Authorization: authHeader, ...(init.headers || {}) },
  })

  // 1. Slug collision check — WP auto-suffixes duplicate slugs by default;
  // we explicitly reject so the UI can prompt for a rename, matching the
  // animals-side "never overwrite" contract.
  try {
    const collisionRes = await wp(`/wp/v2/posts?slug=${encodeURIComponent(payload.slug)}&status=any&per_page=1&_fields=id,slug,link`)
    if (collisionRes.ok) {
      const existing = await collisionRes.json()
      if (Array.isArray(existing) && existing.length) {
        return err({ error: 'slug_taken', slug: payload.slug, message: `The slug "${payload.slug}" is already used on the website. Rename and try again.` }, 409)
      }
    } else if (collisionRes.status === 401 || collisionRes.status === 403) {
      return err({ error: 'auth_failed', message: 'The WordPress site rejected the credentials. Check WORDPRESS_USER / WORDPRESS_APP_PASSWORD on this Vercel deployment.' }, 502)
    }
  } catch (e) {
    return err({ error: 'network_error', message: `Could not reach WordPress: ${e.message}` }, 502)
  }

  // 2. Hero image — fetch the source URL, upload binary to /media, capture
  // the media ID and (optionally) set its alt text.
  let featuredMediaId = null
  if (payload.heroImage) {
    try {
      featuredMediaId = await uploadMedia(wp, payload.heroImage, payload.heroImageAlt)
    } catch (e) {
      return err({ error: 'media_upload_failed', message: `Hero image upload failed: ${e.message}` }, 502)
    }
  }

  // 3. Tags — resolve each name to an ID, creating tags that don't exist.
  let tagIds = []
  if (Array.isArray(payload.tags) && payload.tags.length) {
    try {
      tagIds = await resolveTags(wp, payload.tags)
    } catch (e) {
      return err({ error: 'tag_resolve_failed', message: `Tag resolution failed: ${e.message}` }, 502)
    }
  }

  // 4. Create the post.
  const html = markdownToHtml(payload.markdown)
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
    return err({ error: 'network_error', message: `Could not reach WordPress: ${e.message}` }, 502)
  }

  let postData = {}
  try { postData = await postRes.json() } catch {}

  if (postRes.status === 201 || postRes.status === 200) {
    return ok({
      success: true,
      slug:    postData.slug || payload.slug,
      postUrl: postData.link,
      postId:  postData.id,
    })
  }
  if (postRes.status === 401 || postRes.status === 403) {
    return err({ error: 'auth_failed', message: 'WordPress rejected the credentials. The Application Password may be revoked or the user lacks publish_posts permission.' }, 502)
  }
  if (postRes.status === 400) {
    return err({ error: 'invalid_payload', message: postData.message || 'WordPress rejected the post as invalid.', code: postData.code }, 400)
  }
  return err({ error: 'upstream_error', message: postData.message || `WordPress returned ${postRes.status}.`, status: postRes.status }, 502)
}

async function uploadMedia(wp, sourceUrl, altText) {
  const sourceRes = await fetch(sourceUrl)
  if (!sourceRes.ok) throw new Error(`Could not download image from ${sourceUrl} (${sourceRes.status})`)
  const contentType = sourceRes.headers.get('content-type') || 'application/octet-stream'
  const bytes = await sourceRes.arrayBuffer()
  const filename = filenameFromUrl(sourceUrl, contentType)

  const uploadRes = await wp('/wp/v2/media', {
    method:  'POST',
    headers: {
      'Content-Type':        contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
    body: bytes,
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
  return media.id
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
  // Edge runtime exposes btoa, but it only handles latin-1. App passwords are
  // ASCII so this is safe; user names theoretically could contain non-ASCII —
  // encode through TextEncoder to be defensive.
  const bytes = new TextEncoder().encode(str)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
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

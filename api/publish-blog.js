// Inbound publish webhook for narraterx.ai's own blog.
//
// Mirrors the receive side of the Astro+GitHub publish contract that
// api/publish/website.js → publishToAstro() sends to. Lets a Studio
// workspace push approved blog posts straight into Move-Better/NarrateRx's
// src/content/blog/<slug>.md, which scripts/build-blog.mjs picks up at the
// next Vercel deploy.
//
// Auth: Bearer <NARRATERX_PUBLISH_SECRET>. The shared secret is configured
// once in this project's env vars (Sensitive) and pasted into the calling
// workspace's astro_github credential.
//
// GitHub: commits via Contents API using GITHUB_TOKEN_NARRATERX_PUBLISH
// (Sensitive, fine-grained PAT scoped to Move-Better/NarrateRx with
// `contents: read+write`). Never overwrites — duplicate slug → 409.
//
// Contract (response codes mirror what publishToAstro() expects):
//   200  { success: true, slug, commitUrl, postUrl }
//   400  { error: 'invalid_payload', message, issues[] }
//   401  { error: 'unauthorized', message }
//   409  { error: 'slug_taken', slug, message }
//   500  { error: 'misconfigured', message }          — env vars missing
//   502  { error: 'github_error', message, retriable } — transient upstream

export const config = { runtime: 'nodejs', maxDuration: 30 }

import { enforceLimit } from './_lib/ratelimit.js'

const REPO_OWNER = 'Move-Better'
const REPO_NAME  = 'NarrateRx'
const REPO_BRANCH = 'main'
const CONTENT_PATH_PREFIX = 'src/content/blog'

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/

function yamlQuote(s) {
  // Quote a string with double quotes for YAML, escaping backslashes and quotes.
  return `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function buildMarkdownFile(data) {
  const fm = []
  fm.push(`title: ${yamlQuote(data.title)}`)
  fm.push(`description: ${yamlQuote(data.description)}`)
  fm.push(`pubDate: ${data.pubDate}`)
  if (data.updatedDate)  fm.push(`updatedDate: ${data.updatedDate}`)
  if (data.author)       fm.push(`author: ${yamlQuote(data.author)}`)
  if (data.heroImage)    fm.push(`hero: ${yamlQuote(data.heroImage)}`)
  if (data.heroImageAlt) fm.push(`heroAlt: ${yamlQuote(data.heroImageAlt)}`)
  if (Array.isArray(data.tags) && data.tags.length) {
    fm.push(`tags: [${data.tags.map(yamlQuote).join(', ')}]`)
  }
  if (typeof data.draft === 'boolean') fm.push(`draft: ${data.draft}`)
  if (data.topic) fm.push(`topic: ${yamlQuote(data.topic)}`)
  return `---\n${fm.join('\n')}\n---\n\n${String(data.markdown).trimEnd()}\n`
}

function timingSafeEqual(a, b) {
  // Constant-time string comparison for secret validation. Node has
  // crypto.timingSafeEqual but it requires Buffer args of equal length;
  // this version handles unequal lengths without short-circuiting.
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const max = Math.max(a.length, b.length)
  let mismatch = a.length === b.length ? 0 : 1
  for (let i = 0; i < max; i++) {
    mismatch |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  }
  return mismatch === 0
}

const GH_HEADERS_BASE = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'narraterx-publish-blog/1.0',
}

async function githubGet(token, path) {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}?ref=${encodeURIComponent(REPO_BRANCH)}`
  return fetch(url, { headers: { ...GH_HEADERS_BASE, Authorization: `Bearer ${token}` } })
}

async function githubPut(token, path, content, message) {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`
  return fetch(url, {
    method: 'PUT',
    headers: { ...GH_HEADERS_BASE, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      content: Buffer.from(content, 'utf8').toString('base64'),
      branch: REPO_BRANCH,
    }),
  })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed', message: 'POST only' })
  }

  const limited = await enforceLimit(req, res, 'publish-blog-inbound')
  if (limited) return

  const expectedSecret = process.env.NARRATERX_PUBLISH_SECRET
  const ghToken        = process.env.GITHUB_TOKEN_NARRATERX_PUBLISH
  if (!expectedSecret || !ghToken) {
    console.error('[publish-blog] env missing:', { hasSecret: !!expectedSecret, hasToken: !!ghToken })
    return res.status(500).json({
      error: 'misconfigured',
      message: 'narraterx.ai publish webhook is missing env vars (NARRATERX_PUBLISH_SECRET and/or GITHUB_TOKEN_NARRATERX_PUBLISH). Not retriable from the client.',
    })
  }

  const authHeader = req.headers['authorization'] || ''
  const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
  if (!timingSafeEqual(provided, expectedSecret)) {
    return res.status(401).json({ error: 'unauthorized', message: 'Bearer token did not match the configured shared secret.' })
  }

  const payload = (typeof req.body === 'object' && req.body) ? req.body : null
  if (!payload) {
    return res.status(400).json({ error: 'invalid_payload', message: 'Request body must be JSON.', issues: ['body parse failed'] })
  }

  const issues = []
  const required = ['slug', 'title', 'description', 'pubDate', 'markdown']
  for (const k of required) {
    if (!payload[k] || (typeof payload[k] === 'string' && !payload[k].trim())) issues.push(`${k} required`)
  }
  if (payload.slug && !SLUG_RE.test(payload.slug)) {
    issues.push('slug must be lowercase alphanumeric + hyphens (matches /^[a-z0-9][a-z0-9-]*$/)')
  }
  if (issues.length) {
    return res.status(400).json({ error: 'invalid_payload', message: 'Validation failed.', issues })
  }

  const slug = payload.slug
  const filePath = `${CONTENT_PATH_PREFIX}/${slug}.md`
  const tag = `[publish-blog slug=${slug}]`

  // 1. Existence check — never overwrite.
  let existsResp
  try {
    existsResp = await githubGet(ghToken, filePath)
  } catch (e) {
    console.error(tag, 'github existence-check network error:', e?.message)
    return res.status(502).json({ error: 'github_error', message: `Could not reach GitHub: ${e.message}`, retriable: true })
  }
  if (existsResp.ok) {
    return res.status(409).json({
      error: 'slug_taken',
      slug,
      message: `The slug "${slug}" is already published at ${filePath}. Rename and try again — the website never overwrites.`,
    })
  }
  if (existsResp.status === 401 || existsResp.status === 403) {
    console.error(tag, `github auth ${existsResp.status} on existence check`)
    return res.status(500).json({
      error: 'misconfigured',
      message: 'The GitHub token lacks contents access on Move-Better/NarrateRx. Regenerate the PAT with `Contents: read+write` and re-paste in Vercel env.',
    })
  }
  if (existsResp.status !== 404) {
    const body = await existsResp.text().catch(() => '')
    console.error(tag, `github existence-check ${existsResp.status}:`, body.slice(0, 500))
    return res.status(502).json({ error: 'github_error', message: `GitHub returned ${existsResp.status} on existence check.`, retriable: true })
  }

  // 2. Build the markdown file content.
  const fileContent = buildMarkdownFile(payload)
  const commitMessage = `feat(blog): publish ${slug}\n\nPushed via the publish webhook from a NarrateRx Studio workspace.`

  // 3. Commit via Contents API.
  let putResp
  try {
    putResp = await githubPut(ghToken, filePath, fileContent, commitMessage)
  } catch (e) {
    console.error(tag, 'github PUT network error:', e?.message)
    return res.status(502).json({ error: 'github_error', message: `Could not reach GitHub: ${e.message}`, retriable: true })
  }

  let putData = {}
  try { putData = await putResp.json() } catch { /* empty */ }

  if (!putResp.ok) {
    console.error(tag, `github PUT ${putResp.status}:`, JSON.stringify(putData).slice(0, 500))
    if (putResp.status === 401 || putResp.status === 403) {
      return res.status(500).json({ error: 'misconfigured', message: 'The GitHub token lacks contents:write. Update PAT permissions and re-paste.' })
    }
    if (putResp.status === 422) {
      return res.status(409).json({ error: 'slug_taken', slug, message: putData.message || 'GitHub rejected the file — likely a race condition with another publish. Try again.' })
    }
    return res.status(502).json({ error: 'github_error', message: putData.message || `GitHub returned ${putResp.status}.`, retriable: true })
  }

  return res.status(200).json({
    success:   true,
    slug,
    commitUrl: putData?.commit?.html_url || null,
    postUrl:   `https://narraterx.ai/blog/${slug}`,
  })
}

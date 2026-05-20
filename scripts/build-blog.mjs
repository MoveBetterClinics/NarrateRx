#!/usr/bin/env node
// Build static blog HTML for narraterx.ai from markdown sources.
//
//   Source:    src/content/blog/<slug>.md  (frontmatter + markdown body)
//   Generated: public/blog/<slug>.html     (per-post page)
//              public/blog.html            (index, lists all posts by date desc)
//
// Runs as part of `npm run build` (see package.json — chained before vite build).
// Re-runnable and idempotent: deletes + regenerates public/blog/*.html each run.
//
// Frontmatter (YAML-like, parsed manually — no extra dep):
//   ---
//   title: Why I built NarrateRx
//   description: One paragraph (140-160 chars) for meta + OG.
//   pubDate: 2026-05-19
//   slug: why-i-built-narraterx        # optional; defaults to filename
//   updatedDate: 2026-05-20            # optional
//   hero: /brand/narraterx-icon-1024.png # optional
//   ---
//
// Markdown is rendered with `marked` (already a dep — see api/publish/website.js).

import { readFile, writeFile, readdir, mkdir, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, basename, extname } from 'node:path'
import { marked } from 'marked'

const ROOT = process.cwd()
const SRC_DIR = join(ROOT, 'src/content/blog')
const OUT_DIR = join(ROOT, 'public/blog')
const INDEX_OUT = join(ROOT, 'public/blog.html')

function parseFrontmatter(raw) {
  if (!raw.startsWith('---')) {
    throw new Error('Missing frontmatter — first line must be `---`')
  }
  const end = raw.indexOf('\n---', 3)
  if (end < 0) throw new Error('Unterminated frontmatter — no closing `---` line found')
  const block = raw.slice(3, end).trim()
  const body = raw.slice(end + 4).replace(/^\n/, '')
  const data = {}
  for (const line of block.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const m = trimmed.match(/^([A-Za-z][A-Za-z0-9_]*):\s*(.*)$/)
    if (!m) continue
    let value = m[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    data[m[1]] = value
  }
  return { data, body }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00Z')
  if (Number.isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
}

function readTime(markdown) {
  const words = markdown.replace(/```[\s\S]*?```/g, '').split(/\s+/).filter(Boolean).length
  const minutes = Math.max(1, Math.round(words / 220))
  return `${minutes} min read`
}

// Header + footer match the existing marketing pages (public/about.html etc).
// Keep these in sync if the marketing-site template changes.
const HEADER = `<header class="uhdr">
  <div class="container uhdr-inner">
    <a href="/" class="uhdr-logo"><span class="glyph">N</span>narrate<span class="rx">Rx</span></a>
    <button class="uhdr-toggle" type="button" aria-label="Toggle menu" aria-expanded="false">
      <span></span><span></span><span></span>
    </button>
    <nav class="uhdr-nav">
      <a href="/how-it-works">How it works</a>
      <a href="/features">Features</a>
      <a href="/compare">Compare</a>
      <a href="/demo">Demo</a>
      <a href="/pricing">Pricing</a>
      <a href="/blog" aria-current="page">Blog</a>
      <a href="/onboard#signin" class="uhdr-signin">Sign in</a>
      <a href="/onboard" class="uhdr-cta">Claim a spot</a>
    </nav>
  </div>
</header>`

const FOOTER = `<footer class="ufoot">
  <div class="container ufoot-inner">
    <span class="footer-brand">narrate<span class="rx">Rx</span> — You talk. It does the rest.</span>
    <span><a href="/how-it-works">How it works</a> · <a href="/features">Features</a> · <a href="/compare">Compare</a> · <a href="/pricing">Pricing</a> · <a href="/blog">Blog</a> · <a href="/about">About</a> · <a href="/transparency">Transparency</a></span>
    <span>© <span data-year>2026</span> · <a href="mailto:drq@narraterx.ai">drq@narraterx.ai</a></span>
  </div>
</footer>`

const HEAD_COMMON = `<meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="icon" type="image/svg+xml" href="/narraterx-icon.svg" />
  <link rel="apple-touch-icon" href="/narraterx-icon.svg" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Source+Serif+4:ital,wght@0,400;0,500;0,600;1,400;1,500;1,600&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/site.css" />`

function renderPostHtml({ data, body }) {
  const title = data.title || 'Untitled'
  const description = data.description || ''
  const slug = data.slug || data._defaultSlug
  const pubDate = data.pubDate || ''
  const updatedDate = data.updatedDate || ''
  const canonical = `https://narraterx.ai/blog/${slug}`
  const dateLabel = formatDate(pubDate)
  const updatedLabel = updatedDate ? `Updated ${formatDate(updatedDate)}` : ''
  const ogImage = data.hero || 'https://narraterx.ai/brand/narraterx-icon-1024.png'

  const bodyHtml = marked.parse(body, { gfm: true, breaks: false })

  // Hero image rendered between the title hero and the body — gives every
  // post a visual anchor without forcing the writer to put `![](...)` inline.
  // Alt text falls back to title when Studio sends the original filename
  // (which is useless as alt text — e.g. "IMG_1234.jpeg").
  const heroSrc = data.hero || ''
  const heroAltCandidate = data.heroAlt || ''
  const looksLikeFilename = /\.(jpe?g|png|gif|webp|avif|heic)$/i.test(heroAltCandidate) || /^[A-F0-9-]{20,}_/i.test(heroAltCandidate)
  const heroAlt = (heroAltCandidate && !looksLikeFilename) ? heroAltCandidate : title
  const heroBlock = heroSrc
    ? `
<section class="upost-hero-image">
  <div class="container">
    <figure class="upost-hero-figure">
      <img src="${escapeHtml(heroSrc)}" alt="${escapeHtml(heroAlt)}" loading="eager" />
    </figure>
  </div>
</section>
`
    : ''

  return `<!doctype html>
<html lang="en">
<head>
  ${HEAD_COMMON}
  <title>${escapeHtml(title)} — NarrateRx</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <link rel="canonical" href="${canonical}" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:url" content="${canonical}" />
  <meta property="og:type" content="article" />
  <meta property="og:image" content="${escapeHtml(ogImage)}" />
  <meta name="twitter:card" content="summary_large_image" />
  ${pubDate ? `<meta property="article:published_time" content="${pubDate}" />` : ''}
  ${updatedDate ? `<meta property="article:modified_time" content="${updatedDate}" />` : ''}
</head>
<body>

${HEADER}

<section class="upage-hero">
  <div class="container">
    <div class="upage-hero-inner">
      <p class="upage-eyebrow"><span class="dot"></span> <a href="/blog">Blog</a></p>
      <h1>${escapeHtml(title)}</h1>
      <p class="upost-meta">
        ${dateLabel ? `<time datetime="${pubDate}">${dateLabel}</time>` : ''}
        ${dateLabel ? ' · ' : ''}<span>${readTime(body)}</span>
        ${updatedLabel ? ` · <span>${escapeHtml(updatedLabel)}</span>` : ''}
      </p>
    </div>
  </div>
</section>
${heroBlock}
<section class="uband">
  <div class="container">
    <article class="upost-body">
      ${bodyHtml}
    </article>
    <p class="upost-back"><a href="/blog">← Back to all posts</a></p>
  </div>
</section>

${FOOTER}

<script src="/site.js"></script>
</body>
</html>
`
}

function renderIndexHtml(posts) {
  const cards = posts.map((p) => {
    const slug = p.data.slug || p.data._defaultSlug
    const title = p.data.title || 'Untitled'
    const description = p.data.description || ''
    const dateLabel = formatDate(p.data.pubDate)
    const hero = p.data.hero || ''
    const heroAltCandidate = p.data.heroAlt || ''
    const looksLikeFilename = /\.(jpe?g|png|gif|webp|avif|heic)$/i.test(heroAltCandidate) || /^[A-F0-9-]{20,}_/i.test(heroAltCandidate)
    const heroAlt = (heroAltCandidate && !looksLikeFilename) ? heroAltCandidate : title
    const heroThumb = hero
      ? `<div class="upost-card-thumb"><img src="${escapeHtml(hero)}" alt="${escapeHtml(heroAlt)}" loading="lazy" /></div>`
      : ''
    return `      <li class="upost-card${hero ? ' upost-card-with-thumb' : ''}">
        <a href="/blog/${slug}" class="upost-card-link">
          ${heroThumb}
          <div class="upost-card-body">
            <p class="upost-card-meta">${dateLabel ? `<time datetime="${p.data.pubDate}">${dateLabel}</time>` : ''} · ${readTime(p.body)}</p>
            <h2 class="upost-card-title">${escapeHtml(title)}</h2>
            ${description ? `<p class="upost-card-desc">${escapeHtml(description)}</p>` : ''}
            <p class="upost-card-cta">Read post <span class="arrow">→</span></p>
          </div>
        </a>
      </li>`
  }).join('\n')

  const emptyState = `      <li class="upost-card upost-card-empty">
        <p>No posts yet. First piece is on its way.</p>
      </li>`

  return `<!doctype html>
<html lang="en">
<head>
  ${HEAD_COMMON}
  <title>Blog — NarrateRx</title>
  <meta name="description" content="Field notes from building NarrateRx — voice-faithful content for hands-on and integrative care providers." />
  <link rel="canonical" href="https://narraterx.ai/blog" />
  <meta property="og:title" content="NarrateRx Blog" />
  <meta property="og:description" content="Field notes from building NarrateRx — voice-faithful content for hands-on and integrative care providers." />
  <meta property="og:url" content="https://narraterx.ai/blog" />
  <meta property="og:type" content="website" />
  <meta name="twitter:card" content="summary_large_image" />
</head>
<body>

${HEADER}

<section class="upage-hero">
  <div class="container">
    <div class="upage-hero-inner">
      <p class="upage-eyebrow"><span class="dot"></span> Blog</p>
      <h1>Field notes from <em>building NarrateRx</em>.</h1>
      <p>Why voice-faithful content matters, what we're learning from real clinicians, and how this thing is taking shape.</p>
    </div>
  </div>
</section>

<section class="uband">
  <div class="container">
    <ul class="upost-list">
${posts.length === 0 ? emptyState : cards}
    </ul>
  </div>
</section>

${FOOTER}

<script src="/site.js"></script>
</body>
</html>
`
}

async function main() {
  if (!existsSync(SRC_DIR)) {
    console.log(`[build-blog] No source dir at ${SRC_DIR} — creating empty index only.`)
    await mkdir(OUT_DIR, { recursive: true })
    await writeFile(INDEX_OUT, renderIndexHtml([]), 'utf8')
    console.log(`[build-blog] Wrote ${INDEX_OUT}`)
    return
  }

  // Clean output dir so deleted markdown files don't leave stale HTML behind.
  if (existsSync(OUT_DIR)) {
    await rm(OUT_DIR, { recursive: true, force: true })
  }
  await mkdir(OUT_DIR, { recursive: true })

  const entries = await readdir(SRC_DIR)
  const mdFiles = entries.filter((f) => extname(f) === '.md')

  const posts = []
  for (const file of mdFiles) {
    const fp = join(SRC_DIR, file)
    const raw = await readFile(fp, 'utf8')
    let parsed
    try {
      parsed = parseFrontmatter(raw)
    } catch (e) {
      console.error(`[build-blog] Skipping ${file} — frontmatter error: ${e.message}`)
      continue
    }
    parsed.data._defaultSlug = basename(file, '.md')
    parsed.data.slug = parsed.data.slug || parsed.data._defaultSlug
    if (!parsed.data.title) {
      console.error(`[build-blog] Skipping ${file} — missing title in frontmatter`)
      continue
    }
    posts.push(parsed)
  }

  // Sort newest first by pubDate (ISO date), then by slug as a stable tiebreaker.
  posts.sort((a, b) => {
    const aDate = a.data.pubDate || ''
    const bDate = b.data.pubDate || ''
    if (aDate !== bDate) return bDate.localeCompare(aDate)
    return (a.data.slug || '').localeCompare(b.data.slug || '')
  })

  for (const post of posts) {
    const slug = post.data.slug
    const outPath = join(OUT_DIR, `${slug}.html`)
    await writeFile(outPath, renderPostHtml(post), 'utf8')
    console.log(`[build-blog] Wrote ${outPath}`)
  }

  await writeFile(INDEX_OUT, renderIndexHtml(posts), 'utf8')
  console.log(`[build-blog] Wrote ${INDEX_OUT} (${posts.length} post${posts.length === 1 ? '' : 's'})`)
}

main().catch((err) => {
  console.error('[build-blog] Failed:', err)
  process.exit(1)
})

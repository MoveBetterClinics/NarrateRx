import { withSentry } from '../_lib/sentry.js'
// POST /api/onboarding/scan-website
//
// Body: { url }
// Response: { display_name, audience_short, brand_voice, clinic_context,
//             services: string[], recent_topics: string[], source_pages: string[] }
//
// Fetches the user's home page, discovers candidate service / about / blog
// pages from its links, fetches a handful of them, extracts the visible copy,
// and asks Claude Sonnet 4.6 via the AI Gateway to draft starter brand voice
// context grounded in what they actually offer and what they actually publish.
// Output is *suggestions* — the wizard pre-fills the editable voice form so
// the user can keep, edit, or discard.
//
// Public endpoint (the user is signed in for the wizard, but they're not yet
// bound to a workspace, so we don't require Clerk org context here). Light
// rate-limit footprint: capped fetch budget per request, single AI call.

import { generateObject } from 'ai'
import { z } from 'zod'

const MODEL = 'anthropic/claude-sonnet-4-6'
const FETCH_TIMEOUT_MS = 8000
const MAX_HTML_BYTES = 500_000
const MAX_TEXT_CHARS_HOME = 12_000
const MAX_TEXT_CHARS_SECONDARY = 5_000
const MAX_PAGES = 16 // home + up to 15 discovered

const ScanSchema = z.object({
  display_name: z.string().describe('The business / practice / brand name as shown on the site. Empty string if not detectable.'),
  audience_short: z.string().describe('Who this business serves, in one short phrase (e.g. "Active adults in Portland with persistent injuries"). Empty string if unclear.'),
  brand_voice: z.string().describe('3-5 sentence description of how this brand writes — tone, pace, vocabulary, what they avoid. Reference patterns observed in blog/article copy when present (long-form writing reveals voice better than nav copy). Empty string if unclear.'),
  clinic_context: z.string().describe('1-3 sentences describing what the business does, their method/model, and what makes them distinctive. Empty string if unclear.'),
  services: z.array(z.string()).describe('Specific services / treatments / programs the business offers, as short noun phrases (e.g. "Dry needling", "Postpartum return-to-running coaching"). Pull from services / treatments / programs / what-we-do pages. Empty array if none found. Cap at ~8 most prominent.'),
  recent_topics: z.array(z.string()).describe('Topics covered in their blog / articles / news / journal, as short noun phrases (e.g. "Hip impingement in cyclists", "Pelvic floor and breath"). Empty array if no blog content. Cap at ~6 most recent or most prominent.'),
})

function normalizeUrl(raw) {
  if (typeof raw !== 'string') return null
  let s = raw.trim()
  if (!s) return null
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`
  try {
    const u = new URL(s)
    if (!['http:', 'https:'].includes(u.protocol)) return null
    return u
  } catch {
    return null
  }
}

async function fetchPage(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const r = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'NarrateRxBot/1.0 (+https://narraterx.ai)',
        Accept: 'text/html,application/xhtml+xml',
      },
    })
    if (!r.ok) return null
    const ct = r.headers.get('content-type') || ''
    if (!ct.includes('html')) return null
    const reader = r.body?.getReader?.()
    if (!reader) {
      const txt = await r.text()
      return txt.slice(0, MAX_HTML_BYTES)
    }
    let received = 0
    let chunks = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      chunks.push(value)
      if (received >= MAX_HTML_BYTES) break
    }
    const buf = new Uint8Array(received)
    let offset = 0
    for (const c of chunks) { buf.set(c, offset); offset += c.byteLength }
    return new TextDecoder('utf-8', { fatal: false }).decode(buf)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

// Discover candidate same-origin pages by scanning <a href> links in the home
// page HTML. We rank by URL-path heuristics — services / treatments / programs
// / about / approach for the "what they do" axis, and blog / articles / news /
// journal / posts for the "how they write" axis.
function discoverLinks(html, origin) {
  if (!html) return []
  const seen = new Set()
  const candidates = []
  const re = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>/gi
  let m
  while ((m = re.exec(html)) !== null) {
    let href = m[1].trim()
    if (!href || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) continue
    let u
    try { u = new URL(href, origin) } catch { continue }
    if (u.origin !== origin) continue
    const key = u.pathname.replace(/\/+$/, '').toLowerCase() || '/'
    if (key === '/' || seen.has(key)) continue
    seen.add(key)

    const score = scorePath(key)
    if (score > 0) candidates.push({ url: u.toString(), path: key, score })
    if (candidates.length > 80) break
  }
  candidates.sort((a, b) => b.score - a.score)
  return candidates
}

function scorePath(path) {
  // Higher = more interesting. Negative would mean "skip".
  // Penalize obvious noise.
  if (/\/(privacy|terms|cookie|legal|sitemap|login|signin|signup|register|cart|checkout|account|search|tag|category|author)(\/|$)/.test(path)) return 0
  if (/\.(pdf|jpg|jpeg|png|gif|webp|svg|mp4|mov|zip|css|js)$/.test(path)) return 0

  let s = 0
  // Services / what-we-do
  if (/(^|\/)(services?|treatments?|programs?|offerings?|specialties|specialties|what-we-do|what-i-do|how-we-help|how-i-help|sessions?)(\/|$)/.test(path)) s += 10
  if (/(^|\/)(approach|method|methodology|philosophy|process)(\/|$)/.test(path)) s += 8
  if (/(^|\/)(about|about-us|about-me|team|our-story|story|who-we-are)(\/|$)/.test(path)) s += 7
  // Blog / editorial
  if (/(^|\/)(blog|articles?|news|journal|posts?|insights?|resources?|library|writing)(\/|$)/.test(path)) s += 9
  // Conditions / population
  if (/(^|\/)(conditions?|populations?|who-we-treat|who-we-serve|for-(.+))(\/|$)/.test(path)) s += 6
  // FAQ sometimes carries voice
  if (/(^|\/)(faq|faqs|questions?)(\/|$)/.test(path)) s += 3

  // Shorter paths slightly preferred (top-level pages over deep ones)
  const depth = path.split('/').filter(Boolean).length
  if (depth === 1) s += 1
  if (depth > 4) s -= 2

  return s
}

// Strip scripts/styles, collapse whitespace, surface title + meta description +
// h1-h3 + first N chars of visible body text.
function extractText(html, sourceUrl, maxChars = MAX_TEXT_CHARS_HOME) {
  if (!html) return ''
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i)
  const descMatch  = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)
                   || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i)
  const ogDescMatch = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i)

  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')

  const headings = []
  const hRe = /<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi
  let m
  while ((m = hRe.exec(stripped)) !== null) {
    const t = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    if (t) headings.push(`H${m[1]}: ${t}`)
    if (headings.length > 24) break
  }

  const body = stripped
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()

  const parts = []
  parts.push(`SOURCE: ${sourceUrl}`)
  if (titleMatch) parts.push(`TITLE: ${titleMatch[1].trim()}`)
  if (descMatch)  parts.push(`META DESCRIPTION: ${descMatch[1].trim()}`)
  if (ogDescMatch) parts.push(`OG DESCRIPTION: ${ogDescMatch[1].trim()}`)
  if (headings.length) parts.push(`HEADINGS:\n${headings.join('\n')}`)
  parts.push(`BODY:\n${body.slice(0, maxChars)}`)
  return parts.join('\n\n')
}

const SYSTEM = `You are helping NarrateRx onboard a new business. You're reading several pages from their site — typically home, about, one or more services / treatments / programs pages, and one or more blog / article pages — and producing structured starter brand-voice context the business owner can edit.

Be specific and grounded in the source. If the site doesn't tell you something, leave that field empty (or the array empty) rather than inventing. Do NOT use marketing fluff. Match the tone and vocabulary the site already uses — that's the whole point.

How to read the corpus:
- Services / treatments / programs pages are the best signal for WHAT they do — extract the actual offerings as short noun phrases for the services field, and let them shape clinic_context.
- Blog / article / journal pages are the best signal for HOW they write — long-form copy reveals voice far more accurately than nav and hero text. Lean on these for brand_voice, and pull recurring themes into recent_topics.
- About / approach / method pages are the best signal for what makes them distinctive — feed that into clinic_context.

For brand_voice: describe their actual writing style (warm vs. clinical, plain vs. technical, first-person vs. brand-voice, sentence length, vocabulary they reach for, things they avoid). Cite specific patterns from blog copy when present.

For clinic_context: what the business does, their method or distinctive approach, who they serve. Weave in the most prominent services if helpful.

For services: short noun phrases for each offering — names of treatments, programs, or session types as they appear on the site. Don't pad with generic items; only include what the site actually states.

For recent_topics: short noun phrases naming what their blog / articles cover. Empty array if there's no blog content in the corpus.

For audience_short: one tight phrase, ~10 words max.

For display_name: the brand name as they present it.`

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method-not-allowed' })
  }
  if (!process.env.AI_GATEWAY_API_KEY) {
    console.error('[scan-website] AI_GATEWAY_API_KEY not set')
    return res.status(500).json({ error: 'ai-not-configured' })
  }

  const u = normalizeUrl(req.body?.url)
  if (!u) return res.status(400).json({ error: 'invalid-url' })

  const homeUrl = u.toString()
  const homeHtml = await fetchPage(homeUrl)

  // Discover candidate pages from the home page's links. If the home page
  // didn't load, fall back to the conventional /about URL so we don't return
  // a flat fetch-failed when the home page just rejected our UA.
  let candidatePaths = []
  if (homeHtml) {
    const discovered = discoverLinks(homeHtml, u.origin)
    // Prefer one of each "kind": services, blog/articles, about/approach,
    // conditions. We do this by walking the ranked list and skipping later
    // matches in the same bucket once we have one — then filling remaining
    // slots with whatever's next in score order.
    const buckets = { services: [], blog: [], about: [], other: [] }
    for (const c of discovered) {
      const p = c.path
      if (/(services?|treatments?|programs?|offerings?|specialties|what-we-do|what-i-do|how-we-help|how-i-help|sessions?)/.test(p)) buckets.services.push(c)
      else if (/(blog|articles?|news|journal|posts?|insights?|writing)/.test(p)) buckets.blog.push(c)
      else if (/(about|team|story|approach|method|methodology|philosophy|process|who-we-are)/.test(p)) buckets.about.push(c)
      else buckets.other.push(c)
    }
    const picks = []
    // Take a generous slice of each kind, then fill from "other". Services
    // and blog are the highest-signal so we bias toward them.
    picks.push(...buckets.services.slice(0, 5))
    picks.push(...buckets.blog.slice(0, 5))
    picks.push(...buckets.about.slice(0, 3))
    for (const c of buckets.other) {
      if (picks.length >= MAX_PAGES - 1) break
      picks.push(c)
    }
    candidatePaths = picks.slice(0, MAX_PAGES - 1).map(c => c.url)
  } else {
    candidatePaths = [new URL('/about', u.origin).toString()]
  }

  const secondaryHtmls = await Promise.all(candidatePaths.map(fetchPage))

  if (!homeHtml && !secondaryHtmls.some(Boolean)) {
    return res.status(502).json({ error: 'fetch-failed' })
  }

  const sourcePages = []
  const corpus = []
  if (homeHtml) {
    sourcePages.push(homeUrl)
    corpus.push(extractText(homeHtml, homeUrl, MAX_TEXT_CHARS_HOME))
  }
  candidatePaths.forEach((pageUrl, i) => {
    const html = secondaryHtmls[i]
    if (!html) return
    sourcePages.push(pageUrl)
    corpus.push(extractText(html, pageUrl, MAX_TEXT_CHARS_SECONDARY))
  })

  let object
  try {
    const result = await generateObject({
      model: MODEL,
      schema: ScanSchema,
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: `Read the following website content from ${u.origin} and produce starter brand-voice context.\n\n${corpus.join('\n\n---\n\n')}`,
      }],
      temperature: 0.3,
    })
    object = result.object
  } catch (e) {
    console.error('[scan-website] AI call failed:', e?.message)
    return res.status(502).json({ error: 'ai-failed' })
  }

  return res.status(200).json({
    display_name: object.display_name || '',
    audience_short: object.audience_short || '',
    brand_voice: object.brand_voice || '',
    clinic_context: object.clinic_context || '',
    services: Array.isArray(object.services) ? object.services.filter(s => typeof s === 'string' && s.trim()) : [],
    recent_topics: Array.isArray(object.recent_topics) ? object.recent_topics.filter(s => typeof s === 'string' && s.trim()) : [],
    source_pages: sourcePages,
  })
}

export default withSentry(handler)

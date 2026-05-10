// POST /api/onboarding/scan-website
//
// Body: { url }
// Response: { display_name, audience_short, brand_voice, clinic_context, source_pages: string[] }
//
// Fetches the user's home page (and /about when available), extracts the visible
// copy, and asks Claude Sonnet 4.6 via the AI Gateway to draft starter brand
// voice context. Output is *suggestions* — the wizard pre-fills the editable
// voice form so the user can keep, edit, or discard.
//
// Public endpoint (the user is signed in for the wizard, but they're not yet
// bound to a workspace, so we don't require Clerk org context here). Light
// rate-limit footprint: capped fetch budget per request, single AI call.

import { generateObject } from 'ai'
import { z } from 'zod'

const MODEL = 'anthropic/claude-sonnet-4-6'
const FETCH_TIMEOUT_MS = 8000
const MAX_HTML_BYTES = 500_000
const MAX_TEXT_CHARS = 12_000

const ScanSchema = z.object({
  display_name: z.string().describe('The business / practice / brand name as shown on the site. Empty string if not detectable.'),
  audience_short: z.string().describe('Who this business serves, in one short phrase (e.g. "Active adults in Portland with persistent injuries"). Empty string if unclear.'),
  brand_voice: z.string().describe('3-5 sentence description of how this brand writes — tone, pace, vocabulary, what they avoid. Empty string if unclear.'),
  clinic_context: z.string().describe('1-3 sentences describing what the business does, their method/model, and what makes them distinctive. Empty string if unclear.'),
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

// Strip scripts/styles, collapse whitespace, surface title + meta description +
// h1-h3 + first ~12k chars of visible body text.
function extractText(html, sourceUrl) {
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
  parts.push(`BODY:\n${body.slice(0, MAX_TEXT_CHARS)}`)
  return parts.join('\n\n')
}

const SYSTEM = `You are helping NarrateRx onboard a new business. Read the website text and produce structured starter brand-voice context the business owner can edit.

Be specific and grounded in the source. If the site doesn't tell you something, leave that field empty rather than inventing. Do NOT use marketing fluff. Match the tone and vocabulary the site already uses — that's the whole point.

For brand_voice: describe their actual writing style (warm vs. clinical, plain vs. technical, first-person vs. brand-voice, sentence length, vocabulary they reach for, things they avoid). Reference specific patterns from the source if helpful.

For clinic_context: what the business does, their method or distinctive approach, who they serve.

For audience_short: one tight phrase, ~10 words max.

For display_name: the brand name as they present it.`

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method-not-allowed' })
  }
  if (!process.env.AI_GATEWAY_API_KEY) {
    console.error('[scan-website] AI_GATEWAY_API_KEY not set')
    return res.status(500).json({ error: 'ai-not-configured' })
  }

  const u = normalizeUrl(req.body?.url)
  if (!u) return res.status(400).json({ error: 'invalid-url' })

  const homeUrl  = u.toString()
  const aboutUrl = new URL('/about', u.origin).toString()

  const [homeHtml, aboutHtml] = await Promise.all([
    fetchPage(homeUrl),
    fetchPage(aboutUrl),
  ])

  if (!homeHtml && !aboutHtml) {
    return res.status(502).json({ error: 'fetch-failed' })
  }

  const sourcePages = []
  const corpus = []
  if (homeHtml)  { sourcePages.push(homeUrl);  corpus.push(extractText(homeHtml, homeUrl)) }
  if (aboutHtml) { sourcePages.push(aboutUrl); corpus.push(extractText(aboutHtml, aboutUrl)) }

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
    source_pages: sourcePages,
  })
}

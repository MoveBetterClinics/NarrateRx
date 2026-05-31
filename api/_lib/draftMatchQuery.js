// Build a semantic-search query string from a content_items draft, for the
// media→content matcher (api/content-items/suggest-media.js).
//
// The draft's `topic` is the strongest signal — clean clinical labels like
// "Plantar fasciitis" / "Sciatica" / "Knee Pain with Running" embed cleanly and
// match the "what's shown" tags on assets (clinic-setting, runner, rehab-exercise).
// The body adds concrete context (body part, setting, patient scenario), but the
// generators inject scaffolding markers ([ON SCREEN TEXT: …], [HOOK …], HEADLINE:,
// markdown headings) that are noise for retrieval — strip them before embedding.
//
// Pure + I/O-free so it's unit-testable and reused if other callers need the
// same draft→query shaping.

const SCAFFOLD_PATTERNS = [
  // Stage-direction brackets the video/social generators emit.
  /\[(on\s*screen\s*text|hook|b-?roll|visual|cut|cta|scene|beat|shot)[^\]]*\]/gi,
  // Landing-page / email field labels at line start.
  /^(headline|subheadline|sub-?headline|subhead|cta|preview\s*text)\s*:/gim,
  // Markdown headings ("# ...") — keep the heading text, drop the hashes.
  /^#{1,6}\s+/gm,
  // URLs add no visual signal.
  /https?:\/\/\S+/gi,
  // Markdown emphasis / blockquote markers.
  /[*_`>]+/g,
]

/**
 * @param {{ topic?: string|null, content?: string|null }} item
 * @param {{ maxChars?: number }} [opts]
 * @returns {string}
 */
export function buildDraftMatchQuery(item, { maxChars = 1200 } = {}) {
  if (!item || typeof item !== 'object') return ''

  const topic = String(item.topic || '').trim()

  let body = typeof item.content === 'string' ? item.content : ''
  for (const re of SCAFFOLD_PATTERNS) body = body.replace(re, ' ')
  // Drop any leftover stray brackets/parens from stripped markers/links, then
  // collapse whitespace.
  body = body.replace(/[[\]()]+/g, ' ').replace(/\s+/g, ' ').trim()

  const parts = []
  if (topic) parts.push(topic)
  if (body) parts.push(body)
  let query = parts.join('. ').trim()

  if (query.length > maxChars) {
    // Cut on a word boundary so we don't embed a dangling half-word.
    const cut = query.slice(0, maxChars)
    const lastSpace = cut.lastIndexOf(' ')
    query = (lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut).trim()
  }
  return query
}

// Extracts brand voice + tone guidelines from a brand book PDF.
// Called async via waitUntil in the brand-kit upload webhook — runs after
// the brand_assets row is committed so the webhook returns 200 immediately.
//
// Output is a plain-text block intended for direct injection into AI system
// prompts, not for display. Shape:
//
//   BRAND VOICE: …
//   TONE: …
//   KEY MESSAGES: …
//   AVOID: …
//
// If extraction fails for any reason (bad PDF, model error, timeout) this
// returns null so the caller can skip the DB write rather than storing garbage.

import { generateText } from 'ai'
import { getDocumentProxy, extractText } from 'unpdf'

// Rough character budget to keep the Claude call within token limits.
// A 20-page brand book runs ~30k chars of extracted text; we take the first
// 12k which covers the strategic/voice sections that typically appear up front.
const MAX_PDF_CHARS = 12_000

const EXTRACTION_PROMPT = `You are extracting brand guidelines from a brand book PDF to help an AI content writer produce on-brand copy.

Read the text below and output ONLY the following lines (no headers, no bullet points, no extra commentary):

BRAND VOICE: [2-4 adjectives or short phrases describing the brand's voice/personality, comma-separated]
TONE: [1-2 sentences describing the desired writing tone and emotional register]
KEY MESSAGES: [3-5 core brand messages or beliefs, separated by " | "]
AVOID: [3-5 things to never say or write, separated by " | "]
BRAND COLORS: [all brand hex color codes found in the document, primary colors first then secondary, up to 12 total, comma-separated — e.g. #FF6B2B, #1A1A2E, #F5F5F0. Output hex codes only, or "Not specified"]
HEADING FONT: [the primary heading/display typeface name, or "Not specified"]
BODY FONT: [the body copy typeface name, or "Not specified"]

If a section isn't addressed in the document, write "Not specified" for that line.
Output exactly 7 lines, no more.`

export async function extractBrandGuidelines(pdfBlobUrl) {
  if (!process.env.AI_GATEWAY_API_KEY) {
    console.error('brandGuidelinesExtractor: AI_GATEWAY_API_KEY not set — skipping extraction')
    return null
  }

  let pdfText = ''
  try {
    const res = await fetch(pdfBlobUrl)
    if (!res.ok) throw new Error(`PDF fetch failed: ${res.status}`)
    const buf = new Uint8Array(await res.arrayBuffer())
    const pdf = await getDocumentProxy(buf)
    const { text: rawText } = await extractText(pdf, { mergePages: true })
    pdfText = (rawText || '').slice(0, MAX_PDF_CHARS).trim()
  } catch (e) {
    console.error('brandGuidelinesExtractor: PDF parse failed:', e?.message)
    return null
  }

  if (!pdfText) {
    console.error('brandGuidelinesExtractor: no text extracted from PDF (scanned image?)')
    return null
  }

  try {
    const { text } = await generateText({
      model: 'anthropic/claude-sonnet-4-6',
      system: EXTRACTION_PROMPT,
      messages: [{ role: 'user', content: `BRAND BOOK TEXT:\n\n${pdfText}` }],
      temperature: 0.1,
      maxTokens: 400,
    })
    const trimmed = text.trim()
    // Sanity-check: must have the four core section labels
    const valid = ['BRAND VOICE:', 'TONE:', 'KEY MESSAGES:', 'AVOID:'].every((label) =>
      trimmed.includes(label)
    )
    if (!valid) {
      console.error('brandGuidelinesExtractor: model output missing expected labels:', trimmed)
      return null
    }

    // Parse optional style fields for the brand_style row
    const colorsMatch  = trimmed.match(/^BRAND COLORS:\s*(.+)$/m)
    const headingMatch = trimmed.match(/^HEADING FONT:\s*(.+)$/m)
    const bodyMatch    = trimmed.match(/^BODY FONT:\s*(.+)$/m)

    const colorsRaw  = colorsMatch?.[1]?.trim()
    const headingRaw = headingMatch?.[1]?.trim()
    const bodyRaw    = bodyMatch?.[1]?.trim()

    // Extract all valid hex codes from the colors line — model may include
    // surrounding text or names alongside the hex values.
    const HEX_RE = /#[0-9a-f]{3,6}/gi
    const suggestedPalette = colorsRaw && colorsRaw !== 'Not specified'
      ? [...colorsRaw.matchAll(HEX_RE)].map((m) => m[0].toUpperCase())
      : []

    const stylePatch = {}
    if (suggestedPalette.length > 0) {
      stylePatch.suggested_palette = suggestedPalette
      // First color in the palette is the primary/accent color.
      stylePatch.accent_color = suggestedPalette[0]
    }
    if (headingRaw && headingRaw !== 'Not specified') stylePatch.heading_font = headingRaw
    if (bodyRaw    && bodyRaw    !== 'Not specified') stylePatch.body_font    = bodyRaw

    return { guidelines: trimmed, stylePatch }
  } catch (e) {
    console.error('brandGuidelinesExtractor: model call failed:', e?.message)
    return null
  }
}

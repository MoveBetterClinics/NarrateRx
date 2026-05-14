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

import pdfParse from 'pdf-parse'
import { generateText } from 'ai'

// Rough character budget to keep the Claude call within token limits.
// A 20-page brand book runs ~30k chars of extracted text; we take the first
// 12k which covers the strategic/voice sections that typically appear up front.
const MAX_PDF_CHARS = 12_000

const EXTRACTION_PROMPT = `You are extracting brand guidelines from a brand book PDF to help an AI content writer produce on-brand copy.

Read the text below and output ONLY the following four lines (no headers, no bullet points, no extra commentary):

BRAND VOICE: [2-4 adjectives or short phrases describing the brand's voice/personality, comma-separated]
TONE: [1-2 sentences describing the desired writing tone and emotional register]
KEY MESSAGES: [3-5 core brand messages or beliefs, separated by " | "]
AVOID: [3-5 things to never say or write, separated by " | "]

If a section isn't addressed in the document, write "Not specified" for that line.
Output exactly 4 lines, no more.`

export async function extractBrandGuidelines(pdfBlobUrl) {
  if (!process.env.AI_GATEWAY_API_KEY) {
    console.error('brandGuidelinesExtractor: AI_GATEWAY_API_KEY not set — skipping extraction')
    return null
  }

  let pdfText = ''
  try {
    const res = await fetch(pdfBlobUrl)
    if (!res.ok) throw new Error(`PDF fetch failed: ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    const parsed = await pdfParse(buf)
    pdfText = (parsed.text || '').slice(0, MAX_PDF_CHARS).trim()
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
    // Sanity-check: must have all four section labels
    const valid = ['BRAND VOICE:', 'TONE:', 'KEY MESSAGES:', 'AVOID:'].every((label) =>
      trimmed.includes(label)
    )
    if (!valid) {
      console.error('brandGuidelinesExtractor: model output missing expected labels:', trimmed)
      return null
    }
    return trimmed
  } catch (e) {
    console.error('brandGuidelinesExtractor: model call failed:', e?.message)
    return null
  }
}

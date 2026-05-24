// provenanceValidator.js — validates the <PROVENANCE> trailer Claude emits on
// every generation. If validation fails, the caller falls back to the
// algorithmic matcher (provenanceMatcher.js) and stores the result with
// source: "algorithmic_fallback" instead of "model_emit_validated".
//
// Pure functions on strings + arrays — no DB or network deps. Testable in
// isolation.
//
// Public surface:
//   parseProvenance(jsonText)          → { ok, blocks, error }
//   validateProvenance(blocks, content, userMessages) → { ok, normalized, error }
//
// extractProvenanceBlock(rawStream) is re-exported from src/lib/provenance.js
// (it has to live on the client too — the streaming consumer in
// InterviewSession.jsx splits content + trailer before posting).
//
// Block shape produced by the model (per the prompt in src/lib/prompts.js):
//   { text_prefix: "First 80 chars…", msg: 3, type: "paraphrase", span: [44, 187] }
//
// Normalized shape produced by validation (matches provenanceMatcher output):
//   { ordinal, text_prefix, source_type, source_msg_index, source_span, confidence }

export { extractProvenanceBlock } from '../../src/lib/provenance.js'

const TEXT_PREFIX_LEN = 80
const MAX_PREFIX_LEVENSHTEIN = 5

const VALID_TYPES = new Set(['verbatim', 'paraphrase', 'synthesis', 'close_paraphrase', 'prior_corpus'])

// Types that don't reference the current interview's user messages — no msg
// index or span required.
const TRANSCRIPT_FREE_TYPES = new Set(['synthesis', 'prior_corpus'])

// ─── JSON parse ────────────────────────────────────────────────────────────

export function parseProvenance(jsonText) {
  if (!jsonText || typeof jsonText !== 'string') {
    return { ok: false, blocks: [], error: 'empty' }
  }
  let obj
  try {
    obj = JSON.parse(jsonText)
  } catch (e) {
    return { ok: false, blocks: [], error: `json_parse: ${e.message}` }
  }
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.blocks)) {
    return { ok: false, blocks: [], error: 'no_blocks_array' }
  }
  return { ok: true, blocks: obj.blocks, error: null }
}

// ─── validation ────────────────────────────────────────────────────────────

/**
 * Validate a model-emitted block array against the actual content body + the
 * transcript's user messages. Strict mode: any block failing any check
 * invalidates the entire array (the caller falls back to algorithmic).
 *
 * Returns:
 *   { ok: true,  normalized: [{ordinal, text_prefix, source_type, source_msg_index, source_span, confidence}, …], error: null }
 *   { ok: false, normalized: [], error: '...' }
 */
export function validateProvenance(rawBlocks, content, userMessages) {
  if (!Array.isArray(rawBlocks) || rawBlocks.length === 0) {
    return { ok: false, normalized: [], error: 'no_blocks' }
  }
  if (typeof content !== 'string' || !content.trim()) {
    return { ok: false, normalized: [], error: 'no_content' }
  }

  const paragraphs = splitParagraphs(content)
  if (paragraphs.length === 0) {
    return { ok: false, normalized: [], error: 'no_paragraphs' }
  }
  if (rawBlocks.length !== paragraphs.length) {
    return {
      ok: false,
      normalized: [],
      error: `block_count_mismatch (${rawBlocks.length} blocks, ${paragraphs.length} paragraphs)`,
    }
  }

  const msgCount = Array.isArray(userMessages) ? userMessages.length : 0
  const normalized = []

  for (let i = 0; i < rawBlocks.length; i += 1) {
    const b = rawBlocks[i]
    const paragraph = paragraphs[i]
    const expectedPrefix = paragraph.slice(0, TEXT_PREFIX_LEN)

    // Type — accept both "paraphrase" (model emission) and "close_paraphrase"
    // (matcher output) and normalize to "close_paraphrase".
    const rawType = typeof b?.type === 'string' ? b.type.toLowerCase() : ''
    if (!VALID_TYPES.has(rawType)) {
      return { ok: false, normalized: [], error: `block_${i}: invalid type "${rawType}"` }
    }
    const sourceType = rawType === 'paraphrase' ? 'close_paraphrase' : rawType

    // text_prefix — fuzzy-match the paragraph's first 80 chars.
    const claimed = typeof b?.text_prefix === 'string' ? b.text_prefix : ''
    if (levenshtein(claimed.toLowerCase(), expectedPrefix.toLowerCase()) > MAX_PREFIX_LEVENSHTEIN) {
      return {
        ok: false,
        normalized: [],
        error: `block_${i}: text_prefix mismatch (claimed "${claimed.slice(0, 40)}…" vs "${expectedPrefix.slice(0, 40)}…")`,
      }
    }

    // msg index — must be a valid user-message index OR null.
    let msgIndex = null
    if (!TRANSCRIPT_FREE_TYPES.has(sourceType)) {
      const raw = b?.msg
      if (!Number.isInteger(raw) || raw < 0 || raw >= msgCount) {
        return { ok: false, normalized: [], error: `block_${i}: invalid msg index ${raw}` }
      }
      msgIndex = raw
    } else if (b?.msg !== undefined && b?.msg !== null) {
      // prior_corpus / synthesis with a stray msg index — non-fatal, drop it.
      msgIndex = null
    }

    // span — when present, must fit inside the named message.
    let span = null
    if (!TRANSCRIPT_FREE_TYPES.has(sourceType) && Array.isArray(b?.span) && b.span.length === 2) {
      const msg = userMessages[msgIndex]
      const msgText = typeof msg === 'string' ? msg : (msg?.content ?? '')
      const [s, e] = b.span
      if (
        Number.isInteger(s) && Number.isInteger(e) &&
        s >= 0 && e <= msgText.length && s < e
      ) {
        span = [s, e]
      } else {
        return { ok: false, normalized: [], error: `block_${i}: span [${s},${e}] out of bounds (msg length ${msgText.length})` }
      }
    }

    normalized.push({
      ordinal: i,
      text_prefix: expectedPrefix,
      source_type: sourceType,
      source_msg_index: msgIndex,
      source_span: span,
      confidence: typeof b?.confidence === 'number' ? clamp01(b.confidence) : null,
    })
  }

  return { ok: true, normalized, error: null }
}

// ─── internals ─────────────────────────────────────────────────────────────

function splitParagraphs(content) {
  return content
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function clamp01(x) {
  if (x < 0) return 0
  if (x > 1) return 1
  return Math.round(x * 1000) / 1000
}

// Standard Levenshtein. Caps inputs at 200 chars (we only compare prefixes).
function levenshtein(a, b) {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  const m = Math.min(a.length, 200)
  const n = Math.min(b.length, 200)
  const prev = new Array(n + 1)
  const curr = new Array(n + 1)
  for (let j = 0; j <= n; j += 1) prev[j] = j
  for (let i = 1; i <= m; i += 1) {
    curr[0] = i
    for (let j = 1; j <= n; j += 1) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
    }
    for (let j = 0; j <= n; j += 1) prev[j] = curr[j]
  }
  return prev[n]
}

// provenanceMatcher.js — algorithmic fallback for content_items.provenance.
//
// The voice-fidelity substrate (P0-A / P0-C / P0-G) is populated by a hybrid
// pipeline: Claude emits a <PROVENANCE> JSON trailer on every generation; if
// that emission fails validation OR the trailer is missing entirely, we fall
// back to this matcher. It also drives the one-time backfill for existing
// content_items.
//
// Public surface:
//   computeProvenance(content, userMessages) → { version, granularity, blocks, summary }
//   classifyParagraph(paragraph, userMessages) → one block (verbatim|close_paraphrase|synthesis)
//   summarize(blocks, source) → { verbatim_pct, paraphrase_pct, synthesis_pct, … }
//
// Thresholds calibrated by scripts/calibrate-provenance-thresholds.mjs against
// 452 real paragraphs (PR4 / P0-A.2, May 2026). The original placeholders
// (0.80 / 0.45) labelled 99.6% of production paragraphs as `synthesis` — the
// voice-fidelity scorecard was effectively dark. New cutoffs sit at the
// natural cliffs of the real-data score distribution:
//   • [0.10, 0.15) holds 33 paragraphs of function-word noise; [0.15, 0.20)
//     drops to 4 — paraphrase floor lives here.
//   • Above 0.30 we see clean clinic-voice rewrites of clinician statements
//     (e.g. "I tell my patients X" → "We tell our patients X" scores 0.647).
//
// Known limitation: bigram-Jaccard is surface-form. A true semantic paraphrase
// (same idea, completely different wording) scores near 0 — see synthetic
// test Case C. Catching those requires a semantic feature (embeddings or a
// model-emitted label via the validator pipeline). Until then the
// "close_paraphrase" band primarily captures surface rewordings, not
// semantic ones; deeper recall lives with the model-emit path.
//
// No deps — pure functions on strings + arrays. Browser-safe and Node-safe.

const VERBATIM_THRESHOLD   = 0.30
const PARAPHRASE_THRESHOLD = 0.15
const TEXT_PREFIX_LEN      = 80

// ─── public ────────────────────────────────────────────────────────────────

export function computeProvenance(content, userMessages, { source = 'algorithmic_fallback' } = {}) {
  const paragraphs = splitParagraphs(content)
  const messages = Array.isArray(userMessages) ? userMessages : []
  const blocks = paragraphs.map((para, i) => classifyParagraph(para, messages, i))
  return {
    version: 1,
    granularity: 'paragraph',
    blocks,
    summary: summarize(blocks, source),
  }
}

/**
 * Compute the raw best-match score for a paragraph against a user-message
 * array. Returns `{ msg, score, spanStart, spanEnd }`. `score` is the best
 * bigram-Jaccard across all (message, window) combinations. This is the
 * underlying signal that `classifyParagraph` thresholds into categories;
 * exposed separately so calibration tooling and tests can inspect the raw
 * value without re-running the algorithm.
 *
 * Returns `{ msg: -1, score: 0, spanStart: -1, spanEnd: -1 }` for empty inputs.
 */
export function scoreParagraph(paragraph, userMessages) {
  if (!paragraph?.trim() || !Array.isArray(userMessages) || userMessages.length === 0) {
    return { msg: -1, score: 0, spanStart: -1, spanEnd: -1 }
  }
  const paraTokens = tokenize(paragraph)
  if (paraTokens.length === 0) {
    return { msg: -1, score: 0, spanStart: -1, spanEnd: -1 }
  }

  let best = { msg: -1, score: 0, spanStart: -1, spanEnd: -1 }
  for (let i = 0; i < userMessages.length; i += 1) {
    const msg = userMessages[i]
    const msgText = typeof msg === 'string' ? msg : (msg?.content ?? '')
    if (!msgText) continue
    const { score, spanStart, spanEnd } = scorePair(paraTokens, msgText)
    if (score > best.score) {
      best = { msg: i, score, spanStart, spanEnd }
    }
  }
  return best
}

export function classifyParagraph(paragraph, userMessages, ordinal = 0) {
  const text_prefix = paragraph.slice(0, TEXT_PREFIX_LEN)
  const best = scoreParagraph(paragraph, userMessages)
  if (best.score === 0) return baseBlock(ordinal, text_prefix, 'synthesis')

  if (best.score >= VERBATIM_THRESHOLD) {
    return {
      ordinal,
      text_prefix,
      source_type: 'verbatim',
      source_msg_index: best.msg,
      source_span: best.spanStart >= 0 ? [best.spanStart, best.spanEnd] : null,
      confidence: round3(best.score),
    }
  }
  if (best.score >= PARAPHRASE_THRESHOLD) {
    return {
      ordinal,
      text_prefix,
      source_type: 'close_paraphrase',
      source_msg_index: best.msg,
      source_span: best.spanStart >= 0 ? [best.spanStart, best.spanEnd] : null,
      confidence: round3(best.score),
    }
  }
  return baseBlock(ordinal, text_prefix, 'synthesis')
}

export function summarize(blocks, source = 'algorithmic_fallback') {
  const total = blocks.length || 1
  const counts = { verbatim: 0, close_paraphrase: 0, synthesis: 0 }
  for (const b of blocks) {
    if (counts[b.source_type] !== undefined) counts[b.source_type] += 1
  }
  return {
    verbatim_pct:   Math.round((counts.verbatim         / total) * 100),
    paraphrase_pct: Math.round((counts.close_paraphrase / total) * 100),
    synthesis_pct:  Math.round((counts.synthesis        / total) * 100),
    computed_at:    new Date().toISOString(),
    source,
  }
}

// ─── internals ─────────────────────────────────────────────────────────────

function baseBlock(ordinal, text_prefix, source_type) {
  return {
    ordinal,
    text_prefix,
    source_type,
    source_msg_index: null,
    source_span: null,
    confidence: null,
  }
}

// Split on blank-line paragraph breaks; trim each block; drop empty entries.
function splitParagraphs(content) {
  if (typeof content !== 'string') return []
  return content
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean)
}

// Lowercased word tokens, punctuation-stripped. Cheap; good enough for an
// overlap ratio at the paragraph grain. PR4 may upgrade to a stemmer or
// n-gram shingle if calibration data shows we need it.
function tokenize(s) {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

// Bigram-shingle Jaccard between paragraph tokens and a sliding window over
// the user-message tokens. Two passes per message: (1) compute best Jaccard
// over all reasonable window sizes; (2) extract the character offsets of the
// best window so the UI can highlight.
//
// Window sizes default to [0.5×, 1×, 1.5×] of the paragraph length, capped at
// the message length. That covers verbatim quotes (~1×) and rewordings that
// expand or compress the original (~0.5×–1.5×). Smaller windows than 0.5×
// drop the precision below useful; larger than 1.5× swamps with non-source
// material.
function scorePair(paraTokens, msgText) {
  const msgTokens = tokenize(msgText)
  if (msgTokens.length < 2) return { score: 0, spanStart: -1, spanEnd: -1 }

  const paraShingles = bigramSet(paraTokens)
  if (paraShingles.size === 0) return { score: 0, spanStart: -1, spanEnd: -1 }

  const sizes = uniqueSizes([
    Math.max(2, Math.floor(paraTokens.length * 0.5)),
    Math.max(2, paraTokens.length),
    Math.max(2, Math.floor(paraTokens.length * 1.5)),
  ])

  let best = { score: 0, windowStart: -1, windowEnd: -1 }
  for (const winSize of sizes) {
    const limit = Math.min(winSize, msgTokens.length)
    for (let start = 0; start + limit <= msgTokens.length; start += Math.max(1, Math.floor(limit / 4))) {
      const window = msgTokens.slice(start, start + limit)
      const winShingles = bigramSet(window)
      if (winShingles.size === 0) continue
      const j = jaccard(paraShingles, winShingles)
      if (j > best.score) best = { score: j, windowStart: start, windowEnd: start + limit }
    }
  }

  if (best.windowStart < 0) return { score: 0, spanStart: -1, spanEnd: -1 }

  // Convert token-window offsets back into character offsets within msgText.
  const offsets = tokenOffsets(msgText)
  const spanStart = offsets[best.windowStart]?.start ?? -1
  const lastTokenIndex = Math.min(best.windowEnd - 1, offsets.length - 1)
  const spanEnd = offsets[lastTokenIndex]?.end ?? -1
  return { score: best.score, spanStart, spanEnd }
}

function bigramSet(tokens) {
  const out = new Set()
  for (let i = 0; i + 1 < tokens.length; i += 1) {
    out.add(`${tokens[i]}␟${tokens[i + 1]}`)
  }
  return out
}

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const v of a) if (b.has(v)) inter += 1
  return inter / (a.size + b.size - inter)
}

function tokenOffsets(s) {
  // Walk the lowercased mirror of `s` to find positions of the same word
  // boundaries `tokenize` produced. Returns one entry per token, in order.
  const out = []
  const re = /[\p{L}\p{N}']+/gu
  let m
  while ((m = re.exec(s)) !== null) {
    out.push({ start: m.index, end: m.index + m[0].length })
  }
  return out
}

function uniqueSizes(arr) {
  return Array.from(new Set(arr.filter((n) => n >= 2))).sort((a, b) => a - b)
}

function round3(x) {
  return Math.round(x * 1000) / 1000
}

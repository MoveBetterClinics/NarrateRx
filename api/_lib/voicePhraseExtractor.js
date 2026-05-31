// Phase C — voice-faithful output loop, extractor module.
//
// Single source of truth for the algorithm that pulls characteristic phrases
// out of a piece of approved content and writes them into
// staff_voice_phrases. Used by:
//
//   * api/db/content.js — fire-and-forget on every content_item approval,
//     so the table auto-deepens with every shipped piece (Phase C.3).
//   * scripts/backfill-voice-phrases.mjs — bulk one-shot over historical
//     approved content (Phase C.1).
//
// The extraction itself is deterministic + algorithmic on purpose: sentence-
// split, length/word gates, filter CTAs/URLs/hashtags, normalize. We do NOT
// LLM-summarize because the table's downstream consumer (C.2 span annotations)
// needs to mark *literal* sentences in generated drafts that trace back to
// the clinician's prior writing — paraphrases would break that contract.
//
// Rejection signal (negative weight on phrases the clinician cut during
// editing) is intentionally deferred to a follow-up PR. It requires diffing
// ai_original_content against content and is meaningfully more complex than
// the positive-signal path.

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// Phrase-quality gates. Numbers picked to match the historical script — moving
// them retroactively would invalidate any backfilled rows.
const MIN_CHARS = 20   // below this = fragment / hashtag line
const MAX_CHARS = 160  // above this = block of prose, not a reusable phrase
const MIN_WORDS = 4    // fewer = fragment

const CTA_RE          = /^(click|tap|swipe|follow|subscribe|link in bio|check out|dm|comment|share|save|tag|watch|listen|visit|sign up|learn more|read more|get yours|shop|order|book|schedule|register|download)/i
const URL_RE          = /^https?:\/\//
const HASHTAG_RE      = /^#/
const MENTION_RE      = /^@/
const EMOJI_HEAVY_RE  = /^[\p{Emoji}\s]{1,10}$/u

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey:        SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer:        'return=representation',
      ...init.headers,
    },
  })
}

// ── Pure extraction ──────────────────────────────────────────────────────────

function splitSentences(content) {
  const clean = content.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n')
  // Split on sentence-terminal punctuation followed by whitespace, OR newlines.
  return clean.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim())
}

function isVoiceWorthy(s) {
  if (s.length < MIN_CHARS || s.length > MAX_CHARS) return false
  if (URL_RE.test(s))         return false
  if (HASHTAG_RE.test(s))     return false
  if (MENTION_RE.test(s))     return false
  if (EMOJI_HEAVY_RE.test(s)) return false
  if (CTA_RE.test(s))         return false
  const words = s.match(/\b\w{2,}\b/g) || []
  if (words.length < MIN_WORDS) return false
  if (!/[a-zA-Z]/.test(s))    return false
  return true
}

function normalize(phrase) {
  return phrase
    .toLowerCase()
    .trim()
    .replace(/[.!?,;:…]+$/, '')
    .replace(/\s+/g, ' ')
}

/**
 * extractPhrasesFromContent(content) → [{ phrase, phrase_normalized }]
 *
 * Pure function: no I/O. Same algorithm as the backfill script — keeps
 * historical rows and new approve-hook rows from diverging. Returns deduped
 * (within this one content body) phrases.
 */
export function extractPhrasesFromContent(content) {
  if (!content || typeof content !== 'string') return []
  const seen = new Set()
  const out  = []
  for (const s of splitSentences(content)) {
    if (!isVoiceWorthy(s)) continue
    const norm = normalize(s)
    if (seen.has(norm)) continue
    seen.add(norm)
    out.push({ phrase: s, phrase_normalized: norm })
  }
  return out
}

// ── Upsert via Supabase REST ─────────────────────────────────────────────────

// PostgREST exposes ON CONFLICT through the Prefer: resolution=merge-duplicates
// header. The unique index on (workspace_id, staff_id, phrase_normalized)
// drives the conflict target. Existing rows get approve_count+1, last_seen_at
// bumped; weight is intentionally left to the auto-tune worker's positive
// signal (currently the default 1.0; richer weighting lands in a follow-up).
async function upsertOneVoicePhrase({ workspaceId, staffId, phrase, phraseNormalized, initialWeight = 1.0 }) {
  // PostgREST's merge-duplicates doesn't let us express "+1 to approve_count"
  // — it overwrites the row with the values we sent. Do a read-modify-write:
  // fetch existing, increment locally, PATCH if exists else INSERT.
  const lookupRes = await sb(
    `staff_voice_phrases` +
    `?workspace_id=eq.${workspaceId}` +
    `&staff_id=eq.${staffId}` +
    `&phrase_normalized=eq.${encodeURIComponent(phraseNormalized)}` +
    `&select=id,approve_count,weight`
  )
  if (!lookupRes.ok) {
    const body = await lookupRes.text().catch(() => '')
    console.error(`[voicePhraseExtractor] lookup failed status=${lookupRes.status} body=${body.slice(0, 200)}`)
    return
  }
  const existing = (await lookupRes.json())[0]

  if (existing) {
    const patchRes = await sb(`staff_voice_phrases?id=eq.${existing.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        approve_count: existing.approve_count + 1,
        weight:        Number(existing.weight) + 1,
        last_seen_at:  new Date().toISOString(),
      }),
    })
    if (!patchRes.ok) {
      const body = await patchRes.text().catch(() => '')
      console.error(`[voicePhraseExtractor] update failed status=${patchRes.status} body=${body.slice(0, 200)}`)
    }
    return
  }

  const insertRes = await sb('staff_voice_phrases', {
    method: 'POST',
    body: JSON.stringify({
      workspace_id:      workspaceId,
      staff_id:      staffId,
      phrase,
      phrase_normalized: phraseNormalized,
      // initialWeight lets a lower-confidence source (interview transcript, F1)
      // seed a phrase BELOW approved-content phrases (1.0). Re-sighting via the
      // approval hook still PATCHes weight += 1, so approval promotes it.
      weight:            initialWeight,
      approve_count:     1,
      reject_count:      0,
    }),
  })
  if (!insertRes.ok) {
    const body = await insertRes.text().catch(() => '')
    // 23505 = unique violation — two concurrent approvals raced. Safe to ignore;
    // the other approval landed the row.
    if (!body.includes('23505')) {
      console.error(`[voicePhraseExtractor] insert failed status=${insertRes.status} body=${body.slice(0, 200)}`)
    }
  }
}

// ── Public entry point ───────────────────────────────────────────────────────

/**
 * extractVoicePhrases({ workspaceId, staffId, content, initialWeight })
 *
 * Fire-and-forget extractor. Pulls voice-worthy sentences out of a content
 * body and upserts each into staff_voice_phrases. Never throws — caller can
 * ignore the returned promise without unhandled-rejection risk.
 *
 * Sources:
 *   * api/db/content.js — on content_item approval (initialWeight 1.0, default).
 *   * api/db/interviews.js — on interview completion (F1, initialWeight 0.5,
 *     PROVISIONAL): gives clinicians who interview but never get a piece
 *     approved a real voice substrate, while keeping approved-content phrases
 *     ranked above. Re-sighting in approved content promotes the phrase (+1).
 *
 * @param {number} [initialWeight=1.0] — weight for NEWLY inserted phrases only;
 *        existing rows are still bumped weight += 1 regardless of this value.
 *
 * No-ops when:
 *   * staffId is missing (content without an owning clinician
 *     doesn't contribute to any per-clinician voice profile)
 *   * content is empty / whitespace only
 *   * no sentences clear the voice-worthy quality gate
 */
export async function extractVoicePhrases({ workspaceId, staffId, content, initialWeight = 1.0 }) {
  try {
    if (!workspaceId || !staffId) return
    if (!content?.trim()) return

    const phrases = extractPhrasesFromContent(content)
    if (!phrases.length) return

    // Serial upserts — each is two small REST calls (lookup + write). For a
    // typical approved piece that's ~5–15 phrases × 2 ≈ 10–30 calls, well under
    // any rate-limit concern, and serial keeps the read-modify-write race-free
    // within a single approval event.
    for (const { phrase, phrase_normalized } of phrases) {
      await upsertOneVoicePhrase({
        workspaceId,
        staffId,
        phrase,
        phraseNormalized: phrase_normalized,
        initialWeight,
      })
    }

    console.info(
      `[voicePhraseExtractor] workspace=${workspaceId} staff=${staffId} ` +
      `phrases=${phrases.length} initialWeight=${initialWeight}`
    )
  } catch (e) {
    console.error('[voicePhraseExtractor] unhandled error:', e?.message)
  }
}

// api/_lib/captionFidelityRubric.js
//
// SINGLE SOURCE OF TRUTH for the caption-fidelity rubric. Imported by:
//   - api/_lib/captionFidelity.js          (live scorer, waitUntil after render)
//   - scripts/voice-fidelity-captions.mjs   (offline fixture refresh + dashboard)
//   - scripts/u1-caption-ab-smoke.mjs        (A/C experiments)
// so the prompt + dimensions can never drift between them again.
//
// PURE: no env reads, no network, no side effects. Safe to import anywhere
// (including the function-bundle smoke test).
//
// ─────────────────────────────────────────────────────────────────────────────
// Why this rubric was rewritten (2026-05-31):
//
// The previous rubric graded a caption WITHOUT ever seeing the clip transcript,
// and two of its five dimensions (`clinical_texture`, `specificity`) explicitly
// rewarded clinical/technical language ("real anatomy, technique names"). So it
// wasn't measuring faithfulness to what the clinician said — it was rewarding
// "sounds clinical + echoes the catalogued phrases." That breaks the moment a
// clinician shares an emotional challenge or a personal story: a caption that
// faithfully reflects that gets DINGED for having no anatomy in it.
//
// The fix splits the two things the old rubric conflated and feeds the
// transcript in as the gold reference:
//   • said_fidelity — does the caption faithfully convey WHAT WAS ACTUALLY SAID?
//   • voice_match   — does it sound like THIS PERSON, in whatever register they
//                     are using (clinical OR emotional) — never rewarding jargon.
//   • naturalness   — real human, not a content-mill/corporate template (register-neutral).
//   • tightness     — title + caption don't restate each other; caption is crisp.
// `clinical_texture`, `specificity`, and `brand_fit` are gone (folded in or dropped).
// ─────────────────────────────────────────────────────────────────────────────

export const FIDELITY_DIMENSIONS = ['said_fidelity', 'voice_match', 'naturalness', 'tightness']

/**
 * Build the evaluator prompt. Pure — returns { system, user }.
 *
 * @param {object} p
 * @param {string} p.topic          — thumbnail/title text
 * @param {string} p.caption        — caption under test
 * @param {string} [p.transcript]   — what the clinician ACTUALLY said in this clip
 *                                     (segment excerpt or asset transcription). Empty
 *                                     when there's no audio/transcript on record.
 * @param {Array}  [p.phrases]      — [{ phrase }] voice reference (one signal, not the gold)
 * @param {string} p.staffName
 * @param {string} p.workspaceName
 */
export function buildFidelityPrompt({ topic, caption, transcript = '', phrases = [], staffName, workspaceName }) {
  const said = String(transcript || '').replace(/\s+/g, ' ').trim().slice(0, 2500)
  const hasSaid = said.length > 0
  const phraseExamples = (phrases || []).slice(0, 8).map((x) => `- "${x.phrase}"`).join('\n')
  const hasPhrases = phraseExamples.length > 0

  return {
    system:
`You are a precise evaluator of SHORT social-distribution copy (a thumbnail title +
caption) for a real person's clinical practice. You judge two things above all:
(1) FAITHFULNESS — does the caption reflect what the person ACTUALLY said in this
clip, without inventing or distorting it? and (2) VOICE — does it sound like THIS
person speaking?

CRITICAL — you are NOT a "sounds clinical" detector. Do NOT reward anatomy,
technique names, diagnostic jargon, or clinical register for their own sake, and
do NOT penalize a caption for being warm, personal, or emotional. People share
personal struggles and stories as well as clinical insight; a caption that
faithfully carries an emotional or personal moment in the person's own voice is
EXCELLENT and should score high. Register (clinical vs. personal) is the speaker's
choice, never a quality signal. Return ONLY valid JSON — no markdown, no preamble.`,
    user:
`Evaluate this title + caption, written for ${staffName} at ${workspaceName}. It will
be posted as the social caption and burned into the video's subtitles.

${hasSaid
  ? `WHAT THE CLINICIAN ACTUALLY SAID IN THIS CLIP (the gold reference for faithfulness —
the caption should reflect THIS, paraphrased, not invent beyond it):
"""
${said}
"""`
  : `(No transcript on record for this clip — score said_fidelity at 5; you cannot check
faithfulness without a reference. Judge the other dimensions normally.)`}

${hasPhrases
  ? `HOW THIS PERSON TENDS TO SPEAK (a sample of their voice — match the rhythm/cadence/
framing, NOT a checklist of words to echo; they speak in many registers):
${phraseExamples}`
  : `(No voice sample on record for this person yet — score voice_match at 5.)`}

TITLE (thumbnail text, ${(topic || '').length} chars):
"${topic || ''}"

CAPTION (subtitle + social copy, ${(caption || '').length} chars):
"${caption || ''}"

Score each dimension 1–10 and return EXACTLY this JSON shape (no other keys):
{
  "said_fidelity": <1-10; how faithfully the caption conveys what was ACTUALLY said above —
    captures the real point, no invented claims, no distortion${hasSaid ? '' : '; score 5 (no transcript to compare)'}>,
  "voice_match": <1-10; sounds like THIS person's rhythm + word choice in whatever register
    they used (clinical OR personal/emotional). Do NOT reward jargon${hasPhrases ? '' : '; score 5 (no voice sample)'}>,
  "naturalness": <1-10; sounds like a real human talking, not a generic content-mill or
    corporate template. Register-neutral>,
  "tightness": <1-10 INVERSE redundancy — 10=title and caption each add something and the
    caption is crisp; 1=they restate each other or it's padded>,
  "red_flag": "<one short phrase: the single biggest issue, or 'none'. Do NOT cite missing
    clinical/anatomical language as a flag>"
}`,
  }
}

/**
 * Parse the evaluator's raw JSON text into { overall, breakdown }.
 * Tolerant of ```json fences. Returns null if no scorable dimensions parsed.
 *
 * @param {string} rawText
 * @param {object} [extra] — merged into breakdown (e.g. has_phrases, model)
 */
export function parseFidelity(rawText, extra = {}) {
  let r = {}
  try {
    r = JSON.parse(String(rawText || '').trim())
  } catch {
    const cleaned = String(rawText || '').replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    try { r = JSON.parse(cleaned) } catch { return null }
  }
  const valid = FIDELITY_DIMENSIONS.filter((d) => typeof r[d] === 'number')
  if (!valid.length) return null
  const overall = Number((valid.reduce((s, d) => s + r[d], 0) / valid.length).toFixed(2))
  const breakdown = {
    said_fidelity: r.said_fidelity ?? null,
    voice_match:   r.voice_match ?? null,
    naturalness:   r.naturalness ?? null,
    tightness:     r.tightness ?? null,
    red_flag:      r.red_flag || null,
    ...extra,
  }
  return { overall, breakdown }
}

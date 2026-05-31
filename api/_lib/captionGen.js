// api/_lib/captionGen.js
//
// Shared caption generator, extracted from generate-package.js so multiple
// editorial endpoints (generate-package, render-longform, …) emit the same
// voice-faithful caption. PR #997 logic preserved verbatim: injects the
// clinician's staff_voice_phrases + voice_notes and grades on Sonnet 4.6.
//
// generateCaption NEVER mutates global state — it reads the clinician's voice
// corpus via the service-key REST client below and returns a trimmed string.

import { generateText } from 'ai'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...init.headers,
    },
  })
}

/**
 * Generate a compelling 1-2 sentence caption.
 * V6: when practiceChunks are available, injects the clinician's prior
 * framing so the caption echoes their actual voice on this topic.
 * Phase 4 Tentpole PR B: when campaign is provided, injects the campaign's
 * theme + content_style so the caption serves the campaign goal.
 *
 * @param {Object}   p
 * @param {string}   p.topic
 * @param {Object}   [p.clip]            — { visualNarrative, aiTags } for clip context
 * @param {Object}   p.workspace         — workspace row (brand_voice, id)
 * @param {string}   [p.staffId]         — clinician id for voice-phrase lookup
 * @param {Object[]} [p.practiceChunks]  — prior-thinking RAG chunks
 * @param {Object}   [p.campaign]        — active campaign row
 * @param {string}   [p.clipTranscript]  — what the clinician actually said in THIS clip
 *                                          (segment transcript / asset transcription). The
 *                                          single richest grounding signal — when present it
 *                                          anchors the caption to this specific clip. Empty
 *                                          string = unchanged behavior (backward-compatible).
 * @returns {Promise<string>}
 */
export async function generateCaption({ topic, clip = {}, workspace, staffId = null, practiceChunks = [], campaign = null, clipTranscript = '' }) {
  const toneHint = workspace?.brand_voice?.tone_descriptors?.join(', ') || 'warm, expert'
  const clipContext = [
    clip.visualNarrative ? `Visual: ${clip.visualNarrative}` : '',
    clip.aiTags?.length ? `Tags: ${(clip.aiTags || []).join(', ')}` : '',
  ].filter(Boolean).join('. ')

  const priorThinking = practiceChunks
    .slice(0, 3)
    .map((c) => String(c.text || '').slice(0, 200).trim())
    .filter(Boolean)
    .join(' … ')

  // Fetch the clinician's authentic voice phrases + notes so the caption is
  // graded ON its input. The V1 fidelity scorer (api/_lib/captionFidelity.js)
  // judges voice_fidelity against `staff_voice_phrases`, and the long-form blog
  // path already injects them — which is why long-form scores ~7.3 while
  // captions (voice-blind until now) score ~6. Mirror the blog-regen fetch.
  // Non-fatal: empty corpus → falls back to tone descriptors alone.
  let voicePhrases = []
  let voiceNotes = ''
  if (staffId && workspace?.id) {
    try {
      const [sRes, pRes] = await Promise.all([
        sb(`staff?id=eq.${staffId}&workspace_id=eq.${workspace.id}&select=voice_notes`),
        sb(`staff_voice_phrases?staff_id=eq.${staffId}&workspace_id=eq.${workspace.id}&select=phrase&order=weight.desc,last_seen_at.desc&limit=8`),
      ])
      if (sRes.ok) { const r = await sRes.json(); voiceNotes = r?.[0]?.voice_notes || '' }
      if (pRes.ok) voicePhrases = await pRes.json()
    } catch { /* non-fatal — score on tone descriptors alone */ }
  }

  // The richest grounding signal: what the clinician ACTUALLY said in this clip.
  // Capped so a multi-minute transcript can't blow the context or drown the voice
  // phrases. Paraphrase-not-quote keeps captions natural rather than transcript dumps.
  const clipSaid = String(clipTranscript || '').replace(/\s+/g, ' ').trim().slice(0, 1500)

  const systemLines = [
    'You write short, compelling social media captions for a clinical practitioner.',
    `Tone: ${toneHint}. Write 1-2 sentences only. Do NOT use hashtags. Do NOT include a call to action.`,
    'Speak from the practitioner\'s perspective as if they\'re sharing something meaningful.',
  ]
  // Inject the clip transcript FIRST among the grounding signals so it — together
  // with the voice phrases below — dominates over the generic tone descriptors.
  // Split of duties matters: the transcript supplies WHAT to say (the substance,
  // the specific moment), the voice phrases below supply HOW to say it (rhythm,
  // word choice, clinical framing). Grounding the substance must not flatten the
  // voice — keep both.
  if (clipSaid) {
    systemLines.push(
      'What the clinician actually said in this specific clip — use this for the SUBSTANCE of the ' +
      'caption (anchor to this specific moment; paraphrase, don\'t quote verbatim, and don\'t invent ' +
      'anything not implied here). Still render it in the clinician\'s own voice and clinical framing ' +
      '(see the voice phrases below):\n' +
      clipSaid
    )
  }
  if (voicePhrases.length) {
    systemLines.push(
      'The clinician\'s authentic voice — match this rhythm, cadence, and word choice (don\'t quote verbatim):\n' +
      voicePhrases.map((p) => `- "${p.phrase}"`).join('\n')
    )
  }
  if (voiceNotes.trim()) {
    systemLines.push(`Voice notes for this clinician: ${voiceNotes.trim().slice(0, 400)}`)
  }
  if (priorThinking) {
    systemLines.push(`The practitioner's prior thinking on this topic: ${priorThinking}`)
    systemLines.push('Echo their specific clinical framing naturally — don\'t copy phrases verbatim.')
  }
  // Campaign context — tightens the caption to the campaign goal. The
  // content_style flag changes the register:
  //   • promotional  — pitch-y, urgency, drives toward event
  //   • relationship — warm, community, NO clinical talk
  //   • clinical     — default (no extra instruction)
  if (campaign) {
    if (campaign.theme_notes) {
      systemLines.push(`This caption is part of an active campaign: ${campaign.name}. Campaign theme: ${campaign.theme_notes}`)
    } else if (campaign.name) {
      systemLines.push(`This caption is part of an active campaign: ${campaign.name}.`)
    }
    if (campaign.content_style === 'promotional') {
      systemLines.push('Style: promotional. Subtly orient the reader toward an upcoming event — don\'t hard-sell, but make it clear something specific is happening.')
    } else if (campaign.content_style === 'relationship') {
      systemLines.push('Style: relationship — warm, community-focused. Do NOT talk about clinical care, assessments, or treatment. Focus on the people, the relationship, the moment.')
    }
  }

  const { text } = await generateText({
    // Sonnet, matching the long-form blog path (api/content-items/regenerate.js)
    // that scores ~7.3 voice fidelity — captions are the highest-volume text the
    // pipeline emits and ride every clip, so they earn the better model.
    model: 'anthropic/claude-sonnet-4-6',
    system: systemLines.join('\n'),
    messages: [{
      role: 'user',
      content: `Topic: ${topic}
Clip context: ${clipContext || '(clinical care photo/video)'}

Write a caption (1-2 sentences, no hashtags, no CTA):`,
    }],
    maxOutputTokens: 200,
  })

  return text.trim().replace(/^["']|["']$/g, '')
}

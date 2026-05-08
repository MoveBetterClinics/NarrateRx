import { generateObject } from 'ai'
import { z } from 'zod'
import { brand } from '../../src/lib/brand.js'

// Phase 3: AI segmenter for clinic-capture footage. Reads the transcription
// Phase 2 already produced (and the visual narrative when available) and
// surfaces 1–5 "edit briefs" — moments worth turning into a finished, branded
// clip. Each brief becomes a content_pieces row that the in-house contractor
// (Philip, or whoever is on the Media page) reviews, accepts, takes to
// CapCut Pro to edit, and uploads back. The edited media then lives in the
// library and gets attached to posts in Content Hub.
//
// Source = treatment sessions captured by an admin observer in clinic. The
// camera person is filming clinicians treating patients: explanations, demos,
// concept teaching, patient movement. There is significant clinician–patient
// dialog. Patients are universally on camera or audible, so every brief
// carries an implicit "verify consent before publishing" surface.
//
// Operates on transcript + visual narrative text — not the video file — so
// long sessions stay cheap (~$0.03–0.05 per call). Talks to Claude Sonnet 4.6
// through the Vercel AI Gateway using the AI_GATEWAY_API_KEY already in env
// from Phase 2.

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const MODEL = 'anthropic/claude-sonnet-4-6'

function brandId() {
  return (process.env.BRAND || process.env.VITE_BRAND || 'people').toLowerCase()
}

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

const PLATFORMS = ['reels', 'feed', 'story', 'shorts', 'tiktok', 'gbp', 'newsletter']

const momentSchema = z.object({
  source_quote: z.string().min(8).max(800),
  ai_suggested_platform: z.enum(PLATFORMS),
  ai_caption: z.string().min(8).max(2200),
  ai_hashtags: z.array(z.string()).max(8).default([]),
  ai_cta_text: z.string().max(120).default(''),
  ai_reasoning: z.string().max(240),
})

const segmenterOutput = z.object({
  moments: z.array(momentSchema).min(1).max(5),
})

const ROLE_FRAMINGS = {
  clinician: {
    setting:
      'An admin observer is filming inside the clinic while clinicians treat patients. The footage captures real clinical work: clinicians explaining concepts to patients, demonstrating movements, walking through assessments, and patients responding. The goal is to show the public how this clinic actually works — the unique nature of treatment and patient experience — without staging or sales pressure.',
    momentCriteria: [
      'A clinician explaining the WHY behind a treatment choice or movement principle',
      'A demonstration that visibly teaches something (a movement pattern, an assessment, a cue)',
      'A patient–clinician exchange that reveals the unique nature of how this clinic works',
      'Specific, not abstract — vivid analogy, counterintuitive insight, or clear teaching beat',
      'Quotable on its own',
    ],
    consentNote:
      'EVERY brief from a clinician-role source involves a patient on camera or audible. Patient written/verbal consent must be verified by the contractor before publishing — the queue UI surfaces this; do not soften that requirement in your captions.',
  },
  admin: {
    setting:
      'An admin staff member is being interviewed about life behind the scenes at the clinic — operations, business decisions, working with patients on the non-clinical side, navigating the healthcare system, and the human story of running a movement-medicine practice. They are NOT clinicians; do not surface anything that sounds like clinical advice or treatment claims from them.',
    momentCriteria: [
      'An operational or behind-the-scenes story that humanizes the clinic',
      'A moment that explains how the practice navigates the healthcare system, insurance, or patient experience outside treatment',
      'A business / journey beat (why the clinic was started, how it has grown, lessons learned)',
      'A specific concrete example — a problem solved, a workflow, a moment that shaped the practice',
      'Quotable on its own',
    ],
    consentNote:
      'No patients should be referenced by identifying details. If the speaker mentions a specific patient interaction, anonymize in your draft caption.',
  },
  patient_guest: {
    setting:
      'A patient guest is on camera sharing their experience with the clinic. (Inert until the consent gate ships — segmenter should produce briefs cautiously and flag every output as patient-guest content for human review.)',
    momentCriteria: [
      'A specific lived-experience moment told in the patient\'s own words',
      'A turning point, realization, or instruction that landed for the patient',
      'NEVER an outcome guarantee — frame as personal experience, not promise',
    ],
    consentNote:
      'EVERY brief from a patient-guest source REQUIRES verified written consent before publishing. Mark every caption draft with a "verify consent" reminder until the consent-tracking gate ships.',
  },
}

function buildSystemPrompt(speakerRole = 'clinician') {
  const role = ROLE_FRAMINGS[speakerRole] || ROLE_FRAMINGS.clinician
  const lines = [
    `You are a senior social media editor for ${brand.appName} (${brand.location}).`,
    '',
    role.setting,
    '',
    'You are reading the transcript (and a brief visual narrative when present) of one such captured clip. Your job: identify the 1–5 strongest moments worth editing into finished, reusable social clips. Each moment becomes an "edit brief" the contractor reviews, accepts, and takes to CapCut Pro to produce a finished file. Lengthier sources yield more briefs (rough rule: one brief per 5–7 minutes of source). Pick fewer if the source is short, repetitive, or thin.',
    '',
    `Clinic context: ${brand.prompt.clinicContext}`,
    '',
    `Audience: ${brand.prompt.audienceShort}`,
    '',
    'Brand voice:',
    brand.prompt.brandVoice,
    '',
    'A "moment worth editing" is:',
    '- A self-contained idea that lands in 15–60 seconds of speech and/or demonstration',
    ...role.momentCriteria.map((c) => `- ${c}`),
    '',
    'Constraints (medical / clinical content — important):',
    '- Educational framing, not testimonial. Prefer "here\'s why this happens" over outcome claims.',
    '- Never imply diagnostic or treatment guarantees ("cures", "fixes for good", "100%").',
    '- Don\'t reference patient identity beyond what is provided in the source metadata.',
    `- ${role.consentNote}`,
    '- Tone: clinical-but-accessible. No jargon, no hype.',
    '',
    'Platforms (for the contractor\'s reference — they may override):',
    '- reels       — 9:16, hook-first, 15–30s (Instagram/Facebook Reels)',
    '- feed        — 1:1 or 4:5, slower pace OK (Instagram/Facebook feed)',
    '- story       — 9:16, ephemeral, simpler',
    '- shorts      — YouTube vertical, 15–60s',
    '- tiktok      — 9:16, casual tone',
    '- gbp         — Google Business Profile post, professional, strong CTA',
    '- newsletter  — long-form excerpt for the weekly email',
    '',
    'For each moment, output:',
    '- source_quote        — verbatim transcript chunk (1–3 sentences) the moment is built around. If the moment is primarily visual demonstration with little dialog, summarize what is shown in 1–2 sentences and prefix with "[demo]".',
    '- ai_suggested_platform — single best fit from the list above (advisory only; contractor may change)',
    '- ai_caption          — draft caption in brand voice, platform-appropriate length',
    `- ai_hashtags         — 3–8 hashtags. Include ${brand.prompt.brandHashtag} where it fits.`,
    `- ai_cta_text         — short CTA (e.g. "Book at ${brand.prompt.spokenUrl}", "Read more on the blog")`,
    '- ai_reasoning        — 1 sentence: why this moment is worth editing',
  ]
  return lines.join('\n')
}

function buildUserMessage(asset) {
  const lines = []

  if (asset.visual_narrative && String(asset.visual_narrative).trim()) {
    lines.push('Visual narrative (what the camera shows):', asset.visual_narrative.trim(), '')
  }

  lines.push('Spoken transcript:', '', asset.transcription || '(no transcription available)')

  const meta = []
  if (Array.isArray(asset.ai_tags) && asset.ai_tags.length) meta.push(`tags: ${asset.ai_tags.join(', ')}`)
  if (asset.condition) meta.push(`condition: ${asset.condition}`)
  if (asset.patient_pseudonym) meta.push(`patient pseudonym: ${asset.patient_pseudonym} (a patient is on camera/audible — every brief from this clip needs consent verification before publishing)`)
  if (asset.notes) meta.push(`uploader notes: ${asset.notes}`)
  if (meta.length) {
    lines.push('', 'Metadata:', ...meta.map((m) => `- ${m}`))
  }
  return lines.join('\n')
}

async function callModel(asset) {
  if (!process.env.AI_GATEWAY_API_KEY) {
    throw new Error('AI_GATEWAY_API_KEY is not set on this deployment')
  }
  const hasTranscript = asset.transcription && String(asset.transcription).trim()
  const hasNarrative = asset.visual_narrative && String(asset.visual_narrative).trim()
  if (!hasTranscript && !hasNarrative) {
    throw new Error('Asset has no transcription or visual narrative to segment (run Phase 2 tagging first)')
  }

  const speakerRole = asset.speaker_role || 'clinician'
  const { object } = await generateObject({
    model: MODEL,
    schema: segmenterOutput,
    system: buildSystemPrompt(speakerRole),
    messages: [{ role: 'user', content: buildUserMessage(asset) }],
    temperature: 0.4,
  })

  return object.moments
}

function buildRows(asset, moments, generatedAt) {
  return moments.map((m) => ({
    brand: asset.brand,
    source_asset_id: asset.id,
    source_quote: m.source_quote,
    ai_suggested_platform: m.ai_suggested_platform,
    ai_caption: m.ai_caption,
    ai_hashtags: m.ai_hashtags || [],
    ai_cta_text: m.ai_cta_text || null,
    ai_reasoning: m.ai_reasoning,
    ai_model: MODEL,
    ai_generated_at: generatedAt,
    // Seed final_* with AI proposal so the editor edits in place rather than
    // re-typing. target_platform mirrors AI suggestion until editor changes it.
    final_caption: m.ai_caption,
    final_hashtags: m.ai_hashtags || [],
    final_cta_text: m.ai_cta_text || null,
    target_platform: m.ai_suggested_platform,
    status: 'suggested',
  }))
}

// Run the segmenter on an existing tagged interview row and persist the
// content_pieces it produces. On failure: stamp `notes` on the source asset
// (mirroring tagAsset.js) and rethrow.
export async function segmentAndPersist(asset) {
  if (asset.kind !== 'video') {
    // No-op for photos in v1. Phase 3c may revisit.
    return []
  }
  const where = `id=eq.${asset.id}&brand=eq.${brandId()}`
  try {
    const moments = await callModel(asset)
    if (!moments?.length) return []

    const rows = buildRows(asset, moments, new Date().toISOString())
    const ins = await sb('content_pieces', { method: 'POST', body: JSON.stringify(rows) })
    if (!ins.ok) {
      const text = await ins.text()
      throw new Error(`content_pieces insert failed: ${text}`)
    }
    return await ins.json()
  } catch (e) {
    const message = e?.message || 'Segmentation failed'
    const stamp = new Date().toISOString()
    const noteLine = `[ai-segment ${stamp}] ${message}`
    const merged = asset.notes ? `${asset.notes}\n${noteLine}` : noteLine
    await sb(`media_assets?${where}`, {
      method: 'PATCH',
      body: JSON.stringify({ notes: merged }),
    }).catch(() => {})
    throw e
  }
}

// Look up an asset by id (brand-scoped) and run segmentAndPersist. Used by
// the manual /api/media/segment endpoint.
export async function segmentById(id) {
  const where = `id=eq.${id}&brand=eq.${brandId()}`
  const lookup = await sb(
    `media_assets?${where}&select=id,brand,kind,status,blob_url,mime_type,tags,ai_tags,transcription,visual_narrative,speaker_role,condition,patient_pseudonym,notes`,
  )
  if (!lookup.ok) throw new Error('Database error')
  const rows = await lookup.json()
  const asset = rows[0]
  if (!asset) throw new Error('Not found')
  return segmentAndPersist(asset)
}

import { generateObject } from 'ai'
import { z } from 'zod'
import { brand } from '../../src/lib/brand.js'

// Phase 3: AI segmenter. Reads the transcription Phase 2 already produced and
// surfaces 1–5 post-worthy "moments" from an interview as content_pieces rows.
// Each moment becomes a draft post the in-house editor reviews, accepts, and
// renders offline (CapCut etc.) before publishing.
//
// Operates on transcript text — not the video file — so 30-min interviews are
// still cheap (~$0.03–0.05 per call). Talks to Claude Sonnet 4.6 through the
// Vercel AI Gateway using the AI_GATEWAY_API_KEY already in env from Phase 2.

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

function buildSystemPrompt() {
  const lines = [
    `You are a senior social media editor for ${brand.appName} (${brand.location}).`,
    '',
    'You are reading the transcript of an interview recorded at the clinic. Your job: identify the 1–5 most post-worthy moments and propose them as draft social posts. Lengthier interviews yield more pieces (rough rule: one moment per 5–7 minutes of source). Pick fewer if the transcript is short, redundant, or thin.',
    '',
    `Clinic context: ${brand.prompt.clinicContext}`,
    '',
    `Audience: ${brand.prompt.audienceShort}`,
    '',
    'Brand voice:',
    brand.prompt.brandVoice,
    '',
    'A "post-worthy moment" is:',
    '- A self-contained idea that lands in 15–60 seconds of speech',
    '- Specific, not abstract — a story, vivid analogy, counterintuitive insight, or clear answer',
    '- Quotable — could stand alone as a caption pull-quote',
    '- A natural fit for at least one of the platforms below',
    '',
    'Constraints (medical / clinical content — important):',
    '- Educational framing, not testimonial. Prefer "here\'s why this happens" over outcome claims.',
    '- Never imply diagnostic or treatment guarantees ("cures", "fixes for good", "100%").',
    '- Don\'t reference patient identity beyond what is provided in the source metadata.',
    '- Tone: clinical-but-accessible. No jargon, no hype.',
    '',
    'Platforms:',
    '- reels       — 9:16, hook-first, 15–30s (Instagram/Facebook Reels)',
    '- feed        — 1:1 or 4:5, slower pace OK (Instagram/Facebook feed)',
    '- story       — 9:16, ephemeral, simpler',
    '- shorts      — YouTube vertical, 15–60s',
    '- tiktok      — 9:16, casual tone',
    '- gbp         — Google Business Profile post, professional, strong CTA',
    '- newsletter  — long-form excerpt for the weekly email',
    '',
    'For each moment, output:',
    '- source_quote        — verbatim transcript chunk (1–3 sentences) the moment is built around',
    '- ai_suggested_platform — single best fit from the list above',
    '- ai_caption          — draft caption in brand voice, platform-appropriate length',
    `- ai_hashtags         — 3–8 hashtags. Include ${brand.prompt.brandHashtag} where it fits.`,
    `- ai_cta_text         — short CTA (e.g. "Book at ${brand.prompt.spokenUrl}", "Read more on the blog")`,
    '- ai_reasoning        — 1 sentence: why this moment is post-worthy',
  ]
  return lines.join('\n')
}

function buildUserMessage(asset) {
  const lines = ['Source interview transcript:', '', asset.transcription || '(no transcription available)']
  const meta = []
  if (Array.isArray(asset.ai_tags) && asset.ai_tags.length) meta.push(`tags: ${asset.ai_tags.join(', ')}`)
  if (asset.condition) meta.push(`condition: ${asset.condition}`)
  if (asset.patient_pseudonym) meta.push(`patient pseudonym: ${asset.patient_pseudonym} (verify written consent before publishing any piece derived from this interview)`)
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
  if (!asset.transcription || !String(asset.transcription).trim()) {
    throw new Error('Asset has no transcription to segment (run Phase 2 tagging first)')
  }

  const { object } = await generateObject({
    model: MODEL,
    schema: segmenterOutput,
    system: buildSystemPrompt(),
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
    `media_assets?${where}&select=id,brand,kind,status,blob_url,mime_type,tags,ai_tags,transcription,condition,patient_pseudonym,notes`,
  )
  if (!lookup.ok) throw new Error('Database error')
  const rows = await lookup.json()
  const asset = rows[0]
  if (!asset) throw new Error('Not found')
  return segmentAndPersist(asset)
}

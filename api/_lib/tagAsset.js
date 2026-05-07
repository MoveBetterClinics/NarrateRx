import { generateObject } from 'ai'
import { z } from 'zod'
import { brand } from '../../src/lib/brand.js'
import { recordAudit, snapshot } from './audit.js'

// Shared AI auto-tagging logic. Used by api/media/tag.js (manual button)
// and api/media/upload.js (auto-kick on upload). Talks to the Vercel AI
// Gateway with a plain `provider/model` string (AI_GATEWAY_API_KEY in env).

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const MODEL = 'google/gemini-2.5-flash'

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

const VOCAB = {
  people:  'human anatomy and movement: low-back, mid-back, neck, shoulder, hip, knee, ankle, glute, hamstring, hinge, brace, breathing, runner, lifter, climber, post-op, senior',
  equine:  'horse anatomy and gait: poll, withers, thoracic, lumbar, sacrum, hip, stifle, hock, fetlock, shoulder, neck, lead-refusal, posture, mobile-visit, dressage, jumping, trail',
  animals: 'companion-animal anatomy: hip, stifle, shoulder, neck, spine, tail, gait, senior-dog, working-dog, agility, hiking-companion, post-surgical, mobility, dog, cat',
}

function buildSystemPrompt(kind) {
  const id = brandId()
  const vocab = VOCAB[id] || VOCAB.people
  const lines = [
    `You are tagging clinical media for a ${brand.prompt.clinicContext}`,
    `Audience: ${brand.prompt.audienceShort}`,
    `Relevant context: ${brand.prompt.sportContext}.`,
    `Anatomy / scene vocabulary to prefer: ${vocab}.`,
    '',
    'Return 4–8 short, lowercase, kebab-case tags that describe what is visibly happening in this clip. Use single tokens or short phrases (e.g. "low-back", "post-op", "senior-dog", "lead-refusal"). Avoid filler tags like "video", "photo", "person", or generic camera/edit terms.',
  ]
  if (kind === 'video') {
    lines.push(
      '',
      'If the clip contains spoken word, also return a clean transcription with light punctuation. Skip filler, music notes, or onscreen text. If there is no speech, return an empty string.',
      '',
      'Also return a short visual_narrative (1–3 sentences) describing what the camera shows beat-by-beat — the demonstration, the patient movement, the clinician\'s hands, what is being taught visually. This is paired with the transcript downstream so an editor can spot moments where the visual is the primary signal. If the clip is unremarkable visually, return a single sentence summarizing what is shown.',
    )
  }
  return lines.join('\n')
}

const photoSchema = z.object({
  tags: z.array(z.string()).min(1).max(10),
})

const videoSchema = z.object({
  tags:             z.array(z.string()).min(1).max(10),
  transcription:    z.string(),
  visual_narrative: z.string(),
})

function normalizeTag(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/['’"`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function normalizeTags(tags, existingUserTags = []) {
  const lowerExisting = new Set((existingUserTags || []).map((t) => String(t).toLowerCase()))
  const seen = new Set()
  const out = []
  for (const t of tags || []) {
    const norm = normalizeTag(t)
    if (!norm) continue
    if (norm.length > 40) continue
    if (lowerExisting.has(norm) || seen.has(norm)) continue
    seen.add(norm)
    out.push(norm)
    if (out.length >= 8) break
  }
  return out
}

async function callModel(asset) {
  if (!process.env.AI_GATEWAY_API_KEY) {
    throw new Error('AI_GATEWAY_API_KEY is not set on this deployment')
  }
  if (!asset.blob_url) {
    throw new Error('Asset has no blob_url to analyze')
  }

  const isVideo = asset.kind === 'video'
  const userParts = [
    { type: 'text', text: isVideo
        ? 'Watch this clip and return tags + transcription as specified.'
        : 'Look at this image and return tags as specified.' },
    {
      type: 'file',
      data: asset.blob_url,
      mediaType: asset.mime_type || (isVideo ? 'video/mp4' : 'image/jpeg'),
    },
  ]

  const { object } = await generateObject({
    model: MODEL,
    schema: isVideo ? videoSchema : photoSchema,
    system: buildSystemPrompt(asset.kind),
    messages: [{ role: 'user', content: userParts }],
    temperature: 0.2,
  })

  const ai_tags = normalizeTags(object.tags, asset.tags)
  const transcription = isVideo ? (object.transcription || '').trim() : null
  const visual_narrative = isVideo ? (object.visual_narrative || '').trim() : null
  return { ai_tags, transcription, visual_narrative }
}

// Run AI tagging on an existing media_assets row and persist the result.
// On success: PATCH ai_tags + (video) transcription, status='tagged', return the row.
// On failure: stamp the failure into `notes` and rethrow.
export async function tagAndPersist(asset) {
  const where = `id=eq.${asset.id}&brand=eq.${brandId()}`
  try {
    const { ai_tags, transcription, visual_narrative } = await callModel(asset)
    const patch = { ai_tags, status: 'tagged' }
    if (asset.kind === 'video') {
      patch.transcription = transcription
      patch.visual_narrative = visual_narrative
    }

    const upd = await sb(`media_assets?${where}`, { method: 'PATCH', body: JSON.stringify(patch) })
    if (!upd.ok) {
      const text = await upd.text()
      throw new Error(`Update failed: ${text}`)
    }
    const data = await upd.json()
    const after = data[0] ?? null

    // Audit AI tagging as a 'tag' action with actor='system'. before/after
    // snapshots let us see exactly what tags + transcription the AI produced.
    await recordAudit({
      assetId: asset.id,
      action:  'tag',
      actor:   'system',
      before:  snapshot(asset),
      after:   snapshot(after),
    })

    return after
  } catch (e) {
    const message = e?.message || 'Tagging failed'
    const stamp = new Date().toISOString()
    const noteLine = `[ai-tag ${stamp}] ${message}`
    const merged = asset.notes ? `${asset.notes}\n${noteLine}` : noteLine
    await sb(`media_assets?${where}`, { method: 'PATCH', body: JSON.stringify({ notes: merged }) }).catch(() => {})
    throw e
  }
}

// Look up an asset by id (brand-scoped) and run tagAndPersist on it.
export async function tagById(id) {
  const where = `id=eq.${id}&brand=eq.${brandId()}`
  const lookup = await sb(`media_assets?${where}&select=id,brand,kind,status,blob_url,mime_type,tags,notes`)
  if (!lookup.ok) throw new Error('Database error')
  const rows = await lookup.json()
  const asset = rows[0]
  if (!asset) throw new Error('Not found')
  return tagAndPersist(asset)
}

import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateObject } from 'ai'
import ffmpegStaticPath from 'ffmpeg-static'
import { z } from 'zod'
import { recordAudit, snapshot } from './audit.js'

function requireScope(scope) {
  if (!scope?.workspace) {
    throw new Error('tagAsset: workspace scope is required (caller must pass a resolved scope)')
  }
  return scope
}

// Shared AI auto-tagging logic. Used by api/media/tag.js (manual button)
// and api/media/upload.js (auto-kick on upload). Talks to the Vercel AI
// Gateway with a plain `provider/model` string (AI_GATEWAY_API_KEY in env).

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const MODEL = 'google/gemini-2.5-flash'

// Gemini's inline-data cap on Vertex (the path the AI Gateway uses) is ~20 MB
// per request, after base64 inflation. Anything larger handed to the SDK as a
// URL (which it fetches + base64-encodes) returns "Request contains an invalid
// argument". Workaround: for videos at or above PROXY_TRIGGER_BYTES, download
// + transcode to a 720p/CRF30/64k-mono proxy capped at 18 MB, then hand the
// model the proxy bytes. Original blob is untouched — editors still get full
// quality in CapCut downstream.
const PROXY_TRIGGER_BYTES = 15 * 1024 * 1024
const PROXY_MAX_OUTPUT    = '18000000'                          // ffmpeg -fs

// Binary resolution priority:
//   1. FFMPEG_PATH env (lets ops point at a system binary if needed)
//   2. ffmpeg-static (bundled, ships per-platform — used in production on
//      Vercel because the function runtime has no system ffmpeg)
//   3. 'ffmpeg' on PATH (local dev fallback)
const FFMPEG_BIN = process.env.FFMPEG_PATH || ffmpegStaticPath || 'ffmpeg'

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

function buildSystemPrompt(kind, scope) {
  const ws = scope.workspace
  // VOCAB key resolution: workspace_id scopes use the workspace slug. Move
  // Better workspaces use slugs prefixed `movebetter-<paradigm>` (per memory:
  // animals slug is `movebetter-animals` with the s). External tenants fall
  // back to the people vocabulary.
  const slug = ws?.slug || ''
  const vocabKey =
    slug === 'movebetter-equine'  ? 'equine'  :
    slug === 'movebetter-animals' ? 'animals' :
    slug === 'movebetter-people'  ? 'people'  :
    VOCAB[slug] ? slug : 'people'
  const vocab = VOCAB[vocabKey]
  const lines = [
    `You are tagging clinical media for a ${ws.clinic_context}`,
    `Audience: ${ws.audience_short}`,
    `Relevant context: ${ws.activity_context}.`,
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

// Download the blob locally and ffmpeg-transcode to a small H.264 proxy that
// fits under Gemini's inline cap. Returns the proxy bytes; caller is
// responsible for handing them to the model. Originals are never modified.
async function transcodeProxy(blobUrl) {
  const dir     = await mkdtemp(join(tmpdir(), 'tagproxy-'))
  const inPath  = join(dir, 'in.bin')
  const outPath = join(dir, 'out.mp4')
  try {
    const res = await fetch(blobUrl)
    if (!res.ok) throw new Error(`Proxy download failed: ${res.status}`)
    await writeFile(inPath, Buffer.from(await res.arrayBuffer()))

    await new Promise((resolve, reject) => {
      const args = [
        '-y', '-i', inPath,
        '-vf', "scale='min(720,iw)':-2",
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30',
        '-c:a', 'aac', '-b:a', '64k', '-ac', '1',
        '-movflags', '+faststart',
        '-fs', PROXY_MAX_OUTPUT,
        outPath,
      ]
      const proc = spawn(FFMPEG_BIN, args, { stdio: ['ignore', 'ignore', 'pipe'] })
      let stderr = ''
      proc.stderr.on('data', (d) => { stderr += d.toString() })
      proc.on('error', (e) => reject(new Error(`ffmpeg spawn failed (${e.code || e.message}); set FFMPEG_PATH or install ffmpeg`)))
      proc.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-400).trim()}`))
      })
    })

    return await readFile(outPath)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

async function callModel(asset, scope) {
  if (!process.env.AI_GATEWAY_API_KEY) {
    throw new Error('AI_GATEWAY_API_KEY is not set on this deployment')
  }
  if (!asset.blob_url) {
    throw new Error('Asset has no blob_url to analyze')
  }

  const isVideo  = asset.kind === 'video'
  const sizeBytes = Number(asset.size_bytes || 0)
  const needsProxy = isVideo && sizeBytes >= PROXY_TRIGGER_BYTES

  const fileData = needsProxy ? await transcodeProxy(asset.blob_url) : asset.blob_url
  const mediaType = needsProxy
    ? 'video/mp4'
    : (asset.mime_type || (isVideo ? 'video/mp4' : 'image/jpeg'))

  const userParts = [
    { type: 'text', text: isVideo
        ? 'Watch this clip and return tags + transcription as specified.'
        : 'Look at this image and return tags as specified.' },
    { type: 'file', data: fileData, mediaType },
  ]

  const { object } = await generateObject({
    model: MODEL,
    schema: isVideo ? videoSchema : photoSchema,
    system: buildSystemPrompt(asset.kind, scope),
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
export async function tagAndPersist(asset, scope) {
  const s = requireScope(scope)
  const where = `id=eq.${asset.id}&${s.column}=eq.${s.id}`
  try {
    const { ai_tags, transcription, visual_narrative } = await callModel(asset, s)
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
      scope:   s,
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

// Look up an asset by id (workspace-scoped) and run tagAndPersist on it.
export async function tagById(id, scope) {
  const s = requireScope(scope)
  const where = `id=eq.${id}&${s.column}=eq.${s.id}`
  const lookup = await sb(`media_assets?${where}&select=id,${s.column},kind,status,blob_url,mime_type,size_bytes,tags,notes`)
  if (!lookup.ok) throw new Error('Database error')
  const rows = await lookup.json()
  const asset = rows[0]
  if (!asset) throw new Error('Not found')
  return tagAndPersist(asset, s)
}

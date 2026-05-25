#!/usr/bin/env node
// Re-train Q's ElevenLabs voice clone from accumulated interview audio.
//
// Fetches all interviews with audio_recording_url set for the target clinician,
// downloads the audio files, submits them to ElevenLabs to create a new IVC
// voice, then updates clinicians.eleven_voice_id with the new voice_id.
//
// The old voice is deleted from ElevenLabs after the new one is confirmed.
//
// Usage:
//   node scripts/reclone-voice.mjs [--workspace=<slug>] [--dry-run] [--max=<n>]
//
// Options:
//   --workspace=<slug>  Target workspace (default: movebetter-people)
//   --dry-run           Show what would happen; no ElevenLabs API calls
//   --max=<n>           Cap number of audio files submitted (default: 20, max: 25)
//
// Required env (read from .env.local):
//   SUPABASE_URL, SUPABASE_SERVICE_KEY, ELEVENLABS_API_KEY

import { readFile, writeFile, unlink } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const ROOT    = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const envText = await readFile(join(ROOT, '.env.local'), 'utf8').catch(() => '')
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
}

const args      = process.argv.slice(2)
const DRY_RUN   = args.includes('--dry-run')
const wsSlug    = args.find((a) => a.startsWith('--workspace='))?.split('=')[1] ?? 'movebetter-people'
const maxFiles  = parseInt(args.find((a) => a.startsWith('--max='))?.split('=')[1] ?? '20', 10)

const need = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'ELEVENLABS_API_KEY']
for (const k of need) {
  if (!process.env[k] || process.env[k].includes('REDACTED')) {
    console.error(`Missing or redacted env: ${k}`); process.exit(1)
  }
}

const SUPABASE_URL  = process.env.SUPABASE_URL
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY
const ELEVEN_KEY    = process.env.ELEVENLABS_API_KEY

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json', ...init.headers,
    },
  })
}

// ── Resolve workspace + clinician ──────────────────────────────────────────
const wsRes = await sb(`workspaces?slug=eq.${encodeURIComponent(wsSlug)}&select=id,slug&limit=1`)
if (!wsRes.ok) { console.error(`workspaces fetch ${wsRes.status}`); process.exit(1) }
const [ws] = await wsRes.json()
if (!ws) { console.error(`No workspace: ${wsSlug}`); process.exit(1) }

const clRes = await sb(
  `clinicians?workspace_id=eq.${ws.id}&user_id=not.is.null&select=id,name,eleven_voice_id&order=created_at.asc&limit=1`
)
if (!clRes.ok) { console.error(`clinicians fetch ${clRes.status}`); process.exit(1) }
const [cl] = await clRes.json()
if (!cl) { console.error(`No Self-clinician in ${wsSlug}`); process.exit(1) }

console.log(`Workspace  : ${ws.slug}`)
console.log(`Clinician  : ${cl.name} (${cl.id})`)
console.log(`Current ID : ${cl.eleven_voice_id ?? '(none)'}`)

// ── Fetch interviews with audio ────────────────────────────────────────────
const ivRes = await sb(
  `interviews?workspace_id=eq.${ws.id}&clinician_id=eq.${cl.id}` +
  `&audio_recording_url=not.is.null&status=eq.completed` +
  `&select=id,audio_recording_url,created_at` +
  `&order=created_at.desc&limit=${maxFiles}`
)
if (!ivRes.ok) { console.error(`interviews fetch ${ivRes.status}`); process.exit(1) }
const interviews = await ivRes.json()

console.log(`\nAudio recordings found: ${interviews.length}`)
if (interviews.length === 0) {
  console.log('No recordings yet. Complete an interview with audio capture enabled first.')
  process.exit(0)
}

interviews.forEach((iv, i) => {
  const date = new Date(iv.created_at).toISOString().slice(0, 10)
  console.log(`  ${i + 1}. ${date}  ${iv.audio_recording_url}`)
})

if (DRY_RUN) {
  console.log('\n(dry-run) Would submit these files to ElevenLabs to recreate the voice clone.')
  process.exit(0)
}

// ── Download audio files to tmp ────────────────────────────────────────────
console.log('\nDownloading audio files...')
const tmpFiles = []
try {
  for (const iv of interviews) {
    const url = iv.audio_recording_url
    const ext = url.split('.').pop().split('?')[0] || 'webm'
    const tmpPath = join(tmpdir(), `narraterx-voice-${iv.id}.${ext}`)
    process.stdout.write(`  Downloading ${basename(url)}... `)
    const r = await fetch(url)
    if (!r.ok) { console.log(`SKIP (${r.status})`); continue }
    const buf = Buffer.from(await r.arrayBuffer())
    await writeFile(tmpPath, buf)
    console.log(`OK (${(buf.length / 1024 / 1024).toFixed(1)} MB)`)
    tmpFiles.push({ path: tmpPath, ext, size: buf.length })
  }
} catch (e) {
  console.error('Download failed:', e?.message)
  process.exit(1)
}

if (tmpFiles.length === 0) {
  console.log('All downloads failed. Cannot reclone.')
  process.exit(1)
}

// ── Submit to ElevenLabs — create new IVC voice ────────────────────────────
console.log(`\nSubmitting ${tmpFiles.length} file(s) to ElevenLabs...`)

const form = new FormData()
form.append('name',        `${cl.name} (NarrateRx interviews)`)
form.append('description', `Auto-trained from ${tmpFiles.length} NarrateRx interview session(s). Regenerated ${new Date().toISOString().slice(0, 10)}.`)

for (const { path, ext } of tmpFiles) {
  const buf  = await readFile(path)
  const mime = ext === 'mp4' ? 'audio/mp4' : ext === 'ogg' ? 'audio/ogg' : 'audio/webm'
  form.append('files', new Blob([buf], { type: mime }), basename(path))
}

const createRes = await fetch('https://api.elevenlabs.io/v1/voices/add', {
  method:  'POST',
  headers: { 'xi-api-key': ELEVEN_KEY },
  body:    form,
})

if (!createRes.ok) {
  const body = await createRes.text().catch(() => '')
  console.error(`ElevenLabs create failed ${createRes.status}: ${body.slice(0, 400)}`)
  process.exit(1)
}

const { voice_id: newVoiceId } = await createRes.json()
console.log(`New voice created: ${newVoiceId}`)

// ── Update clinicians.eleven_voice_id ──────────────────────────────────────
const patchRes = await sb(`clinicians?id=eq.${cl.id}`, {
  method: 'PATCH',
  body:   JSON.stringify({ eleven_voice_id: newVoiceId }),
})
if (!patchRes.ok) {
  const body = await patchRes.text().catch(() => '')
  console.error(`DB patch failed ${patchRes.status}: ${body.slice(0, 200)}`)
  console.log(`\nNEW VOICE ID: ${newVoiceId}`)
  console.log('Update clinicians.eleven_voice_id manually via Supabase Studio.')
  process.exit(1)
}
console.log(`DB updated: clinicians.eleven_voice_id = ${newVoiceId}`)

// ── Delete old voice from ElevenLabs (optional cleanup) ───────────────────
if (cl.eleven_voice_id && cl.eleven_voice_id !== newVoiceId) {
  const delRes = await fetch(`https://api.elevenlabs.io/v1/voices/${cl.eleven_voice_id}`, {
    method:  'DELETE',
    headers: { 'xi-api-key': ELEVEN_KEY },
  })
  if (delRes.ok) {
    console.log(`Old voice deleted: ${cl.eleven_voice_id}`)
  } else {
    console.warn(`Old voice delete failed (non-fatal) ${delRes.status} — remove manually if needed`)
  }
}

// ── Cleanup tmp files ──────────────────────────────────────────────────────
await Promise.all(tmpFiles.map(({ path }) => unlink(path).catch(() => {})))

console.log('\n✓ Voice clone re-trained successfully.')
console.log(`  Run: node scripts/generate-voice-samples.mjs  — to verify the new voice`)

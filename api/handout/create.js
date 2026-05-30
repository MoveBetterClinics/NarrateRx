// POST /api/handout/create
//
// Patient handout end-to-end pipeline (Phase 5 Feature 4, PR1):
//   1. Receive raw audio binary (clinician's 30–60s post-visit voice memo)
//   2. Upload to Vercel Blob
//   3. Transcribe via OpenAI Whisper
//   4. Find or create the clinician's row (same Self-clinician pattern as voice-memo)
//   5. Create an interviews row with capture_mode='patient_handout'
//   6. Generate the handout body via getPatientHandoutSystemPrompt
//   7. Insert a content_items row (platform='handout', status='draft')
//   8. Return { contentItemId, interviewId } — client redirects to /stories/<id>
//
// Gated by workspaces.patient_handouts_enabled — off by default; admin
// enables per workspace.

export const config = {
  runtime: 'nodejs',
  maxDuration: 300,
  api: { bodyParser: false },
}

import { put as blobPut } from '@vercel/blob'
import { createClerkClient } from '@clerk/backend'
import { generateText } from 'ai'
import { requireRole } from '../_lib/auth.js'
import { workspaceContext } from '../_lib/workspaceContext.js'
import { enforceLimit } from '../_lib/ratelimit.js'
import { getPatientHandoutSystemPrompt } from '../../src/lib/prompts.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const OPENAI_KEY   = process.env.OPENAI_API_KEY

const WHISPER_MAX_BYTES = 25 * 1024 * 1024 // OpenAI Whisper hard cap
const MODEL = 'anthropic/claude-sonnet-4-6'

let _clerk = null
function clerkClient() {
  if (!_clerk) _clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })
  return _clerk
}

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

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })

  // Flag gate. If a clinician somehow reaches the URL on a workspace that
  // hasn't been enabled, fail fast with a clear message rather than
  // silently spending the audio + transcribe + model budget.
  if (!ws.patient_handouts_enabled) {
    return res.status(403).json({ error: 'Patient handouts not enabled for this workspace.' })
  }

  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  if (!(await enforceLimit(req, res, 'media'))) return

  const { searchParams } = new URL(req.url, 'http://localhost')
  const rawFilename = searchParams.get('filename') || `handout-${Date.now()}.webm`
  const durationSec = parseInt(searchParams.get('durationSec') || '0', 10) || null
  const contentType = req.headers['content-type'] || 'audio/webm'

  // ── 1. Buffer audio ─────────────────────────────────────────────────────
  let audioBuffer
  try {
    audioBuffer = await readBody(req)
  } catch (e) {
    console.error(`[handout] body read failed ws=${ws.slug}: ${e?.message}`)
    return res.status(400).json({ error: 'Could not read request body' })
  }
  if (audioBuffer.byteLength === 0) {
    return res.status(400).json({ error: 'Empty audio body' })
  }
  if (audioBuffer.byteLength > WHISPER_MAX_BYTES) {
    const mb = Math.round(audioBuffer.byteLength / 1024 / 1024)
    return res.status(413).json({
      error: `Recording is ${mb}MB — the 25MB cap is around 90 min at standard quality. Re-record shorter or at a lower bitrate.`,
    })
  }

  // ── 2. Upload to Blob ───────────────────────────────────────────────────
  const safeName = rawFilename.replace(/[^a-z0-9._-]/gi, '_').slice(0, 80)
  const blobPath = `handouts/${ws.id}/${Date.now()}-${safeName}`
  let blobResult
  try {
    blobResult = await blobPut(blobPath, audioBuffer, {
      access: 'public',
      contentType,
      addRandomSuffix: false,
    })
  } catch (e) {
    console.error(`[handout] blob upload failed ws=${ws.slug}: ${e?.message}`)
    return res.status(502).json({ error: 'Audio upload failed — please try again.' })
  }

  // ── 3. Transcribe via Whisper ──────────────────────────────────────────
  if (!OPENAI_KEY) {
    return res.status(500).json({ error: 'Transcription not configured (OPENAI_API_KEY missing)' })
  }
  let transcript
  try {
    const ext = (safeName.match(/\.([a-z0-9]+)$/i)?.[1] || 'webm').toLowerCase()
    const form = new FormData()
    form.append('file', new Blob([audioBuffer], { type: contentType }), `audio.${ext}`)
    form.append('model', 'whisper-1')
    form.append('response_format', 'text')
    const wRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_KEY}` },
      body: form,
    })
    if (!wRes.ok) {
      const errTxt = await wRes.text().catch(() => '')
      throw new Error(`Whisper ${wRes.status}: ${errTxt.slice(0, 200)}`)
    }
    transcript = (await wRes.text()).trim()
    if (!transcript) throw new Error('Whisper returned an empty transcript')
  } catch (e) {
    console.error(`[handout] transcription error ws=${ws.slug}: ${e?.message}`)
    return res.status(502).json({ error: `Transcription failed: ${e?.message}` })
  }

  // ── 4. Find/create Self-clinician (mirrors voice-memo pattern) ─────────
  const wsFilter = `workspace_id=eq.${ws.id}`
  let staffId = null
  let staffName = 'Me'
  {
    const r = await sb(
      `staff?${wsFilter}&user_id=eq.${encodeURIComponent(auth.userId)}&select=id,name,voice_notes,eleven_voice_id&limit=1`
    )
    if (r.ok) {
      const rows = await r.json()
      if (rows.length) {
        staffId = rows[0].id
        staffName = rows[0].name || staffName
      }
    }
  }
  if (!staffId) {
    let name = 'Me'
    try {
      const user = await clerkClient().users.getUser(auth.userId)
      const full = [user.firstName, user.lastName].filter(Boolean).join(' ')
      name = full || user.username || user.primaryEmailAddress?.emailAddress?.split('@')[0] || 'Me'
    } catch (e) {
      console.warn(`[handout] could not fetch Clerk user: ${e?.message}`)
    }
    const cRes = await sb('staff', {
      method: 'POST',
      body: JSON.stringify({
        workspace_id: ws.id,
        name,
        user_id: auth.userId,
        created_by_id: auth.userId,
      }),
    })
    if (!cRes.ok) {
      const body = await cRes.text().catch(() => '')
      console.error(`[handout] staff create failed: ${body.slice(0, 300)}`)
      return res.status(500).json({ error: 'Could not create staff member record' })
    }
    const created = (await cRes.json())[0]
    staffId = created?.id
    staffName = created?.name || staffName
  }
  if (!staffId) {
    return res.status(500).json({ error: 'Clinician ID could not be determined' })
  }

  // Pull voice phrases for the prompt (top-weighted, capped).
  let voiceNotes = ''
  let voicePhrases = []
  {
    const r = await sb(
      `staff?id=eq.${staffId}&${wsFilter}&select=voice_notes`
    )
    if (r.ok) {
      const rows = await r.json()
      voiceNotes = rows[0]?.voice_notes || ''
    }
  }
  {
    const r = await sb(
      `staff_voice_phrases?staff_id=eq.${staffId}&${wsFilter}` +
      `&order=weight.desc&limit=12&select=phrase`
    )
    if (r.ok) {
      const rows = await r.json()
      voicePhrases = rows.map((p) => p.phrase).filter(Boolean)
    }
  }

  // ── 5. Create interview row ────────────────────────────────────────────
  const date = new Date().toLocaleDateString('en-CA')
  const topic = `Patient handout — ${date}`
  let interviewId = null
  {
    const r = await sb('interviews', {
      method: 'POST',
      body: JSON.stringify({
        workspace_id:              ws.id,
        staff_id:              staffId,
        owner_id:                  auth.userId,
        topic,
        status:                    'completed',
        capture_mode:              'patient_handout',
        source_audio_url:          blobResult.url,
        source_audio_duration_sec: durationSec,
        messages:                  [{ role: 'user', content: transcript }],
        tone:                      'smart',
        voice_mode:                'personal',
        generation_style:          'blog_post',
      }),
    })
    if (!r.ok) {
      const body = await r.text().catch(() => '')
      console.error(`[handout] interview create failed: ${body.slice(0, 300)}`)
      return res.status(500).json({ error: 'Could not save interview record' })
    }
    interviewId = (await r.json())[0]?.id
  }
  if (!interviewId) return res.status(500).json({ error: 'Interview created but no ID returned' })

  // ── 6. Generate handout body ───────────────────────────────────────────
  let handoutBody = ''
  try {
    const systemPrompt = getPatientHandoutSystemPrompt(ws, staffName, transcript, voiceNotes, voicePhrases)
    const { text } = await generateText({
      model: MODEL,
      messages: [{ role: 'user', content: systemPrompt }],
      maxOutputTokens: 1200,
    })
    handoutBody = (text || '').trim()
    if (!handoutBody) throw new Error('Model returned empty handout')
  } catch (e) {
    console.error(`[handout] generation failed interview=${interviewId}: ${e?.message}`)
    return res.status(502).json({
      error: 'Handout generation failed — recording saved, you can retry from the interview.',
      interviewId,
    })
  }

  // ── 7. Insert content_item ─────────────────────────────────────────────
  let contentItemId = null
  {
    const r = await sb('content_items', {
      method: 'POST',
      body: JSON.stringify({
        workspace_id:   ws.id,
        interview_id:   interviewId,
        staff_id:   staffId,
        staff_name: staffName,
        topic,
        platform:       'handout',
        content:        handoutBody,
        status:         'draft',
      }),
    })
    if (!r.ok) {
      const body = await r.text().catch(() => '')
      console.error(`[handout] content_item insert failed interview=${interviewId}: ${body.slice(0, 300)}`)
      return res.status(500).json({
        error: 'Handout generated but could not save — please retry.',
        interviewId,
      })
    }
    contentItemId = (await r.json())[0]?.id
  }

  return res.status(200).json({ staffId, interviewId, contentItemId })
}

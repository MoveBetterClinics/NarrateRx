// POST /api/voice-clone/create
//
// Accepts a raw audio binary body, uploads it to Vercel Blob, then runs the
// shared clone-from-URL pipeline (api/_lib/voiceCloneActions.js).
//
// Query params:
//   staffId — required; clinician whose voice this is
//   durationSec — recording length in seconds (server enforces 60s floor)
//   filename    — original file name for blob path + ext sniffing
//
// Response (success): { voiceId, sampleUrl }
// Response (failure): { error, sampleUrl?, voiceIdUpstream? }
//   sampleUrl is included on any error AFTER the blob upload succeeds, so
//   the client can stash it in localStorage and offer the user a "Resume
//   without re-recording" option via /api/voice-clone/resume.

export const config = {
  runtime: 'nodejs',
  maxDuration: 300,
  api: { bodyParser: false },
}

import { put as blobPut } from '@vercel/blob'
import { requireRole } from '../_lib/auth.js'
import { workspaceContext } from '../_lib/workspaceContext.js'
import { enforceLimit } from '../_lib/ratelimit.js'
import { cloneFromSampleUrl } from '../_lib/voiceCloneActions.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// 15MB cap — ~10 min of audio at conversational quality, well over the
// 3–5 min IVC recommends.
const MAX_SAMPLE_BYTES = 15 * 1024 * 1024
// 60s floor — shorter samples make poor clones.
const MIN_SAMPLE_SECONDS = 60

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey:        SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
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

  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  if (!(await enforceLimit(req, res, 'media'))) return

  const { searchParams } = new URL(req.url, 'http://localhost')
  const staffId = searchParams.get('staffId')
  const durationSec = parseInt(searchParams.get('durationSec') || '0', 10) || 0
  const rawFilename = searchParams.get('filename') || `voice-clone-${Date.now()}.webm`
  const contentType = req.headers['content-type'] || 'audio/webm'

  if (!staffId) return res.status(400).json({ error: 'staffId required' })
  if (durationSec && durationSec < MIN_SAMPLE_SECONDS) {
    return res.status(400).json({
      error: `Recording is too short — ${MIN_SAMPLE_SECONDS}s minimum for a usable voice clone.`,
    })
  }

  const clinicianRes = await sb(
    `staff?id=eq.${encodeURIComponent(staffId)}` +
    `&workspace_id=eq.${ws.id}` +
    `&select=id,name,eleven_voice_id,voice_clone_revoked_at&limit=1`
  )
  if (!clinicianRes.ok) {
    return res.status(502).json({ error: 'Could not look up clinician' })
  }
  const [clinician] = await clinicianRes.json()
  if (!clinician) return res.status(404).json({ error: 'Clinician not found in this workspace' })

  // ── Buffer audio ────────────────────────────────────────────────────────────
  let audioBuffer
  try {
    audioBuffer = await readBody(req)
  } catch (e) {
    console.error(`[voice-clone] body read failed: ${e?.message}`)
    return res.status(400).json({ error: 'Could not read request body' })
  }
  if (audioBuffer.byteLength === 0) {
    return res.status(400).json({ error: 'Empty audio body' })
  }
  if (audioBuffer.byteLength > MAX_SAMPLE_BYTES) {
    const mb = Math.round(audioBuffer.byteLength / 1024 / 1024)
    return res.status(413).json({
      error: `Recording is ${mb}MB — the limit for voice cloning is 15MB. Trim or re-record at a lower bitrate.`,
    })
  }

  // ── Upload to Blob ──────────────────────────────────────────────────────────
  const safeName = rawFilename.replace(/[^a-z0-9._-]/gi, '_').slice(0, 80)
  const blobPath = `voice-clone-samples/${ws.slug}/${staffId}-${Date.now()}-${safeName}`
  let blobResult
  try {
    blobResult = await blobPut(blobPath, audioBuffer, {
      access: 'public',
      contentType,
      addRandomSuffix: false,
    })
  } catch (e) {
    console.error(`[voice-clone] blob upload failed ws=${ws.slug}: ${e?.message}`)
    return res.status(502).json({ error: 'Sample upload failed — please try again.' })
  }

  // ── Clone + persist (shared with /resume) ───────────────────────────────────
  const result = await cloneFromSampleUrl({ ws, clinician, sampleUrl: blobResult.url })
  if (!result.ok) return res.status(result.status).json(result.body)
  return res.status(200).json({ voiceId: result.voiceId, sampleUrl: result.sampleUrl })
}

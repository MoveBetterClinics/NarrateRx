// api/interviews/detect-video-offset.js
//
// POST /api/interviews/detect-video-offset
// Body: { interviewId, assetId }
//
// Downloads the first portion of the attached video, runs ffmpeg silencedetect
// on its audio track, and returns (+ persists) the number of seconds before
// the first significant sound — i.e. how much setup/silence to skip so the
// interview clip starts at the right moment.
//
// Why silencedetect works here: the clinician hits record on the iPhone, sets
// it on the tripod, then starts the interview on the laptop. The AI's TTS
// voice is a loud, clear onset. Everything before it is room noise / setup.
// silencedetect(noise=-30dB, duration=0.3) reliably finds that boundary.
//
// We only download the first MAX_PROBE_BYTES of the video (default 20 MB) —
// enough to probe the first few minutes of audio without pulling a 2 GB file.

export const config = { runtime: 'nodejs' }

import { spawn }             from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdtemp, rm }       from 'node:fs/promises'
import { join }              from 'node:path'
import { tmpdir }            from 'node:os'
import { Readable }          from 'node:stream'
import { pipeline }          from 'node:stream/promises'

import ffmpegStaticPath from 'ffmpeg-static'
import { workspaceContext }  from '../_lib/workspaceContext.js'
import { sb }                from '../_lib/supabase.js'

const FFMPEG_BIN    = process.env.FFMPEG_PATH || ffmpegStaticPath || 'ffmpeg'
const MAX_PROBE_BYTES = 20 * 1024 * 1024  // 20 MB — enough for ~3 min of audio at typical bitrates

// Run ffmpeg silencedetect and return the first non-silence start time in seconds.
// Falls back to 0 if the whole clip is silence-free from the start.
async function detectSpeechOnset(videoPath) {
  return new Promise((resolve, reject) => {
    // silencedetect emits lines like:
    //   silence_start: 0.000000
    //   silence_end: 4.320000 | silence_duration: 4.320000
    // We want the first silence_end — that's where speech begins.
    const args = [
      '-i',        videoPath,
      '-vn',                          // audio only — skip video decode
      '-af',       'silencedetect=noise=-30dB:duration=0.3',
      '-f',        'null',
      '-',
    ]
    const proc   = spawn(FFMPEG_BIN, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let   stderr = ''
    proc.stderr.on('data', (d) => { stderr += d.toString() })
    proc.on('error', reject)
    proc.on('close', (_code) => {
      // Parse silence_end lines — the first one marks the onset of sound
      const silenceEndMatch = stderr.match(/silence_end:\s*([\d.]+)/)
      if (silenceEndMatch) {
        // Back off 0.3s so we don't clip the very start of the first word
        const offset = Math.max(0, parseFloat(silenceEndMatch[1]) - 0.3)
        return resolve(Math.round(offset * 100) / 100)
      }
      // No silence detected at start — video starts with sound immediately
      resolve(0)
    })
  })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const scope = await workspaceContext(req)
  if (!scope) return res.status(401).json({ error: 'Unauthorized' })

  const { interviewId, assetId } = req.body || {}
  if (!interviewId || !assetId) {
    return res.status(400).json({ error: 'interviewId and assetId are required' })
  }

  // Verify the interview belongs to this workspace
  const iRes = await sb(
    `interviews?id=eq.${interviewId}&workspace_id=eq.${scope.id}&select=id,video_media_asset_id`,
  )
  if (!iRes.ok) return res.status(500).json({ error: 'Database error' })
  const [interview] = await iRes.json()
  if (!interview) return res.status(404).json({ error: 'Interview not found' })

  // Fetch the media asset to get its blob URL
  const aRes = await sb(
    `media_assets?id=eq.${assetId}&workspace_id=eq.${scope.id}&select=id,blob_url,kind`,
  )
  if (!aRes.ok) return res.status(500).json({ error: 'Database error' })
  const [asset] = await aRes.json()
  if (!asset) return res.status(404).json({ error: 'Asset not found' })
  if (!asset.blob_url) return res.status(422).json({ error: 'Asset has no blob URL yet' })

  const dir    = await mkdtemp(join(tmpdir(), 'vidoffset-'))
  const inPath = join(dir, 'in.bin')

  try {
    // Partial download — we only need the first MAX_PROBE_BYTES.
    // Range requests are supported by Vercel Blob.
    const fetchRes = await fetch(asset.blob_url, {
      headers: { Range: `bytes=0-${MAX_PROBE_BYTES - 1}` },
    })
    if (!fetchRes.ok && fetchRes.status !== 206) {
      throw new Error(`Blob download failed: ${fetchRes.status}`)
    }
    await pipeline(Readable.fromWeb(fetchRes.body), createWriteStream(inPath))

    const offsetSeconds = await detectSpeechOnset(inPath)

    // Persist both the asset link and the detected offset in one PATCH
    const patchRes = await sb(`interviews?id=eq.${interviewId}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body:    JSON.stringify({
        video_media_asset_id: assetId,
        video_offset_seconds: offsetSeconds,
      }),
    })
    if (!patchRes.ok) throw new Error('Failed to persist video link')

    return res.status(200).json({ offsetSeconds })
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

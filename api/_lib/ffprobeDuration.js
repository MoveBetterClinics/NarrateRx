// api/_lib/ffprobeDuration.js
//
// Probe a remote video's duration (seconds) without downloading it.
//
// `ffmpeg -i <url>` opens the input, prints the container metadata —
// "Duration: HH:MM:SS.ss, ..." — to stderr, then exits non-zero with
// "At least one output file must be specified". It does NOT decode the stream,
// so this is fast even for a multi-GB source (it reads headers + seeks, served
// over HTTP range from Vercel Blob). We parse the Duration line from stderr.
//
// We use ffmpeg (already a dep, ffmpeg-static) rather than ffprobe to avoid
// adding ffprobe-static to the bundle. Resolves null on any failure — callers
// treat an unknown duration as "can't plan chunks" and fall back to the capped
// single-pass render.

import { spawn } from 'node:child_process'
import ffmpegPath from 'ffmpeg-static'

/**
 * @param {string} videoUrl
 * @returns {Promise<number|null>} duration in seconds, or null if undeterminable
 */
export function probeDurationSec(videoUrl) {
  return new Promise((resolve) => {
    let proc
    try {
      proc = spawn(ffmpegPath, ['-hide_banner', '-i', videoUrl], {
        stdio: ['ignore', 'ignore', 'pipe'],
      })
    } catch {
      return resolve(null)
    }

    let stderr = ''
    proc.stderr.on('data', (c) => {
      stderr += c.toString('utf8')
      // The Duration line appears near the top of the metadata dump; keep only
      // the head so a chatty source can't grow stderr without bound.
      if (stderr.length > 64 * 1024) {
        proc.kill('SIGKILL')
      }
    })

    // Hard stop: header read should be near-instant. Don't let a hung connection
    // keep the function alive.
    const timer = setTimeout(() => { try { proc.kill('SIGKILL') } catch { /* noop */ } }, 30_000)

    const finish = () => {
      clearTimeout(timer)
      const m = stderr.match(/Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/)
      if (!m) return resolve(null)
      const sec = Number(m[1]) * 3600 + Number(m[2]) * 60 + parseFloat(m[3])
      resolve(Number.isFinite(sec) && sec > 0 ? sec : null)
    }

    proc.on('close', finish)
    proc.on('error', () => { clearTimeout(timer); resolve(null) })
  })
}

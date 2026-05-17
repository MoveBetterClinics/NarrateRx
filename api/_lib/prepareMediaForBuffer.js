import { put as blobPut } from '@vercel/blob'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, readFile, createWriteStream } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import ffmpegStaticPath from 'ffmpeg-static'
// jimp's conditional exports map `import` → ESM and `require` → CJS. esbuild
// follows the `import` condition when bundling, picks the ESM build, and the
// resulting bundle crashes at Node runtime with ERR_INTERNAL_ASSERTION.
// Bypassing conditional exports by referencing the CJS dist directly forces
// esbuild to bundle the CJS build, which loads cleanly in Vercel Node functions.
import { Jimp } from 'jimp/dist/commonjs/index.js'

// Per-platform caps used by Buffer's media validator:
//   Instagram: 5000px image, 1920px video, 60s reel
//   Twitter:   4096px image, 1280px video
//   Facebook:  — generous, but 1920px video is safe
// We target widths well below each cap so phone-camera originals always pass.
const IMG_MAX_WIDTH   = 4000  // images: under Instagram (5000) and Twitter (4096)
const VID_MAX_WIDTH   = 1920  // video:  under Instagram and matches Twitter HD max
const RESIZED_PREFIX  = 'media/publish-resized'
const FFMPEG_BIN      = process.env.FFMPEG_PATH || ffmpegStaticPath || 'ffmpeg'

// ─── Images ──────────────────────────────────────────────────────────────────

async function resizeImageIfNeeded(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`download failed: ${r.status}`)
  const buf = Buffer.from(await r.arrayBuffer())

  const img = await Jimp.read(buf)
  if (img.width <= IMG_MAX_WIDTH) return url

  img.resize({ w: IMG_MAX_WIDTH })
  const resized = await img.getBuffer('image/jpeg', { quality: 88 })

  const hash = createHash('sha256').update(url).digest('hex').slice(0, 16)
  const { url: blobUrl } = await blobPut(
    `${RESIZED_PREFIX}/${hash}-img${IMG_MAX_WIDTH}.jpg`,
    resized,
    { access: 'public', contentType: 'image/jpeg', addRandomSuffix: false, allowOverwrite: true },
  )
  return blobUrl
}

// ─── Video ───────────────────────────────────────────────────────────────────

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_BIN, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    proc.stderr.on('data', (d) => { stderr += d.toString() })
    proc.on('error', (e) => reject(new Error(`ffmpeg spawn: ${e.code || e.message}`)))
    proc.on('close', (code) => {
      if (code === 0) resolve(stderr)
      else reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-600).trim()}`))
    })
  })
}

// Returns { width, height } from ffmpeg -i stderr. 0s on parse failure.
async function probeVideoSize(inPath) {
  const stderr = await runFfmpeg(['-y', '-i', inPath]).catch((e) => e.message || '')
  const m = stderr.match(/Video:.*?(\d{3,4})x(\d{3,4})/)
  return m ? { width: parseInt(m[1], 10), height: parseInt(m[2], 10) } : { width: 0, height: 0 }
}

async function transcodeVideoIfNeeded(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`download failed: ${r.status}`)

  const dir    = await mkdtemp(join(tmpdir(), 'buf-vid-'))
  const inPath = join(dir, 'in.mp4')
  const outPath = join(dir, 'out.mp4')

  try {
    // Stream to disk — videos can be 500MB+; arrayBuffer() OOMs the function.
    await pipeline(Readable.fromWeb(r.body), createWriteStream(inPath))

    const { width } = await probeVideoSize(inPath)
    if (width > 0 && width <= VID_MAX_WIDTH) return url

    // Scale down preserving aspect. -2 keeps even-numbered height for H.264.
    // -movflags +faststart puts the moov atom first for streaming.
    await runFfmpeg([
      '-y', '-i', inPath,
      '-vf', `scale='min(${VID_MAX_WIDTH},iw):-2'`,
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      outPath,
    ])

    const mp4 = await readFile(outPath)
    const hash = createHash('sha256').update(url).digest('hex').slice(0, 16)
    const { url: blobUrl } = await blobPut(
      `${RESIZED_PREFIX}/${hash}-vid${VID_MAX_WIDTH}.mp4`,
      mp4,
      { access: 'public', contentType: 'video/mp4', addRandomSuffix: false, allowOverwrite: true },
    )
    return blobUrl
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

// Walk a mediaUrls array, downsizing oversized images and transcoding oversized
// videos before the URLs are handed to Buffer. Results are stored at
// deterministic blob paths (sha256 of source URL) so retrying the same publish
// reuses the cached output. On any error, falls back to the original URL —
// the publish still attempts and Buffer surfaces a readable error if the asset
// truly exceeds the platform cap.
export async function prepareMediaForBuffer(mediaUrls) {
  if (!Array.isArray(mediaUrls) || mediaUrls.length === 0) return mediaUrls || []
  return Promise.all(
    mediaUrls.map(async (m) => {
      if (!m || typeof m !== 'object') return m
      const isVideo = m.type?.startsWith('video')
      try {
        const newUrl = isVideo
          ? await transcodeVideoIfNeeded(m.url)
          : await resizeImageIfNeeded(m.url)
        if (!newUrl || newUrl === m.url) return m
        return { ...m, url: newUrl }
      } catch (e) {
        const kind = isVideo ? 'video transcode' : 'image resize'
        console.error(`[publish/buffer] ${kind} failed`, m.url, e?.message)
        return m
      }
    }),
  )
}

export const __test = { IMG_MAX_WIDTH, VID_MAX_WIDTH, RESIZED_PREFIX }

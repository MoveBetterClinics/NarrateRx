// Brand-styled video rendering — Phase 2 Day 7b of the 30-day video output build.
//
// Takes a source video URL + caption + workspace brand context and produces per-channel
// MP4 outputs with:
//   • Video cropped + resized to the channel's aspect ratio (cover fit, centered)
//   • Static caption band overlay (same brand SVG as photo renders)
//   • Whisper-transcribed burned-in subtitles (best-effort; skipped on failure)
//   • Lower-third with clinician name + workspace name
//
// Pipeline per channel:
//   1. Stream download source video to /tmp
//   2. If > 20MB, ffmpeg-extract audio → mp3 for Whisper (else send video directly)
//   3. Whisper-1 → SRT (best-effort; no subs if fails)
//   4. Sharp + SVG → brand overlay PNG (reuses buildBrandOverlaySvg from brandRender.js)
//   5. ffmpeg: scale+crop → overlay brand PNG → burn subtitles (if present) → H.264 MP4
//   6. Return output Buffer for caller to upload to Vercel Blob
//
// All /tmp files are cleaned up in the finally block even on failure.

import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { writeFile as writeFileP, readFile as readFileP, unlink as unlinkP, stat as statP } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { randomUUID } from 'node:crypto'
import ffmpegPath from 'ffmpeg-static'
import sharp from 'sharp'
import { buildBrandOverlaySvg, resolveBrandColors } from './brandRender.js'
import { getBrandFont, ensureFontconfig } from './brandFonts.js'
import { transcribeToSrt } from './whisper.js'

// Max source video size we'll download. ZV-1F 4K clips can be large; cap at 500MB.
const MAX_VIDEO_BYTES = 500 * 1024 * 1024

/**
 * Channel specs for video rendering.
 * Dimensions + aspect match the photo CHANNEL_SPECS so the brand overlay SVG
 * geometry is identical — only the output format (MP4 vs JPEG) differs.
 */
export const VIDEO_CHANNEL_SPECS = {
  linkedin_video:  { width: 1080, height: 1080, aspect: '1:1',  captionPos: 'top' },
  instagram_reel:  { width: 1080, height: 1920, aspect: '9:16', captionPos: 'top' },
  tiktok:          { width: 1080, height: 1920, aspect: '9:16', captionPos: 'top' },
  youtube_short:   { width: 1080, height: 1920, aspect: '9:16', captionPos: 'top' },
  blog_hero_video: { width: 1920, height: 1080, aspect: '16:9', captionPos: 'bottom' },
  facebook_video:  { width: 1080, height: 1350, aspect: '4:5',  captionPos: 'top' },
}

/**
 * Run ffmpeg with the given args. Resolves on exit-0, rejects with the last
 * few stderr lines on non-zero exit (ffmpeg always writes progress to stderr
 * even on success, so we don't surface stderr on clean exit).
 */
function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    const stderrChunks = []
    proc.stderr.on('data', (chunk) => {
      stderrChunks.push(chunk)
      // Cap total buffered stderr at 256KB to avoid OOM on long renders
      const total = stderrChunks.reduce((s, c) => s + c.length, 0)
      if (total > 256 * 1024) stderrChunks.shift()
    })
    proc.on('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        const errText = Buffer.concat(stderrChunks).toString('utf8').trim()
        const tail = errText.split('\n').slice(-8).join('\n')
        reject(new Error(`ffmpeg exited ${code}:\n${tail}`))
      }
    })
    proc.on('error', (err) => reject(new Error(`ffmpeg spawn failed: ${err.message}`)))
  })
}

/**
 * Render one channel's worth of a video asset.
 *
 * @param {Object} params
 * @param {string} params.videoUrl      — source video URL (Vercel Blob etc.)
 * @param {string} params.channel       — key in VIDEO_CHANNEL_SPECS
 * @param {string} params.captionText   — text shown in the caption band (optional marketing headline)
 * @param {Object} params.workspace     — workspace row (display_name, colors)
 * @param {string} params.clinicianName — display name for lower-third
 * @returns {Promise<{buffer: Buffer, width: number, height: number, channel: string, hadSubtitles: boolean}>}
 */
export async function renderVideoChannel({ videoUrl, channel, captionText, workspace, clinicianName }) {
  const spec = VIDEO_CHANNEL_SPECS[channel]
  if (!spec) throw new Error(`Unknown video channel: ${channel}`)

  // Initialise fontconfig before any Sharp SVG work. No-op after first call.
  await ensureFontconfig()

  const id = randomUUID()
  const tmpInput   = `/tmp/vid-in-${id}.mp4`
  const tmpAudio   = `/tmp/vid-audio-${id}.mp3`
  const tmpOverlay = `/tmp/vid-ov-${id}.png`
  const tmpSrt     = `/tmp/vid-sub-${id}.srt`
  const tmpOutput  = `/tmp/vid-out-${id}.mp4`

  try {
    // ── 1. Stream download source video ─────────────────────────────────────
    const fetchRes = await fetch(videoUrl)
    if (!fetchRes.ok) throw new Error(`Source video fetch failed: ${fetchRes.status}`)
    const contentLength = parseInt(fetchRes.headers.get('content-length') || '0', 10)
    if (contentLength > MAX_VIDEO_BYTES) {
      throw new Error(`Source video too large: ${Math.round(contentLength / 1e6)}MB (max ${MAX_VIDEO_BYTES / 1e6}MB)`)
    }
    await pipeline(Readable.fromWeb(fetchRes.body), createWriteStream(tmpInput))

    const { size: actualSize } = await statP(tmpInput)
    if (actualSize > MAX_VIDEO_BYTES) {
      throw new Error(`Downloaded video too large: ${Math.round(actualSize / 1e6)}MB`)
    }

    // ── 2. Whisper transcription (best-effort) ───────────────────────────────
    // ALWAYS extract audio to MP3 first — sidesteps the Whisper "Invalid file format"
    // error we saw in prod 2026-05-27 when sending MP4 directly. MP3 is well-tested,
    // smaller to upload, and works for any input size.
    let hadSubtitles = false
    try {
      await runFfmpeg([
        '-i', tmpInput,
        '-vn',                          // no video
        '-acodec', 'libmp3lame',
        '-ar', '16000',                 // 16kHz — Whisper-optimal sample rate
        '-ac', '1',                     // mono
        '-b:a', '32k',
        '-y', tmpAudio,
      ])

      const srt = await transcribeToSrt(tmpAudio)
      if (srt && srt.trim()) {
        await writeFileP(tmpSrt, srt, 'utf8')
        hadSubtitles = true
      }
    } catch (e) {
      // Non-fatal: continue with brand overlay only, no spoken-word captions.
      console.error(`[brandRenderVideo] whisper skip (${channel}):`, e.message)
    }

    // ── 3. Build brand overlay PNG via Sharp + SVG ───────────────────────────
    // Resolve brand colors + opacity from the priority chain (see brandRender.js header)
    const { primaryColor, accentColor, captionOpacity } = resolveBrandColors(workspace)

    // Resolve brand font (workspace.brand_style.heading_font → Google Fonts → bundled Inter).
    // Embedding the font via @font-face data-URI is what fixes the garbled-text bug —
    // librsvg can't find system fonts in the Vercel function container, so the SVG
    // must carry its own font.
    const { buffer: fontBuffer } = await getBrandFont(workspace).catch(() => ({ buffer: null }))

    const overlaySvg = buildBrandOverlaySvg({
      width:         spec.width,
      height:        spec.height,
      captionPos:    spec.captionPos,
      captionText:   captionText || '',
      clinicianName: clinicianName || '',
      workspaceName: workspace?.display_name || '',
      primaryColor,
      accentColor,
      fontBuffer,
      captionOpacity,
    })
    const overlayPng = await sharp(overlaySvg).png().toBuffer()
    await writeFileP(tmpOverlay, overlayPng)

    // ── 4. Build ffmpeg filter_complex ───────────────────────────────────────
    // [0:v] = source video, [1:v] = brand overlay PNG
    //
    // Scale + cover-crop to target dimensions, then composite the brand overlay.
    // The PNG was rendered at exactly spec.width × spec.height so overlay=0:0 fits perfectly.
    const W = spec.width
    const H = spec.height
    let filterComplex = [
      `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H}[scaled]`,
      `[scaled][1:v]overlay=0:0[branded]`,
    ]

    let finalOutput = '[branded]'
    if (hadSubtitles) {
      // The subtitles filter path must not contain colons (fine — /tmp/vid-sub-uuid.srt has none).
      // force_style overrides: large-ish font, white with black outline, positioned above lower-third.
      // When the caption band is at the bottom (e.g. blog_hero_video) bump MarginV so the
      // last subtitle line clears the band — otherwise the bottom subtitle line overlaps it.
      const marginV = spec.captionPos === 'bottom' ? 220 : 120
      filterComplex.push(
        `[branded]subtitles=${tmpSrt}:force_style='PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BackColour=&H80000000,Bold=1,FontSize=20,Outline=1,Shadow=0,MarginV=${marginV}'[vout]`,
      )
      finalOutput = '[vout]'
    }

    // ── 5. Run ffmpeg ────────────────────────────────────────────────────────
    const ffmpegArgs = [
      '-i', tmpInput,
      '-i', tmpOverlay,
      '-filter_complex', filterComplex.join(';'),
      '-map', finalOutput,
      '-map', '0:a?',                    // include audio if present; ? = optional
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '23',                      // perceptually lossless quality for clinic content
      '-pix_fmt', 'yuv420p',             // required for broad compatibility (LinkedIn, etc.)
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',         // moov atom at start for streaming
      '-y',                              // overwrite if exists
      tmpOutput,
    ]

    await runFfmpeg(ffmpegArgs)

    // ── 6. Read output buffer ────────────────────────────────────────────────
    // Rendered MP4 at CRF 23 is compact: ~0.5–2MB/minute at 1080p fast preset.
    const outBuffer = await readFileP(tmpOutput)
    return { buffer: outBuffer, width: W, height: H, channel, hadSubtitles }

  } finally {
    // Always clean up /tmp files — even on error paths.
    for (const f of [tmpInput, tmpAudio, tmpOverlay, tmpSrt, tmpOutput]) {
      await unlinkP(f).catch(() => {})
    }
  }
}

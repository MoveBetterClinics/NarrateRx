import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { put as blobPut, del as blobDel } from '@vercel/blob'
import ffmpegStaticPath from 'ffmpeg-static'

// Generates a JPEG poster frame for a video asset and persists thumbnail_url.
// Used by api/media/upload.js (auto on upload) and api/media/[id]/thumbnail.js
// (manual / backfill). Originals are never modified — only the thumbnail blob
// and the media_assets.thumbnail_url column.

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const FFMPEG_BIN = process.env.FFMPEG_PATH || ffmpegStaticPath || 'ffmpeg'

// Frame to grab. 0.5s avoids first-frame black/leader cards on most clips
// while still landing inside very short videos. If seek lands past EOF,
// extractFrame() retries from frame 0.
const SEEK_SECONDS  = '0.5'
const THUMB_WIDTH   = 480
// JPEG quality for ffmpeg's -q:v (1=best, 31=worst). 4 is a good balance —
// poster frames stay crisp without ballooning the blob storage cost.
const JPEG_QUALITY  = '4'

function requireScope(scope) {
  if (!scope?.workspace) {
    throw new Error('thumbnail: workspace scope is required (caller must pass a resolved scope)')
  }
  return scope
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

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_BIN, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    proc.stderr.on('data', (d) => { stderr += d.toString() })
    proc.on('error', (e) => reject(new Error(`ffmpeg spawn failed (${e.code || e.message}); set FFMPEG_PATH or install ffmpeg`)))
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-400).trim()}`))
    })
  })
}

// Read the display-rotation metadata so the thumbnail can be transposed to
// match what a video player would render. Returns 0/90/180/270 CW. ffmpeg's
// `-vf scale=…` does NOT auto-rotate reliably across versions when a custom
// filter chain is supplied, so we apply it explicitly under `-noautorotate`.
function probeRotation(inPath) {
  return new Promise((resolve) => {
    const proc = spawn(FFMPEG_BIN, ['-i', inPath], { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    proc.stderr.on('data', (d) => { stderr += d.toString() })
    proc.on('close', () => {
      const rot = stderr.match(/rotate\s*:\s*(-?\d+)/i)
      const dm  = stderr.match(/displaymatrix:\s*rotation of (-?[\d.]+)/i)
      // displaymatrix reports CCW (negative = CW); legacy rotate atom is CW.
      // Convert displaymatrix to the same CW sign before normalizing.
      const raw = rot
        ? parseInt(rot[1], 10)
        : (dm ? -Math.round(parseFloat(dm[1])) : 0)
      resolve(((raw % 360) + 360) % 360)
    })
    proc.on('error', () => resolve(0))
  })
}

function transposeForRotation(deg) {
  switch (deg) {
    case 90:  return 'transpose=1'
    case 180: return 'transpose=1,transpose=1'
    case 270: return 'transpose=2'
    default:  return ''
  }
}

async function extractFrame(inPath, outPath) {
  const rotation = await probeRotation(inPath)
  const filters = [transposeForRotation(rotation), `scale=${THUMB_WIDTH}:-2`]
    .filter(Boolean)
    .join(',')
  // `-noautorotate` disables ffmpeg's implicit rotation so the explicit
  // transpose below is the sole source of orientation — keeps behavior
  // deterministic across ffmpeg versions.
  const baseArgs = [
    '-y', '-noautorotate',
    '-ss', SEEK_SECONDS, '-i', inPath,
    '-vframes', '1',
    '-vf', filters,
    '-q:v', JPEG_QUALITY,
    outPath,
  ]
  try {
    await runFfmpeg(baseArgs)
    const s = await stat(outPath).catch(() => null)
    if (s && s.size > 0) return
    throw new Error('Empty output')
  } catch {
    // Seek past EOF or short clip — retry from the very beginning.
    const fallback = [
      '-y', '-noautorotate', '-i', inPath,
      '-vframes', '1',
      '-vf', filters,
      '-q:v', JPEG_QUALITY,
      outPath,
    ]
    await runFfmpeg(fallback)
  }
}

// Base path for thumbnail blobs. addRandomSuffix=true in blobPut appends a
// unique segment so every regen produces a fresh URL — same cache-bust
// reasoning as the edit endpoint's replace-master blob. Old thumbnail blobs
// are deleted fire-and-forget after the DB row is updated.
function thumbPathname(asset) {
  return `media/thumbs/${asset.id}.jpg`
}

// Extract + upload + PATCH. Returns the new thumbnail_url, or null if the
// asset is not a video / has no source blob to read from.
export async function generateAndPersistThumbnail(asset, scope) {
  if (!asset || asset.kind !== 'video') return null
  if (!asset.blob_url) return null
  const s = requireScope(scope)

  const dir     = await mkdtemp(join(tmpdir(), 'thumb-'))
  const inPath  = join(dir, 'in.bin')
  const outPath = join(dir, 'out.jpg')
  try {
    const res = await fetch(asset.blob_url)
    if (!res.ok) throw new Error(`Source download failed: ${res.status}`)
    // Stream to disk instead of buffering — videos can be 500MB+ and
    // arrayBuffer() materializes the whole file in RAM, OOMing the function.
    await pipeline(Readable.fromWeb(res.body), createWriteStream(inPath))

    await extractFrame(inPath, outPath)
    const jpeg = await readFile(outPath)

    // Fresh pathname on every regen — CDN + browser cache by full URL, so an
    // in-place overwrite (same URL) keeps serving the pre-rotation frame until
    // the CDN TTL expires. addRandomSuffix guarantees a new URL, which misses
    // every cache layer immediately.
    const oldThumbnailUrl = asset.thumbnail_url || null
    const uploaded = await blobPut(thumbPathname(asset), jpeg, {
      access: 'public',
      contentType: 'image/jpeg',
      addRandomSuffix: true,
      allowOverwrite: false,
    })

    const where = `id=eq.${asset.id}&${s.column}=eq.${s.id}`
    const upd = await sb(`media_assets?${where}`, {
      method: 'PATCH',
      body: JSON.stringify({ thumbnail_url: uploaded.url }),
    })
    if (!upd.ok) {
      throw new Error(`thumbnail PATCH failed: ${upd.status} ${await upd.text()}`)
    }

    // Old thumbnail blob is now orphaned — delete it. Fire-and-forget; only
    // cost of failure is a leftover small JPEG in storage.
    if (oldThumbnailUrl && oldThumbnailUrl !== uploaded.url) {
      blobDel(oldThumbnailUrl).catch((e) => {
        console.error('[thumbnail] stale blob delete failed:', e?.message)
      })
    }

    return uploaded.url
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

// Look up an asset by id (workspace-scoped) and run generateAndPersistThumbnail.
export async function thumbnailById(id, scope) {
  const s = requireScope(scope)
  const where = `id=eq.${id}&${s.column}=eq.${s.id}`
  const lookup = await sb(`media_assets?${where}&select=id,${s.column},kind,blob_url,thumbnail_url`)
  if (!lookup.ok) throw new Error('Database error')
  const rows = await lookup.json()
  const asset = rows[0]
  if (!asset) throw new Error('Not found')
  if (asset.kind !== 'video') throw new Error('Not a video')
  return generateAndPersistThumbnail(asset, s)
}

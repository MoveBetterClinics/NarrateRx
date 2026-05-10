import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { put as blobPut } from '@vercel/blob'
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

function legacyScope() {
  const slug = (process.env.BRAND || process.env.VITE_BRAND || 'people').toLowerCase()
  return { column: 'brand', id: slug, workspace: null }
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

async function extractFrame(inPath, outPath) {
  const baseArgs = [
    '-y',
    '-ss', SEEK_SECONDS, '-i', inPath,
    '-vframes', '1',
    '-vf', `scale=${THUMB_WIDTH}:-2`,
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
      '-y', '-i', inPath,
      '-vframes', '1',
      '-vf', `scale=${THUMB_WIDTH}:-2`,
      '-q:v', JPEG_QUALITY,
      outPath,
    ]
    await runFfmpeg(fallback)
  }
}

// Derive a deterministic blob path for the thumbnail so re-running on the
// same asset overwrites the previous frame instead of accumulating stale
// blobs. Uses the asset id as the stable key.
function thumbPathname(asset) {
  return `media/thumbs/${asset.id}.jpg`
}

// Extract + upload + PATCH. Returns the new thumbnail_url, or null if the
// asset is not a video / has no source blob to read from.
export async function generateAndPersistThumbnail(asset, scope) {
  if (!asset || asset.kind !== 'video') return null
  if (!asset.blob_url) return null
  const s = scope || legacyScope()

  const dir     = await mkdtemp(join(tmpdir(), 'thumb-'))
  const inPath  = join(dir, 'in.bin')
  const outPath = join(dir, 'out.jpg')
  try {
    const res = await fetch(asset.blob_url)
    if (!res.ok) throw new Error(`Source download failed: ${res.status}`)
    await writeFile(inPath, Buffer.from(await res.arrayBuffer()))

    await extractFrame(inPath, outPath)
    const jpeg = await readFile(outPath)

    // allowOverwrite + deterministic pathname → regenerating the thumbnail
    // replaces the old blob in place; no orphan cleanup needed.
    const uploaded = await blobPut(thumbPathname(asset), jpeg, {
      access: 'public',
      contentType: 'image/jpeg',
      addRandomSuffix: false,
      allowOverwrite: true,
    })

    const where = `id=eq.${asset.id}&${s.column}=eq.${s.id}`
    const upd = await sb(`media_assets?${where}`, {
      method: 'PATCH',
      body: JSON.stringify({ thumbnail_url: uploaded.url }),
    })
    if (!upd.ok) {
      throw new Error(`thumbnail PATCH failed: ${upd.status} ${await upd.text()}`)
    }
    return uploaded.url
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

// Look up an asset by id (workspace-scoped) and run generateAndPersistThumbnail.
export async function thumbnailById(id, scope) {
  const s = scope || legacyScope()
  const where = `id=eq.${id}&${s.column}=eq.${s.id}`
  const lookup = await sb(`media_assets?${where}&select=id,${s.column},kind,blob_url,thumbnail_url`)
  if (!lookup.ok) throw new Error('Database error')
  const rows = await lookup.json()
  const asset = rows[0]
  if (!asset) throw new Error('Not found')
  if (asset.kind !== 'video') throw new Error('Not a video')
  return generateAndPersistThumbnail(asset, s)
}

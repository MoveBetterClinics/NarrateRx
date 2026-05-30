// api/_lib/stitchLongform.js
//
// Glue the rendered pieces of a chunked keep-whole long-form render into one
// master MP4 and upload it to Vercel Blob.
//
// Every piece was produced by the SAME renderer with identical codec params
// (libx264 preset fast / crf 23 / yuv420p, aac 128k, 1920×1080), so the concat
// demuxer with `-c copy` joins them without re-encoding — fast (I/O-bound, not
// CPU-bound) and lossless. Pieces stream to /tmp (never buffered in RAM) per
// the large-file rule; peak memory is bounded regardless of total length.
//
// Caveat: `-c copy` concat requires every piece to share codec params. They do,
// because one renderer made them all. If a source had no audio track some
// pieces could lack an audio stream and concat would mismatch — for the talk
// sources this lane targets, audio is always present; a mismatch surfaces as a
// failed stitch (caller marks the package failed), not silent corruption.

import { spawn } from 'node:child_process'
import { createWriteStream, createReadStream } from 'node:fs'
import { writeFile as writeFileP, unlink as unlinkP, stat as statP } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { randomUUID } from 'node:crypto'
import ffmpegPath from 'ffmpeg-static'
import { put as blobPut } from '@vercel/blob'

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    const chunks = []
    proc.stderr.on('data', (c) => {
      chunks.push(c)
      const total = chunks.reduce((s, x) => s + x.length, 0)
      if (total > 256 * 1024) chunks.shift()
    })
    proc.on('close', (code) => {
      if (code === 0) return resolve()
      const tail = Buffer.concat(chunks).toString('utf8').trim().split('\n').slice(-8).join('\n')
      reject(new Error(`ffmpeg concat exited ${code}:\n${tail}`))
    })
    proc.on('error', (err) => reject(new Error(`ffmpeg spawn failed: ${err.message}`)))
  })
}

/**
 * Download the ordered piece MP4s, concat them, and upload the master.
 *
 * @param {Object}   p
 * @param {Object}   p.workspace   — workspace row (id, slug)
 * @param {string}   p.packageId   — story_packages id (blob path namespacing)
 * @param {string}   p.sourceAssetId
 * @param {string}   [p.filename]  — source filename (for a readable blob name)
 * @param {{idx:number, blob_url:string, width?:number, height?:number}[]} p.chunks
 *                   — DONE chunk rows; concat order is taken from idx (callers
 *                     should pass them sorted, but we sort defensively).
 * @returns {Promise<{url:string, width:number, height:number, sizeBytes:number}>}
 */
export async function stitchLongform({ workspace, packageId, sourceAssetId, filename, chunks }) {
  const ws = workspace
  const ordered = [...chunks].sort((a, b) => a.idx - b.idx)
  if (!ordered.length) throw new Error('stitchLongform: no chunks to stitch')
  if (ordered.some((c) => !c.blob_url)) throw new Error('stitchLongform: a chunk is missing blob_url')

  const safeFilename = (filename || 'render').replace(/[^\w.-]/g, '_').replace(/\.\w+$/, '')
  const id = randomUUID()
  const localPaths = ordered.map((_, i) => `/tmp/stitch-${id}-${String(i).padStart(4, '0')}.mp4`)
  const listPath = `/tmp/stitch-${id}.txt`
  const outPath = `/tmp/stitch-${id}-out.mp4`

  try {
    // 1. Stream each piece to /tmp (never arrayBuffer — pieces can be large).
    for (let i = 0; i < ordered.length; i++) {
      const r = await fetch(ordered[i].blob_url)
      if (!r.ok || !r.body) throw new Error(`piece ${ordered[i].idx} download failed: ${r.status}`)
      await pipeline(Readable.fromWeb(r.body), createWriteStream(localPaths[i]))
    }

    // 2. concat demuxer list. Paths are our own /tmp UUIDs (no quotes/colons).
    const listBody = localPaths.map((p) => `file '${p}'`).join('\n') + '\n'
    await writeFileP(listPath, listBody, 'utf8')

    // 3. Lossless join.
    await runFfmpeg([
      '-f', 'concat', '-safe', '0',
      '-i', listPath,
      '-c', 'copy',
      '-movflags', '+faststart',
      '-y', outPath,
    ])

    // 4. Upload the master. Path keyed by packageId (one master per package).
    // Stream the file to Blob — a 60-min 1080p master can be hundreds of MB and
    // must not be buffered into RAM (large-file rule). Retry on a transient
    // upload error: the concat is expensive (whole job re-downloads + re-glues
    // on retry), so a brief 5xx shouldn't fail the entire multi-piece render.
    const { size: sizeBytes } = await statP(outPath)
    const pathname = `media/renders/${ws.id}/${sourceAssetId}/${packageId}/longform-master-${safeFilename}.mp4`
    let blob
    for (let attempt = 0; ; attempt++) {
      try {
        // Fresh stream per attempt — a consumed stream can't be re-read.
        blob = await blobPut(pathname, createReadStream(outPath), {
          access: 'public', contentType: 'video/mp4', addRandomSuffix: false, allowOverwrite: true,
        })
        break
      } catch (e) {
        if (attempt >= 2) throw e
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
      }
    }

    const width = ordered[0].width || 1920
    const height = ordered[0].height || 1080
    return { url: blob.url, width, height, sizeBytes }
  } finally {
    for (const p of [...localPaths, listPath, outPath]) {
      await unlinkP(p).catch(() => {})
    }
  }
}

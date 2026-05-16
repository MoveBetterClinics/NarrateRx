#!/usr/bin/env node
/**
 * Bulk-fix videos whose source files carry non-zero `displaymatrix` or
 * `rotate` metadata. Browsers honor those hints during playback, so the
 * clips look upright in the media grid — but any ffmpeg re-encode that
 * doesn't apply the matrix (older crops, future thumbnail passes, social
 * exports) produces sideways pixels.
 *
 * Per row we:
 *   1. Stream-download the current blob to /tmp.
 *   2. Probe with ffmpeg to read width/height/rotate.
 *   3. Skip if rotate == 0 (idempotent — already fixed or never needed).
 *   4. Re-encode with the appropriate `transpose` filter, strip ALL
 *      rotation metadata (`-map_metadata -1` + `-metadata:s:v:0 rotate=`).
 *      Same ffmpeg args as api/media/[id]/edit.js editVideo().
 *   5. Upload the rotated file to `media/raw/<workspace>/rotated/<asset-id>.mp4`.
 *   6. UPDATE media_assets SET blob_url=<new>, width=<rotated.w>,
 *      height=<rotated.h> WHERE id=<asset.id>.
 *
 * The ORIGINAL blob is NOT deleted — leaves it in storage for revert.
 * Re-running probes the new blob, sees rotate=0, and skips.
 *
 * Usage
 * -----
 *   node scripts/bulk-rotate-videos.mjs --dry-run
 *   node scripts/bulk-rotate-videos.mjs --limit=1            # test one round-trip
 *   node scripts/bulk-rotate-videos.mjs --asset=<uuid>       # one specific asset
 *   node scripts/bulk-rotate-videos.mjs                       # all 19
 *
 * Requires: MULTITENANT_DATABASE_URL + BLOB_READ_WRITE_TOKEN in .env.local.
 */

import pg from 'pg'
import { put } from '@vercel/blob'
import { spawn } from 'node:child_process'
import { createReadStream, createWriteStream, existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import ffmpegStatic from 'ffmpeg-static'

const FFMPEG = ffmpegStatic || 'ffmpeg'

// ─── .env.local loader (same as scripts/migrate-legacy-blobs.mjs) ───────────
const repoRoot = join(fileURLToPath(import.meta.url), '..', '..')
const envPath = join(repoRoot, '.env.local')
if (!existsSync(envPath)) { console.error('ERROR: .env.local not found'); process.exit(1) }
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const t = line.trim()
  if (!t || t.startsWith('#')) continue
  const eq = t.indexOf('=')
  if (eq < 0) continue
  const k = t.slice(0, eq).trim()
  const v = t.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '')
  if (!(k in process.env)) process.env[k] = v
}

const dbUrl = process.env.MULTITENANT_DATABASE_URL
const blobToken = process.env.BLOB_READ_WRITE_TOKEN
if (!dbUrl || dbUrl.includes('REDACTED')) {
  console.error('ERROR: MULTITENANT_DATABASE_URL missing or redacted in .env.local'); process.exit(1)
}
if (!blobToken) { console.error('ERROR: BLOB_READ_WRITE_TOKEN not set in .env.local'); process.exit(1) }

// ─── CLI ────────────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/)
    return m ? [m[1], m[2] ?? 'true'] : [a, 'true']
  }),
)
const DRY_RUN = args['dry-run'] === 'true'
const limit = args.limit ? parseInt(args.limit, 10) : null
const assetFilter = args.asset || null

// ─── DB connect ─────────────────────────────────────────────────────────────
const { Client } = pg
const db = new Client({ connectionString: dbUrl })
await db.connect()

// Select every video. We probe each one fresh (don't trust the audit CSV —
// it could be hours stale and we want to be sure rotation is still present
// before re-encoding). Idempotency comes from the probe-then-skip check.
let sql = `
  SELECT m.id, m.filename, m.mime_type, m.width, m.height, m.blob_url,
         w.slug AS workspace_slug
  FROM media_assets m
  JOIN workspaces w ON w.id = m.workspace_id
  WHERE m.kind = 'video'
`
const params = []
if (assetFilter) {
  params.push(assetFilter)
  sql += ` AND m.id = $${params.length}`
}
sql += ` ORDER BY w.slug, m.created_at DESC`
if (limit) sql += ` LIMIT ${limit}`

const { rows } = await db.query(sql, params)
console.error(`Loaded ${rows.length} video rows; probing each to find rotation${DRY_RUN ? ' [DRY RUN]' : ''}…`)

// ─── ffmpeg helpers (lifted from api/media/[id]/edit.js) ────────────────────
function transposeFilter(deg) {
  switch (deg) {
    case 90:  return ['transpose=1']
    case 180: return ['transpose=1', 'transpose=1']
    case 270: return ['transpose=2']
    default:  return []
  }
}

function probe(path) {
  return new Promise((resolve) => {
    const proc = spawn(FFMPEG, ['-i', path], { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    proc.stderr.on('data', (d) => { stderr += d.toString() })
    proc.on('close', () => {
      const dim = stderr.match(/Stream #\d+:\d+(?:\[[^\]]+\]|\([^)]+\))*:\s*Video:[^\n]*?,\s*(\d{2,5})x(\d{2,5})/)
      const rot = stderr.match(/rotate\s*:\s*(-?\d+)/i)
      const dm  = stderr.match(/displaymatrix:\s*rotation of (-?[\d.]+)/i)
      const rRaw = rot ? parseInt(rot[1], 10) : (dm ? Math.round(parseFloat(dm[1])) : 0)
      const cw = dm && !rot ? -rRaw : rRaw
      const rotate = ((cw % 360) + 360) % 360
      resolve({
        width:  dim ? parseInt(dim[1], 10) : null,
        height: dim ? parseInt(dim[2], 10) : null,
        rotate,
      })
    })
    proc.on('error', () => resolve({ width: null, height: null, rotate: 0 }))
  })
}

function runFfmpeg(ffmpegArgs) {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, ffmpegArgs, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    proc.stderr.on('data', (d) => { stderr += d.toString() })
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-400)}`))
    })
    proc.on('error', reject)
  })
}

async function downloadTo(url, outPath) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`download HTTP ${r.status}`)
  await pipeline(Readable.fromWeb(r.body), createWriteStream(outPath))
  return (await stat(outPath)).size
}

// ─── Main loop ──────────────────────────────────────────────────────────────
const workdir = await mkdtemp(join(tmpdir(), 'bulk-rotate-'))
const tally = { skipped: 0, rotated: 0, failed: 0 }
const failures = []

for (let i = 0; i < rows.length; i++) {
  const row = rows[i]
  const tag = `[${i + 1}/${rows.length}] ${row.workspace_slug} ${row.id.slice(0, 8)} ${row.filename}`
  const inPath = join(workdir, `${row.id}.in`)
  const outPath = join(workdir, `${row.id}.out.mp4`)

  try {
    const bytes = await downloadTo(row.blob_url, inPath)
    const probed = await probe(inPath)
    if (!probed.rotate) {
      tally.skipped++
      console.error(`${tag}  skip (rotate=0, ${probed.width}x${probed.height}, ${(bytes / 1e6).toFixed(1)}MB)`)
      continue
    }
    const newW = probed.rotate === 180 ? probed.width  : probed.height
    const newH = probed.rotate === 180 ? probed.height : probed.width
    console.error(`${tag}  rotate=${probed.rotate}°  ${probed.width}x${probed.height} → ${newW}x${newH}`)

    if (DRY_RUN) {
      tally.rotated++
      continue
    }

    // Re-encode. Strategy: rely on ffmpeg's default decode-side autorotate
    // to apply the input's displaymatrix to frames during decode, so the
    // encoder receives already-rotated pixels and writes them in their
    // visual orientation. We do NOT add a transpose filter — autorotate
    // already did the rotation. We do NOT pass -noautorotate — that would
    // skip the rotation entirely. `-map_metadata -1` plus clearing the
    // legacy `rotate=` tag prevents the source's rotation hints from
    // leaking into the output container, where they would double-rotate.
    await runFfmpeg([
      '-y', '-i', inPath,
      '-c:v', 'libx264', '-crf', '23', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
      // Transcode audio to AAC. `-c:a copy` is faster but breaks on any source
      // whose audio codec isn't mp4-compatible (e.g. PCM from cameras). AAC is
      // universally supported and the size delta is negligible for short clips.
      '-c:a', 'aac', '-b:a', '192k',
      '-map_metadata', '-1',
      '-metadata:s:v:0', 'rotate=',
      outPath,
    ])
    const outSize = (await stat(outPath)).size
    if (!outSize) throw new Error('ffmpeg produced empty output')

    // Upload to a distinct path so the original blob stays available for revert
    const blobPath = `media/raw/${row.workspace_slug}/rotated/${row.id}.mp4`
    const { url: newUrl } = await put(blobPath, createReadStream(outPath), {
      access: 'public',
      contentType: row.mime_type || 'video/mp4',
      token: blobToken,
      addRandomSuffix: true,
    })

    // Atomic DB swap — blob_url + width + height in one statement
    await db.query(
      `UPDATE media_assets SET blob_url=$1, width=$2, height=$3, updated_at=now() WHERE id=$4`,
      [newUrl, newW, newH, row.id],
    )
    tally.rotated++
    console.error(`${tag}  ✓ swapped → ${newUrl.slice(-60)} (${(outSize / 1e6).toFixed(1)}MB)`)
  } catch (e) {
    tally.failed++
    failures.push({ id: row.id, filename: row.filename, error: e.message })
    console.error(`${tag}  ✗ ${e.message}`)
  } finally {
    await rm(inPath,  { force: true }).catch(() => {})
    await rm(outPath, { force: true }).catch(() => {})
  }
}

await rm(workdir, { recursive: true, force: true }).catch(() => {})
await db.end()

console.error('\n── Summary ──')
console.error(`  rotated  ${tally.rotated}`)
console.error(`  skipped  ${tally.skipped}`)
console.error(`  failed   ${tally.failed}`)
if (failures.length) {
  console.error('\nFailures:')
  for (const f of failures) console.error(`  ${f.id} ${f.filename}: ${f.error}`)
}

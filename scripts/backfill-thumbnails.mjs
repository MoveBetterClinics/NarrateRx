#!/usr/bin/env node
/**
 * Backfill thumbnails for videos missing thumbnail_url.
 *
 * Uses local source files where available (much faster than downloading GB+
 * files from blob storage). Falls back to downloading from blob_url for any
 * video not found locally.
 *
 * Usage:
 *   node scripts/backfill-thumbnails.mjs --source="/path/to/local/folder" --dry-run
 *   node scripts/backfill-thumbnails.mjs --source="/path/to/local/folder"
 *
 * Requires: MULTITENANT_DATABASE_URL + BLOB_READ_WRITE_TOKEN + SUPABASE_URL
 *           + SUPABASE_SERVICE_KEY in .env.local
 */

import pg from 'pg'
import { put as blobPut } from '@vercel/blob'
import { readFileSync, createWriteStream } from 'fs'
import { mkdtemp, readFile, rm, stat } from 'fs/promises'
import { readdir } from 'fs/promises'
import { join, extname } from 'path'
import { tmpdir } from 'os'
import { spawn } from 'child_process'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import https from 'node:https'
import http from 'node:http'
import ffmpegStaticPath from 'ffmpeg-static'

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const sourceArg = args.find(a => a.startsWith('--source='))
const SOURCE_DIR = sourceArg ? sourceArg.split('=').slice(1).join('=') : null

// ---------------------------------------------------------------------------
// .env.local
// ---------------------------------------------------------------------------
const envPath = '/Users/qbook/Claude Projects/NarrateRx/.env.local'
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#')) continue
  const eq = t.indexOf('='); if (eq < 0) continue
  const k = t.slice(0, eq).trim(); const v = t.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '')
  if (!(k in process.env)) process.env[k] = v
}

const dbUrl = process.env.MULTITENANT_DATABASE_URL
const blobToken = process.env.BLOB_READ_WRITE_TOKEN
if (!dbUrl) { console.error('ERROR: MULTITENANT_DATABASE_URL not set'); process.exit(1) }
if (!blobToken) { console.error('ERROR: BLOB_READ_WRITE_TOKEN not set'); process.exit(1) }

// ---------------------------------------------------------------------------
// pg pool
// ---------------------------------------------------------------------------
const s = dbUrl.replace(/^postgres(ql)?:\/\//, ''); const la = s.lastIndexOf('@')
const auth = s.slice(0, la); const hp = s.slice(la + 1)
const c = auth.indexOf(':'); const u = auth.slice(0, c); const p = auth.slice(c + 1)
const [hostport, dbq = 'postgres'] = hp.split('/')
const [h, port = '5432'] = hostport.split(':')
const { Pool } = pg
const pool = new Pool({ host: h, port: +port, user: u, password: p, database: (dbq||'postgres').split('?')[0], ssl: { rejectUnauthorized: false }, max: 4 })

// ---------------------------------------------------------------------------
// Build local file index from --source dir (if provided)
// ---------------------------------------------------------------------------
async function scanDir(dir, index = new Map()) {
  let entries
  try { entries = await readdir(dir, { withFileTypes: true }) } catch { return index }
  for (const e of entries) {
    const full = join(dir, e.name)
    if (e.isDirectory()) {
      await scanDir(full, index)
    } else if (e.isFile()) {
      const ext = extname(e.name).toLowerCase()
      if (['.mp4', '.mov', '.m4v', '.webm'].includes(ext)) {
        index.set(e.name.toLowerCase().trim(), full)
        index.set(e.name.trim(), full)
      }
    }
  }
  return index
}

let localIndex = new Map()
if (SOURCE_DIR) {
  console.log(`→ Scanning ${SOURCE_DIR} for local video files...`)
  localIndex = await scanDir(SOURCE_DIR)
  console.log(`  Found ${localIndex.size / 2} local video files\n`)
}

// ---------------------------------------------------------------------------
// Query DB for videos missing thumbnails
// ---------------------------------------------------------------------------
const { rows } = await pool.query(`
  SELECT id, filename, workspace_id, blob_url, mime_type, size_bytes
  FROM media_assets
  WHERE thumbnail_url IS NULL
    AND blob_url IS NOT NULL
    AND mime_type LIKE 'video/%'
  ORDER BY size_bytes ASC NULLS LAST
`)

console.log(`→ ${rows.length} video(s) missing thumbnails\n`)
if (rows.length === 0) {
  console.log('✓ Nothing to do.')
  await pool.end(); process.exit(0)
}

// ---------------------------------------------------------------------------
// ffmpeg helpers
// ---------------------------------------------------------------------------
const FFMPEG_BIN = process.env.FFMPEG_PATH || ffmpegStaticPath || 'ffmpeg'
const SEEK_SECONDS = '0.5'
const THUMB_WIDTH = 480
const JPEG_QUALITY = '4'

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_BIN, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    proc.stderr.on('data', d => { stderr += d.toString() })
    proc.on('error', e => reject(new Error(`ffmpeg spawn failed: ${e.message}`)))
    proc.on('close', code => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-300).trim()}`))
    })
  })
}

async function extractFrame(inPath, outPath) {
  const baseArgs = ['-y', '-ss', SEEK_SECONDS, '-i', inPath, '-vframes', '1', '-vf', `scale=${THUMB_WIDTH}:-2`, '-q:v', JPEG_QUALITY, outPath]
  try {
    await runFfmpeg(baseArgs)
    const st = await stat(outPath).catch(() => null)
    if (st && st.size > 0) return
    throw new Error('Empty output')
  } catch {
    await runFfmpeg(['-y', '-i', inPath, '-vframes', '1', '-vf', `scale=${THUMB_WIDTH}:-2`, '-q:v', JPEG_QUALITY, outPath])
  }
}

// ---------------------------------------------------------------------------
// Download via https.get (handles redirects, avoids Web Streams locking)
// ---------------------------------------------------------------------------
function downloadToFile(url, destPath) {
  return new Promise((resolve, reject) => {
    function doGet(u, redirects = 0) {
      if (redirects > 5) { reject(new Error('too many redirects')); return }
      const mod = u.startsWith('https') ? https : http
      mod.get(u, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume(); doGet(res.headers.location, redirects + 1); return
        }
        if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode}`)); return }
        const dest = createWriteStream(destPath)
        res.pipe(dest)
        dest.on('finish', resolve); dest.on('error', reject); res.on('error', reject)
      }).on('error', reject)
    }
    doGet(url)
  })
}

// ---------------------------------------------------------------------------
// Process one video
// ---------------------------------------------------------------------------
async function processThumbnail(row) {
  const localPath = localIndex.get(row.filename?.trim()) || localIndex.get(row.filename?.trim()?.toLowerCase())
  const source = localPath ? 'local' : 'cdn'

  const dir = await mkdtemp(join(tmpdir(), 'thumb-'))
  const inPath = join(dir, 'in.bin')
  const outPath = join(dir, 'out.jpg')

  try {
    if (localPath) {
      // Use local file directly — no download needed
      const srcPath = localPath
      await extractFrame(srcPath, outPath)
    } else {
      // Download from blob URL first (need seekable file for ffmpeg)
      process.stdout.write(' [downloading...]')
      await downloadToFile(row.blob_url, inPath)
      process.stdout.write(' [extracting frame...]')
      await extractFrame(inPath, outPath)
    }

    const jpeg = await readFile(outPath)
    const thumbPathname = `media/thumbs/${row.id}.jpg`

    const uploaded = await blobPut(thumbPathname, jpeg, {
      access: 'public',
      contentType: 'image/jpeg',
      token: blobToken,
      addRandomSuffix: false,
      allowOverwrite: true,
    })

    // Update via direct pg
    await pool.query(
      `UPDATE media_assets SET thumbnail_url = $1, updated_at = now() WHERE id = $2`,
      [uploaded.url, row.id]
    )

    return { source, url: uploaded.url }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

// ---------------------------------------------------------------------------
// Dry run
// ---------------------------------------------------------------------------
if (DRY_RUN) {
  console.log('Videos to thumbnail:')
  for (const row of rows) {
    const localPath = localIndex.get(row.filename?.trim()) || localIndex.get(row.filename?.trim()?.toLowerCase())
    const mb = row.size_bytes ? Math.round(row.size_bytes/1024/1024) + 'MB' : '?'
    console.log(`  [${mb}] ${row.filename} → ${localPath ? 'local ✓' : 'CDN download'}`)
  }
  console.log('\nDry-run complete. Re-run without --dry-run to generate.')
  await pool.end(); process.exit(0)
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
let done = 0, errors = 0
const errorLog = []
const t0 = Date.now()

for (const row of rows) {
  const mb = row.size_bytes ? Math.round(row.size_bytes/1024/1024) : '?'
  process.stdout.write(`\n[${done + errors + 1}/${rows.length}] ${row.filename} (${mb}MB)...`)
  try {
    const result = await processThumbnail(row)
    done++
    process.stdout.write(` ✓ (${result.source})`)
  } catch (err) {
    errors++
    errorLog.push(`${err.message}\t${row.id}\t${row.filename}`)
    process.stdout.write(` ✗ ${err.message}`)
  }
}

const secs = ((Date.now() - t0) / 1000).toFixed(1)
console.log(`\n\n✓ Done in ${secs}s. ok=${done} err=${errors}`)
if (errors) {
  console.log('\nErrors:')
  for (const line of errorLog) console.log('  ' + line)
}

await pool.end()
process.exit(errors ? 1 : 0)

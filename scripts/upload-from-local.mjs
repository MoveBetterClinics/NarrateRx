#!/usr/bin/env node
/**
 * Upload remaining legacy-store videos directly from local disk.
 *
 * Reads the 33 media_assets rows still pointing at the legacy gmrxcvv1cauu7ksf
 * store, finds each file on disk by its original filename, uploads via
 * @vercel/blob put() with multipart:true (required for >100 MB files), then
 * updates media_assets.blob_url + blob_pathname.
 *
 * Usage:
 *   node scripts/upload-from-local.mjs --source="/path/to/local/folder" --dry-run
 *   node scripts/upload-from-local.mjs --source="/path/to/local/folder"
 *
 * Requires: MULTITENANT_DATABASE_URL + BLOB_READ_WRITE_TOKEN in .env.local
 */

import pg from 'pg'
import { put } from '@vercel/blob'
import { existsSync, readFileSync, createReadStream, statSync } from 'fs'
import { fileURLToPath } from 'url'
import { join, extname } from 'path'
import { readdir } from 'fs/promises'

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const sourceArg = args.find(a => a.startsWith('--source='))
const SOURCE_DIR = sourceArg ? sourceArg.split('=').slice(1).join('=') : null

if (!SOURCE_DIR) {
  console.error('ERROR: --source=<path> is required')
  process.exit(1)
}
if (!existsSync(SOURCE_DIR)) {
  console.error(`ERROR: source directory not found: ${SOURCE_DIR}`)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// .env.local
// ---------------------------------------------------------------------------
const repoRoot = join(fileURLToPath(import.meta.url), '..', '..')
const envPath = join(repoRoot, '.env.local')
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

const tokenStoreId = blobToken.replace(/^vercel_blob_rw_/, '').split('_')[0]
const CURRENT_STORE_PREFIX = tokenStoreId.toLowerCase()

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
// Build local file index: original filename (case-insensitive) → absolute path
// ---------------------------------------------------------------------------
console.log(`→ Scanning ${SOURCE_DIR} for video files...`)

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
        // Store by both the original name and lowercased for case-insensitive lookup
        index.set(e.name.toLowerCase().trim(), full)
        index.set(e.name.trim(), full)  // also exact match
      }
    }
  }
  return index
}

const localIndex = await scanDir(SOURCE_DIR)
console.log(`  Found ${localIndex.size / 2} video files locally\n`)

// ---------------------------------------------------------------------------
// Query DB for remaining rows
// ---------------------------------------------------------------------------
const { rows } = await pool.query(`
  SELECT id, blob_url, blob_pathname, filename, mime_type, size_bytes
  FROM media_assets
  WHERE blob_url IS NOT NULL
    AND lower(split_part(split_part(blob_url, '://', 2), '.', 1)) = 'gmrxcvv1cauu7ksf'
  ORDER BY size_bytes ASC NULLS LAST
`)

console.log(`→ ${rows.length} DB row(s) need migration\n`)

if (rows.length === 0) {
  console.log('✓ Nothing to do.')
  await pool.end(); process.exit(0)
}

// Match each row to a local file
const matched = [], unmatched = []
for (const row of rows) {
  const localPath = localIndex.get(row.filename?.trim()) || localIndex.get(row.filename?.trim()?.toLowerCase())
  if (localPath) matched.push({ ...row, localPath })
  else unmatched.push(row)
}

console.log(`  Matched:   ${matched.length}`)
console.log(`  Unmatched: ${unmatched.length}`)
if (unmatched.length) {
  console.log('\nUnmatched (no local file found):')
  for (const r of unmatched) console.log(`  ${r.filename}  (${r.id})`)
}
console.log()

if (DRY_RUN) {
  console.log('Matched files:')
  for (const r of matched) {
    const mb = r.size_bytes ? Math.round(r.size_bytes / 1024 / 1024) : '?'
    console.log(`  [${mb}MB] ${r.filename}`)
    console.log(`    local: ${r.localPath}`)
    console.log(`    → put at: ${r.blob_pathname}`)
  }
  console.log('\nDry-run complete. Re-run without --dry-run to upload.')
  await pool.end(); process.exit(0)
}

// ---------------------------------------------------------------------------
// Upload (sequential — these are large files)
// ---------------------------------------------------------------------------
let done = 0, errors = 0
const errorLog = []
const t0 = Date.now()

for (const row of matched) {
  const mb = row.size_bytes ? Math.round(row.size_bytes / 1024 / 1024) : '?'
  process.stdout.write(`\n[${done + errors + 1}/${matched.length}] ${row.filename} (${mb}MB)... `)

  try {
    const localStat = statSync(row.localPath)
    if (localStat.size === 0) throw new Error('local file is empty')

    // multipart:true is required for files >100MB — splits into chunks and
    // uploads in parallel, avoiding single-stream timeout issues.
    const result = await put(row.blob_pathname, createReadStream(row.localPath), {
      access: 'public',
      token: blobToken,
      contentType: row.mime_type || 'video/mp4',
      addRandomSuffix: false,
      allowOverwrite: true,
      multipart: true,
    })

    const newPrefix = new URL(result.url).host.split('.')[0].toLowerCase()
    if (newPrefix !== CURRENT_STORE_PREFIX) throw new Error(`wrong store prefix: ${newPrefix}`)

    await pool.query(
      `UPDATE media_assets SET blob_url = $1, blob_pathname = $2, updated_at = now() WHERE id = $3`,
      [result.url, result.pathname, row.id]
    )

    done++
    process.stdout.write(`✓`)
  } catch (err) {
    errors++
    const entry = `${err.message}\t${row.id}\t${row.filename}`
    errorLog.push(entry)
    process.stdout.write(`✗ ${err.message}`)
  }
}

const secs = ((Date.now() - t0) / 1000).toFixed(1)
console.log(`\n\n✓ Done in ${secs}s. ok=${done} err=${errors}`)

if (unmatched.length) {
  console.log(`\n${unmatched.length} file(s) had no local match — still on legacy store:`)
  for (const r of unmatched) console.log(`  ${r.filename}`)
}
if (errors) {
  console.log('\nErrors:')
  for (const line of errorLog) console.log('  ' + line)
}

await pool.end()
process.exit(errors || unmatched.length ? 1 : 0)

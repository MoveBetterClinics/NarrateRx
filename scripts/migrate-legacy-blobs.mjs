#!/usr/bin/env node
/**
 * One-shot migration: copy every `media_assets.blob_url` that lives in a
 * legacy (orphaned) Vercel Blob store into the project's current store
 * (T4oTw6…), then rewrite the DB row to the new URL.
 *
 * Why this exists
 * ---------------
 * After the multi-tenant pivot (2026-05-10/11), the three per-brand Vercel
 * projects were deleted. Their Blob stores (one each) were detached and are
 * not visible in the `movebetter` team's blob store list, but the public
 * `*.public.blob.vercel-storage.com` URLs still resolve. The risk is that
 * Vercel may eventually sweep detached stores, after which every
 * `media_assets.blob_url` baked into the 908 production rows would 404.
 *
 * Strategy
 * --------
 *   1. SELECT every row whose blob_url host ≠ current store prefix.
 *   2. fetch(old_url) → stream the body to @vercel/blob put() under the
 *      same pathname, in the current store.
 *   3. UPDATE media_assets SET blob_url = <new_url> WHERE id = <row.id>.
 *   4. Idempotent: re-runs skip rows already pointing at the current store.
 *
 * Streaming, not buffering: pipes fetch ReadableStream straight into put(),
 * so peak RAM is the SDK's internal buffer, not the file size. Matches the
 * pattern from api/_lib/thumbnail.js for large video assets.
 *
 * Usage
 * -----
 *   node scripts/migrate-legacy-blobs.mjs --dry-run
 *   node scripts/migrate-legacy-blobs.mjs --workspace=movebetter-animals
 *   node scripts/migrate-legacy-blobs.mjs --limit=5
 *   node scripts/migrate-legacy-blobs.mjs                  # all remaining
 *
 * Requires: MULTITENANT_DATABASE_URL + BLOB_READ_WRITE_TOKEN in .env.local.
 */

import pg from 'pg'
import https from 'node:https'
import http from 'node:http'
import { put } from '@vercel/blob'
import { existsSync, readFileSync, createWriteStream, unlinkSync } from 'fs'
import { readFile } from 'fs/promises'
import { pipeline } from 'stream/promises'
import { tmpdir } from 'os'
import { fileURLToPath } from 'url'
import { join } from 'path'

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2)
const flag = (name) => args.find(a => a === `--${name}` || a.startsWith(`--${name}=`))
const flagValue = (name) => {
  const f = flag(name)
  if (!f) return null
  if (f.includes('=')) return f.split('=').slice(1).join('=')
  return true
}
const DRY_RUN = !!flag('dry-run')
const WORKSPACE_SLUG = flagValue('workspace') // optional
const LIMIT = flagValue('limit') ? parseInt(flagValue('limit'), 10) : null
const CONCURRENCY = 1 // 1GB+ videos: sequential, no timeout — let each file complete naturally

// ---------------------------------------------------------------------------
// .env.local loader
// ---------------------------------------------------------------------------
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
if (!dbUrl) { console.error('ERROR: MULTITENANT_DATABASE_URL not set'); process.exit(1) }
if (!blobToken) { console.error('ERROR: BLOB_READ_WRITE_TOKEN not set'); process.exit(1) }

// Current store prefix is encoded in the token: vercel_blob_rw_<storeId>_…
const tokenStoreId = blobToken.replace(/^vercel_blob_rw_/, '').split('_')[0]
const CURRENT_STORE_PREFIX = tokenStoreId.toLowerCase()
if (!CURRENT_STORE_PREFIX) {
  console.error('ERROR: could not parse store id from BLOB_READ_WRITE_TOKEN')
  process.exit(1)
}
console.log(`→ Current blob store prefix: ${CURRENT_STORE_PREFIX}`)
console.log(`→ Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}`)
if (WORKSPACE_SLUG) console.log(`→ Filter: workspace = ${WORKSPACE_SLUG}`)
if (LIMIT) console.log(`→ Limit: ${LIMIT} rows`)
console.log('')

// ---------------------------------------------------------------------------
// pg client (parse url the same way backup-blobs.mjs does — password may
// contain raw '@')
// ---------------------------------------------------------------------------
const stripped = dbUrl.replace(/^postgres(ql)?:\/\//, '')
const lastAt = stripped.lastIndexOf('@')
const auth = stripped.slice(0, lastAt)
const hostPart = stripped.slice(lastAt + 1)
const colon = auth.indexOf(':')
const user = auth.slice(0, colon)
const pwd = auth.slice(colon + 1)
const [hostport, dbAndQ = 'postgres'] = hostPart.split('/')
const [host, port = '5432'] = hostport.split(':')
const db = (dbAndQ || 'postgres').split('?')[0] || 'postgres'

// Use a Pool so concurrent batch slots each get their own connection,
// avoiding the pg "query while already executing" deprecation warning.
const { Pool } = pg
const client = new Pool({
  host, port: Number(port), user, password: pwd, database: db,
  ssl: { rejectUnauthorized: false },
  max: CONCURRENCY + 2,
})

// ---------------------------------------------------------------------------
// Resolve --workspace=<slug> → workspace_id, if provided
// ---------------------------------------------------------------------------
let workspaceId = null
if (WORKSPACE_SLUG) {
  const { rows: wrows } = await client.query(
    `SELECT id FROM workspaces WHERE slug = $1`, [WORKSPACE_SLUG]
  )
  if (!wrows[0]) { console.error(`ERROR: no workspace with slug=${WORKSPACE_SLUG}`); process.exit(1) }
  workspaceId = wrows[0].id
}

// ---------------------------------------------------------------------------
// Select rows to migrate: every row whose host prefix ≠ current store.
// (Comparison is case-insensitive; URLs are lowercased.)
// ---------------------------------------------------------------------------
const params = [CURRENT_STORE_PREFIX]
let sql = `
  SELECT id, workspace_id, blob_url, blob_pathname, filename, size_bytes, mime_type
  FROM media_assets
  WHERE blob_url IS NOT NULL
    AND lower(split_part(split_part(blob_url, '://', 2), '.', 1)) <> $1
`
if (workspaceId) {
  params.push(workspaceId)
  sql += ` AND workspace_id = $${params.length}`
}
// Photos first so the bulk of small files migrate quickly; large videos last.
sql += ` ORDER BY (CASE WHEN mime_type LIKE 'video/%' THEN 1 ELSE 0 END), workspace_id, created_at`
if (LIMIT) sql += ` LIMIT ${LIMIT}`

const { rows } = await client.query(sql, params)
console.log(`→ ${rows.length} row(s) need migration\n`)

if (rows.length === 0) {
  console.log('✓ Nothing to do.')
  await client.end()
  process.exit(0)
}

// Group counts for visibility
const byHost = {}
for (const r of rows) {
  const h = new URL(r.blob_url).host.split('.')[0]
  byHost[h] = (byHost[h] || 0) + 1
}
console.log('Distribution by legacy store:')
for (const [h, n] of Object.entries(byHost)) console.log(`  ${h}: ${n}`)
console.log('')

if (DRY_RUN) {
  console.log('Sample (first 5 rows):')
  for (const r of rows.slice(0, 5)) {
    console.log(`  ${r.id}  ${r.blob_url}  →  pathname=${r.blob_pathname}`)
  }
  console.log('\nDry-run complete. Re-run without --dry-run to migrate.')
  await client.end()
  process.exit(0)
}

// ---------------------------------------------------------------------------
// Migrate (concurrent batches)
// ---------------------------------------------------------------------------
let done = 0, errors = 0, skipped = 0
const errorLog = []

async function migrateOne(row) {
  // Use blob_pathname when present (canonical) and fall back to the URL
  // pathname so we never invent a path that didn't exist before.
  const pathname = row.blob_pathname || new URL(row.blob_url).pathname.replace(/^\//, '')
  if (!pathname) throw new Error('no pathname')

  // Use node:https directly (not fetch) to download large videos.
  // Node.js's Fetch/undici implementation throws "body disturbed or locked"
  // on connections that take 30+ minutes (1GB+ files). The classic https.get()
  // gives a plain Node.js IncomingMessage stream with no locking semantics.
  // Follows redirects manually (Vercel Blob CDN may redirect once).
  const tmpFile = join(tmpdir(), `nrx-migrate-${row.id}.tmp`)
  let contentType = row.mime_type || 'application/octet-stream'

  await new Promise((resolve, reject) => {
    function doGet(url, redirects = 0) {
      if (redirects > 5) { reject(new Error('too many redirects')); return }
      const mod = url.startsWith('https') ? https : http
      mod.get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          doGet(res.headers.location, redirects + 1)
          return
        }
        if (res.statusCode !== 200) {
          res.resume()
          reject(new Error(`HTTP ${res.statusCode}`))
          return
        }
        if (res.headers['content-type']) contentType = res.headers['content-type']
        const dest = createWriteStream(tmpFile)
        res.pipe(dest)
        dest.on('finish', resolve)
        dest.on('error', reject)
        res.on('error', reject)
      }).on('error', reject)
    }
    doGet(row.blob_url)
  })

  // Read into a Buffer before calling put().
  // Passing a ReadStream to @vercel/blob put() causes "body disturbed or locked"
  // because the SDK's internal fetch() response handler reads response.body twice.
  // A Buffer has no stream-locking semantics and works reliably.
  // For 1GB files this uses 1GB RAM; with concurrency=1 that's acceptable.
  let result
  try {
    const body = await readFile(tmpFile)
    result = await put(pathname, body, {
      access: 'public',
      token: blobToken,
      contentType,
      addRandomSuffix: false,
      allowOverwrite: true,
    })
  } finally {
    try { unlinkSync(tmpFile) } catch { /* already gone */ }
  }

  // Sanity check: new URL must be on the current store.
  const newPrefix = new URL(result.url).host.split('.')[0].toLowerCase()
  if (newPrefix !== CURRENT_STORE_PREFIX) {
    throw new Error(`unexpected new store prefix: ${newPrefix}`)
  }

  await client.query(
    `UPDATE media_assets SET blob_url = $1, blob_pathname = $2, updated_at = now() WHERE id = $3`,
    [result.url, result.pathname, row.id]
  )
}

console.log(`→ Migrating ${rows.length} blob(s), concurrency=${CONCURRENCY}...\n`)
const t0 = Date.now()

for (let i = 0; i < rows.length; i += CONCURRENCY) {
  const batch = rows.slice(i, i + CONCURRENCY)
  await Promise.all(batch.map(async (row) => {
    try {
      await migrateOne(row)
      done++
    } catch (err) {
      errors++
      const entry = `${err.message}\t${row.id}\t${row.blob_url}`
      errorLog.push(entry)
      process.stdout.write(`\nERR: ${err.message}\n`)
    }
    process.stdout.write(`\r  ${done + errors + skipped}/${rows.length}  ok=${done} err=${errors}`)
  }))
}

const secs = ((Date.now() - t0) / 1000).toFixed(1)
console.log(`\n\n✓ Done in ${secs}s. ok=${done} err=${errors}`)

if (errors) {
  console.log('\nErrors:')
  for (const line of errorLog.slice(0, 20)) console.log('  ' + line)
  if (errorLog.length > 20) console.log(`  … (${errorLog.length - 20} more)`)
}

await client.end()
process.exit(errors ? 1 : 0)

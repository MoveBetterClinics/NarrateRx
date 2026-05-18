#!/usr/bin/env node
/**
 * Backfill thumbnails for PHOTOS missing thumbnail_url.
 *
 * The Library grid uses thumbnail_url with a blob_url fallback. When
 * thumbnail_url is null, the browser tries to render the full-resolution
 * blob_url (5–10 MB DSLR JPEGs), which is brutally slow and often visually
 * blanks the grid on first paint. This script downloads each photo's
 * blob_url, resizes to a 400px-wide JPEG with sharp, uploads to
 * media/thumbs/<id>.jpg in the same blob store, and updates the DB row.
 *
 * The audit on 2026-05-18 found 681 photos with no thumbnail (every photo
 * in the multi-tenant DB at the time). The Library "Recent · last 7 days"
 * lane was the most visibly broken because newest = largest DSLR captures.
 *
 * Usage:
 *   node scripts/backfill-photo-thumbnails.mjs --dry-run
 *   node scripts/backfill-photo-thumbnails.mjs --limit=20
 *   node scripts/backfill-photo-thumbnails.mjs
 *
 * Requires: MULTITENANT_DATABASE_URL + BLOB_READ_WRITE_TOKEN in .env.local.
 */

import pg from 'pg'
import { put as blobPut } from '@vercel/blob'
import sharp from 'sharp'
import { readFileSync } from 'fs'

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const limitArg = args.find(a => a.startsWith('--limit='))
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : null
const idsArg = args.find(a => a.startsWith('--ids='))
const ONLY_IDS = idsArg ? idsArg.split('=')[1].split(',').map(s => s.trim()).filter(Boolean) : null

// ---------------------------------------------------------------------------
// .env.local — mirrors the pattern in scripts/backfill-thumbnails.mjs so the
// script works the same way when invoked from the project root.
// ---------------------------------------------------------------------------
const envPath = '/Users/qbook/Claude Projects/NarrateRx/.env.local'
try {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('='); if (eq < 0) continue
    const k = t.slice(0, eq).trim(); const v = t.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '')
    if (!(k in process.env)) process.env[k] = v
  }
} catch { /* env may already be exported via `set -a && source .env.local` */ }

const dbUrl = process.env.MULTITENANT_DATABASE_URL
const blobToken = process.env.BLOB_READ_WRITE_TOKEN
if (!dbUrl)    { console.error('ERROR: MULTITENANT_DATABASE_URL not set'); process.exit(1) }
if (!blobToken){ console.error('ERROR: BLOB_READ_WRITE_TOKEN not set');    process.exit(1) }

// ---------------------------------------------------------------------------
// pg pool — same connection-string parser as scripts/backfill-thumbnails.mjs
// so heroku-style URLs with @ in the password don't choke pg's default parser.
// ---------------------------------------------------------------------------
const s = dbUrl.replace(/^postgres(ql)?:\/\//, '')
const la = s.lastIndexOf('@')
const auth = s.slice(0, la); const hp = s.slice(la + 1)
const cIdx = auth.indexOf(':')
const u = auth.slice(0, cIdx); const p = auth.slice(cIdx + 1)
const [hostport, dbq = 'postgres'] = hp.split('/')
const [h, port = '5432'] = hostport.split(':')
const { Pool } = pg
const pool = new Pool({
  host: h, port: +port, user: u, password: p,
  database: (dbq || 'postgres').split('?')[0],
  ssl: { rejectUnauthorized: false },
  max: 4,
})

// ---------------------------------------------------------------------------
// Query DB for photos missing thumbnail_url
// ---------------------------------------------------------------------------
const where = [
  `kind = 'photo'`,
  `thumbnail_url IS NULL`,
  `blob_url IS NOT NULL`,
  `archived_at IS NULL`,
]
const params = []
if (ONLY_IDS && ONLY_IDS.length) {
  params.push(ONLY_IDS)
  where.push(`id = ANY($${params.length}::uuid[])`)
}
const limitClause = LIMIT ? `LIMIT ${LIMIT}` : ''
const { rows } = await pool.query(
  `SELECT id, filename, blob_url, mime_type
     FROM media_assets
     WHERE ${where.join(' AND ')}
     ORDER BY created_at DESC
     ${limitClause}`,
  params,
)

console.log(`→ ${rows.length} photo(s) missing thumbnails${ONLY_IDS ? ` (filtered to ${ONLY_IDS.length} id(s))` : ''}${LIMIT ? ` (limited to ${LIMIT})` : ''}\n`)
if (rows.length === 0) {
  console.log('✓ Nothing to do.')
  await pool.end()
  process.exit(0)
}

if (DRY_RUN) {
  for (const r of rows.slice(0, 20)) console.log(`  [dry-run] ${r.filename || r.id}`)
  if (rows.length > 20) console.log(`  …and ${rows.length - 20} more`)
  console.log(`\n(dry-run) Would process ${rows.length} photos. Re-run without --dry-run to apply.`)
  await pool.end()
  process.exit(0)
}

// ---------------------------------------------------------------------------
// Per-photo: download → resize to 400px wide JPEG → upload → update DB
// sharp().resize({ width: 400, withoutEnlargement: true }) keeps the
// aspect ratio so portraits stay portrait. quality: 78 balances size vs
// noise on JPEG re-encode. failOn 'truncated' surfaces partial downloads
// instead of writing a broken thumbnail.
// ---------------------------------------------------------------------------
let ok = 0, failed = 0
for (let i = 0; i < rows.length; i++) {
  const r = rows[i]
  const label = `[${i + 1}/${rows.length}] ${r.filename || r.id}`
  try {
    const resp = await fetch(r.blob_url)
    if (!resp.ok) throw new Error(`fetch ${resp.status}`)
    const buf = Buffer.from(await resp.arrayBuffer())
    const thumb = await sharp(buf, { failOn: 'truncated' })
      .rotate() // honor EXIF orientation
      .resize({ width: 400, withoutEnlargement: true, fit: 'inside' })
      .jpeg({ quality: 78, progressive: true })
      .toBuffer()
    const pathname = `media/thumbs/${r.id}.jpg`
    const uploaded = await blobPut(pathname, thumb, {
      access: 'public',
      contentType: 'image/jpeg',
      token: blobToken,
      addRandomSuffix: false,
      allowOverwrite: true,
    })
    await pool.query(
      `UPDATE media_assets SET thumbnail_url = $1, updated_at = now() WHERE id = $2`,
      [uploaded.url, r.id],
    )
    ok++
    console.log(`${label} → ${(thumb.length / 1024).toFixed(0)} KB`)
  } catch (err) {
    failed++
    console.error(`${label} FAILED: ${err.message}`)
  }
}

console.log(`\n${ok} succeeded, ${failed} failed.`)
await pool.end()
process.exit(failed > 0 ? 1 : 0)

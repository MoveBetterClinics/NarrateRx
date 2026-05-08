#!/usr/bin/env node
//
// One-shot backfill: walk media_assets for rows whose mime_type is HEIC/HEIF,
// transcode the blob to JPEG, replace blob_url + blob_pathname + filename +
// mime_type + size_bytes on the row, and delete the old HEIC blob. Audited as
// action='transcode' for traceability.
//
// Going-forward HEIC handling lives in scripts/import-from-{local,drive}.mjs
// and src/lib/mediaLib.js — this script only needs to run if HEIC files were
// ingested before that landed.
//
// Usage:
//   node scripts/transcode-existing-heic.mjs --brand <people|equine|animals> [--limit N] [--dry-run]
//
// Required env (same as import-from-local.mjs):
//   BLOB_READ_WRITE_TOKEN
//   SUPABASE_URL
//   SUPABASE_SERVICE_KEY

import { put as blobPut, del as blobDel } from '@vercel/blob'
import { readFile } from 'node:fs/promises'
import heicConvert from 'heic-convert'

function parseArgs(argv) {
  const args = { dryRun: false }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    const next = argv[i + 1]
    switch (a) {
      case '--brand':   args.brand  = next; i++; break
      case '--limit':   args.limit  = parseInt(next, 10); i++; break
      case '--dry-run': args.dryRun = true; break
      case '--help': case '-h': args.help = true; break
      default:
        console.error(`Unknown arg: ${a}`)
        process.exit(1)
    }
  }
  return args
}

const argv = parseArgs(process.argv)

if (argv.help || !argv.brand) {
  console.log(`
transcode-existing-heic.mjs — backfill HEIC/HEIF rows to JPEG.

  --brand <people|equine|animals>  required
  --limit <n>                      stop after n successful transcodes
  --dry-run                        list affected rows, don't write
`.trim())
  process.exit(argv.help ? 0 : 1)
}

if (!['people', 'equine', 'animals'].includes(argv.brand)) {
  console.error(`Invalid --brand: ${argv.brand}.`)
  process.exit(1)
}

async function maybeLoadDotenv() {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY && process.env.BLOB_READ_WRITE_TOKEN) return
  try {
    const text = await readFile('.env.local', 'utf8')
    for (const line of text.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/)
      if (!m) continue
      const key = m[1]
      let val = m[2].trim()
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1)
      }
      if (val.length === 0) continue
      if (!process.env[key]) process.env[key] = val
    }
  } catch {
    // no .env.local — fine if envs are exported in the shell
  }
}

await maybeLoadDotenv()

const REQUIRED = ['BLOB_READ_WRITE_TOKEN', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY']
const missing = REQUIRED.filter((k) => !process.env[k])
if (missing.length) {
  console.error(`Missing env vars: ${missing.join(', ')}`)
  process.exit(1)
}

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const BLOB_TOKEN   = process.env.BLOB_READ_WRITE_TOKEN

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

async function listHeicAssets(brand) {
  // PostgREST `or` over the two HEIC mimes. Order by created_at so a re-run
  // after a Ctrl+C resumes in a stable place.
  const filter = `or=(mime_type.eq.image/heic,mime_type.eq.image/heif)`
  const sel = 'id,brand,filename,blob_url,blob_pathname,mime_type,size_bytes'
  const qs = `media_assets?brand=eq.${brand}&${filter}&select=${sel}&order=created_at.asc`
  const r = await sb(qs)
  if (!r.ok) throw new Error(`list failed: ${r.status} ${await r.text()}`)
  return r.json()
}

function newPathnameFor(brand, oldPathname, newFilename) {
  // Old pathname looks like `media/raw/<brand>/<stamp>-<suffix>-<safe-name>`.
  // Replace the trailing safe-name segment with a JPEG-suffixed version so
  // the blob path mirrors the recorded filename.
  const parts = oldPathname.split('/')
  const stem = parts[parts.length - 1].replace(/\.(heic|heif)$/i, '.jpg')
  // If the stamp prefix didn't include the original extension somehow, just
  // append .jpg to be safe.
  const safe = newFilename.replace(/[^a-zA-Z0-9._-]+/g, '-')
  parts[parts.length - 1] = stem.endsWith('.jpg') ? stem : `${stem}-${safe}`
  return parts.join('/')
}

async function transcodeRow(row) {
  // 1. Fetch the existing HEIC blob.
  const dl = await fetch(row.blob_url)
  if (!dl.ok) throw new Error(`fetch blob ${row.blob_url} → ${dl.status}`)
  const ab = await dl.arrayBuffer()

  // 2. Decode → JPEG.
  const out = await heicConvert({ buffer: Buffer.from(ab), format: 'JPEG', quality: 0.92 })
  const jpeg = Buffer.from(out)

  // 3. Upload as a new blob (don't overwrite the HEIC; we want an atomic swap
  //    where the row points at the new URL before we delete the old one).
  const newFilename = (row.filename || 'photo.heic').replace(/\.(heic|heif)$/i, '.jpg')
  const newPathname = newPathnameFor(row.brand, row.blob_pathname, newFilename)
  const blob = await blobPut(newPathname, jpeg, {
    access: 'public',
    contentType: 'image/jpeg',
    token: BLOB_TOKEN,
  })

  // 4. Patch the row.
  const patch = {
    blob_url:      blob.url,
    blob_pathname: blob.pathname,
    filename:      newFilename,
    mime_type:     'image/jpeg',
    size_bytes:    jpeg.byteLength,
  }
  const upd = await sb(`media_assets?id=eq.${row.id}&brand=eq.${row.brand}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
  if (!upd.ok) {
    // Row update failed — clean up the orphan JPEG blob so we don't double-bill.
    try { await blobDel(blob.url, { token: BLOB_TOKEN }) } catch {}
    throw new Error(`row patch ${row.id} → ${upd.status} ${await upd.text()}`)
  }

  // 5. Delete old HEIC blob. Best-effort — if it fails, the row is still
  //    correct and a future blob-cleanup pass can sweep it.
  try {
    await blobDel(row.blob_url, { token: BLOB_TOKEN })
  } catch (e) {
    console.error(`  old blob delete failed (orphaned, not fatal): ${e.message}`)
  }

  // 6. Audit.
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/media_audit`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        brand: row.brand,
        asset_id: row.id,
        action: 'transcode',
        actor: 'transcode-heic-script',
        before: {
          blob_url: row.blob_url,
          blob_pathname: row.blob_pathname,
          filename: row.filename,
          mime_type: row.mime_type,
          size_bytes: row.size_bytes,
        },
        after: { ...patch },
        ip: null,
        user_agent: 'scripts/transcode-existing-heic.mjs',
      }),
    })
  } catch (e) {
    console.error(`  audit write failed: ${e.message}`)
  }

  return patch
}

async function main() {
  console.log(`HEIC backfill`)
  console.log(`  brand:    ${argv.brand}`)
  console.log(`  dry-run:  ${argv.dryRun}`)
  console.log()

  const rows = await listHeicAssets(argv.brand)
  console.log(`Found ${rows.length} HEIC/HEIF rows.`)
  if (!rows.length) return

  let todo = rows
  if (argv.limit && todo.length > argv.limit) todo = todo.slice(0, argv.limit)

  if (argv.dryRun) {
    console.log()
    for (const r of todo) {
      const sizeMb = r.size_bytes ? (r.size_bytes / (1024 * 1024)).toFixed(1) : '?'
      console.log(`  ${r.mime_type}  ${sizeMb.padStart(6)} MB  ${r.filename}`)
    }
    return
  }

  let ok = 0, failed = 0
  for (let i = 0; i < todo.length; i++) {
    const row = todo[i]
    const tag = `[${i + 1}/${todo.length}]`
    try {
      await transcodeRow(row)
      ok++
      console.log(`${tag} ok   ${row.filename}`)
    } catch (e) {
      failed++
      console.error(`${tag} FAIL ${row.filename} — ${e.message}`)
    }
  }

  console.log()
  console.log(`Done — ${ok} transcoded, ${failed} failed.`)
  if (failed) console.log(`Re-run the same command to retry — already-transcoded rows fall out of the query.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

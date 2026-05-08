#!/usr/bin/env node
//
// One-shot local-folder → Media Hub migrator. Companion to (and likely
// replacement for) scripts/import-from-drive.mjs. The user's full Drive
// (~186 GB) is already mirrored to local disk via Drive desktop sync, so
// the simpler path is to walk the local mirror and stream files to Vercel
// Blob — no Drive API, no service-account JWT, no Sensitive Google creds
// touching .env.local.
//
// Usage:
//   node scripts/import-from-local.mjs --brand <people|equine|animals> \
//     --source </absolute/path/to/brand-folder> [options]
//
// Options:
//   --brand <id>          Required. people | equine | animals.
//   --source <path>       Required. Absolute path to the brand-specific
//                         local folder (walks recursively).
//   --limit <n>           Stop after n successful inserts.
//   --concurrency <n>     Parallel upload slots. Default 3. Local disk read
//                         is cheap; the bottleneck is upload bandwidth.
//   --tag                 Enqueue AI auto-tag after each insert. Off by
//                         default — at thousands of files this would burst
//                         the AI Gateway. Re-tag in batches afterward.
//   --dry-run             List what would be imported, don't upload or insert.
//   --no-dedupe           Skip the existing-row pre-check. Default ON: each
//                         file is fingerprinted as `local:<filename>:<size>`
//                         and stamped into media_assets.drive_id so re-runs
//                         skip already-imported files.
//
// Required env (vercel env pull .env.local from a brand-linked checkout
// gets BLOB_READ_WRITE_TOKEN + SUPABASE_URL automatically; SUPABASE_SERVICE_KEY
// is Sensitive and must be pasted manually):
//   BLOB_READ_WRITE_TOKEN
//   SUPABASE_URL
//   SUPABASE_SERVICE_KEY
//
// Resumability: every insert stamps a synthetic id `local:<filename>:<size>`
// into media_assets.drive_id (the column already exists from
// supabase/006_media_assets.sql). Pre-check on each run skips anything
// already imported. Safe to Ctrl+C and re-run.

import { put as blobPut } from '@vercel/blob'
import { createHash } from 'node:crypto'
import { openAsBlob } from 'node:fs'
import { readFile, readdir, stat } from 'node:fs/promises'
import { join, extname, basename } from 'node:path'

// ─── CLI ──────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { concurrency: 3, tag: false, dryRun: false, dedupe: true }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    const next = argv[i + 1]
    switch (a) {
      case '--brand':       args.brand       = next; i++; break
      case '--source':      args.source      = next; i++; break
      case '--limit':       args.limit       = parseInt(next, 10); i++; break
      case '--concurrency': args.concurrency = parseInt(next, 10); i++; break
      case '--tag':         args.tag         = true; break
      case '--dry-run':     args.dryRun      = true; break
      case '--no-dedupe':   args.dedupe      = false; break
      case '--help': case '-h': args.help    = true; break
      default:
        console.error(`Unknown arg: ${a}`)
        process.exit(1)
    }
  }
  return args
}

const argv = parseArgs(process.argv)

if (argv.help || !argv.brand || !argv.source) {
  console.log(`
import-from-local.mjs — one-shot local folder → Media Hub migrator.

  --brand <people|equine|animals>   required
  --source <abs path>               required, brand-specific folder root
  --limit <n>                       stop after n inserts
  --concurrency <n>                 parallel uploads (default 3)
  --tag                             auto-tag after insert (off by default)
  --dry-run                         list, don't write
  --no-dedupe                       skip already-imported pre-check
`.trim())
  process.exit(argv.help ? 0 : 1)
}

if (!['people', 'equine', 'animals'].includes(argv.brand)) {
  console.error(`Invalid --brand: ${argv.brand}. Must be one of people, equine, animals.`)
  process.exit(1)
}

// ─── Try to load .env.local if env vars aren't set ────────────────────────

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
      if (val.length === 0) continue       // empty placeholder from vercel pull
      if (!process.env[key]) process.env[key] = val
    }
  } catch {
    // no .env.local — fine if envs are exported in the shell
  }
}

await maybeLoadDotenv()

// Dry-run only walks + stats locally, so it doesn't need Blob/Supabase creds.
// Dedupe also can't run without Supabase, so dry-run forces dedupe off.
if (argv.dryRun) {
  argv.dedupe = false
} else {
  const REQUIRED = ['BLOB_READ_WRITE_TOKEN', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY']
  const missing = REQUIRED.filter((k) => !process.env[k])
  if (missing.length) {
    console.error(`Missing env vars: ${missing.join(', ')}`)
    console.error(`Run \`vercel env pull .env.local\` from a brand-linked checkout, then paste`)
    console.error(`SUPABASE_SERVICE_KEY (Sensitive — Vercel CLI returns it blank) into .env.local`)
    console.error(`from your Supabase dashboard → Settings → API → service_role.`)
    process.exit(1)
  }
}

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const BLOB_TOKEN   = process.env.BLOB_READ_WRITE_TOKEN

// Verify --source exists and is a directory.
try {
  const s = await stat(argv.source)
  if (!s.isDirectory()) {
    console.error(`--source is not a directory: ${argv.source}`)
    process.exit(1)
  }
} catch (e) {
  console.error(`--source path not found: ${argv.source}`)
  process.exit(1)
}

// ─── Media file detection ─────────────────────────────────────────────────

const MIME = {
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.mp4':  'video/mp4',
  '.mov':  'video/quicktime',
  '.webm': 'video/webm',
  '.m4v':  'video/x-m4v',
  '.avi':  'video/x-msvideo',
  '.mkv':  'video/x-matroska',
}

function kindForExt(ext) {
  const mime = MIME[ext.toLowerCase()]
  if (!mime) return null
  if (mime.startsWith('image/')) return { kind: 'photo', mime }
  if (mime.startsWith('video/')) return { kind: 'video', mime }
  return null
}

const IGNORE_NAMES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini', '.gdoc', '.gsheet', '.gslides'])

async function* walk(dir) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (e) {
    console.error(`Cannot read ${dir}: ${e.message}`)
    return
  }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.' && e.name !== '..') {
      // Hidden files / dirs — skip. (.DS_Store, .Trash-*, etc.)
      if (IGNORE_NAMES.has(e.name) || e.name.startsWith('.')) continue
    }
    if (IGNORE_NAMES.has(e.name)) continue
    const full = join(dir, e.name)
    if (e.isDirectory()) {
      yield* walk(full)
    } else if (e.isFile()) {
      const ext = extname(e.name)
      if (kindForExt(ext)) yield full
    }
  }
}

// ─── Supabase ─────────────────────────────────────────────────────────────

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

function fingerprint(filename, size) {
  // Stable synthetic id stamped into media_assets.drive_id for dedupe.
  // Filename + byte-size collisions are vanishingly rare in clinical media
  // where filenames carry timestamps from the camera. Good enough for
  // skip-if-exists; we avoid hashing every byte at import time.
  return `local:${filename}:${size}`
}

async function existingFingerprints(brand, fps) {
  if (!fps.length) return new Set()
  const found = new Set()
  for (let i = 0; i < fps.length; i += 100) {
    const slice = fps.slice(i, i + 100)
    const filter = `drive_id=in.(${slice.map((x) => encodeURIComponent(`"${x}"`)).join(',')})`
    const r = await sb(`media_assets?brand=eq.${brand}&${filter}&select=drive_id`)
    if (!r.ok) throw new Error(`existingFingerprints: ${r.status} ${await r.text()}`)
    for (const row of await r.json()) found.add(row.drive_id)
  }
  return found
}

async function insertAsset(row) {
  const r = await sb('media_assets', { method: 'POST', body: JSON.stringify(row) })
  if (!r.ok) {
    const text = await r.text()
    throw new Error(`Insert failed: ${r.status} ${text}`)
  }
  const data = await r.json()
  return data[0] ?? null
}

async function recordAudit({ assetId, brand, snapshot }) {
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
        brand,
        asset_id: assetId,
        action: 'upload',
        actor: 'local-import',
        before: null,
        after: snapshot,
        ip: null,
        user_agent: 'scripts/import-from-local.mjs',
      }),
    })
  } catch (e) {
    console.error(`  audit write failed: ${e.message}`)
  }
}

// ─── Stream local file → Blob ─────────────────────────────────────────────

// Deterministic rename: {brand}-{kind}-{yyyymmdd}-{hash8}.{ext}
// e.g. people-video-20260507-a3f2b119.mp4 — sortable, traceable, stable
// per source file (re-import → same name → blob overwrite, not duplicate).
function renamedBasename({ brand, kind, capturedAt, fingerprint, ext }) {
  const date = capturedAt
    ? new Date(capturedAt).toISOString().slice(0, 10).replace(/-/g, '')
    : 'undated'
  const hash = createHash('sha1').update(fingerprint).digest('hex').slice(0, 8)
  const cleanExt = (ext || '').toLowerCase().replace(/^\./, '').replace(/^jpeg$/, 'jpg')
  return `${brand}-${kind}-${date}-${hash}.${cleanExt}`
}

function pathnameFor({ brand, kind, capturedAt, fingerprint, ext }) {
  return `media/raw/${brand}/${renamedBasename({ brand, kind, capturedAt, fingerprint, ext })}`
}

async function streamFileToBlob(brand, file, kind, mime) {
  // openAsBlob returns a Web Blob backed by the file on disk — calling
  // .stream() on it yields a fresh ReadableStream each time. The previous
  // implementation passed a one-shot Web ReadableStream, which broke when
  // @vercel/blob's internal retry logic tried to re-read the body on a
  // transient network blip ("Response body object should not be disturbed
  // or locked"). Memory stays flat: the Blob is lazy, not buffered.
  const fileBlob = await openAsBlob(file.path, { type: mime })
  const pathname = pathnameFor({
    brand,
    kind,
    capturedAt: file.mtime ? new Date(file.mtime).toISOString() : null,
    fingerprint: file.fp,
    ext: extname(file.path),
  })
  // addRandomSuffix:false — keep the deterministic name; re-imports overwrite
  // the same blob rather than creating duplicates.
  const blob = await blobPut(pathname, fileBlob, {
    access: 'public',
    contentType: mime,
    token: BLOB_TOKEN,
    addRandomSuffix: false,
  })
  return blob
}

// ─── One-file import ──────────────────────────────────────────────────────

async function importOne(brand, file) {
  const ext = extname(file.path).toLowerCase()
  const k = kindForExt(ext)
  if (!k) return { skipped: 'unknown-kind' }

  const blob = await streamFileToBlob(brand, file, k.kind, k.mime)

  const row = {
    brand,
    kind:          k.kind,
    status:        'raw',
    source:        'local-import',
    blob_url:      blob.url,
    blob_pathname: blob.pathname,
    filename:      basename(file.path),
    mime_type:     k.mime,
    size_bytes:    file.size,
    drive_id:      file.fp,                    // synthetic dedupe key
    captured_at:   file.mtime ? new Date(file.mtime).toISOString() : null,
    created_by:    'local-import',
    speaker_role:  'clinician',
  }
  const inserted = await insertAsset(row)

  if (inserted?.id) {
    await recordAudit({
      assetId: inserted.id,
      brand,
      snapshot: {
        id: inserted.id,
        kind: inserted.kind,
        status: inserted.status,
        source: inserted.source,
        filename: inserted.filename,
        blob_url: inserted.blob_url,
        blob_pathname: inserted.blob_pathname,
        created_by: inserted.created_by,
      },
    })
  }
  return { inserted }
}

// ─── Concurrency-limited runner ───────────────────────────────────────────

async function runWithConcurrency(items, n, worker, onResult) {
  let i = 0, inFlight = 0, done = 0
  return new Promise((resolve) => {
    const next = () => {
      while (inFlight < n && i < items.length) {
        const idx = i++
        const item = items[idx]
        inFlight++
        worker(item, idx)
          .then((r) => onResult({ item, idx, result: r, error: null }))
          .catch((e) => onResult({ item, idx, result: null, error: e }))
          .finally(() => {
            inFlight--; done++
            if (done === items.length) resolve()
            else next()
          })
      }
    }
    next()
    if (!items.length) resolve()
  })
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Local → Media Hub migrator`)
  console.log(`  brand:        ${argv.brand}`)
  console.log(`  source:       ${argv.source}`)
  console.log(`  concurrency:  ${argv.concurrency}`)
  console.log(`  auto-tag:     ${argv.tag ? 'on' : 'off (re-tag in batches afterward)'}`)
  console.log(`  dedupe:       ${argv.dedupe ? 'on (skip already-imported)' : 'OFF'}`)
  console.log(`  dry-run:      ${argv.dryRun}`)
  console.log()

  // 1. Walk source folder, stat each file for size + mtime.
  process.stdout.write(`Walking ${argv.source}… `)
  const candidates = []
  let walkCount = 0
  for await (const fullPath of walk(argv.source)) {
    try {
      const s = await stat(fullPath)
      candidates.push({
        path: fullPath,
        size: s.size,
        mtime: s.mtimeMs,
        fp: fingerprint(basename(fullPath), s.size),
      })
    } catch (e) {
      console.error(`stat failed: ${fullPath} — ${e.message}`)
    }
    walkCount++
    if (walkCount % 100 === 0) process.stdout.write(`${walkCount} `)
  }
  console.log(`done — ${candidates.length} media files found.`)

  if (!candidates.length) {
    console.log('Nothing to import.')
    return
  }

  const totalBytes = candidates.reduce((acc, f) => acc + f.size, 0)
  console.log(`Total size: ${(totalBytes / (1024 * 1024 * 1024)).toFixed(2)} GB`)

  // 2. Pre-check Supabase for already-imported fingerprints.
  let todo = candidates
  if (argv.dedupe) {
    process.stdout.write(`Checking Supabase for already-imported files… `)
    const existing = await existingFingerprints(argv.brand, candidates.map((f) => f.fp))
    todo = candidates.filter((f) => !existing.has(f.fp))
    console.log(`${existing.size} skipped (already imported), ${todo.length} to do.`)
  }

  if (argv.limit && todo.length > argv.limit) {
    console.log(`Limiting to ${argv.limit} per --limit.`)
    todo = todo.slice(0, argv.limit)
  }

  if (argv.dryRun) {
    console.log('\nDry-run — listing what would be imported (source → renamed blob):')
    for (const f of todo.slice(0, 200)) {
      const sizeMb = (f.size / (1024 * 1024)).toFixed(1)
      const k = kindForExt(extname(f.path))
      const newName = k
        ? renamedBasename({
            brand: argv.brand,
            kind: k.kind,
            capturedAt: f.mtime ? new Date(f.mtime).toISOString() : null,
            fingerprint: f.fp,
            ext: extname(f.path),
          })
        : '?'
      console.log(`  ${sizeMb.padStart(8)} MB  ${basename(f.path)}  →  ${newName}`)
    }
    if (todo.length > 200) console.log(`  …and ${todo.length - 200} more (truncated)`)
    return
  }

  // 3. Upload + insert in parallel up to --concurrency.
  let ok = 0, failed = 0, bytesUploaded = 0
  const startedAt = Date.now()
  await runWithConcurrency(todo, argv.concurrency, async (file) => {
    return importOne(argv.brand, file)
  }, ({ item, idx, result, error }) => {
    const tag = `[${idx + 1}/${todo.length}]`
    if (error) {
      failed++
      console.error(`${tag} FAIL ${basename(item.path)} — ${error.message}`)
      return
    }
    if (result?.skipped) {
      console.log(`${tag} skip ${basename(item.path)} (${result.skipped})`)
      return
    }
    ok++
    bytesUploaded += item.size
    const sizeMb = (item.size / (1024 * 1024)).toFixed(1)
    console.log(`${tag} ok   ${sizeMb.padStart(7)} MB  ${basename(item.path)}`)
  })

  const elapsed = (Date.now() - startedAt) / 1000
  const mbps = elapsed > 0 ? (bytesUploaded / (1024 * 1024) / elapsed).toFixed(1) : '?'
  console.log()
  console.log(`Done in ${elapsed.toFixed(1)}s — ${ok} imported, ${failed} failed.`)
  console.log(`Throughput: ${mbps} MB/s (${(bytesUploaded / (1024 * 1024 * 1024)).toFixed(2)} GB uploaded).`)
  if (failed) {
    console.log(`Re-run the same command — already-imported skips kick in via fingerprint.`)
  }
  if (!argv.tag && ok > 0) {
    console.log(`Auto-tag was off. Use the in-app "Tag with AI" button or run a re-tag batch later.`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

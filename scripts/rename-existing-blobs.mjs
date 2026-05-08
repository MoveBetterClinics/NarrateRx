#!/usr/bin/env node
//
// Backfill: rename Blob assets whose pathnames predate the deterministic
// {brand}-{kind}-{yyyymmdd|undated}-{hash8}.{ext} format introduced in
// PR #144. Reads media_assets rows for the given brand, computes the new
// pathname from row metadata (brand, kind, captured_at, drive_id, filename),
// then rewrites Blob + DB row to match.
//
// Per row:
//   1. compute the new deterministic pathname
//   2. blob copy(old_url → new_pathname)        — addRandomSuffix:false
//   3. PATCH media_assets row to point at the new blob
//   4. blob del(old_url)                        — best-effort
//   5. media_audit row with { action: 'rename', before, after }
//
// Order matters: copy before DB update before del. A crash mid-run leaves
// the row pointing at a working URL; the next run is idempotent because
// rows that already match the new pattern are skipped.
//
// Usage:
//   node scripts/rename-existing-blobs.mjs --brand people --dry-run
//   node scripts/rename-existing-blobs.mjs --brand people --limit 10
//   node scripts/rename-existing-blobs.mjs --brand people
//
// Required env (vercel env pull from a brand-linked checkout, plus the
// pasted Sensitive secrets):
//   BLOB_READ_WRITE_TOKEN
//   SUPABASE_URL
//   SUPABASE_SERVICE_KEY

import { copy as blobCopy, del as blobDel } from '@vercel/blob'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { extname, basename } from 'node:path'

// ─── CLI ──────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { dryRun: false, concurrency: 3 }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    const next = argv[i + 1]
    switch (a) {
      case '--brand':       args.brand       = next; i++; break
      case '--limit':       args.limit       = parseInt(next, 10); i++; break
      case '--concurrency': args.concurrency = parseInt(next, 10); i++; break
      case '--dry-run':     args.dryRun      = true; break
      case '--help':
      case '-h':            args.help        = true; break
      default:
        console.error(`Unknown arg: ${a}`)
        process.exit(2)
    }
  }
  return args
}

const argv = parseArgs(process.argv)

if (argv.help) {
  console.log(`Usage: node scripts/rename-existing-blobs.mjs --brand <name> [opts]

Renames pre-PR-144 Blob assets to {brand}-{kind}-{yyyymmdd|undated}-{hash8}.{ext}.

Required:
  --brand <name>            people | equine | animals | …

Options:
  --dry-run                 print planned renames, don't touch Blob or DB
  --limit <n>               cap how many rows to rename this run
  --concurrency <n>         parallel rename slots (default 3)

Idempotent: rows already matching the new pattern are skipped.
`)
  process.exit(0)
}

if (!argv.brand) {
  console.error('--brand is required (people | equine | animals | …)')
  process.exit(2)
}

// ─── Env loading (mirrors import-from-local.mjs) ──────────────────────────

async function maybeLoadDotenv() {
  try {
    const txt = await readFile(new URL('../.env.local', import.meta.url), 'utf8')
    for (const line of txt.split('\n')) {
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

if (!argv.dryRun) {
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

// ─── Naming (mirrors the import scripts) ─────────────────────────────────

function renamedBasename({ brand, kind, capturedAt, fingerprint, ext }) {
  const date = capturedAt
    ? new Date(capturedAt).toISOString().slice(0, 10).replace(/-/g, '')
    : 'undated'
  const hash = createHash('sha1').update(fingerprint).digest('hex').slice(0, 8)
  const cleanExt = (ext || '').toLowerCase().replace(/^\./, '').replace(/^jpeg$/, 'jpg')
  return `${brand}-${kind}-${date}-${hash}.${cleanExt}`
}

function pathnameFor(row) {
  return `media/raw/${row.brand}/${renamedBasename({
    brand:       row.brand,
    kind:        row.kind,
    capturedAt:  row.captured_at,
    fingerprint: row.drive_id,
    ext:         extname(row.filename || ''),
  })}`
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

async function listAssets(brand) {
  // Range-paginate so we don't hit Supabase's 1000-row default cap.
  const out = []
  const pageSize = 500
  let from = 0
  const select = 'id,brand,kind,blob_url,blob_pathname,filename,captured_at,drive_id'
  while (true) {
    const r = await sb(
      `media_assets?brand=eq.${brand}&select=${select}&order=id.asc`,
      { headers: { Range: `${from}-${from + pageSize - 1}`, 'Range-Unit': 'items' } },
    )
    if (!r.ok && r.status !== 206) {
      throw new Error(`listAssets: ${r.status} ${await r.text()}`)
    }
    const rows = await r.json()
    out.push(...rows)
    if (rows.length < pageSize) break
    from += pageSize
  }
  return out
}

async function updateAssetRow(id, patch) {
  const r = await sb(`media_assets?id=eq.${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
  if (!r.ok) throw new Error(`update id=${id}: ${r.status} ${await r.text()}`)
}

async function recordAudit({ brand, assetId, before, after }) {
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
        action: 'rename',
        actor: 'rename-existing-blobs',
        before,
        after,
        ip: null,
        user_agent: 'scripts/rename-existing-blobs.mjs',
      }),
    })
  } catch (e) {
    console.error(`  audit write failed: ${e.message}`)
  }
}

// ─── Concurrency-limited runner ───────────────────────────────────────────

async function runWithConcurrency(items, n, worker, onResult) {
  let i = 0, inFlight = 0, done = 0
  return new Promise((resolve) => {
    const next = () => {
      while (inFlight < n && i < items.length) {
        const idx  = i++
        const item = items[idx]
        inFlight++
        worker(item, idx)
          .then((r) => onResult({ item, idx, result: r, error: null }))
          .catch((e) => onResult({ item, idx, result: null, error: e }))
          .finally(() => {
            inFlight--
            done++
            if (done === items.length) resolve()
            else next()
          })
      }
    }
    if (!items.length) resolve()
    else next()
  })
}

// ─── Per-row rename ───────────────────────────────────────────────────────

async function renameOne(row) {
  const newPathname = pathnameFor(row)

  // Copy old → new with deterministic name. addRandomSuffix:false so a
  // partial-failure re-run hits the exact same target and overwrites cleanly.
  const newBlob = await blobCopy(row.blob_url, newPathname, {
    access: 'public',
    addRandomSuffix: false,
    token: BLOB_TOKEN,
  })

  // Update DB to point at the new blob BEFORE deleting the old one — a
  // crash here leaves the row with a working URL, just with both blobs
  // existing. Next run is a no-op because the row already matches.
  await updateAssetRow(row.id, {
    blob_url:      newBlob.url,
    blob_pathname: newBlob.pathname,
  })

  await recordAudit({
    brand:   row.brand,
    assetId: row.id,
    before:  { blob_pathname: row.blob_pathname, blob_url: row.blob_url },
    after:   { blob_pathname: newBlob.pathname,  blob_url: newBlob.url  },
  })

  // Best-effort delete of the old blob; if it fails we leak a single blob,
  // not data. The user can run a separate orphan-sweep later.
  try {
    await blobDel(row.blob_url, { token: BLOB_TOKEN })
  } catch (e) {
    return { renamed: newBlob.pathname, delWarning: e.message }
  }

  return { renamed: newBlob.pathname }
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Backfill rename — Media Hub → deterministic blob names`)
  console.log(`  brand:        ${argv.brand}`)
  console.log(`  concurrency:  ${argv.concurrency}`)
  console.log(`  dry-run:      ${argv.dryRun}`)
  console.log()

  process.stdout.write(`Loading media_assets rows… `)
  const rows = await listAssets(argv.brand)
  console.log(`${rows.length} rows.`)

  // Filter to rows that actually need renaming.
  const todo = []
  let skippedAlready = 0
  let skippedBad = 0
  for (const row of rows) {
    if (!row.drive_id || !row.kind || !row.blob_pathname || !row.blob_url) {
      skippedBad++
      continue
    }
    if (!['photo', 'video'].includes(row.kind)) {
      skippedBad++
      continue
    }
    const newPathname = pathnameFor(row)
    if (row.blob_pathname === newPathname) {
      skippedAlready++
      continue
    }
    todo.push({ row, newPathname })
  }
  console.log(`  ${skippedAlready} already-renamed, ${skippedBad} unrenameable, ${todo.length} to rename.`)

  let queue = todo
  if (argv.limit && queue.length > argv.limit) {
    console.log(`  limiting to ${argv.limit} per --limit.`)
    queue = queue.slice(0, argv.limit)
  }

  if (!queue.length) {
    console.log('Nothing to do.')
    return
  }

  if (argv.dryRun) {
    console.log('\nDry-run — planned renames:')
    for (const { row, newPathname } of queue.slice(0, 200)) {
      console.log(`  ${basename(row.blob_pathname)}  →  ${basename(newPathname)}`)
    }
    if (queue.length > 200) console.log(`  …and ${queue.length - 200} more (truncated)`)
    return
  }

  let ok = 0, failed = 0, warned = 0
  const startedAt = Date.now()
  await runWithConcurrency(queue, argv.concurrency, async ({ row }) => {
    return renameOne(row)
  }, ({ item, idx, result, error }) => {
    const tag = `[${idx + 1}/${queue.length}]`
    if (error) {
      failed++
      console.error(`${tag} FAIL ${basename(item.row.blob_pathname)} — ${error.message}`)
      return
    }
    if (result?.delWarning) {
      warned++; ok++
      console.warn(`${tag} ok   ${basename(result.renamed)}  ⚠ old blob del failed: ${result.delWarning}`)
      return
    }
    ok++
    console.log(`${tag} ok   ${basename(result.renamed)}`)
  })

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
  console.log(`\nDone in ${elapsed}s. ${ok} renamed, ${failed} failed, ${warned} succeeded with orphan warnings.`)
  if (warned) {
    console.log(`Orphan warnings = old blob still in storage but DB no longer references it. Safe to leave; run an orphan sweep later if desired.`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

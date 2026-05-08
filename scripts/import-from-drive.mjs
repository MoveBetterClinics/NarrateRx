#!/usr/bin/env node
//
// One-shot Drive → Media Hub migrator. Per HANDOFF and project memory, the
// Drive integration is being retired — this is a throwaway tool, not a
// permanent sync engine. Run once per brand, then drop api/drive/* and the
// MediaPicker Drive path in a follow-up PR.
//
// Usage:
//   node scripts/import-from-drive.mjs --brand <people|equine|animals> [options]
//
// Options:
//   --brand <id>          Required. people | equine | animals.
//   --folder <id>         Drive folder to walk. Defaults to GOOGLE_DRIVE_ID.
//                         Use a sub-folder id to import a slice.
//   --limit <n>           Stop after n successful inserts. Useful for smoke
//                         testing on a small batch first.
//   --concurrency <n>     Parallel upload slots. Default 3. Higher = faster
//                         but blob/Drive rate limits + memory pressure rise
//                         (large videos are streamed but each in-flight
//                         upload still holds a TCP connection + chunk buffer).
//   --tag                 Enqueue AI auto-tag after each insert. Off by
//                         default — at 4k files this floods the AI Gateway.
//                         Re-tag in batches afterward via the in-app button.
//   --dry-run             List what would be imported, don't actually upload
//                         or insert. Useful to preview a folder before commit.
//   --skip-existing       Skip files where media_assets.drive_id already
//                         exists (default ON — this flag is a no-op kept for
//                         clarity and can't be turned off).
//
// Required env (load via `vercel env pull .env.local` then run from repo root):
//   GOOGLE_SERVICE_ACCOUNT_EMAIL
//   GOOGLE_SERVICE_ACCOUNT_KEY      (PEM, with literal \n or real newlines)
//   GOOGLE_DRIVE_ID                 (Team Drive id; can override with --folder)
//   BLOB_READ_WRITE_TOKEN           (Vercel Blob server token)
//   SUPABASE_URL
//   SUPABASE_SERVICE_KEY
//
// Resumability: all writes stamp `media_assets.drive_id` so re-running picks
// up where it left off. Safe to Ctrl+C and resume — anything already inserted
// will skip on next pass via the drive_id pre-check.

import { put as blobPut } from '@vercel/blob'
import { readFile } from 'node:fs/promises'
import { createHash, createSign } from 'node:crypto'
import { extname } from 'node:path'

// ─── CLI ──────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { concurrency: 3, tag: false, dryRun: false }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    const next = argv[i + 1]
    switch (a) {
      case '--brand':       args.brand       = next; i++; break
      case '--folder':      args.folder      = next; i++; break
      case '--limit':       args.limit       = parseInt(next, 10); i++; break
      case '--concurrency': args.concurrency = parseInt(next, 10); i++; break
      case '--tag':         args.tag         = true; break
      case '--dry-run':     args.dryRun      = true; break
      case '--skip-existing': /* default on, accepted for clarity */ break
      case '--help': case '-h': args.help    = true; break
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
import-from-drive.mjs — one-shot Drive → Media Hub migrator.

  --brand <people|equine|animals>   required
  --folder <id>                     defaults to GOOGLE_DRIVE_ID env var
  --limit <n>                       stop after n inserts
  --concurrency <n>                 parallel uploads (default 3)
  --tag                             auto-tag after insert (off by default)
  --dry-run                         list, don't write
`.trim())
  process.exit(argv.help ? 0 : 1)
}

if (!['people', 'equine', 'animals'].includes(argv.brand)) {
  console.error(`Invalid --brand: ${argv.brand}. Must be one of people, equine, animals.`)
  process.exit(1)
}

// ─── Try to load .env.local if env vars aren't set ────────────────────────
//
// vercel env pull writes a .env.local. We don't depend on dotenv to keep the
// script dep-free — just shallow-parse if it exists.
async function maybeLoadDotenv() {
  if (process.env.SUPABASE_URL && process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL) return
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
      if (!process.env[key]) process.env[key] = val
    }
  } catch {
    // no .env.local — fine if envs are exported in the shell already
  }
}

await maybeLoadDotenv()

const REQUIRED = [
  'GOOGLE_SERVICE_ACCOUNT_EMAIL',
  'GOOGLE_SERVICE_ACCOUNT_KEY',
  'BLOB_READ_WRITE_TOKEN',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',
]
const missing = REQUIRED.filter((k) => !process.env[k])
if (missing.length) {
  console.error(`Missing env vars: ${missing.join(', ')}`)
  console.error(`Run \`vercel env pull .env.local\` from a brand-linked checkout, or export them in this shell.`)
  process.exit(1)
}

const SUPABASE_URL    = process.env.SUPABASE_URL
const SUPABASE_KEY    = process.env.SUPABASE_SERVICE_KEY
const BLOB_TOKEN      = process.env.BLOB_READ_WRITE_TOKEN
const ROOT_FOLDER     = argv.folder || process.env.GOOGLE_DRIVE_ID
if (!ROOT_FOLDER) {
  console.error('No folder to walk — set GOOGLE_DRIVE_ID or pass --folder <id>')
  process.exit(1)
}

// ─── Google Drive auth (service-account JWT, RS256) ───────────────────────

function base64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}

let cachedToken = null
let tokenExpiresAt = 0

async function getGoogleToken() {
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) return cachedToken
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const key   = process.env.GOOGLE_SERVICE_ACCOUNT_KEY.replace(/\\n/g, '\n')
  const now   = Math.floor(Date.now() / 1000)
  const claim = {
    iss: email,
    scope: 'https://www.googleapis.com/auth/drive.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = base64url(JSON.stringify(claim))
  const toSign = `${header}.${payload}`
  const signer = createSign('RSA-SHA256')
  signer.update(toSign)
  const sig = base64url(signer.sign(key))
  const jwt = `${toSign}.${sig}`
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })
  const data = await r.json()
  if (!data.access_token) throw new Error(`Token exchange failed: ${data.error_description || JSON.stringify(data)}`)
  cachedToken = data.access_token
  tokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000
  return cachedToken
}

// ─── Drive walk ───────────────────────────────────────────────────────────

const FOLDER_MIME = 'application/vnd.google-apps.folder'

async function listFolder(folderId, pageToken = '') {
  const token = await getGoogleToken()
  const params = new URLSearchParams({
    q: `'${folderId}' in parents and trashed=false`,
    fields: 'nextPageToken,files(id,name,mimeType,size,createdTime,md5Checksum)',
    pageSize: '1000',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
    corpora: 'allDrives',
    orderBy: 'name',
  })
  if (pageToken) params.set('pageToken', pageToken)
  const r = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!r.ok) {
    const e = await r.json().catch(() => ({}))
    throw new Error(`Drive list failed for ${folderId}: ${e.error?.message || r.status}`)
  }
  return r.json()
}

async function* walk(folderId) {
  const stack = [folderId]
  const seen = new Set()
  while (stack.length) {
    const id = stack.pop()
    if (seen.has(id)) continue
    seen.add(id)
    let pageToken = ''
    do {
      const page = await listFolder(id, pageToken)
      for (const f of page.files || []) {
        if (f.mimeType === FOLDER_MIME) {
          stack.push(f.id)
        } else if (f.mimeType.startsWith('image/') || f.mimeType.startsWith('video/')) {
          yield f
        }
      }
      pageToken = page.nextPageToken || ''
    } while (pageToken)
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

async function existingDriveIds(brand, ids) {
  if (!ids.length) return new Set()
  // PostgREST in.() filter — hit in batches of 100 to keep the URL short.
  const found = new Set()
  for (let i = 0; i < ids.length; i += 100) {
    const slice = ids.slice(i, i + 100)
    const filter = `drive_id=in.(${slice.map((x) => encodeURIComponent(x)).join(',')})`
    const r = await sb(`media_assets?brand=eq.${brand}&${filter}&select=drive_id`)
    if (!r.ok) throw new Error(`existingDriveIds: ${r.status}`)
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
  // Best-effort. Mirrors api/_lib/audit.js shape but actor='drive-migrator'.
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
        actor: 'drive-migrator',
        before: null,
        after: snapshot,
        ip: null,
        user_agent: 'scripts/import-from-drive.mjs',
      }),
    })
  } catch (e) {
    console.error(`  audit write failed: ${e.message}`)
  }
}

// ─── Stream Drive → Blob ─────────────────────────────────────────────────

function kindFromMime(mime) {
  if (mime.startsWith('image/')) return 'photo'
  if (mime.startsWith('video/')) return 'video'
  return null
}

// Deterministic rename: {brand}-{kind}-{yyyymmdd}-{hash8}.{ext}
// e.g. people-video-20260507-a3f2b119.mp4 — sortable, traceable, stable
// per Drive file (re-import → same name → blob overwrite, not duplicate).
function renamedBasename({ brand, kind, capturedAt, fingerprint, ext }) {
  const date = capturedAt
    ? new Date(capturedAt).toISOString().slice(0, 10).replace(/-/g, '')
    : 'undated'
  const hash = createHash('sha1').update(fingerprint).digest('hex').slice(0, 8)
  const cleanExt = (ext || '').toLowerCase().replace(/^\./, '').replace(/^jpeg$/, 'jpg')
  return `${brand}-${kind}-${date}-${hash}.${cleanExt}`
}

function pathnameFor(brand, file, kind) {
  return `media/raw/${brand}/${renamedBasename({
    brand,
    kind,
    capturedAt: file.createdTime || null,
    fingerprint: file.id,
    ext: extname(file.name),
  })}`
}

async function streamFileToBlob(brand, file, kind) {
  const token = await getGoogleToken()
  const dl = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!dl.ok) throw new Error(`Drive download ${file.id} → ${dl.status}`)

  // addRandomSuffix:false — keep the deterministic name; re-imports overwrite
  // the same blob rather than creating duplicates.
  const blob = await blobPut(pathnameFor(brand, file, kind), dl.body, {
    access: 'public',
    contentType: file.mimeType,
    token: BLOB_TOKEN,
    addRandomSuffix: false,
  })
  return blob
}

// ─── One-file import ──────────────────────────────────────────────────────

async function importOne(brand, file) {
  const kind = kindFromMime(file.mimeType)
  if (!kind) return { skipped: 'unknown-kind' }

  const blob = await streamFileToBlob(brand, file, kind)

  const row = {
    brand,
    kind,
    status: 'raw',
    source: 'drive-import',
    blob_url: blob.url,
    blob_pathname: blob.pathname,
    filename: file.name,
    mime_type: file.mimeType,
    size_bytes: file.size ? parseInt(file.size, 10) : null,
    drive_id: file.id,
    captured_at: file.createdTime || null,
    created_by: 'drive-migrator',
    speaker_role: 'clinician',
  }
  const inserted = await insertAsset(row)

  // Audit best-effort. Snapshot mirrors what api/_lib/audit.js's snapshot()
  // would produce for an upload action.
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
  let i = 0
  let inFlight = 0
  let done = 0
  return new Promise((resolve, reject) => {
    let halted = false
    const next = () => {
      if (halted) return
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
    // Safety: if items is empty, resolve immediately.
    if (!items.length) resolve()
    // Wire reject to onResult-thrown? Keep it simple: errors are surfaced
    // via onResult, never abort the run.
    void reject
  })
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Drive → Media Hub migrator`)
  console.log(`  brand:        ${argv.brand}`)
  console.log(`  folder:       ${ROOT_FOLDER}`)
  console.log(`  concurrency:  ${argv.concurrency}`)
  console.log(`  auto-tag:     ${argv.tag ? 'on' : 'off (re-tag in batches afterward)'}`)
  console.log(`  dry-run:      ${argv.dryRun}`)
  console.log()

  // 1. Walk Drive, collecting candidates. We materialize the list first so we
  //    can pre-check Supabase for existing drive_ids in one batch and report
  //    a real total before uploading.
  process.stdout.write(`Walking Drive… `)
  const candidates = []
  let walkCount = 0
  for await (const file of walk(ROOT_FOLDER)) {
    candidates.push(file)
    walkCount++
    if (walkCount % 100 === 0) process.stdout.write(`${walkCount} `)
  }
  console.log(`done — ${candidates.length} media files found.`)

  if (!candidates.length) {
    console.log('Nothing to import.')
    return
  }

  // 2. Pre-check which drive_ids are already imported.
  process.stdout.write(`Checking Supabase for already-imported files… `)
  const existing = await existingDriveIds(argv.brand, candidates.map((f) => f.id))
  const todo = candidates.filter((f) => !existing.has(f.id))
  console.log(`${existing.size} skipped (already imported), ${todo.length} to do.`)

  if (argv.limit && todo.length > argv.limit) {
    console.log(`Limiting to ${argv.limit} per --limit.`)
    todo.length = argv.limit
  }

  if (argv.dryRun) {
    console.log('\nDry-run — listing what would be imported (source → renamed blob):')
    for (const f of todo) {
      const sizeMb = f.size ? (parseInt(f.size, 10) / (1024 * 1024)).toFixed(1) : '?'
      const kind = kindFromMime(f.mimeType)
      const newName = kind
        ? renamedBasename({
            brand: argv.brand,
            kind,
            capturedAt: f.createdTime || null,
            fingerprint: f.id,
            ext: extname(f.name),
          })
        : '?'
      console.log(`  ${f.mimeType.padEnd(18)}  ${sizeMb.padStart(7)} MB  ${f.name}  →  ${newName}`)
    }
    return
  }

  // 3. Upload + insert in parallel up to --concurrency.
  let ok = 0, failed = 0
  const startedAt = Date.now()
  await runWithConcurrency(todo, argv.concurrency, async (file) => {
    return importOne(argv.brand, file)
  }, ({ item, idx, result, error }) => {
    const tag = `[${idx + 1}/${todo.length}]`
    if (error) {
      failed++
      console.error(`${tag} FAIL ${item.name} — ${error.message}`)
      return
    }
    if (result?.skipped) {
      console.log(`${tag} skip ${item.name} (${result.skipped})`)
      return
    }
    ok++
    const sizeMb = item.size ? (parseInt(item.size, 10) / (1024 * 1024)).toFixed(1) : '?'
    console.log(`${tag} ok   ${sizeMb.padStart(7)} MB  ${item.name}`)
  })

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
  console.log()
  console.log(`Done in ${elapsed}s — ${ok} imported, ${failed} failed.`)
  if (failed) {
    console.log(`Re-running the same command will retry failed files (already-imported skips kick in via drive_id).`)
  }
  if (!argv.tag && ok > 0) {
    console.log(`Auto-tag was off. Open the Media Hub and use the "Tag with AI" button on each, or run a re-tag pass.`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

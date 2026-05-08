#!/usr/bin/env node
//
// Re-runs AI auto-tagging on every brand-scoped media_assets row that's
// still in status='raw' — i.e. uploaded but not yet tagged. Designed for
// the post-bulk-import retag pass: the local migrator imports with --tag
// off to avoid bursting the AI Gateway during a 4000-file upload, so a
// follow-up pass walks the table and tags everything.
//
// Reuses the same `tagAndPersist()` from api/_lib/tagAsset.js that powers
// the in-app "Tag with AI" button, so prompts, models, and audit-row
// shape stay identical.
//
// Usage:
//   node scripts/retag-untagged.mjs --brand <people|equine|animals> [opts]
//
// Options:
//   --brand <id>          Required. people | equine | animals.
//   --limit <n>           Stop after n successful retags. Default no limit.
//   --concurrency <n>     Parallel retag slots. Default 2 — the AI Gateway
//                         is the bottleneck (vision+transcription per call),
//                         not the network. Pushing higher tends to hit
//                         rate limits before it speeds anything up.
//   --dry-run             List untagged rows, don't call the model.
//
// Required env (vercel env pull from a brand-linked checkout, plus the
// pasted Sensitive secrets):
//   SUPABASE_URL
//   SUPABASE_SERVICE_KEY
//   AI_GATEWAY_API_KEY
//
// Resumability: tagAndPersist() advances status from 'raw' → 'tagged' on
// success. Re-running this script after a partial pass automatically skips
// already-tagged rows because the query filters on status='raw'. Failed
// rows stay at status='raw' (the helper stamps the error into notes for
// forensics) so they get retried on the next invocation.

import { readFile } from 'node:fs/promises'

// ─── CLI ──────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { concurrency: 2, dryRun: false }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    const next = argv[i + 1]
    switch (a) {
      case '--brand':       args.brand       = next; i++; break
      case '--limit':       args.limit       = parseInt(next, 10); i++; break
      case '--concurrency': args.concurrency = parseInt(next, 10); i++; break
      case '--dry-run':     args.dryRun      = true; break
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
retag-untagged.mjs — re-tag every status='raw' media asset for a brand.

  --brand <people|equine|animals>   required
  --limit <n>                       stop after n retags
  --concurrency <n>                 parallel slots (default 2)
  --dry-run                         list untagged, don't call the model
`.trim())
  process.exit(argv.help ? 0 : 1)
}

if (!['people', 'equine', 'animals'].includes(argv.brand)) {
  console.error(`Invalid --brand: ${argv.brand}. Must be one of people, equine, animals.`)
  process.exit(1)
}

// Set BRAND BEFORE the dynamic import below — brand.js evaluates env vars
// at module load time to pick the active brand object that the prompt
// builder reads.
process.env.BRAND = argv.brand

// ─── Dotenv ────────────────────────────────────────────────────────────────

async function maybeLoadDotenv() {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY && process.env.AI_GATEWAY_API_KEY) return
  try {
    const text = await readFile('.env.local', 'utf8')
    for (const line of text.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/)
      if (!m) continue
      let val = m[2].trim()
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1)
      }
      if (val.length === 0) continue
      if (!process.env[m[1]]) process.env[m[1]] = val
    }
  } catch {
    // no .env.local — fine if envs are exported in the shell
  }
}

await maybeLoadDotenv()

// Dry-run only queries the table; doesn't need the AI key.
const REQUIRED = argv.dryRun
  ? ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY']
  : ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'AI_GATEWAY_API_KEY']
const missing = REQUIRED.filter((k) => !process.env[k])
if (missing.length) {
  console.error(`Missing env vars: ${missing.join(', ')}`)
  console.error(`Run \`vercel env pull .env.local\` from the brand-linked checkout, then`)
  console.error(`paste any Sensitive values (Vercel CLI returns them blank).`)
  process.exit(1)
}

// ─── Dynamic import after env is locked ───────────────────────────────────

const { tagAndPersist } = await import('../api/_lib/tagAsset.js')

// ─── Query untagged rows ──────────────────────────────────────────────────

async function listUntagged(brand) {
  const select = 'id,brand,kind,status,blob_url,mime_type,size_bytes,tags,notes'
  const url    = `${process.env.SUPABASE_URL}/rest/v1/media_assets?brand=eq.${brand}&status=eq.raw&select=${select}&order=created_at.asc`
  const r = await fetch(url, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
    },
  })
  if (!r.ok) throw new Error(`Query failed: ${r.status} ${await r.text()}`)
  return r.json()
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
  console.log(`Retag untagged — brand=${argv.brand}, concurrency=${argv.concurrency}, dry-run=${argv.dryRun}`)
  console.log()

  const rows = await listUntagged(argv.brand)
  console.log(`Found ${rows.length} assets at status='raw'.`)

  if (!rows.length) {
    console.log('Nothing to retag.')
    return
  }

  if (argv.dryRun) {
    console.log('\nDry-run — listing first 50 candidates:')
    for (const r of rows.slice(0, 50)) {
      console.log(`  ${r.kind.padEnd(5)} ${r.id}  (${r.tags?.length || 0} user tags)`)
    }
    if (rows.length > 50) console.log(`  …and ${rows.length - 50} more`)
    return
  }

  const todo = argv.limit ? rows.slice(0, argv.limit) : rows
  if (argv.limit && rows.length > argv.limit) {
    console.log(`Limiting to ${argv.limit} per --limit.`)
  }

  let ok = 0, failed = 0
  const startedAt = Date.now()
  await runWithConcurrency(todo, argv.concurrency, async (row) => {
    return await tagAndPersist(row)
  }, ({ item, idx, result, error }) => {
    const tag = `[${idx + 1}/${todo.length}]`
    if (error) {
      failed++
      console.error(`${tag} FAIL ${item.kind} ${item.id} — ${error.message}`)
      return
    }
    ok++
    const tagCount = result?.ai_tags?.length || 0
    const transcribed = result?.transcription ? ' +transcription' : ''
    console.log(`${tag} ok   ${item.kind.padEnd(5)} ${item.id}  → ${tagCount} ai tags${transcribed}`)
  })

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
  console.log()
  console.log(`Done in ${elapsed}s — ${ok} tagged, ${failed} failed.`)
  if (failed) {
    console.log(`Re-run the same command — failed rows stay at status='raw' for retry.`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

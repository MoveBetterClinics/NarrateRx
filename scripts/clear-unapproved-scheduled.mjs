#!/usr/bin/env node
// One-off cleanup: null out content_items.scheduled_at on any row that has
// not been approved yet (status IN 'draft' or 'in_review'). The legacy
// content-plan/draft.js handler pre-filled scheduled_at with an arbitrary
// "anchor + (slot-1) weeks at 9am UTC" date so every draft hit the calendar
// before a reviewer had agreed to a time. That auto-prefill was removed in
// the same PR as this script; this run wipes the pre-existing bogus dates.
//
// Idempotent — re-running is a no-op (matches zero rows once cleaned).
//
// Usage:
//   node scripts/clear-unapproved-scheduled.mjs              # apply
//   node scripts/clear-unapproved-scheduled.mjs --dry-run    # show counts only

import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { Client } = require('pg')

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')

const env = await readFile('.env.local', 'utf8')
const match = env.match(/^MULTITENANT_DATABASE_URL=(.+)$/m)
if (!match) {
  console.error('MULTITENANT_DATABASE_URL not found in .env.local')
  process.exit(1)
}
const connectionString = match[1].trim().replace(/^"(.*)"$/, '$1')

const client = new Client({ connectionString })
await client.connect()

try {
  const { rows: preview } = await client.query(
    `SELECT status, COUNT(*)::int AS n
       FROM public.content_items
      WHERE scheduled_at IS NOT NULL
        AND status IN ('draft', 'in_review')
      GROUP BY status
      ORDER BY status`,
  )
  const total = preview.reduce((s, r) => s + r.n, 0)
  console.log(`Found ${total} content_items with a pre-filled scheduled_at on an unapproved row:`)
  for (const r of preview) console.log(`  ${r.status.padEnd(10)} ${r.n}`)

  if (dryRun) {
    console.log('\n--dry-run set; no changes written.')
  } else if (total === 0) {
    console.log('Nothing to do.')
  } else {
    const { rowCount } = await client.query(
      `UPDATE public.content_items
          SET scheduled_at = NULL
        WHERE scheduled_at IS NOT NULL
          AND status IN ('draft', 'in_review')`,
    )
    console.log(`\nCleared scheduled_at on ${rowCount} row(s).`)
  }
} finally {
  await client.end()
}

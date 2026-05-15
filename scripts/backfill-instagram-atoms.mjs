#!/usr/bin/env node
// One-off backfill for the instagram_post / instagram_reel → `instagram`
// atom-platform mismatch that silently skipped Instagram atoms for any
// interview whose workspace had Instagram channels enabled.
//
// Inserts Instagram atom rows for interviews that:
//   1) have a blogPost (so a plan was already built),
//   2) have NO instagram rows in content_plan_atoms,
//   3) belong to a workspace whose enabled_outputs contains instagram_post
//      or instagram_reel.
//
// Idempotent — re-running is a no-op.
//
// Usage:
//   node scripts/backfill-instagram-atoms.mjs              # all workspaces
//   node scripts/backfill-instagram-atoms.mjs --dry-run    # show what would happen
//   node scripts/backfill-instagram-atoms.mjs --workspace=<slug>
//   node scripts/backfill-instagram-atoms.mjs --interview=<uuid>

import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { ATOM_DEFINITIONS } from '../api/_lib/atomPlan.js'

const require = createRequire(import.meta.url)
const { Client } = require('pg')

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const wsArg = args.find((a) => a.startsWith('--workspace='))?.split('=')[1]
const ivArg = args.find((a) => a.startsWith('--interview='))?.split('=')[1]

const env = await readFile('.env.local', 'utf8')
const match = env.match(/^MULTITENANT_DATABASE_URL=(.+)$/m)
if (!match) {
  console.error('MULTITENANT_DATABASE_URL not found in .env.local')
  process.exit(1)
}
const connectionString = match[1].trim().replace(/^"(.*)"$/, '$1')

const igAtoms = ATOM_DEFINITIONS.instagram
if (!igAtoms?.length) {
  console.error('ATOM_DEFINITIONS.instagram missing — aborting.')
  process.exit(1)
}

const client = new Client({ connectionString })
await client.connect()
console.log(`Connected to ${new URL(connectionString.replace('postgresql://', 'http://')).host}`)
if (dryRun) console.log('[DRY RUN] No rows will be inserted.\n')

try {
  const where = ["i.outputs->>'blogPost' IS NOT NULL", "length(i.outputs->>'blogPost') > 0"]
  const params = []
  if (wsArg) {
    params.push(wsArg)
    where.push(`w.slug = $${params.length}`)
  }
  if (ivArg) {
    params.push(ivArg)
    where.push(`i.id = $${params.length}`)
  }

  const findSql = `
    SELECT i.id, i.workspace_id, i.topic, w.slug AS workspace_slug,
           w.enabled_outputs
    FROM interviews i
    JOIN workspaces w ON w.id = i.workspace_id
    WHERE ${where.join(' AND ')}
      AND (
        'instagram_post' = ANY(w.enabled_outputs)
        OR 'instagram_reel' = ANY(w.enabled_outputs)
      )
      AND NOT EXISTS (
        SELECT 1 FROM content_plan_atoms a
        WHERE a.interview_id = i.id AND a.platform = 'instagram'
      )
    ORDER BY i.created_at DESC
  `
  const { rows: interviews } = await client.query(findSql, params)

  console.log(`Found ${interviews.length} interview${interviews.length === 1 ? '' : 's'} missing Instagram atoms.\n`)
  if (interviews.length === 0) {
    console.log('Nothing to do.')
    process.exit(0)
  }

  let totalInserted = 0
  for (const iv of interviews) {
    const label = `[${iv.workspace_slug}] ${iv.topic} (${iv.id.slice(0, 8)})`
    if (dryRun) {
      console.log(`  would insert ${igAtoms.length} instagram atoms → ${label}`)
      totalInserted += igAtoms.length
      continue
    }

    const values = []
    const ps = []
    let n = 1
    for (const a of igAtoms) {
      values.push(`($${n++}, $${n++}, 'instagram', $${n++}, $${n++}, $${n++}, $${n++}, 'pending')`)
      ps.push(iv.workspace_id, iv.id, a.slot, a.angle, a.label, a.description)
    }
    const insertSql = `
      INSERT INTO content_plan_atoms
        (workspace_id, interview_id, platform, slot, angle, angle_label, angle_description, status)
      VALUES ${values.join(', ')}
    `
    await client.query(insertSql, ps)
    totalInserted += igAtoms.length
    console.log(`  ✓ ${igAtoms.length} instagram atoms → ${label}`)
  }

  console.log(`\n${dryRun ? '[DRY RUN] ' : ''}Backfill complete: ${totalInserted} atoms across ${interviews.length} interviews.`)
} catch (err) {
  console.error('FAILED:', err.message)
  process.exit(1)
} finally {
  await client.end()
}

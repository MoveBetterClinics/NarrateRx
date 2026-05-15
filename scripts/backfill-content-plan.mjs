#!/usr/bin/env node
// Backfills content_plan_atoms for interviews that already have a blog post
// but were created before migration 023 / PR #339.
//
// Idempotent — skips any interview that already has plan rows.
//
// Usage:
//   node scripts/backfill-content-plan.mjs              # all workspaces
//   node scripts/backfill-content-plan.mjs --dry-run    # show what would happen
//   node scripts/backfill-content-plan.mjs --workspace=<slug>  # one workspace

import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { ATOM_DEFINITIONS } from '../api/_lib/atomPlan.js'

const require = createRequire(import.meta.url)
const { Client } = require('pg')

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const wsArg = args.find((a) => a.startsWith('--workspace='))?.split('=')[1]

const env = await readFile('.env.local', 'utf8')
const match = env.match(/^MULTITENANT_DATABASE_URL=(.+)$/m)
if (!match) {
  console.error('MULTITENANT_DATABASE_URL not found in .env.local')
  process.exit(1)
}
const connectionString = match[1].trim().replace(/^"(.*)"$/, '$1')

const client = new Client({ connectionString })
await client.connect()
console.log(`Connected to ${new URL(connectionString.replace('postgresql://', 'http://')).host}`)
if (dryRun) console.log('[DRY RUN] No rows will be inserted.\n')

try {
  // Resolve workspace filter
  let workspaceClause = ''
  let workspaceParams = []
  if (wsArg) {
    const wsRes = await client.query('SELECT id, slug, display_name FROM workspaces WHERE slug = $1', [wsArg])
    if (!wsRes.rows.length) {
      console.error(`No workspace with slug '${wsArg}'`)
      process.exit(1)
    }
    workspaceClause = 'AND i.workspace_id = $1'
    workspaceParams = [wsRes.rows[0].id]
    console.log(`Scoped to workspace: ${wsRes.rows[0].display_name} (${wsRes.rows[0].slug})\n`)
  }

  // Find interviews with a blogPost and NO existing plan atoms
  const findSql = `
    SELECT i.id, i.workspace_id, i.topic, w.slug AS workspace_slug
    FROM interviews i
    JOIN workspaces w ON w.id = i.workspace_id
    WHERE i.outputs->>'blogPost' IS NOT NULL
      AND length(i.outputs->>'blogPost') > 0
      AND NOT EXISTS (
        SELECT 1 FROM content_plan_atoms a WHERE a.interview_id = i.id
      )
      ${workspaceClause}
    ORDER BY i.created_at DESC
  `
  const { rows: interviews } = await client.query(findSql, workspaceParams)

  console.log(`Found ${interviews.length} interview${interviews.length === 1 ? '' : 's'} needing a plan backfill.\n`)
  if (interviews.length === 0) {
    console.log('Nothing to do.')
    process.exit(0)
  }

  // Build the canonical atom set once
  const atomTemplate = []
  for (const [platform, atoms] of Object.entries(ATOM_DEFINITIONS)) {
    for (const a of atoms) {
      atomTemplate.push({
        platform,
        slot: a.slot,
        angle: a.angle,
        angle_label: a.label,
        angle_description: a.description,
      })
    }
  }
  console.log(`Each interview will get ${atomTemplate.length} atoms.\n`)

  let totalInserted = 0
  for (const iv of interviews) {
    const label = `[${iv.workspace_slug}] ${iv.topic} (${iv.id.slice(0, 8)})`
    if (dryRun) {
      console.log(`  would insert ${atomTemplate.length} atoms → ${label}`)
      totalInserted += atomTemplate.length
      continue
    }

    const values = []
    const params = []
    let i = 1
    for (const a of atomTemplate) {
      values.push(`($${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, 'pending')`)
      params.push(
        iv.workspace_id,
        iv.id,
        a.platform,
        a.slot,
        a.angle,
        a.angle_label,
        a.angle_description,
      )
    }
    const insertSql = `
      INSERT INTO content_plan_atoms
        (workspace_id, interview_id, platform, slot, angle, angle_label, angle_description, status)
      VALUES ${values.join(', ')}
    `
    await client.query(insertSql, params)
    totalInserted += atomTemplate.length
    console.log(`  ✓ ${atomTemplate.length} atoms → ${label}`)
  }

  console.log(`\n${dryRun ? '[DRY RUN] ' : ''}Backfill complete: ${totalInserted} atoms across ${interviews.length} interviews.`)
} catch (err) {
  console.error('FAILED:', err.message)
  process.exit(1)
} finally {
  await client.end()
}

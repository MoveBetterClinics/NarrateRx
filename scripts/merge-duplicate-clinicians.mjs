#!/usr/bin/env node
/**
 * Merge duplicate Self clinicians and backfill `user_id`.
 *
 * Identifies clinician rows that all belong to the same Clerk user within a
 * workspace, picks a canonical winner (most interviews, ties broken by
 * earliest created_at), moves all data from the losers onto the winner, then
 * deletes the loser rows. Sets `user_id = clerk_user_id` on the winner.
 *
 * Heuristic for "this row is the user themself":
 *   1. created_by_id matches a Clerk user in the workspace's org
 *   2. AND the clinician.name matches (case-insensitive) one of:
 *        - clerk.unsafeMetadata.display_name
 *        - clerk.fullName
 *        - clerk.firstName + ' ' + clerk.lastName
 *      OR is a recognizable variant ("Dr. " + lastName, "Dr. " + firstInitial).
 *
 * Rows that don't match any Clerk user's name signals stay untouched —
 * they're proxies (admin recorded someone else's interview) and lookup-by-
 * name continues to work for them.
 *
 * Tables that point at clinicians.id (must be re-pointed at the winner):
 *   - interviews.clinician_id
 *   - clinician_recipes.clinician_id  (deduped — winner keeps unique-named
 *     recipes; loser duplicates with the same name are dropped)
 *
 * Usage:
 *   node scripts/merge-duplicate-clinicians.mjs --dry-run
 *   node scripts/merge-duplicate-clinicians.mjs
 *
 * Requires: MULTITENANT_DATABASE_URL + CLERK_SECRET_KEY in .env.local
 */

import pg from 'pg'
import { readFileSync } from 'fs'
import { createClerkClient } from '@clerk/backend'

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')

// ---------------------------------------------------------------------------
// .env.local
// ---------------------------------------------------------------------------
const envPath = '/Users/qbook/Claude Projects/NarrateRx/.env.local'
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#')) continue
  const eq = t.indexOf('='); if (eq < 0) continue
  const k = t.slice(0, eq).trim(); const v = t.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '')
  if (!(k in process.env)) process.env[k] = v
}

const dbUrl = process.env.MULTITENANT_DATABASE_URL
if (!dbUrl) { console.error('Missing MULTITENANT_DATABASE_URL'); process.exit(1) }
if (!process.env.CLERK_SECRET_KEY) { console.error('Missing CLERK_SECRET_KEY'); process.exit(1) }

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })

// ---------------------------------------------------------------------------
// Name helpers
// ---------------------------------------------------------------------------
function norm(s) {
  return (s || '').trim().toLowerCase()
}

// Build the candidate-name set for a Clerk user. Match is a case-insensitive
// equality against any candidate. Includes a few "Dr." prefixed variants
// since clinical contexts almost always wear titles.
function clerkNameCandidates(u) {
  const display = u.unsafeMetadata?.display_name?.trim() || ''
  const first   = u.firstName?.trim() || ''
  const last    = u.lastName?.trim()  || ''
  const full    = u.fullName?.trim()  || `${first} ${last}`.trim()
  const out = new Set()
  if (display) out.add(norm(display))
  if (full)    out.add(norm(full))
  if (first && last) out.add(norm(`${first} ${last}`))
  if (last) {
    out.add(norm(`dr. ${last}`))
    out.add(norm(`dr ${last}`))
  }
  if (first) {
    out.add(norm(`dr. ${first[0]}`))
    out.add(norm(`dr ${first[0]}`))
    out.add(norm(`dr. ${first[0]}.`))
  }
  return out
}

// ---------------------------------------------------------------------------
// DB
// ---------------------------------------------------------------------------
const { Client } = pg
const db = new Client({ connectionString: dbUrl })
await db.connect()

console.log(`Connected to ${dbUrl.split('@')[1]?.split('/')[0] || '???'}`)
console.log(DRY_RUN ? 'DRY RUN — no writes\n' : 'LIVE RUN — writing changes\n')

// Group clinicians by (workspace_id, created_by_id). Each group is a
// candidate for "same person who created multiple rows in same workspace."
const { rows: clinicians } = await db.query(`
  select c.id, c.workspace_id, c.name, c.user_id, c.created_by_id, c.created_at,
         (select count(*) from interviews i where i.clinician_id = c.id) as iv_count
  from clinicians c
  where c.created_by_id is not null
  order by c.workspace_id, c.created_by_id, iv_count desc, c.created_at asc
`)

console.log(`Loaded ${clinicians.length} clinicians (with created_by_id)`)

const groups = new Map()
for (const c of clinicians) {
  const key = `${c.workspace_id}::${c.created_by_id}`
  if (!groups.has(key)) groups.set(key, [])
  groups.get(key).push(c)
}

// Filter to groups with >1 row OR exactly 1 row but no user_id yet (we still
// want to backfill user_id on those single rows).
let totalMerges = 0
let totalBackfills = 0
let totalProxiesSkipped = 0

for (const [key, rows] of groups) {
  const createdById = key.split('::')[1]

  // Fetch the Clerk user once per group. If lookup fails, treat as proxy
  // and skip the whole group — we can't safely auto-merge without knowing
  // what names belong to this user.
  let clerkUser
  try {
    clerkUser = await clerk.users.getUser(createdById)
  } catch {
    totalProxiesSkipped += rows.length
    continue
  }
  if (!clerkUser) {
    totalProxiesSkipped += rows.length
    continue
  }

  const candidates = clerkNameCandidates(clerkUser)
  const selfRows = rows.filter((r) => candidates.has(norm(r.name)))

  if (selfRows.length === 0) {
    // This user created rows but none match their own names — they're all
    // proxies (e.g. admin recorded interviews for other clinicians). Skip.
    totalProxiesSkipped += rows.length
    continue
  }

  // Winner: most interviews; ties broken by earliest created_at (matches
  // the SQL order).
  const winner = selfRows[0]
  const losers = selfRows.slice(1)

  // Always set winner.user_id even when there are no losers — pure
  // backfill case.
  if (!winner.user_id) {
    console.log(`backfill: ws=${winner.workspace_id.slice(0,8)} winner=${winner.id.slice(0,8)} name="${winner.name}" → user_id=${createdById.slice(0,12)}`)
    if (!DRY_RUN) {
      await db.query(`update clinicians set user_id = $1, updated_at = now() where id = $2`, [createdById, winner.id])
    }
    totalBackfills++
  }

  if (losers.length === 0) continue

  console.log(`merge: ws=${winner.workspace_id.slice(0,8)} winner="${winner.name}" (${winner.id.slice(0,8)}, ${winner.iv_count} interviews) <-`)
  for (const loser of losers) {
    console.log(`  loser="${loser.name}" (${loser.id.slice(0,8)}, ${loser.iv_count} interviews)`)
  }

  if (DRY_RUN) {
    totalMerges += losers.length
    continue
  }

  // Transactional merge per group so a mid-merge failure doesn't leave
  // half-pointed rows.
  await db.query('BEGIN')
  try {
    for (const loser of losers) {
      // Move interviews
      await db.query(`update interviews set clinician_id = $1 where clinician_id = $2`, [winner.id, loser.id])

      // Move recipes — but skip duplicates by name. If both winner and
      // loser have a recipe named "Default", keep winner's and drop
      // loser's. Same-name recipes are the only realistic collision case.
      const { rows: loserRecipes } = await db.query(`select id, name from clinician_recipes where clinician_id = $1`, [loser.id])
      const { rows: winnerRecipes } = await db.query(`select name from clinician_recipes where clinician_id = $1`, [winner.id])
      const winnerNames = new Set(winnerRecipes.map((r) => r.name.toLowerCase()))
      for (const lr of loserRecipes) {
        if (winnerNames.has(lr.name.toLowerCase())) {
          await db.query(`delete from clinician_recipes where id = $1`, [lr.id])
        } else {
          await db.query(`update clinician_recipes set clinician_id = $1 where id = $2`, [winner.id, lr.id])
        }
      }

      // Move any other clinician-pointing rows. None exist today besides
      // interviews + clinician_recipes, but a generic FK-discovery would
      // catch future additions. For now, keep it explicit.

      // Delete the loser row
      await db.query(`delete from clinicians where id = $1`, [loser.id])
    }
    await db.query('COMMIT')
    totalMerges += losers.length
  } catch (e) {
    await db.query('ROLLBACK')
    console.error(`  FAILED to merge group ${key}: ${e.message}`)
  }
}

console.log('')
console.log(`Summary:`)
console.log(`  user_id backfills: ${totalBackfills}`)
console.log(`  duplicate rows merged: ${totalMerges}`)
console.log(`  proxy rows skipped: ${totalProxiesSkipped}`)
console.log(DRY_RUN ? '\n(dry run — re-run without --dry-run to apply)' : '\nDone.')

await db.end()

#!/usr/bin/env node
/**
 * One-off: merge Dr. Q + Dr. Michael Quasney clinician rows in the
 * movebetter-people workspace. These are two rows owned by the same Clerk
 * user, created before the user_id binding existed.
 *
 * Winner: Dr. Q (ecc80e20-40af-49dd-9879-e79f65656e6b) — has 2 completed
 *         interviews + the Quality Blog Post recipe.
 * Loser:  Dr. Michael Quasney (ee656a11-6c0e-4364-b5e3-ea7caf7154a4) —
 *         has 1 in-progress interview ("ACL rehab"), no recipes.
 *
 * Action: move ACL rehab onto winner, set user_id on winner, delete loser.
 * The retained label on the winner stays "Dr. Q" (matches the current
 * display name); a follow-up `syncClinicianName` from the Account page can
 * change it later.
 *
 * Usage:
 *   node scripts/merge-drq-rows.mjs --dry-run
 *   node scripts/merge-drq-rows.mjs
 */

import pg from 'pg'
import { readFileSync } from 'fs'

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')

const envPath = '/Users/qbook/Claude Projects/NarrateRx/.env.local'
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#')) continue
  const eq = t.indexOf('='); if (eq < 0) continue
  const k = t.slice(0, eq).trim(); const v = t.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '')
  if (!(k in process.env)) process.env[k] = v
}

const dbUrl = process.env.MULTITENANT_DATABASE_URL
if (!dbUrl) { console.error('Missing MULTITENANT_DATABASE_URL'); process.exit(1) }

const WINNER_ID = 'ecc80e20-40af-49dd-9879-e79f65656e6b'  // Dr. Q
const LOSER_ID  = 'ee656a11-6c0e-4364-b5e3-ea7caf7154a4'  // Dr. Michael Quasney

const { Client } = pg
const db = new Client({ connectionString: dbUrl })
await db.connect()
console.log(`Connected to ${dbUrl.split('@')[1]?.split('/')[0]}`)
console.log(DRY_RUN ? 'DRY RUN\n' : 'LIVE RUN\n')

// Sanity check both rows exist and grab created_by_id from the winner
const { rows: clins } = await db.query(
  `select id, name, user_id, created_by_id from clinicians where id = any($1)`,
  [[WINNER_ID, LOSER_ID]]
)
console.log('Found clinicians:')
for (const c of clins) console.log(`  ${c.id.slice(0,8)} "${c.name}" user_id=${c.user_id || 'null'} created_by=${c.created_by_id?.slice(0,12)}`)
if (clins.length !== 2) { console.error('Expected 2 rows; aborting'); process.exit(1) }

const winner = clins.find((c) => c.id === WINNER_ID)
const loser  = clins.find((c) => c.id === LOSER_ID)
if (winner.created_by_id !== loser.created_by_id) {
  console.error(`created_by_id mismatch (${winner.created_by_id} vs ${loser.created_by_id}); aborting — these may not be the same user`)
  process.exit(1)
}

const { rows: loserInterviews } = await db.query(`select id, topic, status from interviews where staff_id = $1`, [LOSER_ID])
const { rows: loserRecipes }    = await db.query(`select id, name from staff_recipes where staff_id = $1`, [LOSER_ID])
console.log(`\nLoser has ${loserInterviews.length} interviews and ${loserRecipes.length} recipes that will move to winner.`)

if (DRY_RUN) {
  console.log('\n(dry run — re-run without --dry-run to apply)')
  await db.end()
  process.exit(0)
}

await db.query('BEGIN')
try {
  // Move interviews
  const moveIv = await db.query(`update interviews set staff_id = $1 where staff_id = $2`, [WINNER_ID, LOSER_ID])
  console.log(`Moved ${moveIv.rowCount} interviews`)

  // Move recipes (none expected from loser, but be safe)
  const moveRc = await db.query(`update staff_recipes set staff_id = $1 where staff_id = $2`, [WINNER_ID, LOSER_ID])
  console.log(`Moved ${moveRc.rowCount} recipes`)

  // Set user_id on the winner (= the shared Clerk created_by_id)
  await db.query(`update clinicians set user_id = $1, updated_at = now() where id = $2`, [winner.created_by_id, WINNER_ID])
  console.log(`Set user_id on winner`)

  // Delete the loser
  const del = await db.query(`delete from clinicians where id = $1`, [LOSER_ID])
  console.log(`Deleted ${del.rowCount} loser row`)

  await db.query('COMMIT')
  console.log('\nMerge complete.')
} catch (e) {
  await db.query('ROLLBACK')
  console.error(`Failed: ${e.message}`)
  process.exit(1)
}

await db.end()

#!/usr/bin/env node
// Restore a NarrateRx DB snapshot produced by api/cron/backup-db.js.
//
// Usage:
//   DATABASE_URL='postgres://.../narraterx_restore' \
//     node scripts/restore-db-from-blob.mjs <blob-url-or-local-path>
//
// SAFETY: Refuses to run unless DATABASE_URL contains 'restore' or '_test'.
// This is a hard guard against accidentally truncating production. To restore
// to prod, point at a fresh DB named e.g. narraterx_restore, verify, and
// promote via Supabase tooling — never aim this script at the live DB.
//
// Behaviour: TRUNCATE ... CASCADE every snapshot table, then bulk INSERT
// the saved rows in column-order. Schema must already exist (run the
// supabase/multitenant/migrations/ before this script).

import { gunzipSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
import pg from 'pg'

const { Pool } = pg

const src = process.argv[2]
if (!src) {
  console.error('Usage: node scripts/restore-db-from-blob.mjs <blob-url-or-local-path>')
  process.exit(2)
}

const dbUrl = process.env.DATABASE_URL
if (!dbUrl) {
  console.error('DATABASE_URL not set')
  process.exit(2)
}
if (!/restore|_test/i.test(dbUrl)) {
  console.error('Refusing to run: DATABASE_URL must contain "restore" or "_test" as a safety guard.')
  process.exit(2)
}

async function loadSnapshot(srcArg) {
  let buf
  if (/^https?:\/\//i.test(srcArg)) {
    const r = await fetch(srcArg)
    if (!r.ok) throw new Error(`Fetch ${srcArg} failed: ${r.status}`)
    buf = Buffer.from(await r.arrayBuffer())
  } else {
    buf = readFileSync(srcArg)
  }
  const json = gunzipSync(buf).toString('utf8')
  return JSON.parse(json)
}

const snapshot = await loadSnapshot(src)
const tableNames = Object.keys(snapshot.tables)
console.log(`Snapshot ${snapshot.meta?.timestamp_utc} — ${tableNames.length} tables, ${snapshot.meta?.row_count_total} rows`)

const pool = new Pool({ connectionString: dbUrl, max: 2 })
const client = await pool.connect()

try {
  await client.query('BEGIN')

  // TRUNCATE all in one statement so CASCADE handles FK ordering.
  const quotedAll = tableNames.map((n) => '"' + n.replace(/"/g, '""') + '"').join(', ')
  if (tableNames.length) {
    await client.query(`TRUNCATE ${quotedAll} RESTART IDENTITY CASCADE`)
  }

  for (const name of tableNames) {
    const { columns, rows } = snapshot.tables[name]
    if (!rows.length) {
      console.log(`  ${name}: 0 rows`)
      continue
    }
    const quoted = '"' + name.replace(/"/g, '""') + '"'
    const colList = columns.map((c) => '"' + c.replace(/"/g, '""') + '"').join(', ')

    // Batch inserts to keep parameter count under PG's 65k limit.
    const maxParamsPerStmt = 60000
    const rowsPerStmt = Math.max(1, Math.floor(maxParamsPerStmt / columns.length))
    for (let i = 0; i < rows.length; i += rowsPerStmt) {
      const chunk = rows.slice(i, i + rowsPerStmt)
      const params = []
      const valuesSql = chunk
        .map((row) => {
          const placeholders = columns.map((c) => {
            params.push(row[c] === undefined ? null : row[c])
            return '$' + params.length
          })
          return '(' + placeholders.join(', ') + ')'
        })
        .join(', ')
      await client.query(`INSERT INTO ${quoted} (${colList}) VALUES ${valuesSql}`, params)
    }
    console.log(`  ${name}: ${rows.length} rows`)
  }

  await client.query('COMMIT')
  console.log('Restore complete.')
} catch (e) {
  await client.query('ROLLBACK').catch(() => {})
  console.error('Restore failed:', e.message)
  process.exitCode = 1
} finally {
  client.release()
  await pool.end()
}

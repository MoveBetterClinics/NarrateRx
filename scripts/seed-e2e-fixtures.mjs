#!/usr/bin/env node
// Idempotently seed a known clinician in the e2e fixture workspace so the
// Playwright smoke can always find it. "Pick first available" was tempting
// but masks the regression we care about — if the clinicians list is empty
// because workspace scoping is broken, the test should fail loudly, not
// silently pass with whatever happened to be there.
//
// Required env:
//   MULTITENANT_DATABASE_URL — Postgres URL with write access to the shared DB
//
// Optional env:
//   E2E_WORKSPACE_SLUG       — defaults to 'movebetter-people'
//   E2E_FIXTURE_CLINICIAN_NAME — defaults to 'E2E Smoke Clinician'
//
// Reads .env.local first when MULTITENANT_DATABASE_URL is not already set so
// it works the same way locally as `npm run backup:db` does.

import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { Client } = require('pg')

async function resolveConnectionString() {
  if (process.env.MULTITENANT_DATABASE_URL) {
    return process.env.MULTITENANT_DATABASE_URL.trim().replace(/^"(.*)"$/, '$1')
  }
  try {
    const env = await readFile('.env.local', 'utf8')
    const match = env.match(/^MULTITENANT_DATABASE_URL=(.+)$/m)
    if (match) return match[1].trim().replace(/^"(.*)"$/, '$1')
  } catch {
    // .env.local not present — fall through to error below.
  }
  console.error('MULTITENANT_DATABASE_URL not set and not found in .env.local')
  process.exit(1)
}

const WORKSPACE_SLUG = process.env.E2E_WORKSPACE_SLUG || 'movebetter-people'
const CLINICIAN_NAME = process.env.E2E_FIXTURE_CLINICIAN_NAME || 'E2E Smoke Clinician'

const connectionString = await resolveConnectionString()
try {
  const u = new URL(connectionString)
  console.log(`[seed] connecting to host=${u.hostname} port=${u.port || '(default)'} db=${u.pathname.replace(/^\//, '')} user=${u.username} (password redacted, length=${u.password.length})`)
  if (u.searchParams.toString()) {
    console.log(`[seed] connection-string query params present: ${[...u.searchParams.keys()].join(', ')}`)
  }
} catch (e) {
  console.error('[seed] connection string is not a valid URL:', e.message)
  process.exit(1)
}
const client = new Client({ connectionString })
await client.connect()

try {
  const wsRes = await client.query(
    'select id, slug, status from workspaces where slug = $1 limit 1',
    [WORKSPACE_SLUG],
  )
  const workspace = wsRes.rows[0]
  if (!workspace) {
    console.error(`No workspace with slug "${WORKSPACE_SLUG}". Aborting.`)
    process.exit(1)
  }
  if (workspace.status !== 'active') {
    console.error(`Workspace "${WORKSPACE_SLUG}" is not active (status=${workspace.status}).`)
    process.exit(1)
  }

  // Upsert by (workspace_id, name). The clinicians table doesn't have a
  // unique constraint there so we look up first and only insert if absent.
  const existing = await client.query(
    'select id, name from clinicians where workspace_id = $1 and lower(name) = lower($2) limit 1',
    [workspace.id, CLINICIAN_NAME],
  )

  if (existing.rows[0]) {
    console.log(`✓ Fixture clinician already present: ${existing.rows[0].id} — ${existing.rows[0].name}`)
  } else {
    const inserted = await client.query(
      `insert into clinicians (workspace_id, name, created_by_id, created_by_email)
       values ($1, $2, 'e2e-seed', 'e2e@narraterx.test')
       returning id, name`,
      [workspace.id, CLINICIAN_NAME],
    )
    console.log(`✓ Seeded fixture clinician: ${inserted.rows[0].id} — ${inserted.rows[0].name}`)
  }
} finally {
  await client.end()
}

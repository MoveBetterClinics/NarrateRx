#!/usr/bin/env node
// Verifies the new shared multi-tenant Supabase project's schema.
// Reports the public-schema table list and the seeded workspace rows.

import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { Client } = require('pg')

const env = await readFile('.env.local', 'utf8')
const match = env.match(/^MULTITENANT_DATABASE_URL=(.+)$/m)
if (!match) {
  console.error('MULTITENANT_DATABASE_URL not found in .env.local')
  process.exit(1)
}
const connectionString = match[1].trim().replace(/^"(.*)"$/, '$1')

const client = new Client({ connectionString })
await client.connect()

const tables = await client.query(`
  select table_name
  from information_schema.tables
  where table_schema = 'public'
  order by table_name
`)
console.log('Tables:')
for (const r of tables.rows) console.log('  -', r.table_name)

const workspaces = await client.query(`
  select slug, display_name, status, created_at
  from workspaces
  order by slug
`)
console.log(`\nWorkspaces (${workspaces.rowCount}):`)
for (const r of workspaces.rows) {
  console.log(`  - ${r.slug.padEnd(20)} ${r.display_name.padEnd(40)} status=${r.status}`)
}

await client.end()

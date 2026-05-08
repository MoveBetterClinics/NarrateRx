#!/usr/bin/env node
// Applies SQL files to the new shared multi-tenant Supabase project.
//
// Usage:
//   node scripts/apply-multitenant-migrations.mjs file1.sql [file2.sql ...]
//
// Reads MULTITENANT_DATABASE_URL from .env.local. Each file is sent as one
// query to the server (multi-statement). Stops on the first failure.

import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { Client } = require('pg')

const args = process.argv.slice(2)
if (args.length === 0) {
  console.error('Usage: node scripts/apply-multitenant-migrations.mjs <file.sql> [...]')
  process.exit(1)
}

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

try {
  for (const file of args) {
    process.stdout.write(`Applying ${file}... `)
    const sql = await readFile(file, 'utf8')
    await client.query(sql)
    console.log('OK')
  }
} catch (err) {
  console.log('FAILED')
  console.error(err.message)
  process.exit(1)
} finally {
  await client.end()
}

console.log('Done.')

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

// pg-connection-string can't handle a literal @ in the password (Supabase
// pooler passwords contain one). Split on the LAST @ to find the host portion,
// then split the credentials from the scheme prefix.
function parseConnectionString(url) {
  const withoutScheme = url.replace(/^(?:postgresql|postgres):\/\//, '')
  const lastAt = withoutScheme.lastIndexOf('@')
  if (lastAt === -1) throw new Error(`Cannot parse connection string`)
  const credentials = withoutScheme.slice(0, lastAt)
  const hostPart = withoutScheme.slice(lastAt + 1)
  const colonIdx = credentials.indexOf(':')
  const user = credentials.slice(0, colonIdx)
  const password = credentials.slice(colonIdx + 1)
  const [hostPort, database] = hostPart.split('/')
  const [host, port] = hostPort.split(':')
  return { user, password, host, port: Number(port), database }
}

const config = parseConnectionString(connectionString)
const client = new Client(config)
await client.connect()
console.log(`Connected to ${config.host}:${config.port}`)

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

#!/usr/bin/env node
import pg from 'pg'
import { readFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { join } from 'path'

const repoRoot = join(fileURLToPath(import.meta.url), '..', '..')
const envPath = join(repoRoot, '.env.local')
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#')) continue
  const eq = t.indexOf('='); if (eq < 0) continue
  const k = t.slice(0, eq).trim(); const v = t.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '')
  if (!(k in process.env)) process.env[k] = v
}
const dbUrl = process.env.MULTITENANT_DATABASE_URL
const s = dbUrl.replace(/^postgres(ql)?:\/\//, ''); const la = s.lastIndexOf('@')
const auth = s.slice(0, la); const hp = s.slice(la + 1)
const c = auth.indexOf(':'); const u = auth.slice(0, c); const p = auth.slice(c + 1)
const [hostport, dbq = 'postgres'] = hp.split('/')
const [h, port = '5432'] = hostport.split(':')
const { Pool } = pg
const pool = new Pool({ host: h, port: +port, user: u, password: p, database: (dbq||'postgres').split('?')[0], ssl: { rejectUnauthorized: false } })

const { rows } = await pool.query(`
  SELECT id, blob_url, blob_pathname, filename, mime_type, size_bytes
  FROM media_assets
  WHERE blob_url IS NOT NULL
    AND lower(split_part(split_part(blob_url, '://', 2), '.', 1)) = 'gmrxcvv1cauu7ksf'
  ORDER BY created_at
`)
console.log(`${rows.length} rows remaining:\n`)
for (const r of rows) {
  console.log(`id=${r.id}`)
  console.log(`  filename: ${r.filename}`)
  console.log(`  pathname: ${r.blob_pathname}`)
  console.log(`  mime:     ${r.mime_type}`)
  console.log(`  size:     ${r.size_bytes ? Math.round(r.size_bytes/1024/1024)+'MB' : 'unknown'}`)
  console.log()
}
await pool.end()

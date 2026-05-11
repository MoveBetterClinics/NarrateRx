// Nightly cloud backup of the shared narraterx Supabase DB to Vercel Blob.
//
// Vercel cron hits this daily (see vercel.json). Auth = Bearer CRON_SECRET.
//
// Strategy: pg_dump is unavailable in Vercel Functions, so we read each
// public-schema BASE TABLE via `pg`, build a single JSON snapshot
// { meta, tables: { name: { columns, rows } } }, gzip it, and PUT it to
// Vercel Blob at backups/narraterx-db/YYYY-MM-DD-<random>.json.gz with
// access:'private'. Restore: `vercel blob list --prefix backups/narraterx-db/`
// then `vercel blob get <pathname>` to download, then
// scripts/restore-db-from-blob.mjs against the local file (JSON replay,
// not byte-identical SQL — fine because schema is reproducible from
// supabase/multitenant/migrations/).
//
// Retention: 30 days; older blobs in the same prefix are deleted on each run.
//
// Required env: MULTITENANT_DATABASE_URL, BLOB_READ_WRITE_TOKEN, CRON_SECRET.

import { gzipSync } from 'node:zlib'
import pg from 'pg'
import { put, list, del } from '@vercel/blob'

const { Pool } = pg

const RETENTION_DAYS = 30
const PREFIX = 'backups/narraterx-db/'

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = req.headers?.authorization || req.headers?.Authorization
    if (auth !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
  }

  const dbUrl = process.env.MULTITENANT_DATABASE_URL
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN
  if (!dbUrl) return res.status(503).json({ error: 'MULTITENANT_DATABASE_URL not configured' })
  if (!blobToken) return res.status(503).json({ error: 'BLOB_READ_WRITE_TOKEN not configured' })

  const pool = new Pool({ connectionString: dbUrl, max: 2 })

  try {
    // Discover public-schema tables.
    const tablesRes = await pool.query(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name`
    )
    const tableNames = tablesRes.rows.map((r) => r.table_name)

    const tables = {}
    let rowCountTotal = 0

    for (const name of tableNames) {
      const colsRes = await pool.query(
        `SELECT column_name
           FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1
          ORDER BY ordinal_position`,
        [name]
      )
      const columns = colsRes.rows.map((r) => r.column_name)

      // Quote identifier safely.
      const quoted = '"' + name.replace(/"/g, '""') + '"'
      const dataRes = await pool.query(`SELECT * FROM ${quoted}`)
      tables[name] = { columns, rows: dataRes.rows }
      rowCountTotal += dataRes.rows.length
    }

    const now = new Date()
    const isoDate = now.toISOString().slice(0, 10) // YYYY-MM-DD UTC

    let dbHost = null
    try {
      dbHost = new URL(dbUrl.replace(/^postgres(ql)?:\/\//, 'http://')).hostname
    } catch {
      dbHost = null
    }

    const snapshot = {
      meta: {
        timestamp_utc: now.toISOString(),
        db_host: dbHost,
        table_count: tableNames.length,
        row_count_total: rowCountTotal,
        schema_version: 'v1',
      },
      tables,
    }

    const json = JSON.stringify(snapshot)
    const gz = gzipSync(Buffer.from(json, 'utf8'))

    // Private + random suffix: dumps include workspace settings and encrypted
    // workspace_credentials. Private blocks anonymous URL access; the random
    // suffix prevents URL guessing even if the access mode is misconfigured.
    // Restore: `vercel blob list` (with --prefix) to find the blob, then
    // `vercel blob get <pathname>` to download locally, then run
    // scripts/restore-db-from-blob.mjs against the local file.
    const pathname = `${PREFIX}${isoDate}.json.gz`
    const uploaded = await put(pathname, gz, {
      access: 'private',
      contentType: 'application/gzip',
      addRandomSuffix: true,
      token: blobToken,
    })

    // Retention sweep.
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000
    let retainedCount = 0
    let deletedCount = 0
    let cursor
    do {
      const listing = await list({ prefix: PREFIX, cursor, token: blobToken })
      cursor = listing.cursor
      for (const blob of listing.blobs) {
        const uploadedAt = new Date(blob.uploadedAt).getTime()
        if (uploadedAt < cutoff) {
          await del(blob.url, { token: blobToken })
          deletedCount++
        } else {
          retainedCount++
        }
      }
    } while (cursor)

    return res.status(200).json({
      ok: true,
      blob_url: uploaded.url,
      size_bytes: gz.length,
      row_count_total: rowCountTotal,
      table_count: tableNames.length,
      retained_count: retainedCount,
      deleted_count: deletedCount,
    })
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) })
  } finally {
    await pool.end().catch(() => {})
  }
}

#!/usr/bin/env node
// Weekly backup of Vercel Blob media + Supabase media_assets metadata to B2.
//
// Per-brand: reads BRAND env var (people | equine | animals) and uses that to
// scope Supabase queries and choose the B2 destination prefix. Each brand has
// its own Vercel project + Supabase, so this script is invoked once per brand
// from .github/workflows/backup-media.yml's matrix.
//
// Logic:
//   1. Query Supabase for ALL media_assets rows for this brand (any status,
//      including archived — backups must protect against bad archive ops too).
//   2. Write the row dump to s3://$B2_BUCKET/$BRAND/manifest/<iso>.json so we
//      have a complete metadata snapshot independent of Supabase PITR.
//   3. For each row with a blob_url, check whether s3://$B2_BUCKET/$BRAND/<pathname>
//      already exists. If not, fetch the blob and PutObject it.
//
// Idempotent — safe to re-run. Only copies blobs that aren't already present.
//
// Required env vars:
//   BRAND                — 'people' | 'equine' | 'animals'
//   SUPABASE_URL         — for the brand's project
//   SUPABASE_SERVICE_KEY — service role key (read-only would suffice)
//   B2_KEY_ID            — Backblaze B2 application key id
//   B2_APP_KEY           — Backblaze B2 application key
//   B2_BUCKET            — bucket name
//   B2_ENDPOINT          — e.g. https://s3.us-west-002.backblazeb2.com
//   B2_REGION            — e.g. us-west-002

import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'

const { BRAND, SUPABASE_URL, SUPABASE_SERVICE_KEY, B2_KEY_ID, B2_APP_KEY, B2_BUCKET, B2_ENDPOINT, B2_REGION } = process.env

function required(name, value) {
  if (!value) {
    console.error(`Missing required env var: ${name}`)
    process.exit(1)
  }
}
required('BRAND', BRAND)
required('SUPABASE_URL', SUPABASE_URL)
required('SUPABASE_SERVICE_KEY', SUPABASE_SERVICE_KEY)
required('B2_KEY_ID', B2_KEY_ID)
required('B2_APP_KEY', B2_APP_KEY)
required('B2_BUCKET', B2_BUCKET)
required('B2_ENDPOINT', B2_ENDPOINT)
required('B2_REGION', B2_REGION)

const s3 = new S3Client({
  endpoint: B2_ENDPOINT,
  region:   B2_REGION,
  credentials: { accessKeyId: B2_KEY_ID, secretAccessKey: B2_APP_KEY },
  forcePathStyle: true,
})

const SELECT = [
  'id', 'brand', 'kind', 'status', 'source', 'blob_url', 'blob_pathname',
  'rendered_url', 'drive_id', 'filename', 'mime_type', 'size_bytes',
  'duration_s', 'aspect_ratio', 'width', 'height', 'thumbnail_url',
  'patient_pseudonym', 'condition', 'captured_at', 'tags', 'ai_tags',
  'transcription', 'notes', 'content_item_ids',
  'created_at', 'updated_at', 'created_by',
].join(',')

async function fetchAllRows() {
  const all = []
  const PAGE = 1000
  let from = 0
  while (true) {
    const url = `${SUPABASE_URL}/rest/v1/media_assets?select=${SELECT}&brand=eq.${BRAND}&order=created_at.asc&limit=${PAGE}&offset=${from}`
    const r = await fetch(url, {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    })
    if (!r.ok) throw new Error(`Supabase query failed: ${r.status} ${await r.text()}`)
    const page = await r.json()
    all.push(...page)
    if (page.length < PAGE) break
    from += PAGE
  }
  return all
}

async function objectExists(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: B2_BUCKET, Key: key }))
    return true
  } catch (e) {
    if (e?.$metadata?.httpStatusCode === 404 || e?.name === 'NotFound') return false
    throw e
  }
}

async function uploadObject(key, body, contentType) {
  await s3.send(new PutObjectCommand({
    Bucket: B2_BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType || 'application/octet-stream',
  }))
}

async function backupBlob(row) {
  if (!row.blob_url || !row.blob_pathname) return { skipped: 'no-blob' }
  // pathname looks like 'media/raw/<timestamp>-<name>.ext'
  const key = `${BRAND}/blobs/${row.blob_pathname}`

  if (await objectExists(key)) return { skipped: 'exists' }

  const r = await fetch(row.blob_url)
  if (!r.ok) return { error: `fetch ${r.status}`, key }

  const buf = Buffer.from(await r.arrayBuffer())
  await uploadObject(key, buf, row.mime_type)
  return { copied: true, key, size: buf.length }
}

async function backupRendered(row) {
  if (!row.rendered_url) return { skipped: 'no-rendered' }
  const filename = row.rendered_url.split('/').pop().split('?')[0]
  const key = `${BRAND}/rendered/${row.id}/${filename}`

  if (await objectExists(key)) return { skipped: 'exists' }

  const r = await fetch(row.rendered_url)
  if (!r.ok) return { error: `fetch ${r.status}`, key }

  const buf = Buffer.from(await r.arrayBuffer())
  await uploadObject(key, buf, 'video/mp4')
  return { copied: true, key, size: buf.length }
}

async function main() {
  const startedAt = new Date()
  console.log(`[backup-blob] brand=${BRAND} start=${startedAt.toISOString()}`)

  const rows = await fetchAllRows()
  console.log(`[backup-blob] fetched ${rows.length} media_assets rows`)

  // 1. Manifest dump for full-DR scenarios.
  const manifestKey = `${BRAND}/manifest/${startedAt.toISOString().replace(/[:.]/g, '-')}.json`
  await uploadObject(manifestKey, Buffer.from(JSON.stringify(rows, null, 2)), 'application/json')
  console.log(`[backup-blob] wrote manifest ${manifestKey}`)

  // 2. Per-row blob backups.
  let copied = 0, skipped = 0, errors = 0
  for (const row of rows) {
    try {
      const r1 = await backupBlob(row)
      if (r1.copied) copied++
      else if (r1.skipped) skipped++
      else if (r1.error) { errors++; console.error(`[backup-blob] ${row.id}: ${r1.error}`) }

      const r2 = await backupRendered(row)
      if (r2.copied) copied++
      else if (r2.skipped) skipped++
      else if (r2.error) { errors++; console.error(`[backup-blob] ${row.id} rendered: ${r2.error}`) }
    } catch (e) {
      errors++
      console.error(`[backup-blob] ${row.id} failed:`, e.message)
    }
  }

  const duration = ((Date.now() - startedAt.getTime()) / 1000).toFixed(1)
  console.log(`[backup-blob] done in ${duration}s — copied=${copied} skipped=${skipped} errors=${errors}`)

  if (errors > 0) process.exit(1)
}

main().catch((e) => {
  console.error('[backup-blob] fatal:', e)
  process.exit(1)
})

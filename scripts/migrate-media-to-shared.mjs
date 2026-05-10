#!/usr/bin/env node
// Migrate media_assets rows from a legacy per-brand Supabase to the shared
// multitenant Supabase, mapping the `brand TEXT` column to `workspace_id UUID`.
//
// One-shot script run at Phase 2 cutover, once per workspace.
//
// Vercel Blob URLs in `blob_url` / `thumbnail_url` are NOT moved — they
// continue pointing at the legacy Vercel project's blob store. They remain
// publicly readable from the shared deployment. Deletes from the new
// deployment will fail because BLOB_READ_WRITE_TOKEN scopes to one project;
// that's accepted tech debt for the cutover (clinicians start fresh content,
// historical media is read-only).
//
// content_item_ids is preserved as-is even though the referenced content_items
// rows are not migrated — the JSON array is informational, not a hard FK.
//
// Usage:
//   SOURCE_SUPABASE_URL=https://xxx.supabase.co \
//   SOURCE_SUPABASE_KEY=<service_role_key> \
//   TARGET_SUPABASE_URL=https://wrqfrjhevkbbheymzezy.supabase.co \
//   TARGET_SUPABASE_KEY=<service_role_key> \
//   WORKSPACE_SLUG=movebetter-people \
//   [DRY_RUN=true] \
//   node scripts/migrate-media-to-shared.mjs
//
// DRY_RUN=true reads the source and reports what *would* be inserted without
// writing to target.

const SRC_URL = process.env.SOURCE_SUPABASE_URL
const SRC_KEY = process.env.SOURCE_SUPABASE_KEY
const TGT_URL = process.env.TARGET_SUPABASE_URL
const TGT_KEY = process.env.TARGET_SUPABASE_KEY
const SLUG    = process.env.WORKSPACE_SLUG
const DRY_RUN = process.env.DRY_RUN === 'true'

const required = { SOURCE_SUPABASE_URL: SRC_URL, SOURCE_SUPABASE_KEY: SRC_KEY, TARGET_SUPABASE_URL: TGT_URL, TARGET_SUPABASE_KEY: TGT_KEY, WORKSPACE_SLUG: SLUG }
const missing = Object.entries(required).filter(([, v]) => !v).map(([k]) => k)
if (missing.length) {
  console.error(`Missing env: ${missing.join(', ')}`)
  process.exit(1)
}

async function sb(base, key, path, init = {}) {
  const r = await fetch(`${base}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
  if (!r.ok) {
    const text = await r.text()
    throw new Error(`${path} → ${r.status}: ${text}`)
  }
  return r.json()
}

async function fetchAll(base, key, table, select = '*') {
  const PAGE = 1000
  const all = []
  let offset = 0
  while (true) {
    const rows = await sb(base, key, `${table}?select=${select}&order=created_at.asc&limit=${PAGE}&offset=${offset}`)
    if (!rows.length) break
    all.push(...rows)
    offset += rows.length
    process.stdout.write(`  fetched ${all.length}…\r`)
    if (rows.length < PAGE) break
  }
  process.stdout.write('\n')
  return all
}

async function insertBatched(base, key, table, rows) {
  const BATCH = 100
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH)
    await sb(base, key, table, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(batch),
    })
    process.stdout.write(`  inserted ${Math.min(i + BATCH, rows.length)}/${rows.length}\r`)
  }
  process.stdout.write('\n')
}

async function main() {
  console.log(`Resolving workspace_id for slug='${SLUG}' in target…`)
  const wsRows = await sb(TGT_URL, TGT_KEY, `workspaces?slug=eq.${encodeURIComponent(SLUG)}&select=id,slug`)
  if (!wsRows[0]) {
    console.error(`No workspace with slug=${SLUG} in target DB`)
    process.exit(1)
  }
  const workspaceId = wsRows[0].id
  console.log(`workspace_id = ${workspaceId}`)

  console.log(`\nFetching media_assets from source…`)
  const sourceRows = await fetchAll(SRC_URL, SRC_KEY, 'media_assets')
  console.log(`Total: ${sourceRows.length}`)

  if (sourceRows.length === 0) {
    console.log('Nothing to migrate.')
    return
  }

  // Drop the legacy `brand` column, attach workspace_id. Preserve everything
  // else verbatim (id, blob_url, transcription, ai_tags, etc.) so existing
  // references stay valid.
  const transformed = sourceRows.map(({ brand, ...rest }) => ({
    ...rest,
    workspace_id: workspaceId,
  }))

  console.log(`\nSample row (first):`)
  console.log(JSON.stringify({
    id:           transformed[0].id,
    workspace_id: transformed[0].workspace_id,
    kind:         transformed[0].kind,
    status:       transformed[0].status,
    blob_url:     transformed[0].blob_url?.slice(0, 80) + '…',
    created_at:   transformed[0].created_at,
  }, null, 2))

  if (DRY_RUN) {
    console.log(`\nDRY_RUN — would insert ${transformed.length} rows. Aborting before write.`)
    return
  }

  console.log(`\nInserting into target media_assets…`)
  await insertBatched(TGT_URL, TGT_KEY, 'media_assets', transformed)

  console.log(`\nVerifying count in target…`)
  const verify = await sb(TGT_URL, TGT_KEY, `media_assets?workspace_id=eq.${workspaceId}&select=id`, {
    headers: { Prefer: 'count=exact' },
  })
  console.log(`Target now has ${verify.length} rows for workspace_id=${workspaceId}`)
  console.log(`✓ Done`)
}

main().catch((e) => {
  console.error('\nFAILED:', e.message)
  process.exit(1)
})

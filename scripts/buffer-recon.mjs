#!/usr/bin/env node
// buffer-recon.mjs — reconcile Buffer's recent sent posts against NarrateRx's
// content_items.buffer_update_id. Flags any Buffer send that NarrateRx didn't
// create (= came from another tool / manual scheduling / a stray key).
//
// Usage (from the NarrateRx project root):
//
//   set -a && source .env.local && set +a && \
//   BUFFER_TOKEN='<paste-personal-key>' \
//   node scripts/buffer-recon.mjs [--days 30]
//
// The Buffer Personal Key lives at https://publish.buffer.com/settings/api
// (label: "NarrateRx"). Don't commit it. Required env from .env.local:
// MULTITENANT_DATABASE_URL.
//
// Flags
//   --days N     window to scan (default 30)
//   --introspect dump Buffer's Posts/Channel schema and exit (use if the
//                listing query fails — Buffer occasionally renames fields)

import pg from 'pg'

const BUFFER_GQL = 'https://api.buffer.com/graphql'
const DB_URL = process.env.MULTITENANT_DATABASE_URL
const TOKEN = process.env.BUFFER_TOKEN

if (!DB_URL) { console.error('MULTITENANT_DATABASE_URL not set — source .env.local first'); process.exit(1) }
if (!TOKEN)  { console.error('BUFFER_TOKEN not set — paste the NarrateRx Personal Key from publish.buffer.com/settings/api'); process.exit(1) }

const argv = process.argv.slice(2)
const days = Number(argv[argv.indexOf('--days') + 1]) || 30
const introspect = argv.includes('--introspect')

async function gql(query, variables = {}) {
  const r = await fetch(BUFFER_GQL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ query, variables }),
  })
  const json = await r.json().catch(() => ({}))
  if (!r.ok || json.errors) {
    console.error(`[buffer] ${r.status}`, JSON.stringify(json.errors || json))
    return null
  }
  return json.data
}

if (introspect) {
  const d = await gql(`{
    posts: __type(name:"Post")          { fields { name type { name kind ofType { name } } } }
    channel: __type(name:"Channel")     { fields { name type { name kind ofType { name } } } }
    query: __type(name:"Query")         { fields { name args { name type { name kind ofType { name } } } } }
  }`)
  console.log(JSON.stringify(d, null, 2))
  process.exit(0)
}

// 1) Pull every channel for the org.
const acct = await gql('{ account { organizations { id } } }')
const orgId = acct?.account?.organizations?.[0]?.id
if (!orgId) { console.error('No org on this Buffer token'); process.exit(1) }

const ch = await gql(
  'query Channels($input: ChannelsInput!) { channels(input: $input) { id service name isDisconnected } }',
  { input: { organizationId: orgId } },
)
const channels = (ch?.channels || []).filter((c) => !c.isDisconnected)
console.log(`Buffer channels: ${channels.length}`)
for (const c of channels) console.log(`  ${c.id}  ${c.service.padEnd(16)}  ${c.name || ''}`)

// 2) For each channel, list sent posts in the last N days.
// Buffer's posts query: Query.posts(input: PostsInput!) — input filters by
// channelIds + status + after (ISO). If your token's schema rejects the
// field, run `--introspect` to find the current shape.
const since = new Date(Date.now() - days * 86400_000).toISOString()
const sent = []
for (const c of channels) {
  const d = await gql(`
    query Posts($input: PostsInput!) {
      posts(input: $input) {
        posts { id status sentAt dueAt text channel { id service } }
      }
    }
  `, { input: { channelIds: [c.id], status: ['sent'], after: since, first: 200 } })
  const list = d?.posts?.posts || []
  sent.push(...list)
}
console.log(`Buffer sent posts in last ${days}d: ${sent.length}`)

// 3) Pull NarrateRx's buffer_update_ids.
const client = new pg.Client({ connectionString: DB_URL })
await client.connect()
const r = await client.query(
  `SELECT buffer_update_id, platform, w.slug, ci.published_at, ci.scheduled_at
   FROM content_items ci LEFT JOIN workspaces w ON w.id = ci.workspace_id
   WHERE ci.buffer_update_id IS NOT NULL
     AND COALESCE(ci.published_at, ci.scheduled_at, ci.created_at) >= $1`,
  [since],
)
await client.end()
const known = new Map(r.rows.map((row) => [row.buffer_update_id, row]))
console.log(`NarrateRx content_items with buffer_update_id in window: ${known.size}`)

// 4) Diff.
const unknown = sent.filter((p) => !known.has(p.id))
const matched = sent.length - unknown.length
console.log('')
console.log(`Matched (NarrateRx-owned): ${matched}`)
console.log(`UNKNOWN (sent by something else): ${unknown.length}`)
console.log('')
if (unknown.length) {
  console.log('id                        sentAt                channel.service   text')
  console.log('-'.repeat(110))
  for (const p of unknown) {
    const t = (p.text || '').replace(/\s+/g, ' ').slice(0, 60)
    console.log(`${p.id}  ${p.sentAt || p.dueAt || '?'}  ${(p.channel?.service || '?').padEnd(15)}  ${t}`)
  }
}

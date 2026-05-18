#!/usr/bin/env node
/**
 * One-shot cleanup script staged by the 2026-05-17 / 2026-05-18 overnight
 * audit. Cleans two classes of bad state in content_items:
 *
 * 1. Phantom schedules — rows with scheduled_at < now() that never published
 *    (no buffer_update_id, no published_at). Clear scheduled_at on overdue
 *    rows so they stop showing the stale "Scheduled" badge. Future-dated
 *    phantoms are reported but left alone (the editor will re-pick a time
 *    via the schedule widget). Catches every non-published status, not just
 *    draft — `in_review` and `approved` rows can stack up the same way.
 *
 * 2. Markdown leakage in non-published social bodies — asterisks (`*italic*`,
 *    `**bold**`) and `---` HRs that render as literal characters on Buffer /
 *    Instagram / Facebook / LinkedIn / GBP. Long-form platforms (blog,
 *    youtube, landing_page) keep their markdown — only `link in bio/profile`
 *    placeholder copy gets normalized for them. Published rows are reported
 *    but never modified: the leaked content is already live on the platform
 *    and editing the DB doesn't reach back into Buffer.
 *
 * All regex matching happens in JS (Postgres POSIX regex doesn't support
 * lookbehind, which the old version of this script tried to use and crashed
 * with `quantifier operand invalid`).
 *
 * Usage from the project root or this worktree:
 *   set -a && source .env.local && set +a && node scripts/audit-2026-05-17-cleanup.mjs --dry-run
 *   set -a && source .env.local && set +a && node scripts/audit-2026-05-17-cleanup.mjs --apply
 */

import pg from 'pg'

const APPLY = process.argv.includes('--apply')
const DRY   = !APPLY

const url = process.env.MULTITENANT_DATABASE_URL
if (!url) {
  console.error('MULTITENANT_DATABASE_URL not set. Source .env.local first.')
  process.exit(1)
}

// pg connection-string parser that handles passwords with @ in them
// (default pg parser splits on the first @ which breaks).
const s = url.replace(/^postgres(ql)?:\/\//, '')
const la = s.lastIndexOf('@')
const auth = s.slice(0, la); const hp = s.slice(la + 1)
const cIdx = auth.indexOf(':')
const usr = auth.slice(0, cIdx); const pw = auth.slice(cIdx + 1)
const [hostport, dbq = 'postgres'] = hp.split('/')
const [h, port = '5432'] = hostport.split(':')
const { Client } = pg
const c = new Client({
  host: h, port: +port, user: usr, password: pw,
  database: (dbq || 'postgres').split('?')[0],
  ssl: { rejectUnauthorized: false },
})
await c.connect()

// ---------------------------------------------------------------------------
// Platform classification
// ---------------------------------------------------------------------------
const SOCIAL = new Set([
  'instagram', 'instagram_ads', 'instagram_reel',
  'facebook', 'linkedin', 'tiktok', 'gbp',
  'pinterest', 'twitter', 'threads', 'bluesky', 'mastodon',
])
const LONG_FORM = new Set(['blog', 'youtube', 'youtube_short', 'landing_page'])
const NON_PUBLISHED_STATUSES = ['draft', 'in_review', 'approved', 'scheduled']

// ---------------------------------------------------------------------------
// Step 1 — phantom schedules
// ---------------------------------------------------------------------------
const overdueQ = await c.query(
  `SELECT id, platform, status, scheduled_at, topic
     FROM content_items
     WHERE scheduled_at IS NOT NULL
       AND scheduled_at < now()
       AND status = ANY($1)
       AND buffer_update_id IS NULL
       AND published_at IS NULL
     ORDER BY scheduled_at`,
  [NON_PUBLISHED_STATUSES],
)
console.log(`\nPhantom schedule (OVERDUE) — ${overdueQ.rows.length} rows:`)
for (const r of overdueQ.rows) {
  console.log(`  ${r.platform.padEnd(15)} ${r.status.padEnd(10)} scheduled_at=${r.scheduled_at.toISOString().slice(0,16)}  "${r.topic || ''}"  id=${r.id.slice(0,8)}`)
}

const futureQ = await c.query(
  `SELECT id, platform, status, scheduled_at, topic
     FROM content_items
     WHERE scheduled_at IS NOT NULL
       AND scheduled_at >= now()
       AND status = ANY($1)
       AND buffer_update_id IS NULL
       AND published_at IS NULL
     ORDER BY scheduled_at`,
  [NON_PUBLISHED_STATUSES],
)
console.log(`\nPhantom schedule (FUTURE) — ${futureQ.rows.length} rows (left alone; editor will re-pick a time when ready):`)
for (const r of futureQ.rows) {
  console.log(`  ${r.platform.padEnd(15)} ${r.status.padEnd(10)} scheduled_at=${r.scheduled_at.toISOString().slice(0,16)}  "${r.topic || ''}"  id=${r.id.slice(0,8)}`)
}

// ---------------------------------------------------------------------------
// Step 2 — markdown leakage + link-in-bio placeholder
// ---------------------------------------------------------------------------
function detect(content, platform) {
  if (!content) return { flags: [] }
  const flags = []
  if (/\*\*[^*\n]+\*\*/.test(content)) flags.push('bold')
  if (/(^|[^*\\])\*(?!\*)[^*\n]+?(?<![\\*])\*(?!\*)/.test(content)) flags.push('italic')
  if (/^\s*-{3,}\s*$/m.test(content)) flags.push('hr')
  if (/link in bio/i.test(content))     flags.push('link-in-bio')
  if (/link in profile/i.test(content)) flags.push('link-in-profile')
  return { flags }
}

function rewrite(content, platform, websiteUrl) {
  let out = content
  if (SOCIAL.has(platform)) {
    out = out.replace(/\*\*\*([^*\n]+?)\*\*\*/g, '$1')           // ***bold-italic***
    out = out.replace(/\*\*([^*\n]+?)\*\*/g, '$1')               // **bold**
    out = out.replace(/(^|[^*\\])\*([^*\n]+?)\*(?!\*)/g, '$1$2') // *italic*
    out = out.replace(/^\s*-{3,}\s*$/gm, '')                     // HR lines
    out = out.replace(/\n{3,}/g, '\n\n')                         // collapse blank lines
  }
  if (websiteUrl) {
    const u = websiteUrl.replace(/\/$/, '')
    out = out.replace(/link in (bio|profile)/gi, u)
  }
  return out
}

const wsQ = await c.query(`SELECT id, website FROM workspaces`)
const wsWebsite = new Map(wsQ.rows.map(w => [w.id, w.website]))

const allQ = await c.query(
  `SELECT id, workspace_id, platform, status, content, topic
     FROM content_items
     WHERE status = ANY($1)
       AND content IS NOT NULL`,
  [NON_PUBLISHED_STATUSES],
)

const changes = []
for (const r of allQ.rows) {
  const { flags } = detect(r.content, r.platform)
  if (!flags.length) continue
  const after = rewrite(r.content, r.platform, wsWebsite.get(r.workspace_id))
  if (after !== r.content) changes.push({ row: r, flags, before: r.content, after })
}

console.log(`\nMarkdown leakage / link-placeholder in non-published rows — ${changes.length} rows:`)
for (const { row, flags, before, after } of changes) {
  console.log(`  ${row.platform.padEnd(15)} ${row.status.padEnd(10)} flags=${flags.join(',').padEnd(28)} "${row.topic || ''}"  ${before.length}→${after.length}ch  id=${row.id.slice(0,8)}`)
}

// Published — report only
const pubQ = await c.query(
  `SELECT id, platform, content, topic
     FROM content_items
     WHERE status = 'published'
       AND content IS NOT NULL`,
)
const pubLeaks = []
for (const r of pubQ.rows) {
  if (!SOCIAL.has(r.platform)) continue // long-form markdown is fine
  const { flags } = detect(r.content, r.platform)
  if (flags.length) pubLeaks.push({ row: r, flags })
}
console.log(`\nPublished rows with leakage (LEFT ALONE — already live on platform): ${pubLeaks.length}`)
for (const { row, flags } of pubLeaks) {
  console.log(`  ${row.platform.padEnd(15)} flags=${flags.join(',').padEnd(28)} "${row.topic || ''}"  id=${row.id.slice(0,8)}`)
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------
if (DRY) {
  console.log('\n[DRY-RUN — re-run with --apply to commit changes]')
  await c.end()
  process.exit(0)
}

console.log('\n→ Applying changes…')
const overdueIds = overdueQ.rows.map(r => r.id)
if (overdueIds.length) {
  await c.query(
    `UPDATE content_items
       SET scheduled_at = NULL,
           notes = COALESCE(notes, '') || E'\\n[2026-05-17 audit] Cleared overdue scheduled_at (never reached Buffer). Re-pick a time when ready.',
           updated_at = now()
       WHERE id = ANY($1::uuid[])`,
    [overdueIds],
  )
  console.log(`  ✓ Cleared scheduled_at on ${overdueIds.length} overdue rows`)
}
for (const { row, after } of changes) {
  await c.query(
    `UPDATE content_items
       SET content = $1,
           notes = COALESCE(notes, '') || E'\\n[2026-05-17 audit] Stripped markdown / normalized link-in-bio placeholder. Source prompt fixed in PR #634.',
           updated_at = now()
       WHERE id = $2`,
    [after, row.id],
  )
}
console.log(`  ✓ Cleaned ${changes.length} non-published bodies`)
await c.end()
console.log('\n[APPLIED]')

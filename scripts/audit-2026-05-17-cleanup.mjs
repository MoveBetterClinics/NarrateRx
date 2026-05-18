#!/usr/bin/env node
// One-shot cleanup script staged by the 2026-05-17 overnight audit.
//
// Cleans two classes of bad state in content_items:
//
// 1. Phantom schedules — rows with scheduled_at set on a Buffer-eligible
//    platform but no buffer_update_id AND no published_at. PR #628 (Now/
//    Schedule toggle) was silently reverted by PR #630, so users who used
//    the old "Schedule" flow stamped scheduled_at without ever hitting
//    Buffer. Six rows are affected; three are already overdue. The cleanup
//    is conservative: clear scheduled_at on the OVERDUE rows so they stop
//    showing the bogus "Scheduled" badge on the dashboard, and tag the
//    notes column so the reviewer knows it needs re-scheduling once the
//    restored toggle ships. Future-dated phantom schedules are left alone
//    so the reviewer can use the restored toggle to actually schedule them.
//
// 2. Markdown leakage in published / draft social bodies — asterisks and
//    horizontal rules that platforms render as literal characters. The
//    prompt fix (PR #634) stops new content from leaking; this pass cleans
//    five already-saved rows. Only DRAFT rows are auto-cleaned; published
//    rows are left alone (the leaked content is already live on Buffer /
//    Facebook / Instagram and editing the DB doesn't reach back into the
//    platform). Published items just get a note.
//
// Run from the project root:
//   set -a && source .env.local && set +a && node scripts/audit-2026-05-17-cleanup.mjs --dry-run
//   set -a && source .env.local && set +a && node scripts/audit-2026-05-17-cleanup.mjs --apply

import pg from 'pg'

const DRY = !process.argv.includes('--apply')
const url = process.env.MULTITENANT_DATABASE_URL
if (!url) {
  console.error('MULTITENANT_DATABASE_URL not set. Source .env.local first.')
  process.exit(1)
}
const c = new pg.Client({ connectionString: url })
await c.connect()

// 1. Phantom schedules — overdue
const overdueSql = `
  select id, platform, scheduled_at, topic
  from content_items
  where scheduled_at is not null
    and scheduled_at < now()
    and status = 'draft'
    and buffer_update_id is null
    and published_at is null
    and platform = any(array['instagram','facebook','linkedin','pinterest','tiktok','youtube_short','twitter','threads','bluesky','mastodon','gbp'])
`
const overdue = (await c.query(overdueSql)).rows
console.log(`\nPhantom schedule (OVERDUE) — ${overdue.length} rows:`)
for (const r of overdue) console.log(`  ${r.platform}  scheduled_at=${r.scheduled_at.toISOString()}  "${r.topic}"  id=${r.id}`)
if (!DRY && overdue.length) {
  const update = `
    update content_items set
      scheduled_at = null,
      notes = coalesce(notes, '') || E'\\n[2026-05-17 audit] Clearing overdue phantom scheduled_at (no buffer_update_id, never reached Buffer due to PR #628 regression). Re-pick a time when ready.'
    where id = any($1::uuid[])
  `
  await c.query(update, [overdue.map(r => r.id)])
  console.log(`  ✓ Cleared scheduled_at + stamped audit note on ${overdue.length} rows`)
}

// 2. Future phantom schedules — leave timestamp, just note
const futureSql = `
  select id, platform, scheduled_at, topic
  from content_items
  where scheduled_at is not null
    and scheduled_at >= now()
    and status = 'draft'
    and buffer_update_id is null
    and published_at is null
    and platform = any(array['instagram','facebook','linkedin','pinterest','tiktok','youtube_short','twitter','threads','bluesky','mastodon','gbp'])
`
const future = (await c.query(futureSql)).rows
console.log(`\nPhantom schedule (FUTURE) — ${future.length} rows (left alone; restored toggle will pick them up):`)
for (const r of future) console.log(`  ${r.platform}  scheduled_at=${r.scheduled_at.toISOString()}  "${r.topic}"  id=${r.id}`)

// 3. Markdown leakage cleanup on DRAFT social rows
const leakSql = `
  select id, platform, status, content, topic
  from content_items
  where status = 'draft'
    and platform = any(array['instagram','facebook','linkedin','tiktok','gbp','pinterest','twitter','threads'])
    and (
      content ~ '\\*\\*[^*]+\\*\\*' or
      content ~ '(?<!\\*)\\*[^*\\n]+\\*(?!\\*)' or
      content ~ E'^---+\\\\s*$'
    )
`
const leaks = (await c.query(leakSql)).rows
console.log(`\nMarkdown leakage in DRAFT social rows — ${leaks.length} rows:`)
for (const r of leaks) {
  console.log(`  ${r.platform}  status=${r.status}  "${r.topic}"  id=${r.id}`)
  const before = r.content
  let after = before
  after = after.replace(/\*\*([^*\n]+)\*\*/g, '$1')         // **bold** → bold
  after = after.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '$1') // *italic* → italic
  after = after.replace(/^---+\s*$/gm, '')                   // --- HR → blank
  after = after.replace(/\n\n\n+/g, '\n\n')                  // collapse triple newlines
  console.log(`    diff: ${before.length}→${after.length} chars`)
  if (!DRY) {
    await c.query(
      `update content_items set
         content = $1,
         notes = coalesce(notes, '') || E'\\n[2026-05-17 audit] Stripped markdown leakage (asterisks/HRs) from social body. Source prompt fixed in PR #634.'
       where id = $2`,
      [after, r.id],
    )
  }
}
if (!DRY && leaks.length) console.log(`  ✓ Cleaned ${leaks.length} rows`)

// 4. Published rows with leakage — note only
const pubLeakSql = `
  select id, platform, content, topic
  from content_items
  where status = 'published'
    and platform = any(array['instagram','facebook','linkedin','tiktok','gbp','pinterest','twitter','threads'])
    and (
      content ~ '\\*\\*[^*]+\\*\\*'
      or content ~ '(?<!\\*)\\*[^*\\n]+\\*(?!\\*)'
      or (platform = 'gbp' and content ~ 'link in profile')
    )
`
const pubLeaks = (await c.query(pubLeakSql)).rows
console.log(`\nPublished rows with content issues (LEFT ALONE — already live on platform):`)
for (const r of pubLeaks) console.log(`  ${r.platform}  "${r.topic}"  id=${r.id}`)

await c.end()
console.log(DRY ? '\n[DRY-RUN — re-run with --apply to commit changes]' : '\n[APPLIED]')

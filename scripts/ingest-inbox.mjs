#!/usr/bin/env node
// Ingest all files in _ingestion-inbox/ into the Author Mode corpus for
// the movebetter-people workspace (Q's clinician).
//
// Calls indexOriginalBlog / indexUploadedDraft directly (bypasses the HTTP
// API) so it works offline or before the API route is deployed.
//
// Usage:
//   node scripts/ingest-inbox.mjs [--dry-run] [--status] [--workspace=<slug>]
//
// --dry-run   Parse + print what would be ingested; no DB writes
// --status    Show current chunk counts for all indexed docs; no writes
// --workspace Override the default (movebetter-people)
//
// Required env (read from .env.local):
//   SUPABASE_URL, SUPABASE_SERVICE_KEY, OPENAI_API_KEY

import { readFile, readdir } from 'node:fs/promises'
import { join, extname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const ROOT = join(__dirname, '..')

// Load .env.local
const envText = await readFile(join(ROOT, '.env.local'), 'utf8').catch(() => '')
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
}

const args = process.argv.slice(2)
const DRY_RUN  = args.includes('--dry-run')
const STATUS   = args.includes('--status')
const wsSlug   = args.find((a) => a.startsWith('--workspace='))?.split('=')[1] ?? 'movebetter-people'

const need = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'OPENAI_API_KEY']
for (const k of need) {
  if (!process.env[k] || process.env[k].includes('REDACTED')) {
    console.error(`Missing or redacted env: ${k}`)
    process.exit(1)
  }
}

const { indexOriginalBlog, indexUploadedDraft } = await import('../api/_lib/practiceMemoryRag.js')

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json', ...init.headers,
    },
  })
}

// Resolve workspace + clinician
const wsRes = await sb(`workspaces?slug=eq.${encodeURIComponent(wsSlug)}&select=id,slug&limit=1`)
if (!wsRes.ok) { console.error(`workspaces fetch ${wsRes.status}`); process.exit(1) }
const [ws] = await wsRes.json()
if (!ws) { console.error(`No workspace matched: ${wsSlug}`); process.exit(1) }

// Q's clinician — resolve by user_id IS NOT NULL (Self-clinician)
const clRes = await sb(
  `clinicians?workspace_id=eq.${ws.id}&user_id=not.is.null&select=id,name&order=created_at.asc&limit=1`
)
if (!clRes.ok) { console.error(`clinicians fetch ${clRes.status}`); process.exit(1) }
const [cl] = await clRes.json()
if (!cl) { console.error(`No Self-clinician in workspace ${wsSlug}`); process.exit(1) }

console.log(`Workspace : ${ws.slug} (${ws.id})`)
console.log(`Clinician : ${cl.name} (${cl.id})\n`)

// ── Status mode ────────────────────────────────────────────────────────────
if (STATUS) {
  const docsRes = await sb(
    `clinician_corpus_documents?workspace_id=eq.${ws.id}&clinician_id=eq.${cl.id}` +
    `&archived_at=is.null&select=id,doc_type,title,updated_at&order=updated_at.desc`
  )
  const docs = docsRes.ok ? await docsRes.json() : []
  if (docs.length === 0) { console.log('No documents indexed yet.'); process.exit(0) }

  for (const doc of docs) {
    const cRes = await sb(
      `practice_memory_chunks?source_id=eq.${doc.id}&source_type=eq.${doc.doc_type}&select=id`
    )
    const chunks = cRes.ok ? (await cRes.json()).length : '?'
    const date = new Date(doc.updated_at).toISOString().slice(0, 10)
    console.log(`[${chunks} chunks] ${doc.doc_type.padEnd(16)} "${doc.title}" (${date})`)
  }
  process.exit(0)
}

// ── Parse frontmatter ──────────────────────────────────────────────────────
function parseFrontmatter(content, filename) {
  const fm = { docType: 'uploaded_draft', title: basename(filename, extname(filename)), sourceUrl: null, docDate: null }
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!match) return { fm, body: content.trim() }

  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w+):\s*"?([^"]*)"?\s*$/)
    if (!kv) continue
    const [, k, v] = kv
    if (k === 'title') fm.title = v
    if (k === 'docType' && ['original_blog', 'uploaded_draft'].includes(v)) fm.docType = v
    if (k === 'sourceUrl') fm.sourceUrl = v
    if (k === 'docDate') fm.docDate = v
  }
  return { fm, body: content.slice(match[0].length).trim() }
}

// ── Scan inbox ─────────────────────────────────────────────────────────────
const inboxDir = join(ROOT, '_ingestion-inbox')
let files
try {
  files = (await readdir(inboxDir)).filter((f) => /\.(md|txt)$/.test(f) && f !== 'README.md')
} catch {
  console.error(`_ingestion-inbox/ not found at ${inboxDir}`)
  process.exit(1)
}

if (files.length === 0) {
  console.log('Inbox is empty. Drop .md or .txt files into _ingestion-inbox/ and re-run.')
  process.exit(0)
}

console.log(`Files found: ${files.length}`)
if (DRY_RUN) console.log('(dry-run — no DB writes)\n')

let indexed = 0, skipped = 0
for (const filename of files) {
  const filePath = join(inboxDir, filename)
  const raw = await readFile(filePath, 'utf8')
  const { fm, body } = parseFrontmatter(raw, filename)

  if (body.length < 100) {
    console.log(`  SKIP  "${fm.title}" — body too short (${body.length} chars)`)
    skipped++
    continue
  }

  console.log(`  ${DRY_RUN ? 'WOULD INDEX' : 'INDEXING'}  [${fm.docType}] "${fm.title}" — ${body.length} chars`)

  if (DRY_RUN) { indexed++; continue }

  if (fm.docType === 'original_blog') {
    // Upsert into clinician_corpus_documents first
    const upsertRes = await upsertDoc({ workspaceId: ws.id, clinicianId: cl.id, fm, body })
    if (!upsertRes) { skipped++; continue }
    await indexOriginalBlog({
      workspaceId: ws.id, clinicianId: cl.id,
      blogId: upsertRes.id, title: fm.title, body, publishedAt: fm.docDate,
    })
    indexed++
  } else {
    const upsertRes = await upsertDoc({ workspaceId: ws.id, clinicianId: cl.id, fm, body })
    if (!upsertRes) { skipped++; continue }
    await indexUploadedDraft({
      workspaceId: ws.id, clinicianId: cl.id,
      docId: upsertRes.id, title: fm.title, body, uploadedAt: fm.docDate,
    })
    indexed++
  }
}

console.log(`\nDone. indexed=${indexed} skipped=${skipped}${DRY_RUN ? ' (dry-run)' : ''}`)

async function upsertDoc({ workspaceId, clinicianId, fm, body }) {
  // Check for existing by title
  const existRes = await sb(
    `clinician_corpus_documents?workspace_id=eq.${workspaceId}` +
    `&clinician_id=eq.${clinicianId}` +
    `&title=eq.${encodeURIComponent(fm.title)}&select=id&limit=1`
  )
  const [existing] = existRes.ok ? await existRes.json() : []

  if (existing) {
    const r = await sb(`clinician_corpus_documents?id=eq.${existing.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ body, source_url: fm.sourceUrl, doc_date: fm.docDate }),
    })
    if (!r.ok) { console.error(`  PATCH failed ${r.status}`); return null }
    return (await r.json())[0]
  }

  const r = await sb('clinician_corpus_documents', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      workspace_id: workspaceId, clinician_id: clinicianId,
      doc_type: fm.docType, title: fm.title, body,
      source_url: fm.sourceUrl, doc_date: fm.docDate,
    }),
  })
  if (!r.ok) { console.error(`  INSERT failed ${r.status}`); return null }
  return (await r.json())[0]
}

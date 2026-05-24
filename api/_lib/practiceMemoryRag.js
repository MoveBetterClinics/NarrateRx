// Phase 5 Feature 2 PR3 — practice-memory RAG indexer.
//
// Chunks + embeds + upserts source rows into practice_memory_chunks. Wraps
// the OpenAI embeddings call (api/_lib/embeddings.js) and Supabase REST.
//
// Sources indexed (PR2):
//   - interview_summary  — one chunk per interviews.summary_text
//   - content_item       — paragraph-level chunks of approved/published bodies
//
// Voice phrases (3rd CHECK-allowed source) are deliberately not indexed:
// the hot tier already always-injects the top-weighted phrases, so RAG of
// them would be duplicative. The schema accepts them so we can revisit if
// long-tail phrase retrieval ever earns its keep.
//
// All exports are fire-and-forget — they never throw. Errors log to
// `[practiceMemoryRag] …` so they surface in `vercel logs`.

import { embedTexts } from './embeddings.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// Chunking targets — tuned for blog-post-shaped content. text-embedding-3
// handles up to 8192 tokens per input, but smaller chunks give sharper
// retrieval. Char ≈ token/4 heuristic for English.
const CHUNK_TARGET_CHARS = 1600   // ~400 tokens
const CHUNK_MAX_CHARS    = 2400   // ~600 tokens
const CHUNK_MIN_CHARS    = 400    // ~100 tokens — anything smaller gets merged

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey:        SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}

function approxTokens(text) {
  return Math.ceil(String(text || '').length / 4)
}

// Split a content body into chunks of CHUNK_TARGET_CHARS, never exceeding
// CHUNK_MAX_CHARS. Splits on paragraph boundaries first, then merges short
// paragraphs together so single-line "..." or sub-headings don't become
// their own chunk.
export function chunkContent(text) {
  const body = String(text || '').trim()
  if (!body) return []
  if (body.length <= CHUNK_MAX_CHARS) return [body]

  const paragraphs = body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
  const out = []
  let cur = ''
  for (const p of paragraphs) {
    if (!cur) {
      cur = p
      continue
    }
    // If adding this paragraph stays under target, merge.
    if (cur.length + 2 + p.length <= CHUNK_TARGET_CHARS) {
      cur = `${cur}\n\n${p}`
      continue
    }
    // If current chunk is already at least min-size, ship it and start fresh.
    if (cur.length >= CHUNK_MIN_CHARS) {
      out.push(cur)
      cur = p
      continue
    }
    // Current too small — force-merge even if it overshoots target, but cap
    // at max. If the merge would exceed max, split the new paragraph instead.
    if (cur.length + 2 + p.length <= CHUNK_MAX_CHARS) {
      cur = `${cur}\n\n${p}`
    } else {
      out.push(`${cur}\n\n${p.slice(0, CHUNK_MAX_CHARS - cur.length - 2)}`)
      cur = p.slice(CHUNK_MAX_CHARS - cur.length - 2)
    }
  }
  if (cur) out.push(cur)
  return out
}

async function upsertChunks(rows) {
  if (rows.length === 0) return { count: 0 }
  // pgvector expects '[v1,v2,...]' string form over PostgREST.
  const payload = rows.map((r) => ({
    workspace_id:  r.workspaceId,
    clinician_id:  r.clinicianId ?? null,
    source_type:   r.sourceType,
    source_id:     r.sourceId,
    chunk_index:   r.chunkIndex,
    source_label:  r.sourceLabel ?? null,
    text:          r.text,
    tokens:        r.tokens,
    embedding:     `[${r.embedding.join(',')}]`,
  }))
  const r = await sb('practice_memory_chunks?on_conflict=source_type,source_id,chunk_index', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(payload),
  })
  if (!r.ok) {
    const body = await r.text().catch(() => '')
    throw new Error(`upsert ${r.status}: ${body.slice(0, 300)}`)
  }
  return { count: rows.length }
}

async function deleteExtraChunks(sourceType, sourceId, keepCount) {
  // When a re-index produces fewer chunks than a prior pass left behind,
  // wipe the orphans so retrieval doesn't return stale text.
  const r = await sb(
    `practice_memory_chunks?source_type=eq.${sourceType}&source_id=eq.${sourceId}&chunk_index=gte.${keepCount}`,
    { method: 'DELETE' }
  )
  if (!r.ok) {
    const body = await r.text().catch(() => '')
    console.error(`[practiceMemoryRag] orphan cleanup ${r.status}: ${body.slice(0, 200)}`)
  }
}

/**
 * Index a single interview summary. One chunk per row.
 * No-op if summaryText is empty.
 */
export async function indexInterviewSummary({ workspaceId, clinicianId, interviewId, summaryText, topic, createdAt }) {
  try {
    if (!workspaceId || !interviewId) return
    const text = String(summaryText || '').trim()
    if (!text) return

    const dateLabel = createdAt ? new Date(createdAt).toISOString().slice(0, 10) : ''
    const sourceLabel = topic
      ? `Interview on "${topic}"${dateLabel ? ` (${dateLabel})` : ''}`
      : `Interview${dateLabel ? ` (${dateLabel})` : ''}`

    const [embedding] = await embedTexts([text])
    if (!embedding) return

    await upsertChunks([{
      workspaceId,
      clinicianId,
      sourceType:  'interview_summary',
      sourceId:    interviewId,
      chunkIndex:  0,
      sourceLabel,
      text,
      tokens:      approxTokens(text),
      embedding,
    }])
    // Summary is always exactly 1 chunk — wipe any stale chunks from a
    // prior shape (defensive; never expected to fire).
    await deleteExtraChunks('interview_summary', interviewId, 1)
  } catch (e) {
    console.error(`[practiceMemoryRag] indexInterviewSummary interview=${interviewId} threw: ${e?.message}`)
  }
}

/**
 * Index a content_item by id. Fetches the row, paragraph-chunks the body,
 * embeds, upserts. Skips drafts/in_review — only approved/published rows
 * earn a place in retrieval since hot-tier also gates on that status.
 */
export async function indexContentItem({ workspaceId, contentItemId }) {
  try {
    if (!workspaceId || !contentItemId) return

    const r = await sb(
      `content_items?id=eq.${contentItemId}&workspace_id=eq.${workspaceId}` +
      '&select=id,clinician_id,topic,platform,content,status,created_at'
    )
    if (!r.ok) {
      console.error(`[practiceMemoryRag] content fetch ${r.status} item=${contentItemId}`)
      return
    }
    const [row] = await r.json()
    if (!row) return
    if (!['approved', 'published'].includes(row.status)) return
    const body = String(row.content || '').trim()
    if (!body) return

    const chunks = chunkContent(body)
    if (chunks.length === 0) return

    const embeddings = await embedTexts(chunks)
    const dateLabel = row.created_at ? new Date(row.created_at).toISOString().slice(0, 10) : ''
    const platform = row.platform ? row.platform.replace(/_/g, ' ') : 'piece'
    const baseLabel = row.topic
      ? `${cap(platform)}: "${row.topic}"${dateLabel ? ` (${dateLabel})` : ''}`
      : `${cap(platform)}${dateLabel ? ` (${dateLabel})` : ''}`

    const rows = chunks.map((text, i) => {
      const embedding = embeddings[i]
      if (!embedding) return null
      return {
        workspaceId,
        clinicianId:  row.clinician_id ?? null,
        sourceType:   'content_item',
        sourceId:     row.id,
        chunkIndex:   i,
        sourceLabel:  chunks.length > 1
          ? `${baseLabel} — section ${i + 1}/${chunks.length}`
          : baseLabel,
        text,
        tokens:       approxTokens(text),
        embedding,
      }
    }).filter(Boolean)

    await upsertChunks(rows)
    await deleteExtraChunks('content_item', row.id, rows.length)
  } catch (e) {
    console.error(`[practiceMemoryRag] indexContentItem item=${contentItemId} threw: ${e?.message}`)
  }
}

function cap(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

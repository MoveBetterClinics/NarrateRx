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

/**
 * Vector-search the practice-memory corpus for snippets related to a query.
 * Calls the match_practice_memory_chunks RPC (migration 074) so cosine
 * ranking happens server-side.
 *
 * @param {object} args
 * @param {string} args.workspaceId
 * @param {string=} args.clinicianId      — scope to this clinician's chunks
 * @param {string} args.query             — natural-language text (transcript excerpt, topic, etc.)
 * @param {number=} args.topK             — default 6
 * @param {string[]=} args.excludeSourceIds — skip these source IDs (e.g., hot-tier items, current interview)
 * @returns {Promise<Array<{source_type, source_id, source_label, text, similarity}>>}
 */
export async function searchPracticeMemory({ workspaceId, clinicianId, query, topK = 6, excludeSourceIds = [], sourceTypes = null }) {
  try {
    if (!workspaceId) return []
    const q = String(query || '').trim()
    if (!q) return []

    const [embedding] = await embedTexts([q])
    if (!embedding) return []

    const r = await sb('rpc/match_practice_memory_chunks', {
      method: 'POST',
      body: JSON.stringify({
        p_workspace_id:       workspaceId,
        p_clinician_id:       clinicianId ?? null,
        p_query_embedding:    `[${embedding.join(',')}]`,
        p_match_count:        topK,
        p_exclude_source_ids: excludeSourceIds,
        p_source_types:       sourceTypes,
      }),
    })
    if (!r.ok) {
      const body = await r.text().catch(() => '')
      console.error(`[practiceMemoryRag] search ${r.status}: ${body.slice(0, 300)}`)
      return []
    }
    return await r.json()
  } catch (e) {
    console.error(`[practiceMemoryRag] searchPracticeMemory threw: ${e?.message}`)
    return []
  }
}

// ---------------------------------------------------------------------------
// Author Mode — raw-substrate indexers + retrieval.
//
// These index source types added by migration 078:
//   - interview_transcript_full  — paragraph-chunks of the clinician's raw
//                                  spoken/typed interview turns (not the
//                                  AI summary)
//   - original_blog              — blog posts the clinician typed themselves
//                                  pre-NarrateRx
//   - uploaded_draft             — arbitrary draft documents (notes, longhand
//                                  drafts, transcribed voice memos)
//
// Critical principle: Author Mode retrieval (searchAuthorCorpus) filters to
// JUST these three types, never AI-generated text. The clinician composes
// their book by pulling from their own raw words; the model never substitutes.
// ---------------------------------------------------------------------------

/**
 * Source types that constitute the "raw substrate" — the clinician's own
 * spoken or typed words, never AI-generated. Author Mode reads only these.
 */
export const AUTHOR_MODE_SOURCE_TYPES = [
  'interview_transcript_full',
  'original_blog',
  'uploaded_draft',
]

/**
 * Build a single body string from a messages array where assistant turns
 * become bracketed context markers and user turns are the actual content.
 * For single-user (text-import) interviews, just returns the user content.
 */
function buildTranscriptBody(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return ''
  const parts = []
  let lastAsk = null
  for (const m of messages) {
    if (!m || typeof m.content !== 'string') continue
    const content = m.content.trim()
    if (!content) continue
    if (m.role === 'assistant') {
      // Hold onto the most recent assistant prompt so we can pair it with
      // the next user turn. If two assistant turns fire in a row, the last
      // one wins (rare; matches user-visible flow).
      lastAsk = content
      continue
    }
    if (m.role === 'user') {
      if (lastAsk) {
        // First sentence of the prompt, max 140 chars. Keeps the chunk's
        // visible "voice" overwhelmingly the clinician's own words.
        const askLine = lastAsk.split(/(?<=[.?!])\s/)[0].slice(0, 140).trim()
        parts.push(`[Asked: ${askLine}${askLine.length === 140 ? '…' : ''}]\n\n${content}`)
        lastAsk = null
      } else {
        parts.push(content)
      }
    }
  }
  return parts.join('\n\n')
}

/**
 * Index the raw transcript of an interview as paragraph-chunks of the
 * clinician's own words. Author Mode's primary substrate.
 *
 * Prefers cleanedMessages (filler removed, voice preserved) and falls back
 * to messages. Assistant prompts become inline "[Asked: ...]" markers so
 * retrieved chunks land with their question for context.
 */
export async function indexInterviewTranscriptFull({
  workspaceId,
  clinicianId,
  interviewId,
  messages,
  cleanedMessages,
  topic,
  createdAt,
}) {
  try {
    if (!workspaceId || !interviewId) return
    const turns = (Array.isArray(cleanedMessages) && cleanedMessages.length)
      ? cleanedMessages
      : (Array.isArray(messages) ? messages : [])
    const body = buildTranscriptBody(turns)
    if (!body) return

    const chunks = chunkContent(body)
    if (chunks.length === 0) return

    const embeddings = await embedTexts(chunks)
    const dateLabel = createdAt ? new Date(createdAt).toISOString().slice(0, 10) : ''
    const baseLabel = topic
      ? `Interview transcript: "${topic}"${dateLabel ? ` (${dateLabel})` : ''}`
      : `Interview transcript${dateLabel ? ` (${dateLabel})` : ''}`

    const rows = chunks.map((text, i) => {
      const embedding = embeddings[i]
      if (!embedding) return null
      return {
        workspaceId,
        clinicianId:  clinicianId ?? null,
        sourceType:   'interview_transcript_full',
        sourceId:     interviewId,
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
    await deleteExtraChunks('interview_transcript_full', interviewId, rows.length)
  } catch (e) {
    console.error(`[practiceMemoryRag] indexInterviewTranscriptFull interview=${interviewId} threw: ${e?.message}`)
  }
}

/**
 * Shared body for original_blog and uploaded_draft indexers — same chunking
 * + embedding + upsert flow, parameterized on source type + labels.
 */
async function indexAuthoredProse({
  workspaceId,
  clinicianId,
  sourceId,
  sourceType,
  title,
  body,
  dateLabel,
  kindLabel,
}) {
  try {
    if (!workspaceId || !sourceId) return
    const text = String(body || '').trim()
    if (!text) return

    const chunks = chunkContent(text)
    if (chunks.length === 0) return

    const embeddings = await embedTexts(chunks)
    const datePart = dateLabel ? new Date(dateLabel).toISOString().slice(0, 10) : ''
    const titleLabel = String(title || '').trim() || 'Untitled'
    const baseLabel = `${kindLabel}: "${titleLabel}"${datePart ? ` (${datePart})` : ''}`

    const rows = chunks.map((t, i) => {
      const embedding = embeddings[i]
      if (!embedding) return null
      return {
        workspaceId,
        clinicianId:  clinicianId ?? null,
        sourceType,
        sourceId,
        chunkIndex:   i,
        sourceLabel:  chunks.length > 1
          ? `${baseLabel} — section ${i + 1}/${chunks.length}`
          : baseLabel,
        text:         t,
        tokens:       approxTokens(t),
        embedding,
      }
    }).filter(Boolean)

    await upsertChunks(rows)
    await deleteExtraChunks(sourceType, sourceId, rows.length)
  } catch (e) {
    console.error(`[practiceMemoryRag] indexAuthoredProse type=${sourceType} sourceId=${sourceId} threw: ${e?.message}`)
  }
}

/**
 * Index a piece of prose the clinician wrote themselves (pre-NarrateRx
 * blogs, articles, longhand). Caller supplies a UUID source_id and tracks
 * the source row in clinician_corpus_documents (migration 079, follow-up).
 */
export async function indexOriginalBlog({ workspaceId, clinicianId, blogId, title, body, publishedAt }) {
  return indexAuthoredProse({
    workspaceId,
    clinicianId,
    sourceId:   blogId,
    sourceType: 'original_blog',
    title,
    body,
    dateLabel:  publishedAt,
    kindLabel:  'Original blog',
  })
}

/**
 * Index a draft document the clinician uploaded (notes, voice memo
 * transcribed verbatim, longhand drafts).
 */
export async function indexUploadedDraft({ workspaceId, clinicianId, docId, title, body, uploadedAt }) {
  return indexAuthoredProse({
    workspaceId,
    clinicianId,
    sourceId:   docId,
    sourceType: 'uploaded_draft',
    title,
    body,
    dateLabel:  uploadedAt,
    kindLabel:  'Draft',
  })
}

/**
 * Author Mode retrieval — scoped to raw-substrate source types only.
 * Returns chunks the clinician spoke or wrote themselves, never AI-generated
 * text. Use this from the book-composing UI; never use it for Practice Mode.
 */
export function searchAuthorCorpus({ workspaceId, clinicianId, query, topK = 6, excludeSourceIds = [] }) {
  return searchPracticeMemory({
    workspaceId,
    clinicianId,
    query,
    topK,
    excludeSourceIds,
    sourceTypes: AUTHOR_MODE_SOURCE_TYPES,
  })
}

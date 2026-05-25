// POST /api/corpus/ingest
//
// Upsert a clinician corpus document (title + body) and index it into
// practice_memory_chunks so the Author Mode semantic sidebar can retrieve it.
//
// Body: { docType?: string, title: string, body: string }
//   docType defaults to 'uploaded_draft'.
//   Title uniqueness is enforced per (workspace, clinician, docType) so
//   re-saving the same draft is idempotent — the existing row is updated.
//
// Returns: { id, title, doc_type, updated_at }
export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../_lib/workspaceContext.js'
import { requireRole } from '../_lib/auth.js'
import { enforceLimit } from '../_lib/ratelimit.js'
import { chunkContent, searchPracticeMemory } from '../_lib/practiceMemoryRag.js'
import { embedTexts } from '../_lib/embeddings.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey:          SUPABASE_KEY,
      Authorization:   `Bearer ${SUPABASE_KEY}`,
      'Content-Type':  'application/json',
      Prefer:          'return=representation',
      ...init.headers,
    },
  })
}

const err = (res, msg, status = 400) => res.status(status).json({ error: msg })

async function dbErr(res, r, msg = 'Database error') {
  const body = await r.text().catch(() => '')
  console.error(`[corpus/ingest] ${msg} — supabase ${r.status}: ${body.slice(0, 300)}`)
  return res.status(500).json({ error: msg })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed')

  const ws = await workspaceContext(req)
  if (!ws) return err(res, 'Workspace not resolved', 400)

  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  if (!(await enforceLimit(req, res, 'generic'))) return

  const { docType = 'uploaded_draft', title, body } = req.body || {}
  if (!title || typeof title !== 'string' || !title.trim()) return err(res, 'Missing title')
  if (typeof body !== 'string') return err(res, 'Missing body')

  const ALLOWED_DOC_TYPES = new Set(['uploaded_draft', 'original_blog', 'interview_transcript_full'])
  if (!ALLOWED_DOC_TYPES.has(docType)) return err(res, 'Invalid docType')

  // Resolve clinician_id from the authenticated user.
  const clinicianRes = await sb(
    `clinicians?workspace_id=eq.${ws.id}&user_id=eq.${auth.userId}&select=id&limit=1`
  )
  if (!clinicianRes.ok) return dbErr(res, clinicianRes, 'Clinician lookup failed')
  const clinicianRows = await clinicianRes.json()
  if (!clinicianRows.length) return err(res, 'Clinician not found for this user', 404)
  const clinicianId = clinicianRows[0].id

  const titleTrimmed = title.trim()
  const bodyTrimmed  = body.trim()

  // Upsert the document row. The unique index on (workspace_id, clinician_id,
  // doc_type, title) WHERE archived_at IS NULL drives the on_conflict key.
  const upsertRes = await sb(
    'clinician_corpus_documents?on_conflict=workspace_id,clinician_id,doc_type,title',
    {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({
        workspace_id: ws.id,
        clinician_id: clinicianId,
        doc_type:     docType,
        title:        titleTrimmed,
        body:         bodyTrimmed,
      }),
    }
  )
  if (!upsertRes.ok) return dbErr(res, upsertRes, 'Upsert failed')
  const rows = await upsertRes.json()
  const doc  = rows[0]
  if (!doc) return err(res, 'Upsert returned no row', 500)

  // Index into practice_memory_chunks asynchronously — don't block the save
  // response on embedding latency.
  setImmediate(() => indexCorpusDoc({ doc, workspaceId: ws.id, clinicianId }).catch(() => {}))

  return res.status(200).json({ id: doc.id, title: doc.title, doc_type: doc.doc_type, updated_at: doc.updated_at })
}

// Fire-and-forget: chunk + embed + upsert into practice_memory_chunks so
// the RAG sidebar can retrieve text from this document.
async function indexCorpusDoc({ doc, workspaceId, clinicianId }) {
  try {
    if (!doc.body.trim()) return

    const chunks    = chunkContent(doc.body)
    if (!chunks.length) return
    const embeddings = await embedTexts(chunks)

    const dateLabel = doc.updated_at ? new Date(doc.updated_at).toISOString().slice(0, 10) : ''
    const baseLabel = doc.title
      ? `Draft: "${doc.title}"${dateLabel ? ` (${dateLabel})` : ''}`
      : `Draft${dateLabel ? ` (${dateLabel})` : ''}`

    const payload = chunks.map((text, i) => {
      const embedding = embeddings[i]
      if (!embedding) return null
      return {
        workspace_id: workspaceId,
        clinician_id: clinicianId,
        source_type:  'uploaded_draft',
        source_id:    doc.id,
        chunk_index:  i,
        source_label: chunks.length > 1
          ? `${baseLabel} — section ${i + 1}/${chunks.length}`
          : baseLabel,
        text,
        tokens:       Math.ceil(text.length / 4),
        embedding:    `[${embedding.join(',')}]`,
      }
    }).filter(Boolean)

    if (!payload.length) return

    const r = await fetch(`${SUPABASE_URL}/rest/v1/practice_memory_chunks?on_conflict=source_type,source_id,chunk_index`, {
      method:  'POST',
      headers: {
        apikey:          SUPABASE_KEY,
        Authorization:   `Bearer ${SUPABASE_KEY}`,
        'Content-Type':  'application/json',
        Prefer:          'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(payload),
    })
    if (!r.ok) {
      const body = await r.text().catch(() => '')
      console.error(`[corpus/ingest] chunk upsert ${r.status}: ${body.slice(0, 300)}`)
    }

    // Remove orphan chunks from a prior (shorter) version of this document.
    const delRes = await fetch(
      `${SUPABASE_URL}/rest/v1/practice_memory_chunks?source_type=eq.uploaded_draft&source_id=eq.${doc.id}&chunk_index=gte.${payload.length}`,
      {
        method:  'DELETE',
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
      }
    )
    if (!delRes.ok) {
      const body = await delRes.text().catch(() => '')
      console.error(`[corpus/ingest] orphan cleanup ${delRes.status}: ${body.slice(0, 200)}`)
    }
  } catch (e) {
    console.error(`[corpus/ingest] indexCorpusDoc threw: ${e?.message}`)
  }
}

// Re-export searchPracticeMemory under the name the feature spec expects.
export { searchPracticeMemory as searchAuthorCorpus }

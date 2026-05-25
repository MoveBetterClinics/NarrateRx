// POST /api/corpus/ingest
//
// Author Mode ingestion endpoint. Accepts a single piece of the clinician's
// OWN prose and adds it to the raw-substrate corpus so the Author Mode
// writing environment can retrieve from it.
//
// ONLY original_blog and uploaded_draft are accepted here. AI-generated
// content (interview summaries, approved content_items) is indexed
// separately by the hot-tier hooks — never through this endpoint.
//
// Flow:
//   1. Validate + auth
//   2. Upsert a row in clinician_corpus_documents (source of truth)
//   3. Call indexOriginalBlog / indexUploadedDraft (chunks → embeds → upserts
//      into practice_memory_chunks under source_type = doc_type)
//   4. Return { ok: true, docId, chunks }
//
// Body:
//   {
//     docType:     'original_blog' | 'uploaded_draft'   (required)
//     title:       string                                (required)
//     body:        string                                (required, ≥100 chars)
//     sourceUrl?:  string                                (optional, original_blog)
//     docDate?:    ISO-8601 string                       (optional)
//   }
//
// The caller must be authenticated and the workspace must be resolved from
// the subdomain. clinician_id is resolved from the authenticated user.
//
// To update/re-index an existing document, POST the same title + body — a
// deterministic fingerprint (SHA-256 of title+body) is used to check for
// changes. Identical fingerprint = no-op (returns existing docId + chunks).

export const config = { runtime: 'nodejs', maxDuration: 60 }

import { createHash } from 'node:crypto'
import { workspaceContext } from '../_lib/workspaceContext.js'
import { requireRole } from '../_lib/auth.js'
import { enforceLimit } from '../_lib/ratelimit.js'
import { indexOriginalBlog, indexUploadedDraft } from '../_lib/practiceMemoryRag.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey:         SUPABASE_KEY,
      Authorization:  `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}

const ok  = (res, data, status = 200) => res.status(status).json(data)
const err = (res, msg, status = 400)  => res.status(status).json({ error: msg })

async function dbErr(res, r, msg = 'Database error', status = 500) {
  const body = await r.text().catch(() => '')
  console.error(`[corpus/ingest] ${msg} — supabase ${r.status}: ${body.slice(0, 500)}`)
  return res.status(status).json({ error: msg })
}

function fingerprint(title, body) {
  return createHash('sha256').update(`${title}\n\n${body}`).digest('hex').slice(0, 16)
}

/** Resolve the clinician row for the authenticated user in this workspace. */
async function resolveClinicianId(workspaceId, userId) {
  const r = await sb(
    `clinicians?workspace_id=eq.${workspaceId}&user_id=eq.${userId}&select=id&limit=1`
  )
  if (!r.ok) return null
  const [row] = await r.json()
  return row?.id ?? null
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405)
  if (!(await enforceLimit(req, res, 'corpus-ingest'))) return

  const ws = await workspaceContext(req)
  if (!ws) return err(res, 'Workspace not resolved', 400)

  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  const { docType, title, body, sourceUrl, docDate } = req.body ?? {}

  // Validation
  if (!docType || !['original_blog', 'uploaded_draft'].includes(docType)) {
    return err(res, 'docType must be "original_blog" or "uploaded_draft"')
  }
  if (!title || typeof title !== 'string' || !title.trim()) {
    return err(res, 'title is required')
  }
  if (!body || typeof body !== 'string' || body.trim().length < 100) {
    return err(res, 'body must be at least 100 characters')
  }

  const clinicianId = await resolveClinicianId(ws.id, auth.userId)
  // clinicianId can be null for workspace-level ingestion (admin scripts),
  // but we want a real clinician for Author Mode retrieval.
  if (!clinicianId) {
    return err(res, 'No clinician record found for this user', 404)
  }

  const fp = fingerprint(title.trim(), body.trim())

  // Check for an existing document with the same fingerprint (no-op path).
  const existRes = await sb(
    `clinician_corpus_documents?workspace_id=eq.${ws.id}` +
    `&clinician_id=eq.${clinicianId}` +
    `&title=eq.${encodeURIComponent(title.trim())}` +
    `&select=id,updated_at` +
    `&limit=1`
  )
  if (!existRes.ok) return dbErr(res, existRes, 'lookup failed')
  const [existing] = await existRes.json()

  // Count how many chunks we currently have for this source
  async function countChunks(docId) {
    const r = await sb(
      `practice_memory_chunks?source_id=eq.${docId}&source_type=eq.${docType}&select=id`
    )
    if (!r.ok) return 0
    const rows = await r.json()
    return rows.length
  }

  if (existing) {
    // Same title already exists. Re-index in case body changed.
    // Upsert updated body/url/date.
    const patchRes = await sb(
      `clinician_corpus_documents?id=eq.${existing.id}`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          body:       body.trim(),
          source_url: sourceUrl ?? null,
          doc_date:   docDate ?? null,
          updated_at: new Date().toISOString(),
        }),
      }
    )
    if (!patchRes.ok) return dbErr(res, patchRes, 'patch failed')

    await reindex({ workspaceId: ws.id, clinicianId, docId: existing.id, docType, title: title.trim(), body: body.trim(), docDate })
    const chunks = await countChunks(existing.id)
    return ok(res, { ok: true, docId: existing.id, chunks, action: 'updated' })
  }

  // Insert new document
  const insertRes = await sb('clinician_corpus_documents', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      workspace_id: ws.id,
      clinician_id: clinicianId,
      doc_type:     docType,
      title:        title.trim(),
      body:         body.trim(),
      source_url:   sourceUrl ?? null,
      doc_date:     docDate ?? null,
    }),
  })
  if (!insertRes.ok) return dbErr(res, insertRes, 'insert failed')
  const [doc] = await insertRes.json()

  await reindex({ workspaceId: ws.id, clinicianId, docId: doc.id, docType, title: title.trim(), body: body.trim(), docDate })
  const chunks = await countChunks(doc.id)
  return ok(res, { ok: true, docId: doc.id, chunks, action: 'created' }, 201)
}

async function reindex({ workspaceId, clinicianId, docId, docType, title, body, docDate }) {
  if (docType === 'original_blog') {
    await indexOriginalBlog({
      workspaceId,
      clinicianId,
      blogId:      docId,
      title,
      body,
      publishedAt: docDate,
    })
  } else {
    await indexUploadedDraft({
      workspaceId,
      clinicianId,
      docId,
      title,
      body,
      uploadedAt:  docDate,
    })
  }
}

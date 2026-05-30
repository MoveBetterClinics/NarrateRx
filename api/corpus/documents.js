// GET /api/corpus/documents?docType=uploaded_draft
//
// List the authenticated clinician's corpus documents of a given type.
// Used by Author Mode to populate the drafts list sidebar.
//
// Query params:
//   docType — defaults to 'uploaded_draft'. Must be a valid doc_type value.
//
// Returns: Array<{ id, title, updated_at, body }>
//   Body is included so the editor can load the full draft on click.
//   Ordered by updated_at DESC (most recently edited first).
export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../_lib/workspaceContext.js'
import { requireRole } from '../_lib/auth.js'
import { enforceLimit } from '../_lib/ratelimit.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const err = (res, msg, status = 400) => res.status(status).json({ error: msg })

async function dbErr(res, r, msg = 'Database error') {
  const body = await r.text().catch(() => '')
  console.error(`[corpus/documents] ${msg} — supabase ${r.status}: ${body.slice(0, 300)}`)
  return res.status(500).json({ error: msg })
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).send('Method not allowed')

  const ws = await workspaceContext(req)
  if (!ws) return err(res, 'Workspace not resolved', 400)

  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  if (!(await enforceLimit(req, res, 'generic'))) return

  const { searchParams } = new URL(req.url, 'http://localhost')
  const docType = searchParams.get('docType') || 'uploaded_draft'

  const ALLOWED_DOC_TYPES = new Set(['uploaded_draft', 'original_blog', 'interview_transcript_full'])
  if (!ALLOWED_DOC_TYPES.has(docType)) return err(res, 'Invalid docType')

  // Resolve clinician row for the authenticated user.
  const staffRes = await fetch(
    `${SUPABASE_URL}/rest/v1/staff?workspace_id=eq.${ws.id}&user_id=eq.${auth.userId}&select=id&limit=1`,
    {
      headers: {
        apikey:        SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    }
  )
  if (!staffRes.ok) return dbErr(res, staffRes, 'Clinician lookup failed')
  const staffRows = await staffRes.json().catch(() => [])
  if (!staffRows.length) return res.status(200).json([])
  const staffId = staffRows[0].id

  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/staff_corpus_documents` +
    `?workspace_id=eq.${ws.id}` +
    `&staff_id=eq.${staffId}` +
    `&doc_type=eq.${encodeURIComponent(docType)}` +
    `&archived_at=is.null` +
    `&select=id,title,updated_at,body` +
    `&order=updated_at.desc`,
    {
      headers: {
        apikey:        SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
    }
  )
  if (!r.ok) return dbErr(res, r)
  const docs = await r.json()
  return res.status(200).json(docs)
}

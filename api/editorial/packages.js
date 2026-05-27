// GET /api/editorial/packages
//
// List story packages for the workspace. Supports status filtering and
// pagination. Used by Phase 3 Story Director UI.
//
// Query params:
//   status?: 'pending'|'generating'|'complete'|'failed'  — filter by status
//   limit?:  number (default 20, max 100)
//   offset?: number (default 0)
//   clinicianId?: string  — filter by clinician
//
// Auth: Clerk JWT + workspace org-id + video_pipeline_enabled.
//
// Response 200:
//   { packages: [...], total: number, limit, offset }

export const config = { runtime: 'nodejs' }

import { requireRole } from '../_lib/auth.js'
import { ALL_KNOWN_ROLES } from '../_lib/roles.js'
import { workspaceContext } from '../_lib/workspaceContext.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

async function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'count=exact',
      ...init.headers,
    },
  })
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  const ws = await workspaceContext(req)
  if (!ws) return res.status(404).json({ error: 'no_workspace' })
  if (!ws.video_pipeline_enabled) {
    return res.status(403).json({ error: 'feature_disabled' })
  }

  const auth = await requireRole(req, ALL_KNOWN_ROLES, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  const url = new URL(req.url, 'http://localhost')
  const status = url.searchParams.get('status')
  const clinicianId = url.searchParams.get('clinicianId')
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '20', 10), 1), 100)
  const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10), 0)

  const VALID_STATUSES = ['pending', 'generating', 'complete', 'failed']
  if (status && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'invalid_status' })
  }

  // Build query
  let query = `story_packages?workspace_id=eq.${ws.id}&order=created_at.desc&limit=${limit}&offset=${offset}`
  query += `&select=id,topic,caption_text,similarity,channels,renders,status,error_message,created_at,source_asset_id,clinician_id`
  if (status) query += `&status=eq.${status}`
  if (clinicianId) query += `&clinician_id=eq.${clinicianId}`

  const dbRes = await sb(query)
  if (!dbRes.ok) return res.status(500).json({ error: 'db_error' })

  const packages = await dbRes.json()
  const totalHeader = dbRes.headers.get('Content-Range')
  // Supabase Content-Range: 0-19/143
  const total = totalHeader ? parseInt(totalHeader.split('/')[1], 10) : undefined

  return res.status(200).json({
    packages,
    total,
    limit,
    offset,
  })
}

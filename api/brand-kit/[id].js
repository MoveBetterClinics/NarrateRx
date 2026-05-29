import { withSentry } from '../_lib/sentry.js'
export const config = { runtime: 'nodejs' }
import { del as blobDel } from '@vercel/blob'
import { requireRole } from '../_lib/auth.js'
import { EDITOR_ROLES } from '../_lib/roles.js'
import { workspaceScope } from '../_lib/workspaceScope.js'

// One brand asset by id.
//
//   PATCH  /api/brand-kit/<id>   body: { user_tags?, original_filename? }
//   DELETE /api/brand-kit/<id>
//
// PATCH is for human edits to the library row (rename, retag). Auto-classified
// fields (shape, background, color_mode, ai_classification) are deliberately
// NOT writable here — they're outputs of the upload-time classifier and a
// re-classification path will land later if needed.
//
// DELETE removes the blob *and* the row. Role assignments pointing at this
// asset are blocked by the FK (on delete restrict) — the client must clear
// the role first, which surfaces as a 409 with detail.

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const WRITE_ROLES = EDITOR_ROLES

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}

async function handler(req, res) {
  const id = req.query?.id
  if (!id) return res.status(400).json({ error: 'id required' })

  const scope = await workspaceScope(req)

  const auth = await requireRole(req, WRITE_ROLES, { orgId: scope.workspace.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  if (req.method === 'PATCH') {
    const body = req.body || {}
    const patch = {}
    if (body.user_tags != null) {
      if (!Array.isArray(body.user_tags) || body.user_tags.some((t) => typeof t !== 'string')) {
        return res.status(400).json({ error: 'user_tags must be an array of strings' })
      }
      patch.user_tags = body.user_tags
    }
    if (body.original_filename != null) {
      if (typeof body.original_filename !== 'string' || body.original_filename.length > 255) {
        return res.status(400).json({ error: 'original_filename must be a string ≤255 chars' })
      }
      patch.original_filename = body.original_filename
    }
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'no editable fields in body' })
    }
    const upRes = await sb(`brand_assets?id=eq.${encodeURIComponent(id)}&${scope.column}=eq.${scope.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(patch),
    })
    if (!upRes.ok) return res.status(500).json({ error: 'Database error' })
    const rows = await upRes.json()
    if (!rows[0]) return res.status(404).json({ error: 'Not found' })
    return res.status(200).json(rows[0])
  }

  if (req.method === 'DELETE') {
    // Load the row first so we know the blob_pathname AND can prove tenancy.
    // Two-step (read, delete) instead of a single DELETE returning the row
    // because we need the blob_pathname for the blob deletion regardless.
    const readRes = await sb(`brand_assets?id=eq.${encodeURIComponent(id)}&${scope.column}=eq.${scope.id}&select=id,blob_pathname&limit=1`)
    if (!readRes.ok) return res.status(500).json({ error: 'Database error (read)' })
    const rows = await readRes.json()
    if (!rows[0]) return res.status(404).json({ error: 'Not found' })

    const delRes = await sb(`brand_assets?id=eq.${encodeURIComponent(id)}&${scope.column}=eq.${scope.id}`, { method: 'DELETE' })
    if (!delRes.ok) {
      const text = await delRes.text()
      // FK violation: a brand_kit_roles row still points at this asset.
      // Surface a 409 so the UI can prompt "Clear the role first."
      if (text.includes('foreign key') || text.includes('23503')) {
        return res.status(409).json({ error: 'Asset is assigned to one or more roles — clear the role first.' })
      }
      return res.status(500).json({ error: 'Database error (delete)', detail: text })
    }

    // Blob deletion is best-effort: row is already gone, and a stale blob is
    // just storage cost, not a correctness problem. Surface the error in logs
    // for the cleanup job to pick up later.
    try {
      await blobDel(rows[0].blob_pathname)
    } catch (e) {
      console.error(`brand-kit delete: blob removal failed for ${rows[0].blob_pathname}:`, e?.message)
    }

    return res.status(200).json({ ok: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}

export default withSentry(handler)

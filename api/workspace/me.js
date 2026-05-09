// Returns the active workspace (full row) for the request. The middleware
// has already resolved subdomain → workspace and injected the id/slug as
// headers; this endpoint reads them and fetches the full row.
//
// Used by the frontend to bootstrap workspace data on page load. Phase 1
// settings UI uses the same row as initial state for the editor.
//
// 404 when no workspace context (apex / preview URL / legacy deployment).

import { workspaceContext } from '../_lib/workspaceContext.js'

export const config = { runtime: 'edge' }

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      // Don't cache at the edge — workspace data changes when settings are
      // saved, and Phase 1A doesn't yet wire tag-based invalidation.
      'Cache-Control': 'private, no-store',
    },
  })

export default async function handler(req) {
  const ctx = workspaceContext(req)
  if (!ctx) return json({ error: 'no-workspace-context' }, 404)

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return json({ error: 'server-misconfigured' }, 500)
  }

  const url = `${SUPABASE_URL}/rest/v1/workspaces?id=eq.${ctx.workspaceId}&select=*&limit=1`
  let r
  try {
    r = await fetch(url, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    })
  } catch (e) {
    return json({ error: 'lookup-failed', detail: e?.message }, 502)
  }
  if (!r.ok) return json({ error: 'lookup-failed', status: r.status }, 502)

  const rows = await r.json().catch(() => null)
  if (!Array.isArray(rows) || rows.length === 0) {
    return json({ error: 'not-found' }, 404)
  }

  return json(rows[0])
}

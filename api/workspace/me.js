// Returns the active workspace (full row) for the request. Resolved by
// reading the Host header → extracting subdomain slug → fetching the
// workspace row from the shared narraterx Supabase. See
// api/_lib/workspaceContext.js for why slug extraction lives there
// rather than in routing middleware.
//
// 404 when there's no resolvable workspace (apex, www, preview URL,
// unknown subdomain).

import { workspaceContext } from '../_lib/workspaceContext.js'

export const config = { runtime: 'edge' }

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      // Don't cache at the edge — workspace data changes when settings are
      // saved. Phase 1C will add tag-based invalidation via Runtime Cache.
      'Cache-Control': 'private, no-store',
    },
  })

export default async function handler(req) {
  const workspace = await workspaceContext(req)
  if (!workspace) return json({ error: 'no-workspace-context' }, 404)
  return json(workspace)
}

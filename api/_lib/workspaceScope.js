// Resolves the workspace scope for any inbound API request.
//
// Two deployment shapes share this codebase:
//
//   1. Shared multi-tenant deployment (narraterx.ai). One DB, three workspaces
//      (and growing) keyed by `workspace_id UUID FK`. Workspace is resolved
//      from the request's Host header via workspaceContext.
//
//   2. Legacy per-brand deployments (movebetter-people.vercel.app etc.). One
//      DB per brand, every domain table carries a `brand TEXT` column. Brand
//      comes from the BRAND / VITE_BRAND env var on the deployment.
//
// Endpoints that need to query domain tables call workspaceScope(req) and use
// the returned `{ column, id }` pair to build the filter or insert payload:
//
//   const { column, id } = await workspaceScope(req)
//   const qs = `media_assets?...&${column}=eq.${id}`
//   await sb('media_assets', { method: 'POST', body: JSON.stringify({ [column]: id, ... }) })
//
// Phase 2 cutover decommissions the legacy deployments and removes this
// fallback — at that point every endpoint uses workspace_id only.

import { workspaceContext } from './workspaceContext.js'

export async function workspaceScope(req) {
  const ws = await workspaceContext(req)
  if (ws) return { column: 'workspace_id', id: ws.id, workspace: ws }
  const slug = (process.env.BRAND || process.env.VITE_BRAND || 'people').toLowerCase()
  return { column: 'brand', id: slug, workspace: null }
}

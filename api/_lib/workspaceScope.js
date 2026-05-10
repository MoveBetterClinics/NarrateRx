// Resolves the workspace scope for any inbound API request.
//
// The shared multi-tenant deployment (narraterx.ai) keys every domain table
// by `workspace_id UUID FK`. The workspace is resolved from the request's
// Host header via workspaceContext.
//
// Endpoints that need to query domain tables call workspaceScope(req) and use
// the returned `{ column, id }` pair to build the filter or insert payload:
//
//   const { column, id } = await workspaceScope(req)
//   const qs = `media_assets?...&${column}=eq.${id}`
//   await sb('media_assets', { method: 'POST', body: JSON.stringify({ [column]: id, ... }) })
//
// `column` is always 'workspace_id' on the shared deployment. The pair shape
// is retained so call sites don't need rewriting; if the request's host can't
// be resolved to a workspace this throws — silently defaulting to a brand was
// only safe on the (now-decommissioned) per-brand deployments.

import { workspaceContext } from './workspaceContext.js'

export async function workspaceScope(req) {
  const ws = await workspaceContext(req)
  if (!ws) throw new Error('workspace scope unresolved: no workspace matches the request host')
  return { column: 'workspace_id', id: ws.id, workspace: ws }
}

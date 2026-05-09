// Read workspace context from middleware-injected request headers.
//
// Phase 1A: middleware.js resolves subdomain → workspace and attaches:
//   x-workspace-id    — UUID of the active workspace
//   x-workspace-slug  — slug (matches the subdomain)
//
// Returns { workspaceId, workspaceSlug } when middleware has resolved a
// workspace, or null when:
//   - Running on a legacy per-brand deployment (middleware no-ops there)
//   - Request hit an apex domain (no subdomain to extract)
//   - Preview URL with no subdomain pattern
//
// Callers in Phase 1+ assume non-null; legacy callers continue to use
// the env-var-based workspaceId() pattern (until Phase 2 cutover).

export function workspaceContext(req) {
  const headers = req?.headers
  if (!headers) return null

  const get = typeof headers.get === 'function'
    ? (k) => headers.get(k)
    : (k) => headers[k] ?? headers[k.toLowerCase()]

  const id   = get('x-workspace-id')
  const slug = get('x-workspace-slug')
  if (!id || !slug) return null
  return { workspaceId: String(id), workspaceSlug: String(slug) }
}

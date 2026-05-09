// Resolve the active workspace for an inbound request.
//
// Phase 1A took two passes at this. The first version had Vercel Routing
// Middleware perform the slug → workspace lookup and inject `x-workspace-id`
// / `x-workspace-slug` request headers via `next({ headers })`, with this
// helper just reading those headers. That didn't work — `next({ headers })`
// in this Vite/Edge setup doesn't propagate to /api functions; the endpoint
// only ever saw the standard Vercel headers, never the injected ones.
//
// The current pattern: this helper extracts the slug from the Host header
// directly and does its own Supabase REST lookup. Middleware still 404s
// unknown subdomains (so SPA routes also get the right UX), but the
// per-endpoint workspace data comes from here. Keeps middleware simple.
//
// Returns the full workspace row on success, or null when:
//   - No subdomain to extract a slug from (apex, www, preview URL)
//   - Slug doesn't match an active workspace
//   - Supabase lookup failed (logged; treat as no workspace)
//
// A Runtime Cache layer can wrap this in a later phase to avoid one DB
// hit per request.

const APEX_HOSTS = new Set(['narraterx.ai', 'www.narraterx.ai'])

function extractSlug(host) {
  if (!host) return null
  const h = host.split(':')[0].toLowerCase()
  if (APEX_HOSTS.has(h)) return null
  if (h.endsWith('.narraterx.ai')) {
    return h.slice(0, -'.narraterx.ai'.length)
  }
  return null
}

function readHostHeader(req) {
  const headers = req?.headers
  if (!headers) return null
  if (typeof headers.get === 'function') return headers.get('host')
  return headers.host || headers.Host || null
}

export async function workspaceContext(req) {
  const host = readHostHeader(req)
  const slug = extractSlug(host)
  if (!slug) return null

  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY
  if (!supabaseUrl || !supabaseKey) {
    console.error('[workspaceContext] Supabase env not configured')
    return null
  }

  const url = `${supabaseUrl}/rest/v1/workspaces?slug=eq.${encodeURIComponent(slug)}&select=*&limit=1`
  let r
  try {
    r = await fetch(url, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
    })
  } catch (e) {
    console.error('[workspaceContext] network error:', e?.message)
    return null
  }
  if (!r.ok) {
    console.error(`[workspaceContext] lookup failed: ${r.status}`)
    return null
  }
  const rows = await r.json().catch(() => null)
  if (!Array.isArray(rows) || rows.length === 0) return null
  const row = rows[0]
  if (row.status !== 'active') return null
  return row
}

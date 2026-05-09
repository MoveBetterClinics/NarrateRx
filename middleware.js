// Vercel Routing Middleware — runs before cache on every matched request.
//
// Phase 1A scope (revised after the next({headers}) propagation issue):
//   1. Apex / www → rewrite root path to /landing.html (static landing page)
//   2. Subdomain (`<slug>.narraterx.ai`) → 404 if the slug doesn't match an
//      active workspace; pass through otherwise
//   3. Everything else → pass through
//
// Per-endpoint workspace data is fetched by api/_lib/workspaceContext.js,
// which also extracts the slug. Middleware does NOT inject workspace
// headers — that pattern doesn't propagate through this Vite/Edge setup.
//
// Dual-run safe: when MULTITENANT_DATABASE_URL is unset (legacy per-brand
// Vercel projects: narraterx-people, narraterx-equine, narraterx-animals),
// the middleware no-ops and every request passes through unchanged.

import { next, rewrite } from '@vercel/functions'

export const config = {
  matcher: ['/((?!assets/|favicon\\.ico|robots\\.txt|_vercel/).*)'],
}

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

async function workspaceExists(slug, supabaseUrl, supabaseKey) {
  const url = `${supabaseUrl}/rest/v1/workspaces?slug=eq.${encodeURIComponent(slug)}&select=status&limit=1`
  let r
  try {
    r = await fetch(url, {
      headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
    })
  } catch (e) {
    console.error('[middleware] workspace lookup network error:', e?.message)
    return false
  }
  if (!r.ok) {
    console.error(`[middleware] workspace lookup failed: ${r.status}`)
    return false
  }
  const rows = await r.json().catch(() => null)
  if (!Array.isArray(rows) || rows.length === 0) return false
  return rows[0].status === 'active'
}

export default async function middleware(request) {
  // Dual-run gate: legacy per-brand Vercel projects pass through unchanged.
  if (!process.env.MULTITENANT_DATABASE_URL) return next()

  const host = request.headers.get('host') || ''
  const url  = new URL(request.url)
  const slug = extractSlug(host)

  // Apex / www: rewrite root path to landing page; otherwise pass through.
  if (!slug) {
    if (APEX_HOSTS.has(host.split(':')[0].toLowerCase()) && url.pathname === '/') {
      return rewrite(new URL('/landing.html', request.url))
    }
    return next()
  }

  // Subdomain: verify the workspace exists and is active. Phase 1A returns
  // 404 plain text on miss; Phase 1E may redirect to apex onboarding.
  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY
  if (!supabaseUrl || !supabaseKey) {
    console.error('[middleware] SUPABASE_URL/SERVICE_KEY not configured')
    return new Response('Workspace lookup unavailable', { status: 503 })
  }

  const exists = await workspaceExists(slug, supabaseUrl, supabaseKey)
  if (!exists) {
    return new Response(`Unknown workspace: ${slug}`, {
      status: 404,
      headers: { 'Content-Type': 'text/plain' },
    })
  }

  return next()
}

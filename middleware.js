// Vercel Routing Middleware — runs before cache on every matched request.
//
// Phase 1A of the multi-tenant pivot: resolves subdomain (e.g.
// `movebetter-people.narraterx.ai`) → workspace row from the shared
// `narraterx` Supabase, and injects the workspace id + slug as request
// headers for downstream API routes and frontend bootstrap to consume.
//
// Dual-run safe: when MULTITENANT_DATABASE_URL is unset (legacy per-brand
// Vercel projects: narraterx-people, narraterx-equine, narraterx-animals),
// the middleware no-ops and every request passes through unchanged. The
// new shared `narraterx` Vercel project sets the env var and gets the
// resolution behavior.
//
// What gets injected (downstream code reads from req.headers):
//   x-workspace-id    — UUID of the resolved workspace row
//   x-workspace-slug  — slug used to resolve it (matches the subdomain)
//
// On apex (`narraterx.ai` and `www.narraterx.ai`), root-path requests
// rewrite to /landing.html (the static marketing page that lives in
// public/). Other apex paths pass through to the SPA. Preview URLs
// (`*.vercel.app`) also pass through.
//
// Unknown subdomain → 404 with a plain-text body. Phase 1E may redirect
// to the apex onboarding flow instead.

import { next, rewrite } from '@vercel/functions'

export const config = {
  // Skip Vite-built assets and well-known browser noise. Everything else
  // (HTML routes + API routes) goes through middleware so workspace
  // headers are attached before the handler reads them.
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

async function resolveWorkspace(slug, supabaseUrl, supabaseKey) {
  const url = `${supabaseUrl}/rest/v1/workspaces?slug=eq.${encodeURIComponent(slug)}&select=id,slug,status&limit=1`
  let r
  try {
    r = await fetch(url, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
    })
  } catch (e) {
    console.error('[middleware] workspace lookup network error:', e?.message)
    return null
  }
  if (!r.ok) {
    console.error(`[middleware] workspace lookup failed: ${r.status}`)
    return null
  }
  let rows
  try {
    rows = await r.json()
  } catch {
    return null
  }
  if (!Array.isArray(rows) || rows.length === 0) return null
  const row = rows[0]
  if (row.status !== 'active') return null
  return row
}

export default async function middleware(request) {
  // Dual-run gate: only resolve workspaces on the new shared deployment.
  // Legacy per-brand projects don't set this env var and pass straight
  // through.
  if (!process.env.MULTITENANT_DATABASE_URL) return next()

  const host = request.headers.get('host') || ''
  const url  = new URL(request.url)
  const slug = extractSlug(host)

  // Apex / www: serve the static landing page at root, pass other paths
  // through to the SPA. Preview URLs (*.vercel.app) and any other host
  // also pass through.
  if (!slug) {
    if (APEX_HOSTS.has(host.split(':')[0].toLowerCase()) && url.pathname === '/') {
      return rewrite(new URL('/landing.html', request.url))
    }
    return next()
  }

  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY
  if (!supabaseUrl || !supabaseKey) {
    console.error('[middleware] SUPABASE_URL/SERVICE_KEY not configured on multitenant deployment')
    return new Response('Workspace lookup unavailable', { status: 503 })
  }

  const workspace = await resolveWorkspace(slug, supabaseUrl, supabaseKey)
  if (!workspace) {
    return new Response(`Unknown workspace: ${slug}`, {
      status: 404,
      headers: { 'Content-Type': 'text/plain' },
    })
  }

  return next({
    headers: {
      'x-workspace-id':   workspace.id,
      'x-workspace-slug': workspace.slug,
    },
  })
}

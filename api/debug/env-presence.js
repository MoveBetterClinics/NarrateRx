// Temporary diagnostic endpoint — verifies that sensitive env vars are
// actually populated at runtime on the new multi-tenant deployment.
// Returns boolean presence checks only; never returns values. Delete this
// file once Phase 1A diagnostic is complete.

export const config = { runtime: 'edge' }

export default async function handler(req) {
  // Dump every header the request arrived with — exposes whether middleware
  // injected x-workspace-id / x-workspace-slug as expected.
  const incomingHeaders = {}
  if (req?.headers && typeof req.headers.forEach === 'function') {
    req.headers.forEach((v, k) => { incomingHeaders[k] = v })
  } else if (req?.headers) {
    Object.assign(incomingHeaders, req.headers)
  }

  const present = (k) => {
    const v = process.env[k]
    return typeof v === 'string' && v.length > 0
  }
  const lengthOf = (k) => {
    const v = process.env[k]
    return typeof v === 'string' ? v.length : 0
  }

  // Reproduce the middleware's workspace lookup against a known seeded slug.
  // Reports the raw Supabase response — status code, response body, and any
  // network error — so we can see exactly why the middleware lookup fails.
  let lookup = null
  if (present('SUPABASE_URL') && present('SUPABASE_SERVICE_KEY')) {
    const slug = 'movebetter-people'
    const url = `${process.env.SUPABASE_URL}/rest/v1/workspaces?slug=eq.${encodeURIComponent(slug)}&select=id,slug,status&limit=1`
    try {
      const r = await fetch(url, {
        headers: {
          apikey: process.env.SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        },
      })
      const bodyText = await r.text()
      lookup = {
        target_slug: slug,
        url: url.replace(process.env.SUPABASE_URL, '<SUPABASE_URL>'),
        status: r.status,
        ok: r.ok,
        body: bodyText.slice(0, 500),
      }
    } catch (e) {
      lookup = { error: e?.message || String(e) }
    }
  }

  const body = {
    SUPABASE_URL: { present: present('SUPABASE_URL'), length: lengthOf('SUPABASE_URL') },
    SUPABASE_SERVICE_KEY: { present: present('SUPABASE_SERVICE_KEY'), length: lengthOf('SUPABASE_SERVICE_KEY') },
    MULTITENANT_DATABASE_URL: { present: present('MULTITENANT_DATABASE_URL'), length: lengthOf('MULTITENANT_DATABASE_URL') },
    deployment: process.env.VERCEL_URL || null,
    lookup,
    incomingHeaders,
    middleware_headers_seen: {
      'x-workspace-id': incomingHeaders['x-workspace-id'] || null,
      'x-workspace-slug': incomingHeaders['x-workspace-slug'] || null,
    },
  }
  return new Response(JSON.stringify(body, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

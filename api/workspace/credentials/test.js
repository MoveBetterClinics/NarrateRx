import { withSentry } from '../../_lib/sentry.js'
// Test-connection endpoint for stored credentials. Admin-only.
//
//   POST /api/workspace/credentials/test { service }
//     → { ok: true, info: { ... } }                       on success
//     → { ok: false, error: '<message>' }, status 502      on failure
//
// Tests a benign read-only call against each service so an admin can verify
// a credential without having to push a real post. Decrypts the stored
// secret server-side; plaintext never crosses the wire.
//
// What each service does for "test":
//   - buffer       → GET /1/user.json (returns the connected Buffer account)
//   - wordpress    → GET <site_url>?per_page=1 with Basic auth
//                    (Application Password endpoint accepts a list-posts probe)
//   - astro_github → POST <url> with { test: true } payload + bearer
//                    (the publish endpoint should 200 + reject with "test"
//                    in the body, but a 401 still distinguishes bad secret
//                    from network failure)
//   - website      → same shape as astro_github
//   - tdc          → not yet wired

import { requireRole } from '../../_lib/auth.js'
import { workspaceContext } from '../../_lib/workspaceContext.js'
import { getCredential } from '../../_lib/getCredential.js'

const TIMEOUT_MS = 8000

function fetchWithTimeout(url, init = {}) {
  // AbortController-based timeout — we don't want a hung credential test to
  // keep the user waiting more than 8s. fetch's own timeout is undefined
  // across runtimes, so we own it.
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  return fetch(url, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(t))
}

async function testBuffer(secret) {
  // GraphQL API (api.buffer.com/graphql) — the only endpoint that accepts
  // Personal Keys and App Client tokens. The old v1 REST API rejects them.
  const r = await fetchWithTimeout('https://api.buffer.com/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: '{ account { id name email } }' }),
  })
  if (!r.ok) {
    const bodyText = await r.text().catch(() => '')
    console.error('[credentials/test] buffer rejected', r.status, bodyText)
    if (r.status === 401 || r.status === 403) return { ok: false, error: 'Token rejected by Buffer (401/403). Generate a fresh Personal Key at buffer.com/api and try again.' }
    return { ok: false, error: `Buffer responded ${r.status}` }
  }
  const body = await r.json().catch(() => ({}))
  if (body.errors) {
    const msg = body.errors[0]?.message || 'GraphQL error'
    console.error('[credentials/test] buffer graphql error', JSON.stringify(body.errors))
    if (msg.toLowerCase().includes('auth') || msg.toLowerCase().includes('token')) {
      return { ok: false, error: `Token rejected by Buffer: ${msg}` }
    }
    return { ok: false, error: msg }
  }
  const acct = body.data?.account
  return {
    ok: true,
    info: { account: acct?.name || acct?.email || acct?.id || 'verified' },
  }
}

async function testWordPress({ config, secret }) {
  const site = config?.site_url
  const user = config?.user
  if (!site || !user) return { ok: false, error: 'Missing site URL or username.' }
  // List 1 post — cheapest read that exercises the Application Password.
  const base = site.replace(/\/+$/, '')
  const url = `${base.includes('/wp/v2/posts') ? base : `${base}/wp/v2/posts`}?per_page=1&_fields=id`
  const basic = typeof btoa === 'function'
    ? btoa(`${user}:${secret}`)
    : Buffer.from(`${user}:${secret}`).toString('base64')
  const r = await fetchWithTimeout(url, { headers: { Authorization: `Basic ${basic}` } })
  if (!r.ok) {
    if (r.status === 401 || r.status === 403) return { ok: false, error: 'WordPress rejected the credentials (401/403). Check the username and application password.' }
    return { ok: false, error: `WordPress responded ${r.status}` }
  }
  return { ok: true, info: { endpoint: base } }
}

async function testBearerEndpoint({ config, secret }) {
  const url = config?.url
  if (!url) return { ok: false, error: 'Missing webhook URL.' }
  // POST with { test: true } — the publish endpoint should either 200 with
  // "test mode" semantics or 401 on bad secret. Either is informative; a
  // network failure / timeout is the only ambiguous case.
  const r = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ test: true }),
  })
  if (r.status === 401 || r.status === 403) {
    return { ok: false, error: 'Endpoint rejected the bearer token (401/403). Confirm the secret matches what the endpoint expects.' }
  }
  if (!r.ok && r.status !== 400) {
    // 400 is acceptable — the endpoint received our test ping and chose to
    // reject the payload shape. That still proves the credential reached it.
    return { ok: false, error: `Endpoint responded ${r.status}` }
  }
  return { ok: true, info: { endpoint: url } }
}

const TESTERS = {
  buffer:       ({ secret }) => testBuffer(secret),
  wordpress:    testWordPress,
  astro_github: testBearerEndpoint,
  website:      testBearerEndpoint,
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method-not-allowed' })
  }

  const workspace = await workspaceContext(req)
  if (!workspace) return res.status(404).json({ error: 'no-workspace-context' })

  const auth = await requireRole(req, ['admin'], { orgId: workspace.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  const { service } = req.body || {}
  if (!service || !TESTERS[service]) {
    return res.status(400).json({ error: 'unsupported-service' })
  }

  const credential = await getCredential(workspace.id, service)
  if (!credential || !credential.secret) {
    return res.status(404).json({ ok: false, error: 'No credentials saved for this service.' })
  }

  let result
  try {
    result = await TESTERS[service](credential)
  } catch (e) {
    const message = e?.name === 'AbortError'
      ? 'Test timed out after 8 seconds — endpoint slow or unreachable.'
      : e?.message || 'Network error.'
    return res.status(502).json({ ok: false, error: message })
  }

  return res.status(result.ok ? 200 : 502).json(result)
}

export default withSentry(handler)

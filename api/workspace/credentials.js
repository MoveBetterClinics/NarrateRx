import { withSentry } from '../_lib/sentry.js'
// Per-workspace publish credential management. Admin-only.
//
//   GET    /api/workspace/credentials          → list configured services (no secrets)
//   PUT    /api/workspace/credentials          → upsert one service { service, config, secret }
//   DELETE /api/workspace/credentials?service=  → remove one service
//
// Secrets are encrypted in Node with AES-256-GCM (see credentialCrypto.js)
// and stored as base64 text in workspace_credentials.secret_ciphertext.
// Plaintext never crosses the wire on read paths — the secret field is
// write-only. To rotate, the admin re-pastes the value.

import { requireRole } from '../_lib/auth.js'
import { workspaceContext } from '../_lib/workspaceContext.js'
import { encryptSecret } from '../_lib/credentialCrypto.js'
import { listConfiguredServices } from '../_lib/getCredential.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// 'facebook' retired 2026-05-10 — FB routes through Buffer.
// 'gbp' retired 2026-05-11 — GBP routes through Buffer (per-location channel
//   IDs live on workspace_locations.gbp_location_id).
const KNOWN_SERVICES = new Set(['buffer', 'wordpress', 'astro_github', 'website', 'tdc'])

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}

async function handler(req, res) {
  const auth = await requireRole(req, ['admin'])
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  const workspace = await workspaceContext(req)
  if (!workspace) return res.status(404).json({ error: 'no-workspace-context' })

  if (req.method === 'GET') {
    const services = await listConfiguredServices(workspace.id)
    return res.status(200).json({ services })
  }

  if (req.method === 'PUT' || req.method === 'POST') {
    const body = req.body || {}
    const { service, config, secret } = body
    if (!service || !KNOWN_SERVICES.has(service)) {
      return res.status(400).json({ error: 'unknown-service' })
    }
    if (typeof secret !== 'string' || !secret) {
      return res.status(400).json({ error: 'secret-required' })
    }

    let secret_ciphertext
    try {
      secret_ciphertext = encryptSecret(secret)
    } catch (e) {
      console.error('[credentials PUT] encrypt failed:', e?.message)
      return res.status(500).json({ error: 'encrypt-failed' })
    }

    const row = {
      workspace_id: workspace.id,
      service,
      config: config && typeof config === 'object' ? config : {},
      secret_ciphertext,
      status: 'active',
    }

    const r = await sb('workspace_credentials', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(row),
    })
    if (!r.ok) {
      const text = await r.text().catch(() => '')
      console.error('[credentials PUT] supabase error:', r.status, text)
      return res.status(500).json({ error: 'db-error' })
    }
    return res.status(200).json({ ok: true, service })
  }

  if (req.method === 'DELETE') {
    const url = new URL(req.url, 'http://localhost')
    const service = url.searchParams.get('service')
    if (!service || !KNOWN_SERVICES.has(service)) {
      return res.status(400).json({ error: 'unknown-service' })
    }
    const r = await sb(
      `workspace_credentials?workspace_id=eq.${workspace.id}&service=eq.${service}`,
      { method: 'DELETE' },
    )
    if (!r.ok) return res.status(500).json({ error: 'db-error' })
    return res.status(200).json({ ok: true })
  }

  return res.status(405).json({ error: 'method-not-allowed' })
}

export default withSentry(handler)

export const config = { runtime: 'nodejs' }
// Buffer OAuth 2.0 callback — called from narraterx.ai (root domain) after the
// user authorizes NarrateRx in Buffer. No workspace subdomain here; workspace_id
// comes from the signed state param. Exchanges the code for an access token and
// saves it to workspace_credentials, then redirects back to the workspace's
// settings/integrations page.

import crypto from 'node:crypto'
import { encryptSecret } from '../../_lib/credentialCrypto.js'

const CLIENT_ID = process.env.BUFFER_CLIENT_ID
const CLIENT_SECRET = process.env.BUFFER_CLIENT_SECRET
const REDIRECT_URI = 'https://narraterx.ai/api/oauth/buffer/callback'
const TOKEN_URL = 'https://api.bufferapp.com/1/oauth2/token.json'
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

function verifyState(state) {
  const dot = state.lastIndexOf('.')
  if (dot < 0) return null
  const data = state.slice(0, dot)
  const sig = state.slice(dot + 1)
  const expected = crypto.createHmac('sha256', CLIENT_SECRET).update(data).digest('base64url')
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig, 'base64url'), Buffer.from(expected, 'base64url'))) return null
  } catch {
    return null
  }
  try {
    return JSON.parse(Buffer.from(data, 'base64url').toString())
  } catch {
    return null
  }
}

function redirectTo(res, url) {
  res.writeHead(302, { Location: url })
  res.end()
}

async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost')
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const errorParam = url.searchParams.get('error')

  if (errorParam) {
    return redirectTo(res, `/settings/integrations?buffer_error=${encodeURIComponent(errorParam)}`)
  }
  if (!code || !state) {
    return redirectTo(res, '/settings/integrations?buffer_error=missing_params')
  }

  const payload = verifyState(state)
  if (!payload?.workspace_id) {
    return redirectTo(res, '/settings/integrations?buffer_error=invalid_state')
  }

  // Exchange code for access token
  const tokenRes = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      code,
      grant_type: 'authorization_code',
    }),
  })

  if (!tokenRes.ok) {
    const body = await tokenRes.text().catch(() => '')
    console.error('[oauth/buffer/callback] token exchange failed', tokenRes.status, body)
    return redirectTo(res, '/settings/integrations?buffer_error=token_exchange_failed')
  }

  const tokenBody = await tokenRes.json().catch(() => ({}))
  const access_token = tokenBody.access_token
  if (!access_token) {
    console.error('[oauth/buffer/callback] no access_token in response', JSON.stringify(tokenBody))
    return redirectTo(res, '/settings/integrations?buffer_error=no_token')
  }

  // Save to workspace_credentials
  const secret_ciphertext = encryptSecret(access_token)
  const dbRes = await fetch(`${SUPABASE_URL}/rest/v1/workspace_credentials?on_conflict=workspace_id,service`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify({
      workspace_id: payload.workspace_id,
      service: 'buffer',
      config: {},
      secret_ciphertext,
      status: 'active',
    }),
  })

  if (!dbRes.ok) {
    const body = await dbRes.text().catch(() => '')
    console.error('[oauth/buffer/callback] db save failed', dbRes.status, body)
    return redirectTo(res, '/settings/integrations?buffer_error=save_failed')
  }

  // Look up workspace slug to redirect back to the right subdomain
  const wsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/workspaces?id=eq.${payload.workspace_id}&select=slug`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
  )
  const workspaces = wsRes.ok ? await wsRes.json().catch(() => []) : []
  const slug = workspaces[0]?.slug

  const returnHost = slug ? `https://${slug}.narraterx.ai` : 'https://narraterx.ai'
  return redirectTo(res, `${returnHost}/settings/integrations?buffer=connected`)
}

export default handler

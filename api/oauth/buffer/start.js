export const config = { runtime: 'nodejs' }
// Kicks off the Buffer OAuth 2.0 flow.
// Called from a workspace subdomain — resolves workspace from host, requires
// admin role, then redirects to Buffer's authorize URL with a signed state
// param that encodes workspace_id so the callback can save the token correctly.

import crypto from 'node:crypto'
import { workspaceContext } from '../../_lib/workspaceContext.js'

const CLIENT_ID = process.env.BUFFER_CLIENT_ID
const CLIENT_SECRET = process.env.BUFFER_CLIENT_SECRET
const REDIRECT_URI = 'https://narraterx.ai/api/oauth/buffer/callback'
const AUTHORIZE_URL = 'https://bufferapp.com/oauth2/authorize'

function signState(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = crypto.createHmac('sha256', CLIENT_SECRET).update(data).digest('base64url')
  return `${data}.${sig}`
}

async function handler(req, res) {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    res.writeHead(500, { 'Content-Type': 'text/plain' })
    res.end('Buffer OAuth not configured — add BUFFER_CLIENT_ID and BUFFER_CLIENT_SECRET.')
    return
  }

  const workspace = await workspaceContext(req)
  if (!workspace) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'no-workspace-context' }))
    return
  }

  const nonce = crypto.randomBytes(16).toString('hex')
  const state = signState({ workspace_id: workspace.id, nonce })

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    state,
  })

  res.writeHead(302, { Location: `${AUTHORIZE_URL}?${params}` })
  res.end()
}

export default handler

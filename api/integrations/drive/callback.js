import { withSentry } from '../../_lib/sentry.js'
import {
  driveRedirectUri,
  exchangeCodeForTokens,
  fetchAccountEmail,
  persistDriveCredential,
  verifyOAuthState,
} from '../../_lib/driveAuth.js'
import { workspaceById } from '../../_lib/workspaceContext.js'

// GET /api/integrations/drive/callback?code=…&state=…
//
// Runs on the apex (narraterx.ai) because Google requires a fixed redirect
// URI and wildcard subdomains aren't supported. The state token carries the
// originating workspace_id + slug so we know where to persist the credential
// and where to redirect the admin back to after the exchange completes.
//
// Failure modes redirect to /settings/integrations?drive=error&reason=…
// rather than rendering an error page — the admin is already on the
// integrations page and the toast/banner pattern is the consistent UX.

export const config = { runtime: 'nodejs' }

function redirectBack(res, slug, params) {
  const target = new URL(`https://${slug}.narraterx.ai/settings/integrations`)
  for (const [k, v] of Object.entries(params)) target.searchParams.set(k, v)
  res.statusCode = 302
  res.setHeader('Location', target.toString())
  // Don't cache the OAuth redirect — state tokens are single-use and the
  // resulting credential write should never be replayed from cache.
  res.setHeader('Cache-Control', 'no-store')
  res.end()
}

function renderApexError(res, message) {
  res.statusCode = 400
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(
    `<!doctype html><meta charset="utf-8"><title>Google Drive connect</title>` +
    `<body style="font-family:system-ui;padding:2rem;max-width:32rem;margin:auto">` +
    `<h1>Couldn’t complete Drive connect</h1>` +
    `<p>${escapeHtml(message)}</p>` +
    `<p>Return to your workspace’s Settings → Integrations page and try again.</p>` +
    `</body>`,
  )
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method-not-allowed' })
  }

  const url = new URL(req.url, 'http://localhost')
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const errorParam = url.searchParams.get('error')

  // Google bounces back here with ?error=access_denied when the user clicks
  // Cancel on the consent screen. Honor that with a clean redirect — no
  // credential write, no toast spam.
  if (errorParam) {
    const parsed = state ? verifyOAuthState(state) : null
    if (parsed?.slug) {
      return redirectBack(res, parsed.slug, { drive: 'error', reason: errorParam })
    }
    return renderApexError(res, `Google reported: ${errorParam}`)
  }

  if (!code || !state) {
    return renderApexError(res, 'Missing OAuth code or state. Try connecting again from Settings → Integrations.')
  }

  const parsed = verifyOAuthState(state)
  if (!parsed) {
    return renderApexError(res, 'OAuth state is invalid or has expired (10 minute window). Try connecting again.')
  }

  let tokens
  try {
    tokens = await exchangeCodeForTokens({ code, redirectUri: driveRedirectUri() })
  } catch (e) {
    console.error('[drive/callback] exchange failed:', e?.message)
    return redirectBack(res, parsed.slug, { drive: 'error', reason: 'exchange_failed' })
  }

  const accountEmail = await fetchAccountEmail(tokens.access_token)

  // Verify the workspace is still active before writing the credential.
  // The state token was issued against an active workspace; it could have been
  // archived in the ~10 minute OAuth window. workspaceById returns null for
  // non-active workspaces.
  const ws = await workspaceById(parsed.workspaceId)
  if (!ws) {
    console.error('[drive/callback] workspace not found or inactive:', parsed.workspaceId)
    return renderApexError(res, 'Your workspace could not be found. It may have been archived. Contact support if this is unexpected.')
  }

  try {
    await persistDriveCredential({
      workspaceId: parsed.workspaceId,
      refreshToken: tokens.refresh_token,
      accountEmail,
    })
  } catch (e) {
    console.error('[drive/callback] persist failed:', e?.message)
    return redirectBack(res, parsed.slug, { drive: 'error', reason: 'persist_failed' })
  }

  return redirectBack(res, parsed.slug, { drive: 'connected' })
}

export default withSentry(handler)

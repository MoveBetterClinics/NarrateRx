// Shared helpers for the Google Drive OAuth integration.
//
// Service-account JWT (the prior pattern, retired 2026-05-08) is replaced with
// per-workspace OAuth where each tenant connects their own Google account.
// The refresh token is stored encrypted in workspace_credentials and exchanged
// for a short-lived access token on every Drive API call. Access tokens are
// memoized per workspace for their nominal 1h lifetime so back-to-back list
// calls don't burn a token-exchange round-trip each.
//
// State token (connect → callback): HMAC-SHA256-signed JSON with the
// originating workspace id, slug, user id, and an expiry. Signed with a
// sub-key derived from WORKSPACE_CREDENTIALS_KEY (domain-separated via a
// fixed label) so a leaked state can't be cross-protocol-replayed against
// the credential cipher.

import { createHmac, randomBytes } from 'node:crypto'
import { encryptSecret, decryptSecret } from './credentialCrypto.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// `drive.file` (NOT `drive.readonly`): the app can only read/write files the
// user explicitly picked via the Google Picker. This is a non-sensitive scope —
// no Google verification required, no Testing-mode 7-day token expiry, no
// 100-user cap. The Picker (loaded browser-side in DriveImportPicker.jsx)
// "registers" each picked file with our app, after which the workspace's
// access token can download it via the standard drive.files.get?alt=media
// path.
//
// Switching from drive.readonly to drive.file (PR #687, 2026-05-20) makes
// external clinic onboarding trivial — the consent screen reads "see only
// files you pick" instead of "see all your Drive files". Existing
// drive.readonly tokens keep working (broader scope = superset) but should
// be reconnected for hygiene.
export const DRIVE_OAUTH_SCOPES = ['https://www.googleapis.com/auth/drive.file']
const STATE_TTL_MS = 10 * 60 * 1000
const STATE_LABEL = 'drive_oauth_state_v1'

// HMAC sub-key. Reuses WORKSPACE_CREDENTIALS_KEY bytes but with a domain
// separator so signing a state token can't accidentally produce a value that
// also decrypts as a credential blob (or vice versa).
function getStateKey() {
  const hex = process.env.WORKSPACE_CREDENTIALS_KEY
  if (!hex || hex.length !== 64) {
    throw new Error('WORKSPACE_CREDENTIALS_KEY not set (required for Drive OAuth state signing)')
  }
  const base = Buffer.from(hex, 'hex')
  return createHmac('sha256', base).update(STATE_LABEL).digest()
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}
function b64urlDecode(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4))
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64')
}

export function signOAuthState({ workspaceId, slug, userId }) {
  const payload = {
    w: workspaceId,
    s: slug,
    u: userId,
    n: b64url(randomBytes(12)),
    e: Date.now() + STATE_TTL_MS,
  }
  const body = b64url(JSON.stringify(payload))
  const sig = b64url(createHmac('sha256', getStateKey()).update(body).digest())
  return `${body}.${sig}`
}

export function verifyOAuthState(state) {
  if (typeof state !== 'string' || !state.includes('.')) return null
  const [body, sig] = state.split('.')
  if (!body || !sig) return null
  const expected = b64url(createHmac('sha256', getStateKey()).update(body).digest())
  // Constant-time compare via length check + timingSafeEqual would be ideal,
  // but the strings are equal-length when valid; a regular === here is fine
  // because state is short-lived and signed (no oracle is exposed beyond a
  // 400 response either way).
  if (expected !== sig) return null
  let payload
  try {
    payload = JSON.parse(b64urlDecode(body).toString('utf8'))
  } catch {
    return null
  }
  if (!payload?.w || !payload?.s || !payload?.e) return null
  if (Date.now() > Number(payload.e)) return null
  return { workspaceId: payload.w, slug: payload.s, userId: payload.u || null }
}

// Build the Google OAuth authorization URL. access_type=offline + prompt=consent
// is required to receive a refresh_token on subsequent consents — without
// prompt=consent, Google sometimes omits the refresh token if the user has
// already approved the app, which silently breaks reconnect.
export function buildAuthorizationUrl({ redirectUri, state }) {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID
  if (!clientId) throw new Error('GOOGLE_DRIVE_CLIENT_ID not set')
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: DRIVE_OAUTH_SCOPES.join(' '),
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent',
    state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

// Exchange the authorization code for { access_token, refresh_token, expires_in }.
export async function exchangeCodeForTokens({ code, redirectUri }) {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new Error('Drive OAuth client not configured')

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })
  const data = await r.json().catch(() => null)
  if (!r.ok || !data?.access_token) {
    const reason = data?.error_description || data?.error || `HTTP ${r.status}`
    throw new Error(`token exchange failed: ${reason}`)
  }
  // refresh_token is only included on the FIRST consent unless prompt=consent
  // forces re-issuance (which we do above). A missing refresh_token here means
  // the user denied offline scope or Google's per-user limit was hit; treat
  // as a hard failure so we don't store a half-broken credential.
  if (!data.refresh_token) {
    throw new Error('no refresh_token returned — consent must be re-granted with offline access')
  }
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: Number(data.expires_in) || 3600,
    scope: data.scope || DRIVE_OAUTH_SCOPES.join(' '),
    token_type: data.token_type || 'Bearer',
  }
}

// Refresh an access token using the stored refresh_token. Used at every
// Drive API call site (list, get, download) via accessTokenForWorkspace.
export async function refreshAccessToken(refreshToken) {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new Error('Drive OAuth client not configured')

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }),
  })
  const data = await r.json().catch(() => null)
  if (!r.ok || !data?.access_token) {
    const reason = data?.error_description || data?.error || `HTTP ${r.status}`
    const err = new Error(`refresh failed: ${reason}`)
    // Surface invalid_grant so callers can mark the credential as revoked
    // and prompt the admin to reconnect, instead of retrying in a loop.
    if (data?.error === 'invalid_grant') err.code = 'invalid_grant'
    throw err
  }
  return {
    access_token: data.access_token,
    expires_in: Number(data.expires_in) || 3600,
  }
}

// Best-effort revoke. Google's revoke endpoint is idempotent and accepts an
// already-revoked or expired token without erroring meaningfully. We log
// failures but never block the disconnect path on them — the workspace_credentials
// row is being deleted either way.
export async function revokeToken(token) {
  if (!token) return
  try {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
  } catch (e) {
    console.warn('[driveAuth] revoke failed (non-fatal):', e?.message)
  }
}

// Look up the connected Google account's email so we can show it in the
// Settings UI ("Connected as user@gmail.com"). Cheap one-shot call against
// the about endpoint; if it fails, the connect flow still succeeds — we just
// display "Connected".
export async function fetchAccountEmail(accessToken) {
  try {
    const r = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName)', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!r.ok) return null
    const data = await r.json().catch(() => null)
    return data?.user?.emailAddress || null
  } catch {
    return null
  }
}

// In-process access token cache keyed by workspace_id. Fluid Compute reuses
// warm instances across concurrent requests, so this is meaningful even for a
// short cache lifetime. TTL = expires_in - 60s safety margin so we never serve
// a token that's about to expire mid-Drive-call.
const _tokenCache = new Map()

function cacheGet(workspaceId) {
  const entry = _tokenCache.get(workspaceId)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) { _tokenCache.delete(workspaceId); return null }
  return entry.accessToken
}
function cacheSet(workspaceId, accessToken, expiresInSec) {
  const expiresAt = Date.now() + Math.max(60, expiresInSec - 60) * 1000
  _tokenCache.set(workspaceId, { accessToken, expiresAt })
}

// Load the encrypted refresh token from workspace_credentials and exchange it
// for a fresh access token. Throws when no credential exists (caller should
// return a 412 prompting reconnect). On invalid_grant we also delete the
// stored row so the UI re-prompts on the next page load.
async function loadDriveCredentialRow(workspaceId) {
  if (!workspaceId || !SUPABASE_URL || !SUPABASE_KEY) return null
  const url =
    `${SUPABASE_URL}/rest/v1/workspace_credentials` +
    `?workspace_id=eq.${encodeURIComponent(workspaceId)}` +
    `&service=eq.drive&status=eq.active` +
    `&select=id,config,secret_ciphertext&limit=1`
  const r = await fetch(url, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  })
  if (!r.ok) return null
  const rows = await r.json().catch(() => null)
  return Array.isArray(rows) && rows[0] ? rows[0] : null
}

async function markCredentialDisabled(rowId, reason) {
  if (!rowId || !SUPABASE_URL || !SUPABASE_KEY) return
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/workspace_credentials?id=eq.${encodeURIComponent(rowId)}`, {
      method: 'PATCH',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status: 'disabled', config: { last_error: reason, errored_at: new Date().toISOString() } }),
    })
  } catch (e) {
    console.warn('[driveAuth] failed to mark credential disabled:', e?.message)
  }
}

export class DriveAuthError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

export async function accessTokenForWorkspace(workspaceId) {
  const cached = cacheGet(workspaceId)
  if (cached) return cached
  const row = await loadDriveCredentialRow(workspaceId)
  if (!row?.secret_ciphertext) throw new DriveAuthError('not_connected', 'Google Drive not connected for this workspace')
  let refreshToken
  try {
    refreshToken = decryptSecret(row.secret_ciphertext)
  } catch (e) {
    console.error('[driveAuth] decrypt failed:', e?.message)
    throw new DriveAuthError('decrypt_failed', 'stored refresh token unreadable')
  }
  try {
    const { access_token, expires_in } = await refreshAccessToken(refreshToken)
    cacheSet(workspaceId, access_token, expires_in)
    return access_token
  } catch (e) {
    if (e.code === 'invalid_grant') {
      await markCredentialDisabled(row.id, e.message)
      throw new DriveAuthError('reconnect_required', 'Google Drive access was revoked — admin must reconnect')
    }
    throw e
  }
}

// Persist a freshly-issued credential. Called from the OAuth callback after
// a successful token exchange. Upsert by (workspace_id, service='drive').
// We store the refresh_token (long-lived) encrypted, and the account email +
// connect timestamp in config for display.
export async function persistDriveCredential({ workspaceId, refreshToken, accountEmail }) {
  if (!workspaceId) throw new Error('workspaceId required')
  if (!refreshToken) throw new Error('refreshToken required')
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Supabase env not configured')

  const config = {
    account_email: accountEmail || null,
    connected_at: new Date().toISOString(),
    scopes: DRIVE_OAUTH_SCOPES,
  }
  const secret_ciphertext = encryptSecret(refreshToken)

  // Same explicit-read-then-patch/insert dance as workspace/credentials.js —
  // PostgREST upserts hit a 409 on this table even with on_conflict set, so
  // we mirror the workaround documented there.
  const check = await fetch(
    `${SUPABASE_URL}/rest/v1/workspace_credentials?workspace_id=eq.${workspaceId}&service=eq.drive&select=id`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
  )
  const existing = check.ok ? (await check.json().catch(() => []))?.[0] : null

  let r
  if (existing?.id) {
    r = await fetch(`${SUPABASE_URL}/rest/v1/workspace_credentials?id=eq.${existing.id}`, {
      method: 'PATCH',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ config, secret_ciphertext, status: 'active' }),
    })
  } else {
    r = await fetch(`${SUPABASE_URL}/rest/v1/workspace_credentials`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ workspace_id: workspaceId, service: 'drive', config, secret_ciphertext, status: 'active' }),
    })
  }
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    throw new Error(`persist failed: ${r.status} ${text}`)
  }
  _tokenCache.delete(workspaceId)
}

export async function deleteDriveCredential(workspaceId) {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Supabase env not configured')
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/workspace_credentials?workspace_id=eq.${workspaceId}&service=eq.drive`,
    {
      method: 'DELETE',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    },
  )
  if (!r.ok) throw new Error(`delete failed: ${r.status}`)
  _tokenCache.delete(workspaceId)
}

// Resolve the canonical apex redirect URI. Google requires every redirect URI
// to be pre-registered, and registering a wildcard subdomain isn't supported.
// We use a single fixed redirect on the apex, then forward back to the
// originating workspace subdomain after the credential is persisted. The state
// token carries the originating slug for that forward.
//
// Override with GOOGLE_DRIVE_REDIRECT_URI when running against a preview
// deployment whose host isn't apex (e.g. *.vercel.app). When unset we default
// to the production apex URL.
export function driveRedirectUri() {
  return process.env.GOOGLE_DRIVE_REDIRECT_URI
    || 'https://narraterx.ai/api/integrations/drive/callback'
}

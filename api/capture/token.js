// GET    /api/capture/token — read current token state (without exposing the token value if already set)
// POST   /api/capture/token — generate (or rotate) a new token, return plaintext ONCE
// DELETE /api/capture/token — revoke the current token
//
// Used by the in-app Capture Companion settings panel (Phase 3 UI lands later;
// for now this is callable via curl or REST client during Phase 1 dogfood).
//
// Auth: Clerk JWT. Caller must be:
//   • The clinician themselves (clinicians.user_id === auth user_id), OR
//   • A Producer or Owner in the same workspace
//
// Token format: cct_<base32 of 24 random bytes> — prefix is grep-friendly and
// rules out accidental collision with other token shapes in the codebase.

export const config = { runtime: 'nodejs' }

import { randomBytes } from 'node:crypto'
import { requireRole } from '../_lib/auth.js'
import { ALL_KNOWN_ROLES } from '../_lib/roles.js'
import { workspaceContext } from '../_lib/workspaceContext.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const TOKEN_TTL_DAYS = 90

async function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...init.headers,
    },
  })
}

// base32 alphabet (no I/O/L/0/1 confusables)
const B32 = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
function b32(buf) {
  let out = ''
  for (const byte of buf) {
    out += B32[byte % B32.length]
  }
  return out
}
function newToken() {
  return `cct_${b32(randomBytes(24))}`
}

/**
 * Resolve the target clinician + permission check.
 * Returns { ok, clinician } or { ok:false, status, reason }.
 */
async function resolveTarget(req) {
  const ws = await workspaceContext(req)
  if (!ws) {
    return { ok: false, status: 400, reason: 'no_workspace' }
  }
  if (!ws.video_pipeline_enabled) {
    return { ok: false, status: 403, reason: 'feature_disabled' }
  }

  const auth = await requireRole(req, ALL_KNOWN_ROLES, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    return { ok: false, status: auth.reason === 'forbidden' ? 403 : 401, reason: auth.reason }
  }

  // Which clinician? Default to "the one matching auth user_id".
  const url = new URL(req.url, 'http://localhost')
  const clinicianIdParam = url.searchParams.get('clinicianId')

  let clinician
  if (clinicianIdParam) {
    const r = await sb(
      `clinicians?id=eq.${clinicianIdParam}&workspace_id=eq.${ws.id}` +
        `&select=id,name,user_id,workspace_id,permission_tier,staff_type,capture_upload_token,capture_upload_token_expires_at,capture_upload_token_last_used_at`,
    )
    if (!r.ok) return { ok: false, status: 500, reason: 'db_error' }
    const rows = await r.json()
    clinician = rows?.[0]
  } else {
    const r = await sb(
      `clinicians?user_id=eq.${encodeURIComponent(auth.userId)}&workspace_id=eq.${ws.id}` +
        `&select=id,name,user_id,workspace_id,permission_tier,staff_type,capture_upload_token,capture_upload_token_expires_at,capture_upload_token_last_used_at`,
    )
    if (!r.ok) return { ok: false, status: 500, reason: 'db_error' }
    const rows = await r.json()
    clinician = rows?.[0]
  }

  if (!clinician) return { ok: false, status: 404, reason: 'clinician_not_found' }

  // Permission gate: self (matching user_id), or producer/owner in same workspace.
  const isSelf = clinician.user_id && clinician.user_id === auth.userId
  let callerTier = null
  if (!isSelf) {
    const callerRes = await sb(
      `clinicians?user_id=eq.${encodeURIComponent(auth.userId)}&workspace_id=eq.${ws.id}&select=permission_tier`,
    )
    if (callerRes.ok) {
      const callerRows = await callerRes.json()
      callerTier = callerRows?.[0]?.permission_tier || null
    }
  }
  const isElevated = callerTier === 'owner' || callerTier === 'producer'
  if (!isSelf && !isElevated) {
    return { ok: false, status: 403, reason: 'forbidden' }
  }

  return { ok: true, clinician, ws }
}

export default async function handler(req, res) {
  if (!['GET', 'POST', 'DELETE'].includes(req.method)) {
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  const t = await resolveTarget(req)
  if (!t.ok) return res.status(t.status).json({ error: t.reason })
  const { clinician, ws } = t

  if (req.method === 'GET') {
    return res.status(200).json({
      hasToken: !!clinician.capture_upload_token,
      expiresAt: clinician.capture_upload_token_expires_at || null,
      lastUsedAt: clinician.capture_upload_token_last_used_at || null,
      // Never reveal the actual token value on GET; only POST returns it.
    })
  }

  if (req.method === 'DELETE') {
    const r = await sb(`clinicians?id=eq.${clinician.id}&workspace_id=eq.${ws.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        capture_upload_token: null,
        capture_upload_token_expires_at: null,
        capture_upload_token_last_used_at: null,
      }),
    })
    if (!r.ok) return res.status(500).json({ error: 'db_error' })
    return res.status(200).json({ revoked: true })
  }

  // POST — generate / rotate
  const token = newToken()
  const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const r = await sb(`clinicians?id=eq.${clinician.id}&workspace_id=eq.${ws.id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      capture_upload_token: token,
      capture_upload_token_expires_at: expiresAt,
      capture_upload_token_last_used_at: null,
    }),
  })
  if (!r.ok) return res.status(500).json({ error: 'db_error' })

  return res.status(200).json({
    token, // plaintext, shown ONCE
    expiresAt,
    instructions: 'Save this token now. Paste it into your iOS Capture Companion Shortcut as the Bearer value. You will not see it again.',
  })
}

// Per-workspace publish credential lookup.
//
// Replaces process.env.{BUFFER_ACCESS_TOKEN, FACEBOOK_PAGE_TOKEN, ...} reads
// in api/publish/* with a workspace_id-scoped read from the shared
// workspace_credentials table. Each publish endpoint calls
// getCredential(workspaceId, service) and gets back { config, secret } or
// null when the workspace hasn't configured that service.
//
// Service names are stable strings the publish endpoints know about:
//   'buffer'        — Buffer queue          { secret: access_token }
//   'facebook'      — Facebook Page         { config: { page_id }, secret: page_token }
//   'gbp'           — Google Business Profile
//                     { config: { account_id, location_ids[], location_names[],
//                                  service_account_email },
//                       secret: service_account_private_key (JSON-stringified) }
//   'wordpress'     — WordPress REST publish (equine)
//                     { config: { site_url, user }, secret: app_password }
//   'astro_github'  — Astro+GitHub website publish (animals)
//                     { config: { repo, branch, ... }, secret: github_token }
//   'website'       — Generic webhook-based publish
//                     { config: { url }, secret: shared_secret }
//
// Decryption uses WORKSPACE_CREDENTIALS_KEY (see credentialCrypto.js).
//
// LEGACY FALLBACK: if no row exists for (workspace_id, service), this helper
// falls back to reading the matching process.env vars and returns a
// best-effort value. This keeps legacy per-brand deployments working until
// they're decommissioned and lets the shared deployment serve any one
// workspace whose creds are still on env vars (during the credentials
// migration window). Falsy/null returned only when neither source has
// anything to offer.

import { decryptSecret } from './credentialCrypto.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

async function fetchRow(workspaceId, service) {
  if (!workspaceId || !SUPABASE_URL || !SUPABASE_KEY) return null
  const url =
    `${SUPABASE_URL}/rest/v1/workspace_credentials` +
    `?workspace_id=eq.${encodeURIComponent(workspaceId)}` +
    `&service=eq.${encodeURIComponent(service)}` +
    `&status=eq.active` +
    `&select=config,secret_ciphertext&limit=1`
  let r
  try {
    r = await fetch(url, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    })
  } catch (e) {
    console.error('[getCredential] fetch error:', e?.message)
    return null
  }
  if (!r.ok) return null
  const rows = await r.json().catch(() => null)
  return Array.isArray(rows) && rows[0] ? rows[0] : null
}

function envFallback(service) {
  switch (service) {
    case 'buffer':
      return process.env.BUFFER_ACCESS_TOKEN
        ? { config: {}, secret: process.env.BUFFER_ACCESS_TOKEN }
        : null
    case 'facebook':
      return process.env.FACEBOOK_PAGE_TOKEN && process.env.FACEBOOK_PAGE_ID
        ? { config: { page_id: process.env.FACEBOOK_PAGE_ID }, secret: process.env.FACEBOOK_PAGE_TOKEN }
        : null
    case 'gbp':
      return process.env.GOOGLE_SERVICE_ACCOUNT_KEY && process.env.GBP_ACCOUNT_ID
        ? {
            config: {
              account_id: process.env.GBP_ACCOUNT_ID,
              location_ids: (process.env.GBP_LOCATION_IDS || '').split(',').map((s) => s.trim()).filter(Boolean),
              location_names: (process.env.GBP_LOCATION_NAMES || '').split(',').map((s) => s.trim()).filter(Boolean),
              service_account_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
            },
            secret: process.env.GOOGLE_SERVICE_ACCOUNT_KEY,
          }
        : null
    case 'wordpress':
      return process.env.WORDPRESS_USER && process.env.WORDPRESS_APP_PASSWORD
        ? {
            config: {
              site_url: process.env.WEBSITE_PUBLISH_URL,
              user: process.env.WORDPRESS_USER,
            },
            secret: process.env.WORDPRESS_APP_PASSWORD,
          }
        : null
    case 'website':
      return process.env.WEBSITE_PUBLISH_URL && process.env.NARRATERX_PUBLISH_SECRET
        ? {
            config: { url: process.env.WEBSITE_PUBLISH_URL },
            secret: process.env.NARRATERX_PUBLISH_SECRET,
          }
        : null
    default:
      return null
  }
}

export async function getCredential(workspaceId, service) {
  const row = await fetchRow(workspaceId, service)
  if (row && row.secret_ciphertext) {
    try {
      const secret = decryptSecret(row.secret_ciphertext)
      return { config: row.config || {}, secret }
    } catch (e) {
      console.error(`[getCredential] decrypt failed for service='${service}':`, e?.message)
      // Fall through to env fallback so a corrupted row doesn't take publishing
      // offline if env vars are still set.
    }
  }
  return envFallback(service)
}

// Lightweight existence check that doesn't require decrypting the secret.
// Used by the Settings UI to render which services are configured.
export async function listConfiguredServices(workspaceId) {
  if (!workspaceId || !SUPABASE_URL || !SUPABASE_KEY) return []
  const url =
    `${SUPABASE_URL}/rest/v1/workspace_credentials` +
    `?workspace_id=eq.${encodeURIComponent(workspaceId)}` +
    `&status=eq.active` +
    `&select=service,config,updated_at`
  const r = await fetch(url, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  })
  if (!r.ok) return []
  return (await r.json().catch(() => [])) || []
}

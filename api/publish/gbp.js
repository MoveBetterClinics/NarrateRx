export const config = { runtime: 'edge' }

import { workspace as staticWorkspace } from '../../src/lib/workspace.js'
import { workspaceScope } from '../_lib/workspaceScope.js'

// Google Business Profile posting via service account
// Required env vars:
//   GBP_ACCOUNT_ID    - e.g. accounts/123456789
//   GBP_LOCATION_IDS  - comma-separated, e.g. "locations/111,locations/222"
//   GOOGLE_SERVICE_ACCOUNT_EMAIL
//   GOOGLE_SERVICE_ACCOUNT_KEY  (private key — paste as-is with \n newlines)
// Optional:
//   BRAND_URL         - overrides the workspace's bookingUrl for the GBP post CTA

const ok  = (data)       => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } })
const err = (msg, status = 400) => new Response(JSON.stringify({ error: msg }), { status, headers: { 'Content-Type': 'application/json' } })

export async function getGoogleToken() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const key   = (process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '').replace(/\\n/g, '\n')
  if (!email || !key) throw new Error('Google service account not configured')

  const now   = Math.floor(Date.now() / 1000)
  const claim = {
    iss:   email,
    scope: 'https://www.googleapis.com/auth/business.manage',
    aud:   'https://oauth2.googleapis.com/token',
    iat:   now,
    exp:   now + 3600,
  }

  // Build JWT (RS256) using Web Crypto API (available in edge runtime)
  const header  = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const payload = btoa(JSON.stringify(claim)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const toSign  = `${header}.${payload}`

  // Import the private key
  const pemBody = key.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\s/g, '')
  const binaryKey = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0))
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', binaryKey.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  )

  const encoder  = new TextEncoder()
  const sigBuffer = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, encoder.encode(toSign))
  const sig = btoa(String.fromCharCode(...new Uint8Array(sigBuffer))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const jwt = `${toSign}.${sig}`

  // Exchange JWT for access token
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  })
  const tokenData = await tokenRes.json()
  if (!tokenData.access_token) throw new Error(tokenData.error_description || 'Failed to get Google token')
  return tokenData.access_token
}

export async function postToLocation(token, accountId, locationId, post) {
  const url = `https://mybusiness.googleapis.com/v4/${accountId}/${locationId}/localPosts`
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(post),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error?.message || `GBP post failed for ${locationId}`)
  return { locationId, name: data.name }
}

export function buildPost(content, mediaUrls = [], bookingUrl) {
  const post = {
    languageCode: 'en-US',
    summary: content,
    topicType: 'STANDARD',
    callToAction: {
      actionType: 'BOOK',
      url: process.env.BRAND_URL || bookingUrl || staticWorkspace.prompt.bookingUrl,
    },
  }
  const media = Array.isArray(mediaUrls) ? mediaUrls : []
  if (media.length > 0) {
    post.media = media.slice(0, 1).map((m) => ({
      mediaFormat: m.type?.startsWith('video') ? 'VIDEO' : 'PHOTO',
      sourceUrl: m.url,
    }))
  }
  return post
}

export default async function handler(req) {
  const accountId    = process.env.GBP_ACCOUNT_ID
  const allLocationIds = (process.env.GBP_LOCATION_IDS || '').split(',').map((s) => s.trim()).filter(Boolean)

  if (!accountId || !allLocationIds.length) return err('GBP not configured — add GBP_ACCOUNT_ID and GBP_LOCATION_IDS to Vercel env vars', 503)
  if (req.method !== 'POST') return err('Method not allowed', 405)

  const { content, mediaUrls = [], locationIds } = await req.json()
  if (!content) return err('Missing content')

  // Use requested locationIds if provided, otherwise post to all configured locations
  const targets = (locationIds?.length ? locationIds : allLocationIds)
    .filter((id) => allLocationIds.includes(id)) // only allow configured locations

  if (!targets.length) return err('No valid location IDs specified', 400)

  let token
  try { token = await getGoogleToken() }
  catch (e) { return err(`Google auth failed: ${e.message}`, 503) }

  // Resolve booking URL from workspace row when on a shared deployment, so
  // each subdomain's GBP CTA points at the correct clinic.
  const scope = await workspaceScope(req)
  const bookingUrl = scope?.workspace?.booking_url

  const post = buildPost(content, mediaUrls, bookingUrl)

  // Post to all selected locations in parallel
  const results = await Promise.allSettled(
    targets.map((locationId) => postToLocation(token, accountId, locationId, post))
  )

  // Tag each result with its target locationId BEFORE filtering, so failure
  // messages line up with the right location even when some succeed.
  const tagged    = results.map((r, i) => ({ r, locationId: targets[i] }))
  const succeeded = tagged.filter(({ r }) => r.status === 'fulfilled').map(({ r }) => r.value)
  const failed    = tagged.filter(({ r }) => r.status === 'rejected')
                          .map(({ r, locationId }) => ({ locationId, error: r.reason?.message }))

  if (!succeeded.length) return err(`All GBP posts failed: ${failed.map((f) => f.error).join('; ')}`, 502)

  // postId surfaces in publish.js as result.direct?.postId — comma-join the
  // localPost names so multi-location publishes still get tracked.
  const postId = succeeded.map((s) => s.name).filter(Boolean).join(',')
  return ok({ success: true, postId, posted: succeeded, failed })
}

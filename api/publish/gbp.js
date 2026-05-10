// Google Business Profile publish endpoint — Node.js runtime.
//
// Resolves per-workspace creds via getCredential('gbp'):
//   config: { account_id, location_ids[], location_names[], service_account_email }
//   secret: service-account private key (PEM, with literal \n or real newlines)
//
// The cron dispatcher (api/cron/publish-due.js) imports getGoogleToken,
// postToLocation, buildPost from this module — keep their signatures stable.
// getGoogleToken now takes the resolved creds explicitly so it can be invoked
// per-workspace inside the cron loop.

import { createSign } from 'node:crypto'
import { workspaceScope } from '../_lib/workspaceScope.js'
import { getCredential } from '../_lib/getCredential.js'

export async function getGoogleToken(creds) {
  const email = creds?.config?.service_account_email
  const key = (creds?.secret || '').replace(/\\n/g, '\n')
  if (!email || !key) throw new Error('Google service account not configured')

  const now = Math.floor(Date.now() / 1000)
  const claim = {
    iss:   email,
    scope: 'https://www.googleapis.com/auth/business.manage',
    aud:   'https://oauth2.googleapis.com/token',
    iat:   now,
    exp:   now + 3600,
  }

  const b64url = (input) =>
    Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

  const header  = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = b64url(JSON.stringify(claim))
  const toSign  = `${header}.${payload}`

  const signer = createSign('RSA-SHA256')
  signer.update(toSign)
  signer.end()
  const signature = signer.sign(key)
  const sig = signature.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const jwt = `${toSign}.${sig}`

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
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(post),
  })
  const data = await r.json()
  if (!r.ok) throw new Error(data.error?.message || `GBP post failed for ${locationId}`)
  return { locationId, name: data.name }
}

export function buildPost(content, mediaUrls = [], bookingUrl) {
  const post = {
    languageCode: 'en-US',
    summary: content,
    topicType: 'STANDARD',
    callToAction: {
      actionType: 'BOOK',
      url: bookingUrl,
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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const scope = await workspaceScope(req)
  const workspaceId = scope?.workspace?.id
  const cred = await getCredential(workspaceId, 'gbp')
  const accountId = cred?.config?.account_id
  const allLocationIds = Array.isArray(cred?.config?.location_ids) ? cred.config.location_ids : []

  if (!cred?.secret || !accountId || !allLocationIds.length) {
    return res.status(503).json({
      error: `Google Business Profile is not configured for this workspace${scope?.workspace?.slug ? ` (${scope.workspace.slug})` : ''}. Add a service account, account_id, and location_ids in Workspace Settings → Publishing credentials.`,
    })
  }

  const reqBody = (typeof req.body === 'object' && req.body) ? req.body : {}
  const { content, mediaUrls = [], locationIds } = reqBody
  if (!content) return res.status(400).json({ error: 'Missing content' })

  // Use requested locationIds if provided, otherwise post to all configured locations
  const targets = (locationIds?.length ? locationIds : allLocationIds)
    .filter((id) => allLocationIds.includes(id)) // only allow configured locations

  if (!targets.length) return res.status(400).json({ error: 'No valid location IDs specified' })

  let token
  try { token = await getGoogleToken(cred) }
  catch (e) { return res.status(503).json({ error: `Google auth failed: ${e.message}` }) }

  // Resolve booking URL from workspace row when on a shared deployment, so
  // each subdomain's GBP CTA points at the correct clinic.
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

  if (!succeeded.length) {
    return res.status(502).json({ error: `All GBP posts failed: ${failed.map((f) => f.error).join('; ')}` })
  }

  // postId surfaces in publish.js as result.direct?.postId — comma-join the
  // localPost names so multi-location publishes still get tracked.
  const postId = succeeded.map((s) => s.name).filter(Boolean).join(',')
  return res.status(200).json({ success: true, postId, posted: succeeded, failed })
}

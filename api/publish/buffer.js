import { withSentry } from '../_lib/sentry.js'
export const config = { runtime: 'nodejs' }
// Buffer publish endpoint — Node.js runtime.
//
// Uses Buffer's GraphQL API (api.buffer.com/graphql) with a Personal Key or
// App Client token as Bearer auth. The old v1 REST API (api.bufferapp.com/1)
// only accepts classic OAuth tokens which are no longer issued.
//
// Resolves the Buffer access token per-workspace via getCredential() so each
// tenant brings its own token.
//
// GBP: channel IDs come from workspace_locations.gbp_location_id (Buffer
// channel IDs). Other platforms: channels are queried from the GraphQL API
// and matched by service name.

import { getCredential } from '../_lib/getCredential.js'
import { workspaceScope } from '../_lib/workspaceScope.js'

const BUFFER_GQL = 'https://api.buffer.com/graphql'
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// Map our runtime platform IDs → Buffer service strings.
// Service strings match Buffer's GraphQL Service enum exactly.
const PLATFORM_TO_SERVICE = {
  instagram:     'instagram',
  facebook:      'facebook',
  linkedin:      'linkedin',
  pinterest:     'pinterest',
  twitter:       'twitter',
  tiktok:        'tiktok',
  threads:       'threads',
  youtube_short: 'youtube',
  bluesky:       'bluesky',
  mastodon:      'mastodon',
  gbp:           'googlebusiness',
}

async function gql(token, query, variables = {}) {
  const r = await fetch(BUFFER_GQL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  })
  const json = await r.json().catch(() => ({}))
  return { ok: r.ok, status: r.status, data: json.data, errors: json.errors }
}

async function resolveGbpChannelIds(workspaceId, locationIds) {
  if (!SUPABASE_URL || !SUPABASE_KEY || !workspaceId) return []
  const params = new URLSearchParams({
    workspace_id: `eq.${workspaceId}`,
    status: 'eq.active',
    select: 'id,gbp_location_id',
  })
  if (Array.isArray(locationIds) && locationIds.length > 0) {
    params.set('id', `in.(${locationIds.map((id) => `"${id}"`).join(',')})`)
  }
  const r = await fetch(`${SUPABASE_URL}/rest/v1/workspace_locations?${params.toString()}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  })
  if (!r.ok) return []
  const rows = await r.json().catch(() => [])
  return (Array.isArray(rows) ? rows : [])
    .map((row) => row.gbp_location_id)
    .filter((s) => typeof s === 'string' && s.trim().length > 0)
}

function buildAssets(mediaUrls) {
  return mediaUrls.map((m) => {
    if (m.type?.startsWith('video')) {
      return { video: { url: m.url, ...(m.thumbnail ? { thumbnailUrl: m.thumbnail } : {}) } }
    }
    return { image: { url: m.url } }
  })
}

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const scope = await workspaceScope(req)
  const workspaceId = scope?.workspace?.id
  const cred = await getCredential(workspaceId, 'buffer')
  if (!cred?.secret) {
    return res.status(503).json({
      error: `Buffer is not configured for this workspace${scope?.workspace?.slug ? ` (${scope.workspace.slug})` : ''}. Add a Buffer access token in Workspace Settings → Publishing credentials.`,
    })
  }
  const BUFFER_TOKEN = cred.secret

  const body = (typeof req.body === 'object' && req.body) ? req.body : {}
  const { platform, content, mediaUrls = [], scheduledAt, locationIds } = body
  if (!platform || !content) return res.status(400).json({ error: 'Missing platform or content' })

  const service = PLATFORM_TO_SERVICE[platform]
  if (!service) return res.status(400).json({ error: `Unsupported Buffer platform: ${platform}` })

  // 1. Resolve target Buffer channel IDs.
  //    GBP: stored per-location in workspace_locations.gbp_location_id.
  //    Everything else: query the API and match by service name.
  let channelIds = []
  if (platform === 'gbp') {
    channelIds = await resolveGbpChannelIds(workspaceId, locationIds)
    if (channelIds.length === 0) {
      return res.status(404).json({
        error: 'No Buffer GBP channel configured for the selected location(s). Open Workspace Settings → Locations and paste the Buffer GBP channel ID for each listing.',
      })
    }
  } else {
    const result = await gql(BUFFER_TOKEN, '{ channels { id service isDisconnected } }')
    if (!result.ok || result.errors) {
      const errMsg = result.errors?.[0]?.message || `Buffer channels query returned ${result.status}`
      const hint = result.status === 401 || result.status === 403
        ? 'Buffer access token rejected (401/403). Regenerate the token in Workspace Settings → Publishing credentials.'
        : errMsg
      console.error('[publish/buffer] channels query failed', result.status, JSON.stringify(result.errors))
      return res.status(502).json({ error: hint })
    }
    const channels = result.data?.channels ?? []
    const match = channels.find((c) => c.service === service && !c.isDisconnected)
    if (!match) {
      return res.status(404).json({ error: `No connected Buffer channel found for ${platform}. Connect it at buffer.com.` })
    }
    channelIds = [match.id]
  }

  // 2. Build post payload.
  //    scheduledAt → customScheduled + dueAt; otherwise shareNow.
  const mode = scheduledAt ? 'customScheduled' : 'shareNow'
  const assets = buildAssets(mediaUrls)

  // 3. Create one post per channel (fan-out for GBP multi-location).
  const posts = []
  for (const channelId of channelIds) {
    const input = {
      channelId,
      text: content,
      schedulingType: 'automatic',
      mode,
      assets,
      ...(scheduledAt ? { dueAt: new Date(scheduledAt).toISOString() } : {}),
    }
    const r = await gql(BUFFER_TOKEN, `
      mutation CreatePost($input: CreatePostInput!) {
        createPost(input: $input) {
          post { id status dueAt sentAt sharedNow }
        }
      }
    `, { input })
    if (r.errors) {
      console.error('[publish/buffer] createPost error', JSON.stringify(r.errors))
      return res.status(502).json({ error: r.errors[0]?.message || 'Buffer post failed' })
    }
    posts.push(r.data?.createPost?.post)
  }

  const first = posts[0]
  return res.status(200).json({
    success: true,
    bufferId: first?.id,
    scheduledAt: first?.dueAt,
    status: first?.status,
    profileCount: channelIds.length,
  })
}

export default withSentry(handler)

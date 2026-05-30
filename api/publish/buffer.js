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
import { requireRole } from '../_lib/auth.js'
import { prepareMediaForBuffer } from '../_lib/prepareMediaForBuffer.js'

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
  youtube:       'youtube',   // long-form landscape video → same Buffer YouTube channel
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

// Returns { id: workspace_locations.id, channelId: gbp_location_id } pairs
// so the fan-out loop can look up per-location content overrides by UUID.
async function resolveGbpChannelIds(workspaceId, locationIds) {
  if (!SUPABASE_URL || !SUPABASE_KEY || !workspaceId) return []
  const params = new URLSearchParams({
    workspace_id: `eq.${workspaceId}`,
    status: 'eq.active',
    gbp_location_id: 'not.is.null',
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
    .filter((row) => typeof row.gbp_location_id === 'string' && row.gbp_location_id.trim())
    .map((row) => ({ id: row.id, channelId: row.gbp_location_id }))
}

function buildAssets(mediaUrls) {
  return mediaUrls.map((m) => {
    if (m.type?.startsWith('video')) {
      return { video: { url: m.url, ...(m.thumbnail ? { thumbnailUrl: m.thumbnail } : {}) } }
    }
    return { image: { url: m.url } }
  })
}

// Some Buffer services require `metadata.<service>.type`. Pick a sensible
// default based on the media payload. Returns null when no metadata is needed.
function buildMetadata(platform, mediaUrls, _content = '') {
  const imageCount = mediaUrls.filter((m) => !m.type?.startsWith('video')).length
  const videoCount = mediaUrls.filter((m) => m.type?.startsWith('video')).length
  if (platform === 'instagram') {
    // Buffer accepts only post | story | reel here. Multi-image carousels
    // are encoded as type: 'post' with multiple assets.
    const type = videoCount > 0 && imageCount === 0 ? 'reel' : 'post'
    return { instagram: { type, shouldShareToFeed: true } }
  }
  if (platform === 'facebook') {
    const type = videoCount > 0 && imageCount === 0 ? 'reel' : 'post'
    return { facebook: { type } }
  }
  if (platform === 'gbp') {
    // GoogleBusinessWhatsNewMetaDataInput only accepts { button, link } — both
    // optional. The post text itself is the summary; there is no `summary`
    // field on this input type. Pass an empty object so Buffer sees the
    // expected shape without injecting fields it doesn't know about.
    // Buffer requires button on whats-new posts at create time.
    // LEARN_MORE is the safest default (no link URL required).
    return { google: { type: 'whats_new', detailsWhatsNew: { button: 'learn_more' } } }
  }
  return null
}

async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const scope = await workspaceScope(req)
  const auth = await requireRole(req, null, { orgId: scope.workspace.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  const workspaceId = scope?.workspace?.id
  const cred = await getCredential(workspaceId, 'buffer')
  if (!cred?.secret) {
    return res.status(503).json({
      error: `Buffer is not configured for this workspace${scope?.workspace?.slug ? ` (${scope.workspace.slug})` : ''}. Add a Buffer access token in Workspace Settings → Publishing credentials.`,
    })
  }
  const BUFFER_TOKEN = cred.secret

  // DELETE — cancel a scheduled Buffer post.
  //
  // Body: { bufferUpdateId: string }. Calls Buffer's deletePost mutation,
  // which removes the post from the channel's queue. Returns 200 on success
  // or when Buffer reports the post is already gone (idempotent). Other
  // failures bubble up as 502 with the upstream message.
  if (req.method === 'DELETE') {
    const body = (typeof req.body === 'object' && req.body) ? req.body : {}
    const { bufferUpdateId } = body
    if (!bufferUpdateId || typeof bufferUpdateId !== 'string') {
      return res.status(400).json({ error: 'Missing bufferUpdateId' })
    }
    const r = await gql(BUFFER_TOKEN, `
      mutation DeletePost($input: DeletePostInput!) {
        deletePost(input: $input) {
          __typename
          ... on PostActionSuccess { post { id } }
          ... on NotFoundError { message }
          ... on UnauthorizedError { message }
          ... on UnexpectedError { message }
          ... on InvalidInputError { message }
        }
      }
    `, { input: { id: bufferUpdateId } })
    if (r.errors) {
      console.error('[publish/buffer DELETE] deletePost error', JSON.stringify(r.errors))
      return res.status(502).json({ error: r.errors[0]?.message || 'Buffer cancel failed' })
    }
    const payload = r.data?.deletePost
    if (payload && payload.__typename !== 'PostActionSuccess') {
      // Treat NotFoundError as success — post is already gone, which is what
      // the caller wants. Surface other typed errors as 502.
      if (payload.__typename === 'NotFoundError') {
        return res.status(200).json({ success: true, alreadyGone: true })
      }
      console.error('[publish/buffer DELETE] deletePost rejected', JSON.stringify(payload))
      return res.status(502).json({ error: payload.message || `Buffer cancel failed (${payload.__typename})` })
    }
    return res.status(200).json({ success: true })
  }

  const body = (typeof req.body === 'object' && req.body) ? req.body : {}
  // locationContents: { [workspace_locations.id]: string } — per-location body overrides.
  // Generated at draft time and stored in content_items.location_overrides.
  // Falls back to canonical `content` for any location without an override.
  const { platform, content, mediaUrls = [], scheduledAt, useQueue, locationIds, locationContents } = body
  if (!platform || !content) return res.status(400).json({ error: 'Missing platform or content' })

  const service = PLATFORM_TO_SERVICE[platform]
  if (!service) return res.status(400).json({ error: `Unsupported Buffer platform: ${platform}` })

  // 1. Resolve target Buffer channel IDs.
  //    GBP: stored per-location in workspace_locations.gbp_location_id.
  //    Everything else: query the API and match by service name.
  // gbpChannels: { id: workspace_locations.id, channelId: Buffer channel id }[]
  // channelIds: bare Buffer channel id strings for non-GBP platforms
  let gbpChannels = []
  let channelIds  = []
  if (platform === 'gbp') {
    gbpChannels = await resolveGbpChannelIds(workspaceId, locationIds)
    if (gbpChannels.length === 0) {
      return res.status(404).json({
        error: 'No Buffer GBP channel configured for the selected location(s). Open Workspace Settings → Locations and paste the Buffer GBP channel ID for each listing.',
      })
    }
  } else {
    // Buffer's channels query requires an organizationId. Fetch the account's
    // first organization and use that as the scope.
    const acct = await gql(BUFFER_TOKEN, '{ account { organizations { id } } }')
    if (!acct.ok || acct.errors) {
      const errMsg = acct.errors?.[0]?.message || `Buffer account query returned ${acct.status}`
      const hint = acct.status === 401 || acct.status === 403
        ? 'Buffer access token rejected (401/403). Regenerate the token in Workspace Settings → Publishing credentials.'
        : errMsg
      console.error('[publish/buffer] account query failed', acct.status, JSON.stringify(acct.errors))
      return res.status(502).json({ error: hint })
    }
    const organizationId = acct.data?.account?.organizations?.[0]?.id
    if (!organizationId) {
      return res.status(502).json({ error: 'Buffer account has no organizations associated with this token.' })
    }
    const result = await gql(
      BUFFER_TOKEN,
      'query Channels($input: ChannelsInput!) { channels(input: $input) { id service isDisconnected } }',
      { input: { organizationId } },
    )
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

  // 2. Build post payload. Mode resolution:
  //    - scheduledAt set → customScheduled + dueAt (specific time we computed)
  //    - useQueue truthy → shareNext (Buffer slots it into the next open queue
  //                       position for the channel; ignores scheduledAt)
  //    - otherwise      → shareNow (immediate publish)
  // scheduledAt + useQueue together: useQueue wins, scheduledAt is ignored.
  const mode = useQueue ? 'shareNext' : (scheduledAt ? 'customScheduled' : 'shareNow')
  const includeDueAt = mode === 'customScheduled'
  const preparedMedia = await prepareMediaForBuffer(mediaUrls)
  const assets = buildAssets(preparedMedia)
  const metadata = buildMetadata(platform, preparedMedia, content)

  // 3. Create one post per channel (fan-out for GBP multi-location).
  // GBP: iterate gbpChannels pairs so we can look up the per-location body override.
  // Other platforms: iterate bare channelIds (single entry).
  const fanOut = platform === 'gbp'
    ? gbpChannels.map(({ id, channelId }) => ({ id, channelId }))
    : channelIds.map((channelId) => ({ id: null, channelId }))
  const posts = []
  for (const { id: locationId, channelId } of fanOut) {
    const postText = (locationId && locationContents?.[locationId]) ? locationContents[locationId] : content
    const input = {
      channelId,
      text: postText,
      schedulingType: 'automatic',
      mode,
      assets,
      ...(metadata ? { metadata } : {}),
      ...(includeDueAt ? { dueAt: new Date(scheduledAt).toISOString() } : {}),
    }
    const r = await gql(BUFFER_TOKEN, `
      mutation CreatePost($input: CreatePostInput!) {
        createPost(input: $input) {
          __typename
          ... on PostActionSuccess {
            post { id status dueAt sentAt sharedNow }
          }
          ... on NotFoundError { message }
          ... on UnauthorizedError { message }
          ... on UnexpectedError { message }
          ... on RestProxyError { message code link }
          ... on LimitReachedError { message }
          ... on InvalidInputError { message }
        }
      }
    `, { input })
    if (r.errors) {
      console.error('[publish/buffer] createPost error', JSON.stringify(r.errors))
      return res.status(502).json({ error: r.errors[0]?.message || 'Buffer post failed' })
    }
    const payload = r.data?.createPost
    if (payload && payload.__typename !== 'PostActionSuccess') {
      console.error('[publish/buffer] createPost rejected', JSON.stringify(payload))
      return res.status(502).json({ error: payload.message || `Buffer post failed (${payload.__typename})` })
    }
    posts.push(payload?.post)
  }

  const first = posts[0]
  return res.status(200).json({
    success: true,
    bufferId: first?.id,
    scheduledAt: first?.dueAt,
    status: first?.status,
    profileCount: fanOut.length,
  })
}

export default withSentry(handler)

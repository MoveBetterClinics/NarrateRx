// Buffer publish endpoint — Node.js runtime.
//
// Resolves the Buffer access token per-workspace via getCredential() so each
// tenant brings its own token. Falls back to BUFFER_ACCESS_TOKEN env var on
// legacy per-brand deployments (handled inside getCredential).

import { getCredential } from '../_lib/getCredential.js'
import { workspaceScope } from '../_lib/workspaceScope.js'

const BUFFER_API = 'https://api.bufferapp.com/1'

// Map our runtime platform IDs → Buffer service strings. Buffer routes the
// post to whichever profile in the workspace's Buffer org matches the service.
// Adding a new platform: append here, mirror in src/lib/publish.js
// BUFFER_PLATFORMS, and add a registry entry in src/lib/outputChannels.js.
//
// Service strings reflect Buffer's API (https://buffer.com/developers/api).
// Facebook moved here 2026-05-10 — retired direct Meta Graph publishing to
// skip Meta App Review + Page-token rotation. GBP is intentionally NOT in
// this map: it stays on /api/publish/gbp because the workspace_locations /
// gbp_location_id multi-location architecture has no Buffer equivalent.
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
}

export default async function handler(req, res) {
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
  const { platform, content, mediaUrls = [], scheduledAt } = body
  if (!platform || !content) return res.status(400).json({ error: 'Missing platform or content' })

  const service = PLATFORM_TO_SERVICE[platform]
  if (!service) return res.status(400).json({ error: `Unsupported Buffer platform: ${platform}` })

  // 1. Get profiles to find the right profile ID
  const profilesRes = await fetch(`${BUFFER_API}/profiles.json?access_token=${BUFFER_TOKEN}`)
  if (!profilesRes.ok) return res.status(502).json({ error: 'Failed to fetch Buffer profiles' })
  const profiles = await profilesRes.json()

  const profile = profiles.find((p) => p.service === service)
  if (!profile) return res.status(404).json({ error: `No Buffer profile found for ${platform}. Connect it at buffer.com.` })

  // 2. Build the update payload
  const params = new URLSearchParams()
  params.append('access_token', BUFFER_TOKEN)
  params.append('profile_ids[]', profile.id)
  params.append('text', content)

  if (scheduledAt) {
    params.append('scheduled_at', new Date(scheduledAt).toISOString())
  } else {
    params.append('now', 'true')
  }

  // Attach first media item (Buffer supports one primary media per post)
  if (mediaUrls.length > 0) {
    const first = mediaUrls[0]
    if (first.type?.startsWith('video')) {
      params.append('media[video]', first.url)
    } else {
      params.append('media[photo]', first.url)
      params.append('media[link]',  first.url)
    }
  }

  // 3. Create the update
  const updateRes = await fetch(`${BUFFER_API}/updates/create.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })
  const update = await updateRes.json()

  if (!updateRes.ok || update.error) {
    return res.status(502).json({ error: update.error || 'Buffer post failed' })
  }

  return res.status(200).json({
    success: true,
    bufferId: update.updates?.[0]?.id,
    scheduledAt: update.updates?.[0]?.scheduled_at,
    status: update.updates?.[0]?.status,
  })
}

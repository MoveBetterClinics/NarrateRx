// Buffer publish endpoint — Node.js runtime.
//
// Resolves the Buffer access token per-workspace via getCredential() so each
// tenant brings its own token. Falls back to BUFFER_ACCESS_TOKEN env var on
// legacy per-brand deployments (handled inside getCredential).
//
// As of 2026-05-11 this endpoint handles every distribution surface,
// including Google Business Profile. GBP differs only in profile selection:
// instead of "first profile in the org with service=X", we resolve a list of
// Buffer GBP profile IDs from the workspace's workspace_locations rows so a
// single post can fan out across multiple physical locations.

import { getCredential } from '../_lib/getCredential.js'
import { workspaceScope } from '../_lib/workspaceScope.js'

const BUFFER_API = 'https://api.bufferapp.com/1'
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// Map our runtime platform IDs → Buffer service strings. Buffer routes the
// post to whichever profile in the workspace's Buffer org matches the service.
// Adding a new platform: append here, mirror in src/lib/publish.js
// BUFFER_PLATFORMS, and add a registry entry in src/lib/outputChannels.js.
//
// Service strings reflect Buffer's API (https://buffer.com/developers/api).
// Facebook moved here 2026-05-10. GBP moved here 2026-05-11 — every GBP
// listing is connected as a Buffer channel, identified per-location by
// workspace_locations.gbp_location_id (which now stores the Buffer profile ID,
// not the legacy `locations/<id>` Google ID).
//
// Note on 'googlebusiness': Buffer's public API docs don't enumerate every
// service string. This is the value Buffer uses internally and in their
// dashboard URLs for Google Business; if updates/create returns "Unsupported
// service", swap to 'google_business' or 'google' and re-test.
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

// Resolve workspace_locations rows → Buffer GBP profile IDs.
// `locationIds` is an array of workspace_locations row UUIDs from the picker,
// or null/empty for "all active locations". Returns the gbp_location_id values
// (Buffer profile IDs) for active rows that have one configured.
async function resolveGbpProfileIds(workspaceId, locationIds) {
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
  const { platform, content, mediaUrls = [], scheduledAt, locationIds } = body
  if (!platform || !content) return res.status(400).json({ error: 'Missing platform or content' })

  const service = PLATFORM_TO_SERVICE[platform]
  if (!service) return res.status(400).json({ error: `Unsupported Buffer platform: ${platform}` })

  // 1. Resolve the target Buffer profile IDs.
  //    GBP: pull from workspace_locations.gbp_location_id (one or many).
  //    Everything else: first profile in the workspace's Buffer org matching service.
  let profileIds = []
  if (platform === 'gbp') {
    profileIds = await resolveGbpProfileIds(workspaceId, locationIds)
    if (profileIds.length === 0) {
      return res.status(404).json({
        error: 'No Buffer GBP channel configured for the selected location(s). Open Workspace Settings → Locations and paste the Buffer GBP channel ID for each listing.',
      })
    }
  } else {
    const profilesRes = await fetch(`${BUFFER_API}/profiles.json?access_token=${BUFFER_TOKEN}`)
    if (!profilesRes.ok) return res.status(502).json({ error: 'Failed to fetch Buffer profiles' })
    const profiles = await profilesRes.json()
    const profile = profiles.find((p) => p.service === service)
    if (!profile) return res.status(404).json({ error: `No Buffer profile found for ${platform}. Connect it at buffer.com.` })
    profileIds = [profile.id]
  }

  // 2. Build the update payload
  const params = new URLSearchParams()
  params.append('access_token', BUFFER_TOKEN)
  for (const pid of profileIds) params.append('profile_ids[]', pid)
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
    profileCount: profileIds.length,
  })
}

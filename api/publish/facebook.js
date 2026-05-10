// Facebook Page publish endpoint — Node.js runtime.
//
// Resolves the page_id (config) and page access token (secret) per-workspace
// via getCredential('facebook'). Legacy env-var fallback in getCredential keeps
// per-brand deployments working until decommissioned.

import { getCredential } from '../_lib/getCredential.js'
import { workspaceScope } from '../_lib/workspaceScope.js'

const GRAPH = 'https://graph.facebook.com/v19.0'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const scope = await workspaceScope(req)
  const workspaceId = scope?.workspace?.id
  const cred = await getCredential(workspaceId, 'facebook')
  const PAGE_ID = cred?.config?.page_id
  const PAGE_TOKEN = cred?.secret
  if (!PAGE_ID || !PAGE_TOKEN) {
    return res.status(503).json({
      error: `Facebook is not configured for this workspace${scope?.workspace?.slug ? ` (${scope.workspace.slug})` : ''}. Add page_id + page token in Workspace Settings → Publishing credentials.`,
    })
  }

  const reqBody = (typeof req.body === 'object' && req.body) ? req.body : {}
  const { content, mediaUrls = [], scheduledAt } = reqBody
  if (!content) return res.status(400).json({ error: 'Missing content' })

  const body = { message: content, access_token: PAGE_TOKEN }

  // Scheduled posts require published=false + scheduled_publish_time (Unix timestamp)
  if (scheduledAt) {
    body.published = false
    body.scheduled_publish_time = Math.floor(new Date(scheduledAt).getTime() / 1000)
  }

  let endpoint = `${GRAPH}/${PAGE_ID}/feed`

  if (mediaUrls.length > 0) {
    const first = mediaUrls[0]
    if (first.type?.startsWith('video')) {
      // Video post
      endpoint = `${GRAPH}/${PAGE_ID}/videos`
      body.file_url = first.url
      body.description = content
      delete body.message
    } else {
      // Photo post
      endpoint = `${GRAPH}/${PAGE_ID}/photos`
      body.url = first.url
      body.caption = content
      delete body.message
    }
  }

  const postRes = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  const data = await postRes.json()
  if (!postRes.ok || data.error) {
    return res.status(502).json({ error: data.error?.message || 'Facebook post failed' })
  }

  return res.status(200).json({ success: true, postId: data.id || data.post_id })
}

// POST /api/editorial/render-segments
//
// Multi-clip video v1 (Phase 2). Turns kept proposed segments into rendered
// story packages. For each requested segment: create a story_packages row
// (status='generating'), link it back to the segment (status='rendered',
// story_package_id), and render the ≤60s clip window off the request path via
// the existing capped pipeline (ffmpeg -ss <start> -t <len>). The Slate polls
// story_packages until each flips complete/failed — identical to the
// generate-package flow.
//
// Body:
//   { segmentIds: string[] }   // 1..12 video_segments ids to render
//
// Auth: Clerk JWT + workspace org-id + video_pipeline_enabled.
//
// Responses:
//   202 { packages: [{ segmentId, packageId, status: 'generating' }], skipped: [...] }
//   400 / 401 / 403 / 404 / 500

export const config = { runtime: 'nodejs', maxDuration: 300 }

import { waitUntil } from '@vercel/functions'
import { requireRole } from '../_lib/auth.js'
import { ALL_KNOWN_ROLES } from '../_lib/roles.js'
import { workspaceContext } from '../_lib/workspaceContext.js'
import { renderAndPatchPackage } from '../_lib/renderPackageChannels.js'
import { generateCaption } from '../_lib/captionGen.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const DEFAULT_VIDEO_CHANNELS = ['linkedin_video', 'instagram_reel', 'blog_hero_video']

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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  const ws = await workspaceContext(req)
  if (!ws) return res.status(404).json({ error: 'no_workspace' })
  if (!ws.video_pipeline_enabled) {
    return res.status(403).json({ error: 'feature_disabled' })
  }

  const auth = await requireRole(req, ALL_KNOWN_ROLES, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  const body = req.body || {}
  const segmentIds = Array.isArray(body.segmentIds)
    ? [...new Set(body.segmentIds.map((s) => String(s)).filter(Boolean))]
    : []
  if (!segmentIds.length) return res.status(400).json({ error: 'segmentIds_required' })
  if (segmentIds.length > 12) return res.status(400).json({ error: 'too_many_segments', max: 12 })

  // Fetch the requested segments (workspace-scoped) + their source asset so we
  // have the blob url + filename + clinician for the render.
  const inList = segmentIds.map((id) => `"${id}"`).join(',')
  const segRes = await sb(
    `video_segments?id=in.(${inList})&workspace_id=eq.${ws.id}` +
      `&select=id,source_asset_id,staff_id,start_sec,end_sec,hook,transcript_excerpt,status,story_package_id,campaign_id,` +
      `source_asset:media_assets(id,kind,blob_url,filename,archived_at)`,
  )
  if (!segRes.ok) return res.status(500).json({ error: 'db_error' })
  const segments = await segRes.json()

  if (!segments.length) return res.status(404).json({ error: 'no_segments_found' })

  // Resolve clinician names once (best-effort) for lower-third overlays.
  const staffIds = [...new Set(segments.map((s) => s.staff_id).filter(Boolean))]
  const staffNames = {}
  if (staffIds.length) {
    const cIn = staffIds.map((id) => `"${id}"`).join(',')
    const cRes = await sb(`staff?id=in.(${cIn})&workspace_id=eq.${ws.id}&select=id,name`)
    if (cRes.ok) {
      for (const c of await cRes.json()) staffNames[c.id] = c.name
    }
  }

  const packages = []
  const skipped = []

  for (const seg of segments) {
    const asset = seg.source_asset
    // Skip invalid sources or segments already turned into a package.
    if (!asset || asset.kind !== 'video' || !asset.blob_url || asset.archived_at) {
      skipped.push({ segmentId: seg.id, reason: 'invalid_source' })
      continue
    }
    if (seg.story_package_id) {
      skipped.push({ segmentId: seg.id, reason: 'already_rendered', packageId: seg.story_package_id })
      continue
    }

    const startSec = Number(seg.start_sec) || 0
    const durationSec = Math.max(1, (Number(seg.end_sec) || 0) - startSec)
    const hook = String(seg.hook || '').slice(0, 500)
    const transcriptExcerpt = String(seg.transcript_excerpt || '').trim()
    // Placeholder caption seeded on insert; the real voice-faithful caption is
    // generated off the request path (below) from the segment's own transcript +
    // the clinician's voice phrases, then PATCHed before render. Using the hook
    // here means the Slate card never shows an empty caption while it generates.
    const captionText = hook
    const staffName = staffNames[seg.staff_id] || ''

    // Create the story package row (status='generating') so the Slate card
    // appears immediately with a spinner. topic = the segment hook.
    // campaign_id is threaded from the video_segments row (set by repurpose-video.js
    // when clips are part of a Repurpose campaign; null for standalone clip renders).
    const insRes = await sb('story_packages', {
      method: 'POST',
      body: JSON.stringify({
        workspace_id: ws.id,
        staff_id: seg.staff_id || null,
        source_asset_id: asset.id,
        topic: captionText || 'Clip',
        caption_text: captionText,
        similarity: null,
        channels: DEFAULT_VIDEO_CHANNELS,
        renders: [],
        status: 'generating',
        ...(seg.campaign_id ? { campaign_id: seg.campaign_id } : {}),
      }),
    })
    if (!insRes.ok) {
      const errText = await insRes.text().catch(() => '')
      console.error('[render-segments] package insert failed:', insRes.status, errText)
      skipped.push({ segmentId: seg.id, reason: 'db_insert_failed' })
      continue
    }
    const packageId = (await insRes.json())?.[0]?.id
    if (!packageId) {
      skipped.push({ segmentId: seg.id, reason: 'insert_no_id' })
      continue
    }

    // Link the segment to its package + mark rendered (workspace-scoped).
    await sb(`video_segments?id=eq.${seg.id}&workspace_id=eq.${ws.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'rendered', story_package_id: packageId }),
    }).catch(() => {})

    // Off the request path: (1) generate the voice-faithful caption from the
    // segment's OWN transcript + the clinician's voice phrases, (2) PATCH it onto
    // the row so the Slate shows it, (3) render the ≤60s window with that caption
    // burned in. Caption generation is best-effort — on any failure we keep the
    // hook so a clip never fails to render just because captioning hiccuped.
    waitUntil(
      (async () => {
        let finalCaption = hook
        try {
          const generated = await generateCaption({
            topic: hook || 'Clip',
            clip: {},
            workspace: ws,
            staffId: seg.staff_id || null,
            clipTranscript: transcriptExcerpt,
          })
          if (generated && generated.trim()) {
            finalCaption = generated.trim().slice(0, 500)
            await sb(`story_packages?id=eq.${packageId}&workspace_id=eq.${ws.id}`, {
              method: 'PATCH',
              body: JSON.stringify({ caption_text: finalCaption }),
            }).catch(() => {})
          }
        } catch (e) {
          console.error('[render-segments] caption gen failed, using hook:', e?.stack || e?.message)
        }
        return renderAndPatchPackage({
          workspace: ws,
          packageId,
          sourceUrl: asset.blob_url,
          sourceAssetId: asset.id,
          kind: 'video',
          channels: DEFAULT_VIDEO_CHANNELS,
          captionText: finalCaption,
          staffName,
          filename: asset.filename,
          topic: hook || finalCaption,
          staffId: seg.staff_id || null,
          startSec,
          durationSec,
        })
      })(),
    )

    packages.push({ segmentId: seg.id, packageId, status: 'generating' })
  }

  return res.status(202).json({ packages, skipped })
}

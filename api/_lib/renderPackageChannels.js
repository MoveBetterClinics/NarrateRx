// api/_lib/renderPackageChannels.js
//
// Shared render-and-patch step for story packages, extracted from
// generate-package.js + rerender-package.js so both render identically and —
// critically — can run OFF the request path.
//
// Rendering a package (download + per-channel ffmpeg + Whisper) takes seconds
// for a small clip but minutes for a large source once the downscale-on-ingest
// path (brandRenderVideo.js) kicks in. Holding the HTTP request open that long
// raced the 300s function ceiling AND the caller's short-lived Clerk token TTL
// — a re-render of a 562MB source surfaced "invalid-token" and never patched
// the row (found 2026-05-29 during the V-series smoke test). Both endpoints now
// validate synchronously, mark the row status='generating', then invoke this
// via waitUntil and return 202; the Slate polls the row until status flips to
// complete/failed.
//
// This function NEVER throws — any failure is captured onto the row's
// status='failed' + error_message so the Slate surfaces it cleanly. Safe in
// waitUntil: it talks to Supabase with the service key, so it needs no caller
// token.

import { put as blobPut } from '@vercel/blob'
import { renderPhotoChannel, CHANNEL_SPECS } from './brandRender.js'
import { renderVideoChannel, VIDEO_CHANNEL_SPECS } from './brandRenderVideo.js'
import { scoreCaptionFidelity } from './captionFidelity.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

function sb(path, init = {}) {
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

/**
 * Render every channel for a package, upload outputs to Blob, and patch the
 * story_packages row to complete/failed. Designed to run inside waitUntil.
 *
 * @param {Object}   p
 * @param {Object}   p.workspace     — workspace row (id, slug, display_name, brand…)
 * @param {string}   p.packageId     — story_packages row id
 * @param {string}   p.sourceUrl     — source media blob URL
 * @param {string}   p.sourceAssetId — source media_assets id (for the render path key)
 * @param {string}   p.kind          — 'video' | 'photo'
 * @param {string[]} p.channels      — channel keys to render
 * @param {string}   p.captionText   — caption to render + persist
 * @param {string}   p.clinicianName — lower-third name
 * @param {string}   [p.filename]    — source filename (for the render blob path)
 * @param {string}   [p.topic]       — for caption-fidelity scoring
 * @param {string}   [p.clinicianId] — for caption-fidelity scoring
 * @param {number}   [p.startSec]    — clip start offset (multi-clip v1; video only). Default 0.
 * @param {number}   [p.durationSec] — clip length, clamped to MAX_RENDER_SECONDS. Default full cap.
 * @returns {Promise<{finalStatus: string, renders: object[], errors: object[]}>}
 */
export async function renderAndPatchPackage({
  workspace, packageId, sourceUrl, sourceAssetId, kind,
  channels, captionText, clinicianName, filename, topic, clinicianId,
  startSec, durationSec,
}) {
  const ws = workspace
  const isVideo = kind === 'video'
  const safeFilename = (filename || 'render')
    .replace(/[^\w.-]/g, '_')
    .replace(/\.\w+$/, '')

  const renders = []
  const errors = []

  try {
    for (const channel of channels) {
      try {
        if (isVideo) {
          if (!VIDEO_CHANNEL_SPECS[channel]) { errors.push({ channel, error: 'unknown_channel' }); continue }
          const { buffer, width, height, hadSubtitles } = await renderVideoChannel({
            videoUrl: sourceUrl, channel, captionText, workspace: ws, clinicianName,
            startSec, durationSec,
          })
          // Key by packageId, not just sourceAssetId — multi-clip v1 renders
          // several packages (segments) from ONE source asset; keying by source
          // alone would make every segment's render clobber the previous one.
          const pathname = `media/renders/${ws.slug}/${sourceAssetId}/${packageId}/${channel}-${safeFilename}.mp4`
          const blob = await blobPut(pathname, buffer, {
            access: 'public', contentType: 'video/mp4', addRandomSuffix: false, allowOverwrite: true,
          })
          renders.push({ channel, blobUrl: blob.url, width, height, sizeBytes: buffer.length, hadSubtitles })
        } else {
          if (!CHANNEL_SPECS[channel]) { errors.push({ channel, error: 'unknown_channel' }); continue }
          const { buffer, width, height } = await renderPhotoChannel({
            photoUrl: sourceUrl, channel, captionText, workspace: ws, clinicianName,
          })
          const pathname = `media/renders/${ws.slug}/${sourceAssetId}/${packageId}/${channel}-${safeFilename}.jpg`
          const blob = await blobPut(pathname, buffer, {
            access: 'public', contentType: 'image/jpeg', addRandomSuffix: false, allowOverwrite: true,
          })
          renders.push({ channel, blobUrl: blob.url, width, height, sizeBytes: buffer.length })
        }
      } catch (e) {
        console.error(`[renderPackageChannels] channel ${channel} failed:`, e?.stack || e?.message || e)
        errors.push({ channel, error: e?.message || 'unknown' })
      }
    }

    const finalStatus = renders.length > 0 ? 'complete' : 'failed'
    const errorMessage = errors.length ? errors.map((e) => `${e.channel}: ${e.error}`).join('; ') : null

    const patchRes = await sb(`story_packages?id=eq.${packageId}&workspace_id=eq.${ws.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        caption_text:  captionText,
        renders,
        status:        finalStatus,
        error_message: errorMessage,
        updated_at:    new Date().toISOString(),
      }),
    })
    if (!patchRes.ok) {
      const text = await patchRes.text().catch(() => '')
      console.error('[renderPackageChannels] patch failed:', patchRes.status, text)
    }

    // Background voice-fidelity scoring once renders + caption are settled.
    if (finalStatus === 'complete') {
      await scoreCaptionFidelity({
        packageId,
        workspaceId:   ws.id,
        workspaceName: ws.display_name,
        clinicianId:   clinicianId || null,
        topic:         topic || '',
        captionText,
      }).catch((e) => console.error('[renderPackageChannels] caption fidelity scoring failed:', e?.message || e))
    }

    return { finalStatus, renders, errors }
  } catch (e) {
    // Defensive: never let the background task reject unhandled. Mark the row
    // failed so the Slate shows an actionable error instead of spinning forever.
    console.error('[renderPackageChannels] fatal:', e?.stack || e?.message || e)
    await sb(`story_packages?id=eq.${packageId}&workspace_id=eq.${ws.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: 'failed',
        error_message: `render crashed: ${e?.message || 'unknown'}`,
        updated_at: new Date().toISOString(),
      }),
    }).catch(() => {})
    return { finalStatus: 'failed', renders, errors }
  }
}

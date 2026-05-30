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
import { cancelableStatusFilter } from './packageStatus.js'

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
 * A video render's output is fully determined by the geometry fields of its
 * channel spec: target dimensions, fit mode, and caption-band position drive
 * both the ffmpeg scale/pad filter and the brand-overlay SVG. Two channels with
 * the same signature produce byte-identical MP4s for the same source + caption,
 * so they can share one render. Used to dedupe the keep-whole long-form lane's
 * three identical landscape channels (and a no-op for the distinct clip specs).
 */
function videoRenderSignature(channel) {
  const s = VIDEO_CHANNEL_SPECS[channel] || {}
  return JSON.stringify({ w: s.width, h: s.height, captionPos: s.captionPos, fit: s.fit || 'cover' })
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
 * @param {string}   p.staffName — lower-third name
 * @param {string}   [p.filename]    — source filename (for the render blob path)
 * @param {string}   [p.topic]       — for caption-fidelity scoring
 * @param {string}   [p.staffId] — for caption-fidelity scoring
 * @param {number}   [p.startSec]    — clip start offset (multi-clip v1; video only). Default 0.
 * @param {number}   [p.durationSec] — clip length, clamped to MAX_RENDER_SECONDS. Default full cap.
 * @returns {Promise<{finalStatus: string, renders: object[], errors: object[]}>}
 */
export async function renderAndPatchPackage({
  workspace, packageId, sourceUrl, sourceAssetId, kind,
  channels, captionText, staffName, filename, topic, staffId,
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
    if (isVideo) {
      // Group channels by render signature so identical specs render ONCE.
      // The keep-whole long-form lane targets three landscape channels
      // (youtube / linkedin_native / website_embed) that share an identical
      // spec — same dimensions, fit, caption position — so they produce
      // byte-identical MP4s. Rendering each separately tripled the ffmpeg +
      // Whisper cost (and, for a long source, blew the 300s budget). We now
      // render+upload one master per unique signature and fan its blob URL out
      // to every channel in the group. Channels with distinct specs (the clip
      // lane: 1:1 / 9:16 / 16:9) fall into separate groups and still render
      // independently — the grouping is a no-op for them.
      const groups = new Map()
      for (const channel of channels) {
        if (!VIDEO_CHANNEL_SPECS[channel]) { errors.push({ channel, error: 'unknown_channel' }); continue }
        const sig = videoRenderSignature(channel)
        if (!groups.has(sig)) groups.set(sig, [])
        groups.get(sig).push(channel)
      }

      for (const groupChannels of groups.values()) {
        // Deterministic representative channel (sorted) so the blob path is
        // stable across re-renders (allowOverwrite keeps it idempotent).
        const repChannel = [...groupChannels].sort()[0]
        try {
          const { buffer, width, height, hadSubtitles } = await renderVideoChannel({
            videoUrl: sourceUrl, channel: repChannel, captionText, workspace: ws, staffName,
            startSec, durationSec,
          })
          // Key by packageId, not just sourceAssetId — multi-clip v1 renders
          // several packages (segments) from ONE source asset; keying by source
          // alone would make every segment's render clobber the previous one.
          const pathname = `media/renders/${ws.slug}/${sourceAssetId}/${packageId}/${repChannel}-${safeFilename}.mp4`
          const blob = await blobPut(pathname, buffer, {
            access: 'public', contentType: 'video/mp4', addRandomSuffix: false, allowOverwrite: true,
          })
          // Fan the single master out to every channel in the signature group.
          for (const channel of groupChannels) {
            renders.push({ channel, blobUrl: blob.url, width, height, sizeBytes: buffer.length, hadSubtitles })
          }
        } catch (e) {
          console.error(`[renderPackageChannels] group [${groupChannels.join(',')}] failed:`, e?.stack || e?.message || e)
          for (const channel of groupChannels) errors.push({ channel, error: e?.message || 'unknown' })
        }
      }
    } else {
      for (const channel of channels) {
        try {
          if (!CHANNEL_SPECS[channel]) { errors.push({ channel, error: 'unknown_channel' }); continue }
          const { buffer, width, height } = await renderPhotoChannel({
            photoUrl: sourceUrl, channel, captionText, workspace: ws, staffName,
          })
          const pathname = `media/renders/${ws.slug}/${sourceAssetId}/${packageId}/${channel}-${safeFilename}.jpg`
          const blob = await blobPut(pathname, buffer, {
            access: 'public', contentType: 'image/jpeg', addRandomSuffix: false, allowOverwrite: true,
          })
          renders.push({ channel, blobUrl: blob.url, width, height, sizeBytes: buffer.length })
        } catch (e) {
          console.error(`[renderPackageChannels] channel ${channel} failed:`, e?.stack || e?.message || e)
          errors.push({ channel, error: e?.message || 'unknown' })
        }
      }
    }

    const finalStatus = renders.length > 0 ? 'complete' : 'failed'
    const errorMessage = errors.length ? errors.map((e) => `${e.channel}: ${e.error}`).join('; ') : null

    // Guard the terminal write against a cooperative cancel. The producer may
    // have hit "Stop" (packages/[id].js → status='canceled') while this render
    // ran; the &status=in.(...) filter means a canceled row matches zero rows,
    // so a late finish can't resurrect the card to complete/failed. The status
    // list lives in _lib/packageStatus.js.
    const patchRes = await sb(
      `story_packages?id=eq.${packageId}&workspace_id=eq.${ws.id}` +
        `&${cancelableStatusFilter()}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          caption_text:  captionText,
          renders,
          status:        finalStatus,
          error_message: errorMessage,
          updated_at:    new Date().toISOString(),
        }),
      },
    )
    if (!patchRes.ok) {
      const text = await patchRes.text().catch(() => '')
      console.error('[renderPackageChannels] patch failed:', patchRes.status, text)
    }
    // Zero rows updated = the package was canceled mid-render. Discard the
    // output silently — don't score, don't resurrect the card.
    const patched = patchRes.ok ? await patchRes.json().catch(() => []) : []
    if (!patched.length) {
      console.info(`[renderPackageChannels] package ${packageId} canceled mid-render — output discarded`)
      return { finalStatus: 'canceled', renders, errors }
    }

    // Background voice-fidelity scoring once renders + caption are settled.
    if (finalStatus === 'complete') {
      await scoreCaptionFidelity({
        packageId,
        workspaceId:   ws.id,
        workspaceName: ws.display_name,
        staffId:   staffId || null,
        topic:         topic || '',
        captionText,
      }).catch((e) => console.error('[renderPackageChannels] caption fidelity scoring failed:', e?.message || e))
    }

    return { finalStatus, renders, errors }
  } catch (e) {
    // Defensive: never let the background task reject unhandled. Mark the row
    // failed so the Slate shows an actionable error instead of spinning forever.
    console.error('[renderPackageChannels] fatal:', e?.stack || e?.message || e)
    // Same cancel guard as the success path — don't flip a canceled card to failed.
    await sb(
      `story_packages?id=eq.${packageId}&workspace_id=eq.${ws.id}` +
        `&${cancelableStatusFilter()}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'failed',
          error_message: `render crashed: ${e?.message || 'unknown'}`,
          updated_at: new Date().toISOString(),
        }),
      },
    ).catch(() => {})
    return { finalStatus: 'failed', renders, errors }
  }
}

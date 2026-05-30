// api/_lib/longformEngine.js
//
// The chunked keep-whole long-form render engine. ONE invocation = ONE "pass":
// render as many pending pieces as fit in the time budget, then hand off to a
// FRESH function instance (via the worker endpoint) to continue — or, when all
// pieces are done, glue them into the master and complete the package.
//
// Why hand off instead of looping forever: each piece renders well inside the
// 300s function ceiling, but a 30–60 min talk needs many pieces. Rather than
// risk one long invocation hitting the wall (which would strand the job — a
// killed function runs no finally/catch), each pass does a bounded chunk of
// work and re-invokes a clean instance with a fresh 300s budget. A cron
// safety-net (api/cron/resume-longform-renders.js) resumes any chain whose
// hand-off was dropped.
//
// Cooperative cancel: the parent story_packages.status stays 'generating' for
// the whole job. The producer's "Stop" flips it to 'canceled'; this engine
// re-checks status before every piece and before stitching, and every terminal
// PATCH is guarded by cancelableStatusFilter() — so a canceled job stops between
// pieces and a late finish can't resurrect the card. No new status value needed.
//
// Idempotent under concurrency (chain + cron): pieces are claimed optimistically
// (PATCH ?status=eq.pending → 0 rows = already claimed), and a stale 'rendering'
// piece (dead worker) is reclaimed to 'pending' after STALE_RENDERING_MS.

import { put as blobPut } from '@vercel/blob'
import { workspaceById } from './workspaceContext.js'
import { renderVideoChannel } from './brandRenderVideo.js'
import { stitchLongform } from './stitchLongform.js'
import { scoreCaptionFidelity } from './captionFidelity.js'
import { cancelableStatusFilter } from './packageStatus.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// Fallback render channel if a package somehow has no channels stored. The
// engine normally renders ONE master per piece at the package's first channel
// (all keep-whole landscape channels share an identical spec) and fans the
// finished master to every channel in pkg.channels at the complete step.
const FALLBACK_CHANNEL = 'youtube'

// Stop claiming NEW pieces once this much of the 300s budget is spent. The check
// is BEFORE claiming, so the in-flight piece can still run after it; sized so
// claim-time + a heavy piece (~200s for a 4K 90s window) stays under the 300s
// function ceiling. For light 1080p sources several pieces render per pass.
const PASS_BUDGET_MS = 150_000
// A piece that fails this many times (transient download / ffmpeg hiccup) is
// marked terminally failed, which fails the whole package.
const MAX_CHUNK_ATTEMPTS = 3
// A 'rendering' piece older than this is assumed orphaned by a dead worker and
// reclaimed to 'pending'. Safe because the 300s function ceiling means NO live
// worker can hold a piece 'rendering' for more than ~5 min — if it's older than
// that, the worker that claimed it is already dead. 6 min gives a 1-min margin
// so we never reclaim a piece a still-running function is actively rendering.
const STALE_RENDERING_MS = 6 * 60 * 1000

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

async function getJson(res) {
  if (!res.ok) return null
  return res.json().catch(() => null)
}

// Fire a continuation to a fresh worker instance. The worker schedules its own
// pass via waitUntil and returns 202 fast, so this await resolves quickly and
// the current (ending) invocation hands the baton cleanly.
async function postWorker(baseUrl, packageId) {
  if (!baseUrl || !process.env.CRON_SECRET) return
  try {
    await fetch(`${baseUrl}/api/editorial/render-longform-worker`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${process.env.CRON_SECRET}`,
      },
      body: JSON.stringify({ packageId }),
    })
  } catch (e) {
    console.error('[longformEngine] continuation post failed:', e?.message || e)
  }
}

// Guarded terminal write — only lands while the package is still in flight, so a
// canceled card is never resurrected. Returns true if it actually updated a row
// (false = the row no longer matches the guard, i.e. it was canceled/settled).
// Retries on a transient non-2xx so a brief DB blip can't strand the package in
// 'generating' forever (the cron net only resumes packages with pending/rendering
// pieces, so a failed terminal write on an all-done job would otherwise hang).
async function patchPackageTerminal(packageId, workspaceId, body) {
  const payload = JSON.stringify({ ...body, updated_at: new Date().toISOString() })
  const path = `story_packages?id=eq.${packageId}&workspace_id=eq.${workspaceId}&${cancelableStatusFilter()}`
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await sb(path, { method: 'PATCH', body: payload })
    if (res.ok) {
      const rows = await res.json().catch(() => null)
      return Array.isArray(rows) && rows.length > 0
    }
    await new Promise((r) => setTimeout(r, 300 * (attempt + 1)))
  }
  console.error(`[longformEngine] terminal PATCH failed after retries for ${packageId}`)
  return false
}

async function packageStatus(packageId, workspaceId) {
  const rows = await getJson(await sb(
    `story_packages?id=eq.${packageId}&workspace_id=eq.${workspaceId}&select=status&limit=1`,
  ))
  return rows?.[0]?.status || null
}

/**
 * Run one bounded pass of the chunked render for a package. Self-contained
 * given just the packageId — loads workspace, source, caption, and pieces from
 * the DB — so it's callable identically from render-longform (first kick), the
 * worker endpoint (continuation), and the cron safety-net.
 *
 * @param {Object} p
 * @param {string} p.packageId
 * @param {string} [p.baseUrl]  — origin for the self-continuation POST (e.g. https://slug.narraterx.ai)
 */
export async function runChunkPass({ packageId, baseUrl }) {
  const startedAt = Date.now()

  // ── 1. Load the package; bail if it's no longer in flight ────────────────
  const pkgRows = await getJson(await sb(
    `story_packages?id=eq.${packageId}` +
      `&select=id,workspace_id,staff_id,source_asset_id,topic,caption_text,channels,status&limit=1`,
  ))
  const pkg = pkgRows?.[0]
  if (!pkg) { console.error(`[longformEngine] package ${packageId} not found`); return }
  if (pkg.status !== 'generating') return  // canceled or already settled

  // The keep-whole landscape channels for this package (all share one spec).
  const channels = Array.isArray(pkg.channels) && pkg.channels.length ? pkg.channels : [FALLBACK_CHANNEL]
  const renderChannel = channels[0]

  const ws = await workspaceById(pkg.workspace_id)
  if (!ws) {
    await patchPackageTerminal(packageId, pkg.workspace_id, {
      status: 'failed', error_message: 'workspace not found',
    })
    return
  }

  // ── 2. Load source asset (blob + filename) + staff name ──────────────────
  const asset = (await getJson(await sb(
    `media_assets?id=eq.${pkg.source_asset_id}&workspace_id=eq.${ws.id}&select=blob_url,filename&limit=1`,
  )))?.[0]
  if (!asset?.blob_url) {
    await patchPackageTerminal(packageId, ws.id, { status: 'failed', error_message: 'source missing' })
    return
  }
  let staffName = ''
  if (pkg.staff_id) {
    const s = (await getJson(await sb(
      `staff?id=eq.${pkg.staff_id}&workspace_id=eq.${ws.id}&select=name&limit=1`,
    )))?.[0]
    staffName = s?.name || ''
  }

  // ── 3. Reclaim stale 'rendering' pieces (dead worker) → 'pending' ─────────
  const staleBefore = new Date(Date.now() - STALE_RENDERING_MS).toISOString()
  await sb(
    `story_package_chunks?package_id=eq.${packageId}&workspace_id=eq.${ws.id}` +
      `&status=eq.rendering&updated_at=lt.${staleBefore}`,
    { method: 'PATCH', body: JSON.stringify({ status: 'pending' }) },
  ).catch(() => {})

  // ── 4. Load all pieces ───────────────────────────────────────────────────
  const chunks = await getJson(await sb(
    `story_package_chunks?package_id=eq.${packageId}&workspace_id=eq.${ws.id}` +
      `&order=idx.asc&select=id,idx,start_sec,dur_sec,status,attempts,blob_url,width,height,had_subtitles`,
  )) || []
  if (!chunks.length) {
    await patchPackageTerminal(packageId, ws.id, { status: 'failed', error_message: 'no chunks planned' })
    return
  }

  // ── 5. Any terminally-failed piece fails the whole package ───────────────
  if (chunks.some((c) => c.status === 'failed')) {
    const failed = chunks.filter((c) => c.status === 'failed').map((c) => `#${c.idx}`).join(', ')
    await patchPackageTerminal(packageId, ws.id, {
      status: 'failed', error_message: `render failed on piece(s) ${failed}`,
    })
    return
  }

  // ── 6. All pieces done → glue + complete ─────────────────────────────────
  if (chunks.every((c) => c.status === 'done')) {
    // Re-read FRESH status (the cached pkg is stale by now) before the heavy
    // stitch. This both honors a concurrent cancel and shrinks the window where
    // a cron-injected pass could race the chain into a duplicate stitch. Note:
    // the complete-PATCH is guarded regardless, so a duplicate stitch can only
    // waste work — it can never double-complete or corrupt the row. And the
    // cron only resumes packages with stalled pending/rendering pieces, so it
    // can't even fire once every piece is 'done'; the residual race is a
    // sub-second alignment and harmless.
    if (await packageStatus(packageId, ws.id) !== 'generating') return
    try {
      const master = await stitchLongform({
        workspace: ws, packageId, sourceAssetId: pkg.source_asset_id,
        filename: asset.filename, chunks,
      })
      const hadSubtitles = chunks.some((c) => c.had_subtitles)
      const renders = channels.map((channel) => ({
        channel, blobUrl: master.url, width: master.width, height: master.height,
        sizeBytes: master.sizeBytes, hadSubtitles,
      }))
      const landed = await patchPackageTerminal(packageId, ws.id, {
        caption_text: pkg.caption_text, renders, status: 'complete', error_message: null,
      })
      if (!landed) {
        console.info(`[longformEngine] package ${packageId} canceled mid-stitch — master discarded`)
        return
      }
      await scoreCaptionFidelity({
        packageId, workspaceId: ws.id, workspaceName: ws.display_name,
        staffId: pkg.staff_id || null, topic: pkg.topic || '', captionText: pkg.caption_text,
      }).catch((e) => console.error('[longformEngine] caption fidelity scoring failed:', e?.message || e))
    } catch (e) {
      console.error('[longformEngine] stitch failed:', e?.stack || e?.message || e)
      await patchPackageTerminal(packageId, ws.id, {
        status: 'failed', error_message: `stitch failed: ${e?.message || 'unknown'}`,
      })
    }
    return
  }

  // ── 7. Render pending pieces within the time budget ──────────────────────
  let didWork = 0
  while (Date.now() - startedAt < PASS_BUDGET_MS) {
    // Cancel check before each piece — Stop frees the producer immediately.
    if (await packageStatus(packageId, ws.id) !== 'generating') return

    const next = (await getJson(await sb(
      `story_package_chunks?package_id=eq.${packageId}&workspace_id=eq.${ws.id}` +
        `&status=eq.pending&order=idx.asc&limit=1` +
        `&select=id,idx,start_sec,dur_sec,attempts`,
    )))?.[0]
    if (!next) break  // nothing claimable right now

    // Optimistic claim: only succeeds if still pending. 0 rows = another worker
    // grabbed it; loop and try the next one.
    const claimed = await getJson(await sb(
      `story_package_chunks?id=eq.${next.id}&workspace_id=eq.${ws.id}&status=eq.pending`,
      { method: 'PATCH', body: JSON.stringify({ status: 'rendering', attempts: (next.attempts || 0) + 1 }) },
    ))
    if (!Array.isArray(claimed) || !claimed.length) continue

    try {
      const { buffer, width, height, hadSubtitles } = await renderVideoChannel({
        videoUrl: asset.blob_url, channel: renderChannel, captionText: pkg.caption_text,
        workspace: ws, staffName, startSec: next.start_sec, durationSec: next.dur_sec,
        subtitles: false,  // long-form default: captions off (PR4 toggle can re-enable)
      })
      const pathname = `media/renders/${ws.id}/${pkg.source_asset_id}/${packageId}/chunk-${String(next.idx).padStart(4, '0')}.mp4`
      const blob = await blobPut(pathname, buffer, {
        access: 'public', contentType: 'video/mp4', addRandomSuffix: false, allowOverwrite: true,
      })
      await sb(
        `story_package_chunks?id=eq.${next.id}&workspace_id=eq.${ws.id}&status=eq.rendering`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            status: 'done', blob_url: blob.url, width, height,
            size_bytes: buffer.length, had_subtitles: hadSubtitles, error: null,
          }),
        },
      )
      didWork += 1
    } catch (e) {
      const attempts = (next.attempts || 0) + 1
      const status = attempts >= MAX_CHUNK_ATTEMPTS ? 'failed' : 'pending'
      console.error(`[longformEngine] piece #${next.idx} render failed (attempt ${attempts}, → ${status}):`, e?.stack || e?.message || e)
      await sb(
        `story_package_chunks?id=eq.${next.id}&workspace_id=eq.${ws.id}`,
        { method: 'PATCH', body: JSON.stringify({ status, error: e?.message || 'unknown' }) },
      ).catch(() => {})
      didWork += 1
    }
  }

  // ── 8. Hand off to a fresh instance — to render more, or to stitch ───────
  // Re-read remaining work to decide whether to continue. We continue if there's
  // still claimable work, if everything is now done (next pass stitches), or if
  // we made progress this pass. We do NOT continue when the only remaining
  // pieces are in-flight 'rendering' owned by another worker — the cron net
  // resumes those if they stall, avoiding a busy-spin of empty passes.
  const after = await getJson(await sb(
    `story_package_chunks?package_id=eq.${packageId}&workspace_id=eq.${ws.id}&select=status`,
  )) || []
  const pendingLeft = after.filter((c) => c.status === 'pending').length
  const allDone = after.length > 0 && after.every((c) => c.status === 'done')

  if (allDone || pendingLeft > 0 || didWork > 0) {
    await postWorker(baseUrl, packageId)
  }
}

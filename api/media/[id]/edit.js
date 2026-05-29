import { spawn } from 'node:child_process'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { createReadStream, createWriteStream } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { put as blobPut, del as blobDel } from '@vercel/blob'
import ffmpegStaticPath from 'ffmpeg-static'
import sharp from 'sharp'

import { withSentry } from '../../_lib/sentry.js'
import { recordAudit, snapshot } from '../../_lib/audit.js'
import { requireRole } from '../../_lib/auth.js'
import { EDITOR_ROLES } from '../../_lib/roles.js'
import { workspaceScope } from '../../_lib/workspaceScope.js'
import { generateThumbnailFromPath } from '../../_lib/thumbnail.js'

// POST /api/media/:id/edit — Edit Media (rotate + crop).
//
// Two modes:
//   mode: 'variant'        — DEFAULT. Creates a new media_assets row with
//                            parent_id=<source>, writes a new blob, leaves the
//                            source untouched. The variant gets a
//                            variant_label ("9:16 Reel" etc.) and the
//                            transforms JSON.
//   mode: 'replace-master' — Only valid when the source itself has parent_id IS
//                            NULL (i.e. it IS a master). Overwrites the master
//                            blob in place and PATCHes width/height on the
//                            same row. Used for "fix the original" rotations
//                            of un-edited masters — no audit-meaningful reason
//                            to keep a wrong-oriented original around.
//
// Body:
//   { rotate: 0|90|180|270, crop: {x,y,w,h}|null, label: string|null,
//     mode: 'variant'|'replace-master' }
//
// Crop coordinates are in the FINAL (post-rotate) pixel space — the cropper
// UI lets the user rotate first, then drag the crop box on the rotated
// preview, so the box's x/y/w/h are already in the rotated frame.
//
// Runs on Node (Fluid Compute) — needs ffmpeg-static + @vercel/blob server.
// 300s ceiling covers worst-case video re-encode (~500MB clips).

// `memory` doubles as the /tmp size ceiling on Fluid Compute. Stream-copy
// rotation on a 176 MB clip was hitting ENOSPC at the trailer write — even
// after we removed the +faststart 3x peak, concurrent jobs sharing the same
// reused instance pushed /tmp over the default. 3009 MB is the Pro-plan max.
export const config = { runtime: 'nodejs', maxDuration: 300, memory: 3009 }

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const FFMPEG_BIN   = process.env.FFMPEG_PATH || ffmpegStaticPath || 'ffmpeg'

const VALID_ROTATIONS = new Set([0, 90, 180, 270])
const VALID_MODES     = new Set(['variant', 'replace-master'])

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

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_BIN, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    proc.stderr.on('data', (d) => { stderr += d.toString() })
    proc.on('error', (e) => reject(new Error(`ffmpeg spawn failed: ${e.code || e.message}`)))
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-400).trim()}`))
    })
  })
}

// ffmpeg's transpose filter only does 90° increments. Chain twice for 180°.
function transposeFilter(deg) {
  switch (deg) {
    case 90:  return ['transpose=1']                  // 90° clockwise
    case 180: return ['transpose=1', 'transpose=1']
    case 270: return ['transpose=2']                  // 90° counter-clockwise
    default:  return []
  }
}

// Crop must be even-pixel-aligned for libx264 (yuv420p subsampling). We round
// width/height down to the nearest even number and clamp coords to the frame.
function normalizeCrop(crop, frameW, frameH) {
  if (!crop) return null
  let { x, y, w, h } = crop
  x = Math.max(0, Math.round(Number(x)))
  y = Math.max(0, Math.round(Number(y)))
  w = Math.max(2, Math.round(Number(w)))
  h = Math.max(2, Math.round(Number(h)))
  w = w - (w % 2)
  h = h - (h % 2)
  if (x + w > frameW) w = (frameW - x) - ((frameW - x) % 2)
  if (y + h > frameH) h = (frameH - y) - ((frameH - y) % 2)
  if (w < 2 || h < 2) throw new Error('Crop region is empty or out of bounds')
  return { x, y, w, h }
}

// Source frame dimensions in the rotated coordinate system. If the rotation
// swaps width/height (90 or 270), return swapped dimensions.
function rotatedDims(srcW, srcH, deg) {
  return (deg === 90 || deg === 270) ? { w: srcH, h: srcW } : { w: srcW, h: srcH }
}

async function downloadToTmp(blobUrl, destPath) {
  const res = await fetch(blobUrl)
  if (!res.ok) throw new Error(`Source download failed: ${res.status}`)
  // Stream to disk — videos can be 500MB+ and arrayBuffer() OOMs the function.
  await pipeline(Readable.fromWeb(res.body), createWriteStream(destPath))
}

// ── Image edit (sharp) ───────────────────────────────────────────────────────

async function editImage({ inPath, outPath, rotate, crop, srcW, srcH, mimeType }) {
  let img = sharp(inPath, { failOn: 'none' })
  if (rotate) img = img.rotate(rotate)
  if (crop) {
    const rDims = rotatedDims(srcW, srcH, rotate)
    const c = normalizeCrop(crop, rDims.w, rDims.h)
    img = img.extract({ left: c.x, top: c.y, width: c.w, height: c.h })
  }
  // Preserve format. sharp auto-detects from the input pipeline; we just need
  // to make sure JPEG quality stays reasonable so the variant doesn't visibly
  // degrade vs the source.
  const isJpeg = /jpeg|jpg/i.test(mimeType || '')
  if (isJpeg) img = img.jpeg({ quality: 90, mozjpeg: true })
  // For PNG/WebP we let sharp use its default encoding settings.
  await img.toFile(outPath)
}

// ── Video edit (ffmpeg) ──────────────────────────────────────────────────────

// Pixel-true rotation/crop. We re-encode the frames rather than stamp a
// display-rotation metadata flag because phone uploads ship a `displaymatrix`
// side-data atom that takes precedence in some browsers — Chrome / Safari /
// Firefox each disagree about which hint wins when both are present, so the
// metadata-only path looked silent for users (2026-05-15: rotation API
// returned 200 but the video never visibly turned). Baking the rotation
// into pixels and stripping every rotation hint we know about decouples
// playback from any source-side ambiguity.
//
// preset=veryfast keeps encode time well under the 300s function ceiling
// for ≤3-minute clips (current use case). For long-form interviews we'd
// need to move this behind a queue — see the parked idea on streaming-pipe
// normalize in .claude/ideas.md.
async function editVideo({ inPath, outPath, rotate, crop, srcW, srcH }) {
  const filters = transposeFilter(rotate)
  if (crop) {
    const rDims = rotatedDims(srcW, srcH, rotate)
    const c = normalizeCrop(crop, rDims.w, rDims.h)
    filters.push(`crop=${c.w}:${c.h}:${c.x}:${c.y}`)
  }
  // No `-movflags +faststart`: the faststart pass rewrites the file with
  // the moov atom moved to the front, peaking at ~3x file size in /tmp.
  // Output is still playable; first-byte latency is slightly higher when
  // moov is at the tail. Revisit if upload-time normalize lands.
  const args = [
    '-y',
    '-i', inPath,
    ...(filters.length ? ['-vf', filters.join(',')] : []),
    '-c:v', 'libx264',
    '-crf', '23',
    '-preset', 'veryfast',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'copy',
    // Drop all source metadata, then explicitly clear the legacy `rotate`
    // tag. The re-encoded video already has rotation baked into its pixels
    // — any lingering rotation hint would double-rotate in some players.
    '-map_metadata', '-1',
    '-metadata:s:v:0', 'rotate=',
    outPath,
  ]
  await runFfmpeg(args)
  const s = await stat(outPath).catch(() => null)
  if (!s || s.size === 0) throw new Error('ffmpeg produced an empty output')
}

// ── Probe output dimensions ──────────────────────────────────────────────────

async function probeImageDims(path) {
  const meta = await sharp(path).metadata()
  return { width: meta.width || null, height: meta.height || null }
}

// Use ffprobe via ffmpeg's stderr parsing — we don't ship ffprobe-static so
// pull dimensions from sharp for images and from a cheap ffmpeg run for video.
// Also surface the rotate metadata so editVideoRotateOnly can compose chained
// rotations. Stream dims do NOT swap when a rotation tag is present — the
// frames are stored raw and the player rotates on display.
async function probeVideoDims(path) {
  return new Promise((resolve) => {
    const proc = spawn(FFMPEG_BIN, ['-i', path], { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    proc.stderr.on('data', (d) => { stderr += d.toString() })
    proc.on('close', () => {
      // Dimensions follow the pixel format in the stream description, always
      // after a comma (e.g. "yuv420p, 1920x1080"). Using \d{2,5} (2–5 digits)
      // avoids false matches on codec hex tags like "(avc1 / 0x31637661)"
      // where the leading 0 is a single digit — and the prior `\s\d+x\d+`
      // pattern was matching that 0 first, returning width=0 → null in DB.
      // ffmpeg may emit a stream-id `[0x1]` and/or a language `(und)` between
      // the index and the colon, in either order; accept any sequence of both.
      const dim = stderr.match(/Stream #\d+:\d+(?:\[[^\]]+\]|\([^)]+\))*:\s*Video:[^\n]*?,\s*(\d{2,5})x(\d{2,5})/)
      const rot = stderr.match(/rotate\s*:\s*(-?\d+)/i)
      const dm  = stderr.match(/displaymatrix:\s*rotation of (-?[\d.]+)/i)
      const rRaw = rot
        ? parseInt(rot[1], 10)
        : (dm ? Math.round(parseFloat(dm[1])) : 0)
      // displaymatrix uses CCW degrees; rotate metadata uses CW. Normalize to
      // 0/90/180/270 CW so the rest of the pipeline can reason in one frame.
      const cw = dm && !rot ? -rRaw : rRaw
      const rotate = ((cw % 360) + 360) % 360
      resolve({
        width:  dim ? parseInt(dim[1], 10) : null,
        height: dim ? parseInt(dim[2], 10) : null,
        rotate,
      })
    })
    proc.on('error', () => resolve({ width: null, height: null, rotate: 0 }))
  })
}

// ── Blob path helpers ────────────────────────────────────────────────────────

function variantPathname(sourceAsset, ext) {
  // Deterministic-ish but unique per variant: stamp + random suffix is added
  // by blobPut via addRandomSuffix=true to avoid collisions across rapid edits.
  const stamp = Date.now()
  return `media/variants/${sourceAsset.id}/${stamp}${ext}`
}

function extForMime(mimeType, fallback) {
  if (!mimeType) return fallback
  const m = mimeType.toLowerCase()
  if (m.includes('jpeg') || m.includes('jpg')) return '.jpg'
  if (m.includes('png'))  return '.png'
  if (m.includes('webp')) return '.webp'
  if (m.includes('mp4'))  return '.mp4'
  if (m.includes('quicktime') || m.includes('mov')) return '.mov'
  if (m.includes('webm')) return '.webm'
  return fallback
}

// ── Handler ──────────────────────────────────────────────────────────────────

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const url = new URL(req.url, 'http://localhost')
  const parts = url.pathname.split('/').filter(Boolean)
  const id = parts[parts.length - 2]
  if (!id) return res.status(400).json({ error: 'Missing id' })

  const body = req.body || {}
  const rotate = Number.isFinite(Number(body.rotate)) ? Number(body.rotate) : 0
  const crop   = body.crop && typeof body.crop === 'object' ? body.crop : null
  const label  = typeof body.label === 'string' && body.label.trim()
    ? body.label.trim().slice(0, 80)
    : null
  const mode   = VALID_MODES.has(body.mode) ? body.mode : 'variant'

  if (!VALID_ROTATIONS.has(rotate)) {
    return res.status(400).json({ error: 'rotate must be 0, 90, 180, or 270' })
  }
  if (!rotate && !crop) {
    return res.status(400).json({ error: 'Nothing to do — pass rotate or crop' })
  }

  const scope = await workspaceScope(req)

  const auth = await requireRole(req, EDITOR_ROLES, { orgId: scope.workspace.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  // Load source asset (workspace-scoped).
  const where = `id=eq.${id}&${scope.column}=eq.${scope.id}`
  const lookup = await sb(`media_assets?${where}&select=id,${scope.column},kind,filename,mime_type,blob_url,blob_pathname,width,height,parent_id,asset_purpose,speaker_role,patient_pseudonym,condition,notes,thumbnail_url`)
  if (!lookup.ok) return res.status(500).json({ error: 'Database error' })
  const rows = await lookup.json()
  const source = rows[0]
  if (!source) return res.status(404).json({ error: 'Not found' })
  if (!source.blob_url) return res.status(400).json({ error: 'Source has no blob to edit' })

  if (mode === 'replace-master' && source.parent_id) {
    return res.status(400).json({ error: 'replace-master is only valid on a master (parent_id IS NULL)' })
  }

  // Source dimensions are only required to validate crop bounds. Rotate-only
  // operations don't need them — the transpose filter (video) and sharp's
  // .rotate() (image) operate on the full frame regardless of size. Most rows
  // have width/height populated from upload, but older video uploads predate
  // the upload-side population so they're often null; probing falls back to
  // ffmpeg/sharp metadata when we DO need them.
  let srcW = source.width || null
  let srcH = source.height || null

  const dir = await mkdtemp(join(tmpdir(), 'edit-'))
  const inExt  = extForMime(source.mime_type, source.kind === 'video' ? '.mp4' : '.jpg')
  const outExt = inExt
  const inPath  = join(dir, `in${inExt}`)
  const outPath = join(dir, `out${outExt}`)

  try {
    // For VIDEO we pass the blob URL straight to ffmpeg (it reads via HTTP),
    // saving ~the source size in /tmp. Exception: when a crop is requested
    // and dims aren't in the DB, we must probe dimensions first. Probing via
    // HTTP URL is unreliable for moov-at-tail files (no +faststart) because
    // ffmpeg needs to seek backward to find the moov atom — this works for
    // local files but fails silently over HTTP in practice. In that case we
    // download to inPath first and probe (and encode) from the local copy.
    // Rotate-only never needs dims and always streams from the URL.
    const needsLocalForDimProbe = source.kind === 'video' && crop && (!srcW || !srcH)
    if (source.kind !== 'video') {
      await downloadToTmp(source.blob_url, inPath)
    } else if (needsLocalForDimProbe) {
      await downloadToTmp(source.blob_url, inPath)
    }
    const videoInputArg = source.kind === 'video'
      ? (needsLocalForDimProbe ? inPath : source.blob_url)
      : inPath

    if (crop && (!srcW || !srcH)) {
      const probed = source.kind === 'video'
        ? await probeVideoDims(inPath)   // inPath guaranteed populated when dims unknown
        : await probeImageDims(inPath)
      srcW = probed.width
      srcH = probed.height
      if (!srcW || !srcH) {
        return res.status(400).json({ error: 'Could not determine source dimensions' })
      }
    }

    if (source.kind === 'video') {
      // Single pixel-rotation path for rotate, crop, or both. The previous
      // metadata-only rotate was failing silently for some sources (rotate
      // hint conflicted with the displaymatrix already present on phone
      // clips); baking rotation into pixels guarantees the output orientation
      // matches what the user clicked regardless of any source-side hints.
      await editVideo({ inPath: videoInputArg, outPath, rotate, crop, srcW, srcH })
    } else {
      await editImage({
        inPath, outPath, rotate, crop, srcW, srcH, mimeType: source.mime_type,
      })
    }

    const outStat = await stat(outPath)
    // Pixel re-encode produces output whose stream dims already reflect the
    // applied rotation, and -map_metadata -1 strips any inherited rotation
    // flag, so the probed dims are the displayed dims with no swap needed.
    const outDims = source.kind === 'video'
      ? await probeVideoDims(outPath)
      : await probeImageDims(outPath)

    // Upload the new blob. Stream from disk — videos can be 500MB+ and
    // readFile() materializes the entire file in RAM.
    let uploaded
    if (mode === 'replace-master') {
      // Cache-bust: write the rotated/cropped master to a FRESH pathname
      // instead of overwriting in place. The CDN + browser cache by full URL,
      // and an in-place overwrite was serving the pre-rotation bytes from
      // cache for hours — the API would 200 but the user would see no change.
      // The stale blob is deleted below, after the row is PATCHed.
      const oldPath = source.blob_pathname
        || (source.blob_url ? new URL(source.blob_url).pathname.replace(/^\//, '') : '')
      const lastSlash = oldPath.lastIndexOf('/')
      const blobDir = lastSlash > 0 ? oldPath.slice(0, lastSlash) : 'media/raw'
      const tail    = lastSlash > 0 ? oldPath.slice(lastSlash + 1) : oldPath
      const dot     = tail.lastIndexOf('.')
      const base    = (dot > 0 ? tail.slice(0, dot) : tail) || `m-${source.id}`
      // addRandomSuffix appends the unique segment, so the URL is guaranteed
      // fresh and the next image/video load misses every layer of cache.
      const newPathname = `${blobDir}/${base}${outExt}`
      uploaded = await blobPut(newPathname, createReadStream(outPath), {
        access: 'public',
        contentType: source.mime_type,
        addRandomSuffix: true,
        allowOverwrite: false,
      })
    } else {
      const pathname = variantPathname(source, outExt)
      uploaded = await blobPut(pathname, createReadStream(outPath), {
        access: 'public',
        contentType: source.mime_type,
        addRandomSuffix: true,
        allowOverwrite: false,
      })
    }

    const transformsPayload = {
      ...(rotate ? { rotate } : {}),
      ...(crop ? { crop: normalizeCrop(crop, rotatedDims(srcW, srcH, rotate).w, rotatedDims(srcW, srcH, rotate).h) } : {}),
    }

    if (mode === 'replace-master') {
      // PATCH the source row: new URL, dimensions, size; clear thumbnail so it
      // re-generates on the new orientation. blob_url + blob_pathname both
      // change because the new blob lives at a fresh pathname (cache-bust).
      const updateBody = {
        blob_url:      uploaded.url,
        blob_pathname: uploaded.pathname,
        width:  outDims.width  || null,
        height: outDims.height || null,
        size_bytes: outStat.size || null,
        thumbnail_url: null,
        // Stamp the transforms history on the master too — useful for later
        // forensics ("when was this rotated?"). Append to existing if present.
        transforms: transformsPayload,
      }
      const upd = await sb(`media_assets?${where}`, {
        method: 'PATCH',
        body: JSON.stringify(updateBody),
      })
      if (!upd.ok) throw new Error(`PATCH master failed: ${upd.status} ${await upd.text()}`)
      const data = await upd.json()
      const after = data[0] ?? null

      // Old blob is now orphaned — delete it. Fire-and-forget: if the delete
      // fails, the row already points at the new blob and the only cost is a
      // leftover object in storage (handled by the orphan-blob sweeper).
      if (source.blob_url && source.blob_url !== uploaded.url) {
        blobDel(source.blob_url).catch((e) => {
          console.error('[edit] stale blob delete failed:', e?.message)
        })
      }

      // Regenerate thumbnail synchronously from the re-encoded outPath already
      // in /tmp — avoids a second blob download and ensures the 200 response
      // includes the updated thumbnail_url so the UI shows the rotated frame
      // immediately without needing a follow-up "Redo thumbnail" click.
      // Pass source.thumbnail_url so the old thumbnail blob gets cleaned up.
      let thumbnailUrl = null
      if (source.kind === 'video' && after) {
        try {
          thumbnailUrl = await generateThumbnailFromPath(
            outPath,
            { ...after, thumbnail_url: source.thumbnail_url },
            scope,
          )
        } catch (e) {
          console.error('[edit] thumbnail regen failed:', e?.message)
        }
      }

      await recordAudit({
        assetId: id,
        action:  'edit.replace-master',
        before:  snapshot(source),
        after:   snapshot(after),
        req,
        scope,
      })

      return res.status(200).json({
        mode: 'replace-master',
        asset: { ...after, thumbnail_url: thumbnailUrl },
      })
    }

    // Variant insert: new media_assets row carrying parent_id + variant_label
    // + transforms. Status starts as 'approved' so it's immediately usable
    // (variants are derived from already-approved content; no need to re-tag).
    const variantRow = {
      [scope.column]: scope.id,
      kind:          source.kind,
      status:        'approved',
      source:        'edit',
      blob_url:      uploaded.url,
      blob_pathname: uploaded.pathname,
      filename:      source.filename, // keep original filename for download UX
      mime_type:     source.mime_type,
      size_bytes:    outStat.size || null,
      width:         outDims.width  || null,
      height:        outDims.height || null,
      parent_id:     source.id,
      variant_label: label || defaultLabel(rotate, crop, outDims),
      transforms:    transformsPayload,
      asset_purpose: source.asset_purpose || null,
      speaker_role:  source.speaker_role  || null,
      patient_pseudonym: source.patient_pseudonym || null,
      condition:     source.condition || null,
      notes:         source.notes || null,
    }
    const ins = await sb('media_assets', { method: 'POST', body: JSON.stringify(variantRow) })
    if (!ins.ok) throw new Error(`Insert variant failed: ${ins.status} ${await ins.text()}`)
    const insertedRows = await ins.json()
    const variant = insertedRows[0] || null

    // Regenerate thumbnail synchronously from outPath (already in /tmp).
    let variantThumbnailUrl = null
    if (source.kind === 'video' && variant?.id) {
      try {
        variantThumbnailUrl = await generateThumbnailFromPath(outPath, variant, scope)
      } catch (e) {
        console.error('[edit] variant thumbnail failed:', e?.message)
      }
    }

    await recordAudit({
      assetId: variant?.id || id,
      action:  'edit.variant',
      before:  snapshot(source),
      after:   snapshot(variant),
      req,
      scope,
    })

    return res.status(200).json({
      mode: 'variant',
      asset: variantThumbnailUrl ? { ...variant, thumbnail_url: variantThumbnailUrl } : variant,
    })
  } catch (e) {
    console.error('[edit] failed:', e?.message)
    return res.status(500).json({ error: e?.message || 'Edit failed' })
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

// Auto-label from the variant's final aspect ratio so the user has something
// sensible if they don't type one. Matches the picker presets the UI offers.
function defaultLabel(rotate, crop, dims) {
  const w = dims.width  || 0
  const h = dims.height || 0
  if (!w || !h) return rotate ? `Rotated ${rotate}°` : 'Crop'
  const r = w / h
  if (Math.abs(r - 1)        < 0.02) return '1:1 Square'
  if (Math.abs(r - 9 / 16)   < 0.02) return '9:16 Vertical'
  if (Math.abs(r - 16 / 9)   < 0.02) return '16:9 Landscape'
  if (Math.abs(r - 4 / 5)    < 0.02) return '4:5 Portrait'
  if (rotate && !crop)               return `Rotated ${rotate}°`
  return `Crop ${w}×${h}`
}

export default withSentry(handler)

// api/_lib/renderChunkPlan.js
//
// Plan the time-windows for a chunked keep-whole long-form render.
//
// A 30–60 min talk can't render inside one 300s Vercel function, so the source
// is split into fixed-length pieces. Each piece renders in its own invocation
// via the existing windowed renderer (renderVideoChannel with startSec/durationSec
// → ffmpeg -ss/-t), and the pieces are concatenated into one master.

// Seconds of SOURCE per piece. Each piece must render (download/seek + encode +
// upload) comfortably inside the 300s function ceiling. Captions are off for
// long-form, so a 1080p piece at preset fast is roughly real-time or faster.
// The expensive case is a >500MB source: brandRenderVideo downscale-on-ingest
// decodes the window from the original, and a 4K decode runs well over
// real-time (~135s wall per 60s of 4K, per the renderer's measured basis). 90s
// keeps even a heavy piece inside budget while staying efficient for 1080p.
// This is the primary tuning knob — revisit after measuring on a real talk.
export const CHUNK_SECONDS = 90

// Sources at or under this render fine in ONE pass (the existing capped
// renderAndPatchPackage path, LONGFORM_MAX_SECONDS=240). Only longer sources
// pay the cost of the chunk state machine. Kept equal to the single-pass cap so
// there's no gap: anything the single pass can't cover goes chunked.
export const SINGLE_PASS_MAX_SECONDS = 240

/**
 * Split a duration into ordered, non-overlapping, gapless windows.
 *
 * @param {number} totalSec       — source duration in seconds
 * @param {number} [chunkSeconds] — max seconds of source per piece
 * @returns {{idx:number, startSec:number, durSec:number}[]}
 */
export function planChunks(totalSec, chunkSeconds = CHUNK_SECONDS) {
  const total = Math.max(0, Number(totalSec) || 0)
  const size = Math.max(1, Number(chunkSeconds) || CHUNK_SECONDS)
  const chunks = []
  let start = 0
  let idx = 0
  // 0.05s epsilon: don't emit a sliver final piece for floating-point dust.
  while (start < total - 0.05) {
    const durSec = Math.min(size, total - start)
    chunks.push({
      idx,
      startSec: Math.round(start * 100) / 100,
      durSec: Math.round(durSec * 100) / 100,
    })
    // Round the running offset too, so float dust can't accumulate across many
    // pieces and leave a sub-epsilon gap/overlap at the tail of a long talk.
    start = Math.round((start + durSec) * 100) / 100
    idx += 1
  }
  return chunks
}

// Image-source helpers — fetch a remote image into a form sharp can read
// WITHOUT spiking the JS heap on an oversized original.
//
// The naive pattern `Buffer.from(await res.arrayBuffer())` materializes the
// entire payload in RAM before any size guard can fire. That's safe for the
// typical ≤20 MB phone photo but a 40 MB+ HEIC / raw original spikes memory
// before the check runs (and an unbounded path can OOM the 1024 MB function).
// These helpers move the size decision BEFORE the full download:
//
//   1. HEAD-probe Content-Length and reject anything over the cap up front.
//   2. When the server omits Content-Length, stream the body to a temp file
//      (bounded RAM, per the CLAUDE.md "Large-file handling" pattern), stat
//      the materialized file, and only read it into a Buffer if it fits.
//
// Reference streaming pattern: api/_lib/tagAsset.js (transcodeProxy).

import { mkdtemp, rm, stat, readFile } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// HEAD-probe a URL's byte size without downloading the body. Returns a
// positive integer Content-Length, or null when the server omits the header
// or the request fails (callers must treat null as "unknown", not "empty").
export async function probeContentLength(url) {
  try {
    const r = await fetch(url, { method: 'HEAD' })
    if (!r.ok) return null
    const n = Number(r.headers.get('content-length'))
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

// Download an image into a Buffer, but never spike the heap on an oversized
// original. A HEAD probe rejects anything over `maxBytes` BEFORE the body is
// fetched; when Content-Length is absent the body is streamed to a temp file,
// its on-disk size checked against the cap, and only then read into RAM.
//
// Returns:
//   { buffer, size }            — download succeeded and fits under the cap
//   { tooLarge: true, size }    — source exceeds maxBytes (caller should skip)
// Throws on network / fetch failure (so callers can log e.stack).
export async function downloadImageCapped(url, maxBytes) {
  const probed = await probeContentLength(url)
  if (probed != null && probed > maxBytes) {
    return { tooLarge: true, size: probed }
  }
  if (probed != null) {
    // Size known and within budget — safe to buffer directly.
    const r = await fetch(url)
    if (!r.ok) throw new Error(`download failed: ${r.status}`)
    const buffer = Buffer.from(await r.arrayBuffer())
    return { buffer, size: buffer.length }
  }
  // Unknown length — stream to disk so RAM stays bounded, enforce the cap on
  // the materialized file, then read into a Buffer only if it fits.
  const dir = await mkdtemp(join(tmpdir(), 'imgcap-'))
  const path = join(dir, 'in.bin')
  try {
    const r = await fetch(url)
    if (!r.ok) throw new Error(`download failed: ${r.status}`)
    await pipeline(Readable.fromWeb(r.body), createWriteStream(path))
    const { size } = await stat(path)
    if (size > maxBytes) return { tooLarge: true, size }
    const buffer = await readFile(path)
    return { buffer, size }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

// Stream an image to a fresh temp file, returning the on-disk path so sharp
// can read it lazily (`sharp(path)`) instead of holding the full payload in
// the JS heap. Use this for resize paths that have no fixed byte cap — the
// decode-time memory is libvips's concern and scales with pixel dimensions,
// not file bytes, so streaming the bytes to disk removes the heap spike the
// arrayBuffer() path caused.
//
// Returns { path, cleanup }. The caller MUST await cleanup() when done (a
// finally block) to remove the temp directory. Throws on fetch failure.
export async function downloadImageToTemp(url, prefix = 'img-') {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  const path = join(dir, 'in.bin')
  const cleanup = () => rm(dir, { recursive: true, force: true }).catch(() => {})
  try {
    const r = await fetch(url)
    if (!r.ok) throw new Error(`download failed: ${r.status}`)
    await pipeline(Readable.fromWeb(r.body), createWriteStream(path))
    return { path, cleanup }
  } catch (e) {
    await cleanup()
    throw e
  }
}

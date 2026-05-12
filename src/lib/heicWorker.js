// Web Worker for HEIC → JPEG transcode. The libheif WASM bundle (~3 MB) +
// the actual decode + re-encode loop are CPU-heavy and would otherwise
// freeze the main thread for several seconds per large iPhone capture,
// stalling React's render loop and producing visible "Page Unresponsive"
// prompts on dev hardware.
//
// Importing this file with Vite's `?worker` suffix gives us a Worker
// constructor that knows how to bundle this entrypoint as its own
// chunk — heic2any only loads when a HEIC is actually selected.
//
// Wire format: main thread posts a Blob; worker posts back either
// `{ ok: true, blob }` or `{ ok: false, error }`. Single message in,
// single message out — workers are spun up on demand and terminated
// after the result lands, so there's no need for an ID scheme.

import heic2any from 'heic2any'

self.addEventListener('message', async (event) => {
  const { blob, quality = 0.92 } = event.data || {}
  if (!blob) {
    self.postMessage({ ok: false, error: 'No blob provided' })
    return
  }
  try {
    const out = await heic2any({ blob, toType: 'image/jpeg', quality })
    // heic2any returns Blob for single-image inputs, Blob[] for sequences.
    const primary = Array.isArray(out) ? out[0] : out
    self.postMessage({ ok: true, blob: primary })
  } catch (e) {
    self.postMessage({ ok: false, error: e?.message || 'Transcode failed' })
  }
})

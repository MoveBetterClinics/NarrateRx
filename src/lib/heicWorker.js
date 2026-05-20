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

// heic2any was written assuming a browser-main-thread context — it does
// `window.libheif = ...` to expose the WASM module globally, which throws
// `ReferenceError: window is not defined` in a Worker (workers have `self`,
// not `window`). Aliasing `self` to `window` BEFORE importing heic2any
// makes every `window.x = …` assignment land on the worker global scope,
// and every `window.x` read reads from the same place. No behavioral
// change in main-thread contexts — this file is only loaded as a worker.
//
// Static `import` statements in ESM are hoisted and run before any
// top-level statement regardless of source order, so the polyfill has to
// land BEFORE the dynamic-import of heic2any — hence the `await import()`
// inside the message handler instead of a top-level static import.
//
// This stayed latent until now because JPEG uploads bypass the worker
// entirely (maybeTranscodeHeic returns the file unchanged); the bug only
// fires when someone drag-drops an actual HEIC from iPhoto / iCloud.
if (typeof window === 'undefined') {
  self.window = self
}

self.addEventListener('message', async (event) => {
  const { blob, quality = 0.92 } = event.data || {}
  if (!blob) {
    self.postMessage({ ok: false, error: 'No blob provided' })
    return
  }
  try {
    // Dynamic import so the window-polyfill above runs first. Module-level
    // statements in heic2any (e.g. `window.libheif = ...`) execute on the
    // first import, and they need the polyfill in place by then.
    const { default: heic2any } = await import('heic2any')
    const out = await heic2any({ blob, toType: 'image/jpeg', quality })
    // heic2any returns Blob for single-image inputs, Blob[] for sequences.
    const primary = Array.isArray(out) ? out[0] : out
    self.postMessage({ ok: true, blob: primary })
  } catch (e) {
    self.postMessage({ ok: false, error: e?.message || 'Transcode failed' })
  }
})

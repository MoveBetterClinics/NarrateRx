// Thin facade over sonner so the rest of the app doesn't import directly.
// Lets us swap implementations later (or stub in tests) without rippling
// changes through every call site.
//
// Per-type duration defaults (overridable by passing `duration` in opts):
//   error   → Infinity (stays until user clicks the close button — long enough
//             to screen-capture a problem)
//   warning → 12s
//   success → 8s
//   info    → 8s
//   message → 8s
//   loading → sonner default (stays until resolved/dismissed)
//
// Usage:
//   import { toast, runWithToast } from '@/lib/toast'
//   toast.success('Saved')
//   toast.error('Save failed', { description: e.message })
//   toast.info('Heads up')
//   toast.promise(savePromise, { loading: 'Saving…', success: 'Saved', error: 'Save failed' })
//
//   // For long-running actions, wrap the awaited call. The loading toast
//   // persists from click → resolution, so the user always knows the work
//   // is alive even if the button scrolls offscreen.
//   const result = await runWithToast(publishBlogToWebsite(payload), {
//     loading: 'Publishing to website…',
//     success: (r) => ({ message: 'Published', description: r.postUrl }),
//     error: (e) => ({ message: 'Publish failed', description: e.message }),
//   })
//
// The <Toaster /> component is mounted once at the app root in App.jsx.
// The <Toaster /> component is mounted once at the app root in App.jsx with
// closeButton enabled, which is required so Infinity-duration errors are
// dismissable.

import { toast as sonnerToast, Toaster as SonnerToaster } from 'sonner'

const withDuration = (fn, duration) => (message, opts) =>
  fn(message, { duration, ...opts })

const wrapped = (message, opts) => sonnerToast(message, { duration: 8000, ...opts })

wrapped.error = withDuration(sonnerToast.error, Infinity)
wrapped.warning = withDuration(sonnerToast.warning, 12000)
wrapped.success = withDuration(sonnerToast.success, 8000)
wrapped.info = withDuration(sonnerToast.info, 8000)
wrapped.message = withDuration(sonnerToast.message, 8000)

wrapped.promise = sonnerToast.promise.bind(sonnerToast)
wrapped.loading = sonnerToast.loading.bind(sonnerToast)
wrapped.dismiss = sonnerToast.dismiss.bind(sonnerToast)
wrapped.custom = sonnerToast.custom.bind(sonnerToast)

export const toast = wrapped
export const Toaster = SonnerToaster

/**
 * Wrap a promise with a persistent sonner loading toast that resolves to a
 * success or error toast. Returns the awaited value (or rethrows the error)
 * so callers can use it like a normal `await`.
 *
 * `success` and `error` may be a string or a function returning either a
 * string or `{ message, description }`.
 */
export async function runWithToast(promise, { loading, success, error } = {}) {
  const id = sonnerToast.loading(loading || 'Working…')
  try {
    const value = await promise
    const out = typeof success === 'function' ? success(value) : success
    const { message, description } = normalizeToast(out, 'Done')
    sonnerToast.success(message, { id, duration: 8000, ...(description ? { description } : {}) })
    return value
  } catch (e) {
    const out = typeof error === 'function' ? error(e) : error
    const fallback = e instanceof Error ? e.message : String(e)
    const { message, description } = normalizeToast(out, 'Something went wrong', fallback)
    sonnerToast.error(message, { id, duration: Infinity, ...(description ? { description } : {}) })
    throw e
  }
}

function normalizeToast(value, defaultMessage, defaultDescription) {
  if (value && typeof value === 'object') {
    return {
      message: value.message || defaultMessage,
      description: value.description ?? defaultDescription,
    }
  }
  return {
    message: typeof value === 'string' ? value : defaultMessage,
    description: defaultDescription,
  }
}

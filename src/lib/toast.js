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
//   import { toast } from '@/lib/toast'
//   toast.success('Saved')
//   toast.error('Save failed', { description: e.message })
//   toast.info('Heads up')
//   toast.promise(savePromise, { loading: 'Saving…', success: 'Saved', error: 'Save failed' })
//
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

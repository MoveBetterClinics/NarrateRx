// Thin facade over sonner so the rest of the app doesn't import directly.
// Lets us swap implementations later (or stub in tests) without rippling
// changes through every call site.
//
// Usage:
//   import { toast } from '@/lib/toast'
//   toast.success('Saved')
//   toast.error('Save failed', { description: e.message })
//   toast.info('Heads up')
//   toast.promise(savePromise, { loading: 'Saving…', success: 'Saved', error: 'Save failed' })
//
// The <Toaster /> component is mounted once at the app root in App.jsx.

import { toast as sonnerToast, Toaster as SonnerToaster } from 'sonner'

export const toast = sonnerToast
export const Toaster = SonnerToaster

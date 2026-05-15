// @ts-check
// Drop-in replacement for TanStack Query's useMutation that guarantees a
// user-facing error toast when the mutation throws.
//
// Why this exists: every silent-button-fail bug in the recent triage
// (PRs #431, #436, #424, #427, #419, #409) had the same shape — a mutation
// throws, the call site uses `.mutate()` (which swallows the rejection unless
// an explicit onError is wired), and the user sees nothing. By the time a
// developer notices, the user has clicked again three times.
//
// useAppMutation injects a default `onError` that calls toast.error(...) with
// the error's message. Callers can:
//   - Pass `errorMessage` to override the toast title (e.g. "Couldn't delete topic")
//   - Pass `onError` to run extra logic AFTER the toast (logging, state reset)
//   - Pass `silent: true` to suppress the toast entirely (rare — only when
//     the call site has a deliberately custom error surface)
//
// All mutations in src/lib/queries.js use this. The custom ESLint rule
// `narraterx/no-raw-use-mutation` prevents new code from bypassing it.

import { useMutation } from '@tanstack/react-query'
import { toast } from '@/lib/toast'

/**
 * Wrapper around useMutation that always shows a toast on error.
 * @param {{ errorMessage?: string, silent?: boolean, onError?: (...args: any[]) => any, [key: string]: any }} [options]
 */
export function useAppMutation({
  errorMessage = 'Something went wrong',
  silent = false,
  onError: callerOnError,
  ...rest
} = {}) {
  return useMutation({
    ...rest,
    onError: (err, vars, ctx) => {
      if (!silent) {
        const message = err instanceof Error ? err.message : String(err)
        const description = message && message !== errorMessage ? message : undefined
        toast.error(errorMessage, description ? { description } : undefined)
      }
      if (callerOnError) callerOnError(err, vars, ctx)
    },
  })
}

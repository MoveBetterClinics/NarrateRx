// useSaveAction — the standard pattern for any user-initiated save/mutate.
//
// Wraps an async function and exposes:
//   { run, saving, savedAt, error }
//
// On run() it tracks the in-flight state, surfaces a toast on success/error
// (toggle either off if you want inline-only feedback), stamps savedAt so the
// caller can render a "Saved 3s ago" pill, and rethrows so caller-side
// try/catch and Promise chains keep working unchanged.
//
// Why a hook and not a plain function: we need the saving/savedAt state to
// drive button disabled + label morphing, and we need it tied to the
// component's lifecycle so it doesn't update unmounted components.
//
// Examples:
//   const { run: save, saving, savedAt } = useSaveAction(
//     () => updateInterview(id, patch, user.id),
//     { successMessage: 'Interview saved' },
//   )
//   <SaveButton saving={saving} saved={!!savedAt} onClick={save} />
//
//   const { run: confirmDelete, saving: deleting } = useSaveAction(
//     async () => { await deleteClinician(id, user.id); navigate('/') },
//     { successMessage: 'Clinician deleted' },
//   )

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from './toast'

export function useSaveAction(fn, options = {}) {
  const {
    successMessage = null,   // null = no success toast; pass a string to toast on resolve
    errorMessage   = null,   // null = use the thrown error's .message; pass a string to override
    silent         = false,  // true = no toasts at all (caller renders its own inline feedback)
    savedFlashMs   = 2000,   // how long savedAt stays "fresh" before auto-clearing
  } = options

  const [saving, setSaving]   = useState(false)
  const [savedAt, setSavedAt] = useState(null)
  const [error, setError]     = useState(null)

  // Avoid updating state after unmount when the awaited fn outlives the
  // component (slow API + user navigated away).
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  // Auto-clear the savedAt flash so SaveButton can revert to idle.
  useEffect(() => {
    if (!savedAt || savedFlashMs <= 0) return
    const t = setTimeout(() => { if (alive.current) setSavedAt(null) }, savedFlashMs)
    return () => clearTimeout(t)
  }, [savedAt, savedFlashMs])

  // fn is captured fresh on every call so closures over latest state are fine.
  const fnRef = useRef(fn)
  useEffect(() => { fnRef.current = fn }, [fn])

  const run = useCallback(async (...args) => {
    if (!alive.current) return
    setSaving(true)
    setError(null)
    try {
      const result = await fnRef.current(...args)
      if (alive.current) {
        setSaving(false)
        setSavedAt(Date.now())
        if (!silent && successMessage) toast.success(successMessage)
      }
      return result
    } catch (e) {
      if (alive.current) {
        setSaving(false)
        setError(e)
        if (!silent) {
          const msg = errorMessage || e?.message || 'Something went wrong'
          toast.error(msg)
        }
      }
      throw e
    }
  }, [silent, successMessage, errorMessage])

  return { run, saving, savedAt, error }
}

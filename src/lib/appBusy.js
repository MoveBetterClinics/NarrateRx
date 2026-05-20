// appBusy — app-wide "don't interrupt me" registry.
//
// Surfaces destructive prompts (auto-update reload, future "session expired"
// modals, etc.) can subscribe to know whether the user has unsaved work in
// flight — an active interview recording, a streaming AI response, an
// in-progress media upload. Pages that own such state register a busy reason
// while the work is live.
//
// Kept as a tiny module-level registry instead of a Context so it works
// across provider boundaries — the update modal lives near the root of the
// tree but needs to know about busy state set deep inside a Route.

import { useEffect, useSyncExternalStore } from 'react'

const reasons = new Set()
const subscribers = new Set()

function notify() {
  for (const cb of subscribers) {
    try { cb() } catch { /* ignore subscriber errors */ }
  }
}

export function setBusyReason(key, isBusy) {
  if (!key) return
  const had = reasons.has(key)
  if (isBusy && !had) {
    reasons.add(key)
    notify()
  } else if (!isBusy && had) {
    reasons.delete(key)
    notify()
  }
}

function subscribe(cb) {
  subscribers.add(cb)
  return () => { subscribers.delete(cb) }
}

function getSnapshot() {
  return reasons.size > 0
}

/**
 * Subscribe to whether any part of the app has registered a busy reason.
 * Returns a boolean that re-renders on transitions.
 */
export function useAppBusy() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/**
 * Register a busy reason from a component. The reason is cleared
 * automatically on unmount and whenever `isBusy` flips to false.
 */
export function useRegisterBusy(key, isBusy) {
  useEffect(() => {
    setBusyReason(key, isBusy)
    return () => setBusyReason(key, false)
  }, [key, isBusy])
}

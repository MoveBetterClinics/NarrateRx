import { useEffect, useState } from 'react'

const POLL_INTERVAL_MS = 60_000
const DISMISSED_KEY = 'narraterx:dismissed-update-sha'

// __BUILD_SHA__ is injected by Vite at build time (see vite.config.js).
// Resolves to the commit SHA the running bundle was built from, or "dev"
// for local builds without git.
// eslint-disable-next-line no-undef
const BUILT_SHA = typeof __BUILD_SHA__ === 'string' ? __BUILD_SHA__ : 'dev'

// Threshold below which a SHA is treated as a "short" identifier (e.g. the
// 7-char prefix git uses in release notes) and prefix-matching is allowed.
// Both deployed and dismissed SHAs are always full 40-char hashes, so
// prefix-matching them against each other would create false collisions on
// shared prefixes (~1 in 16M for two 7-char prefixes — small but non-zero).
const SHORT_SHA_MAX = 12

function shaMatches(a, b) {
  if (!a || !b) return false
  const x = String(a).toLowerCase()
  const y = String(b).toLowerCase()
  if (x === y) return true
  // Only allow prefix matching when one side is demonstrably short; never
  // prefix-match two full SHAs against each other.
  if (x.length <= SHORT_SHA_MAX && y.startsWith(x)) return true
  if (y.length <= SHORT_SHA_MAX && x.startsWith(y)) return true
  return false
}

function readDismissedSha() {
  try {
    return localStorage.getItem(DISMISSED_KEY) || ''
  } catch {
    return ''
  }
}

async function fetchVersion() {
  const r = await fetch('/version.json', { cache: 'no-store' })
  if (!r.ok) throw new Error(`version.json ${r.status}`)
  const data = await r.json()
  if (!data || typeof data.sha !== 'string') throw new Error('version.json missing sha')
  return data
}

async function fetchReleaseNotes(serverSha) {
  try {
    const r = await fetch('/release-notes.json', { cache: 'no-store' })
    if (!r.ok) return null
    const data = await r.json()
    const releases = Array.isArray(data?.releases) ? data.releases : []
    return releases.find((rel) => shaMatches(rel?.sha, serverSha)) || null
  } catch {
    return null
  }
}

/**
 * Polls /version.json for changes. When the deployed SHA differs from the SHA
 * baked into the running bundle, fetches release notes (if any) and returns
 * an "update available" descriptor for the UI to render.
 *
 * Skips dev builds (BUILT_SHA === 'dev') so local work is not nagged.
 * Remembers the user's dismissed SHA in localStorage so the modal is shown
 * at most once per deploy.
 */
export function useVersionCheck() {
  const [update, setUpdate] = useState(null)

  useEffect(() => {
    if (BUILT_SHA === 'dev') return undefined

    let cancelled = false
    let timer = null

    async function check() {
      try {
        const { sha: serverSha } = await fetchVersion()
        if (cancelled) return
        if (shaMatches(serverSha, BUILT_SHA)) return
        // Re-read each tick — the user may have dismissed a previous notice
        // mid-session, and we want subsequent deploys to honor that without
        // a page reload to refresh the closure.
        const dismissedSha = readDismissedSha()
        if (dismissedSha && shaMatches(serverSha, dismissedSha)) return

        const notes = await fetchReleaseNotes(serverSha)
        if (cancelled) return
        setUpdate({
          sha: serverSha,
          title: notes?.title || 'A new version is available',
          date: notes?.date || null,
          changes: Array.isArray(notes?.changes) ? notes.changes : [],
        })
      } catch {
        // Network blips are fine — try again on the next tick.
      }
    }

    function schedule() {
      if (timer) clearTimeout(timer)
      timer = setTimeout(async () => {
        if (cancelled) return
        if (document.visibilityState === 'visible') await check()
        schedule()
      }, POLL_INTERVAL_MS)
    }

    function onVisibility() {
      if (document.visibilityState !== 'visible') return
      // Reset the polling clock and check immediately. Without the reset,
      // a still-pending timer can fire moments later and double up the
      // check — racing two fetches and possibly resolving stale notes last.
      check()
      schedule()
    }

    check()
    schedule()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  function reload() {
    if (update?.sha) {
      try {
        localStorage.setItem(DISMISSED_KEY, update.sha)
      } catch {
        /* ignore */
      }
    }
    window.location.reload()
  }

  function dismiss() {
    if (update?.sha) {
      try {
        localStorage.setItem(DISMISSED_KEY, update.sha)
      } catch {
        /* ignore */
      }
    }
    setUpdate(null)
  }

  return { update, reload, dismiss }
}

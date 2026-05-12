// Non-prod-only workspace override.
//
// Preview deploys live at `narraterx-git-<branch>.vercel.app`, which has no
// `<slug>.narraterx.ai` subdomain for workspaceContext to resolve. Playwright
// preview-smoke tests need to act on a real workspace, so we accept
// `?workspace=<slug>` as a fallback resolver, persisted to sessionStorage so it
// survives in-app navigations.
//
// The server side (api/_lib/workspaceContext.js) only honors this override when
// `VERCEL_ENV !== 'production'`. The client patch here is opt-in (no `?workspace=`
// in URL or sessionStorage → no patching, no behavior change). Production runs
// are unaffected: even if someone tacks `?workspace=` onto narraterx.ai, the API
// ignores it.

const STORAGE_KEY = '__nrx_workspace_override'

function readSlug() {
  if (typeof window === 'undefined') return null
  let slug = null
  try {
    slug = new URLSearchParams(window.location.search).get('workspace')
  } catch {
    slug = null
  }
  if (slug) {
    try { sessionStorage.setItem(STORAGE_KEY, slug) } catch { /* empty */ }
    return slug
  }
  try { return sessionStorage.getItem(STORAGE_KEY) } catch { return null }
}

export function installWorkspaceOverride() {
  if (typeof window === 'undefined') return
  const slug = readSlug()
  if (!slug) return

  const original = window.fetch.bind(window)
  window.fetch = (input, init) => {
    try {
      const url = typeof input === 'string'
        ? input
        : (input && typeof input.url === 'string' ? input.url : null)
      if (url && url.startsWith('/api/') && !/[?&]workspace=/.test(url)) {
        const sep = url.includes('?') ? '&' : '?'
        const patched = `${url}${sep}workspace=${encodeURIComponent(slug)}`
        if (typeof input === 'string') {
          return original(patched, init)
        }
        return original(new Request(patched, input), init)
      }
    } catch {
      // fall through to original fetch
    }
    return original(input, init)
  }
}

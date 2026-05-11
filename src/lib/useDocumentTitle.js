// useDocumentTitle — sets document.title per page and restores the prior title
// on unmount, so navigating between routes keeps the browser tab and tab-
// switcher previews accurate.
//
// Convention: pass the page-specific noun phrase only ("Media", "Settings —
// Workspace") — the hook appends " · NarrateRx" so the brand stays in the tab.
// Pass an empty/null page to use just the brand.

import { useEffect } from 'react'

const SUFFIX = 'NarrateRx'

export function useDocumentTitle(page) {
  useEffect(() => {
    const prev = document.title
    document.title = page ? `${page} · ${SUFFIX}` : SUFFIX
    return () => { document.title = prev }
  }, [page])
}

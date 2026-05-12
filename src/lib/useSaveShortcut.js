// useSaveShortcut — binds ⌘S (Mac) / Ctrl+S (Win/Linux) to a save callback
// while the component is mounted.
//
// preventDefault() stops the browser's "Save webpage as…" dialog from
// firing. The handler is no-op when `disabled` is true (typical use:
// pass `disabled={saving || !isDirty}` so a chord during an in-flight save
// or against a clean form is a no-op rather than a redundant request).
//
// Keyboard event matching prefers `event.metaKey` on Mac and `event.ctrlKey`
// on everything else, mirroring the way native macOS apps and most web apps
// behave (e.g. Notion, Linear, Stripe Dashboard).

import { useEffect } from 'react'

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

export function useSaveShortcut(onSave, { disabled = false } = {}) {
  useEffect(() => {
    if (disabled || typeof onSave !== 'function') return
    function handler(e) {
      const modifier = IS_MAC ? e.metaKey : e.ctrlKey
      if (modifier && !e.shiftKey && !e.altKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault()
        onSave()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onSave, disabled])
}

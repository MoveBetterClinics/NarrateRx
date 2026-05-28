// Phase 4 PR 2 — capability check hook.
//
// Reads the resolved `current_user_capabilities` array that /api/workspace/me
// returns alongside `current_user_tier`. The server resolves the user's tier
// against the workspace's role_templates (with code defaults as fallback) so
// the client only has to check membership.
//
// Usage:
//   const { has } = usePermission()
//   if (!has('settings.edit')) return null
//
// Or the convenience export:
//   const canEditBilling = useCapability('billing.edit')

import { useWorkspace } from '@/lib/WorkspaceContext'

/**
 * @returns {{ capabilities: string[], has: (cap: string) => boolean }}
 */
export function usePermission() {
  const ws = useWorkspace()
  const capabilities = Array.isArray(ws?.current_user_capabilities)
    ? ws.current_user_capabilities
    : []

  // Stable reference for the closure so consumers can destructure { has }
  // without worrying about re-renders triggered by reference identity.
  function has(cap) {
    return capabilities.includes(cap)
  }

  return { capabilities, has }
}

/**
 * Convenience hook for a single-capability check.
 * @param {string} cap
 * @returns {boolean}
 */
export function useCapability(cap) {
  const { has } = usePermission()
  return has(cap)
}

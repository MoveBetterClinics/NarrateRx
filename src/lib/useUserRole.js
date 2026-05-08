import { useUser } from '@clerk/clerk-react'

// Hook for reading the current user's NarrateRx role. The role is stored in
// Clerk's publicMetadata.role and synced when an admin sets it on the user.
// Defaults to the least-privileged tier ('clinician') when no role is set so
// new users can upload but cannot edit/archive/purge until an admin promotes
// them.
//
// Server-side requireRole() is the authoritative gate — this hook only drives
// UI affordances (button visibility, info banners). The server will still
// 403 anyone who calls a privileged endpoint without the matching role, even
// if the UI somehow surfaces the action to them.
//
// Roles (HANDOFF.md → Locked decisions):
//   admin     → upload, edit, archive, restore, purge
//   editor    → upload, edit, archive, restore
//   clinician → upload (own metadata only — server-side scoping is a future
//               refinement; v1 just blocks edit/archive at the role layer)
export function useUserRole() {
  const { user, isLoaded } = useUser()
  const role     = (user?.publicMetadata?.role || 'clinician').toLowerCase()
  const isLoading = !isLoaded

  return {
    role,
    isLoading,
    canUpload:  true,                                  // any signed-in user
    canEdit:    role === 'admin' || role === 'editor',
    canArchive: role === 'admin' || role === 'editor',
    canRestore: role === 'admin' || role === 'editor',
    canPurge:   role === 'admin',
  }
}

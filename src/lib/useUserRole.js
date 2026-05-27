import { useAuth, useUser } from '@clerk/react'
import { ROLE_ADMIN, ROLE_CLINICIAN, isStaff } from '@/lib/roles'
import { useWorkspace } from '@/lib/WorkspaceContext'

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
// Roles (see src/lib/roles.js for the canonical persona model):
//   admin     → workspace owner; configures NarrateRx; can purge
//   publisher → publishes content (attach media, schedule, publish, monitor)
//               LEGACY ALIAS: 'editor' still authorizes via isStaff()
//   clinician → owns voice; records interviews, reviews drafts; upload only
export function useUserRole() {
  const { user, isLoaded } = useUser()
  const { orgRole } = useAuth()
  const workspace = useWorkspace()
  // Clerk Organization admins are treated as NarrateRx admins for the active
  // workspace, regardless of their publicMetadata.role. Mirrors the server-side
  // gate in api/_lib/auth.js.
  //
  // 'internal' plan workspaces (Move Better-owned tenants) grant admin to
  // every org member — full feature + admin access without per-user grants.
  const metadataRole   = (user?.publicMetadata?.role || ROLE_CLINICIAN).toLowerCase()
  const isOrgAdmin     = orgRole === 'org:admin'
  const internalBypass = workspace?.plan === 'internal'
  const role           = (isOrgAdmin || internalBypass) ? ROLE_ADMIN : metadataRole
  const isLoading      = !isLoaded

  // "Staff" = admin or publisher. Most write/edit/review gates collapse
  // to this — admin is a superset of publisher in every capability below
  // except canPurge.
  const staff = isStaff(role)

  return {
    role,
    isLoading,
    isStaff:    staff,
    canUpload:  true,                                  // any signed-in user
    canEdit:    staff,
    canArchive: staff,
    canRestore: staff,
    canPurge:   role === ROLE_ADMIN,
    // Approval workflow gates. canReview = the user is allowed to approve
    // or request changes on a content item that's in_review. canPublish
    // mirrors the "Publish" button visibility: only staff can publish
    // from in_review or approved states. Clinicians can still publish
    // from a draft when the workspace.skip_review escape hatch is on
    // (the consumer applies that override on top of this hook's value).
    canReview:  staff,
    canPublish: staff,
  }
}

// Drop-in wrapper around Clerk's <UserButton> that adds a "My Clinician
// Profile" entry to the dropdown when the signed-in user has a Self
// clinician row in this workspace.
//
// Why this exists: the only path to /clinician/:id today is from contextual
// surfaces (Home Resume strip, story author chip, Settings → Interview
// Defaults). Per-clinician campaign overrides live on the profile, so
// clinicians needed a direct route. The Clerk dropdown is where everyone
// already looks for "me"-shaped settings.
//
// When no Self clinician exists (user hasn't run their first interview, or
// they're an admin-only seat), the extra menu item is hidden — never a
// dead link.

import { UserButton } from '@clerk/clerk-react'
import { UserCircle } from 'lucide-react'
import { useSelfClinicianId } from '@/lib/useSelfClinicianId'

export function UserButtonWithProfile() {
  const selfId = useSelfClinicianId()

  return (
    <UserButton afterSignOutUrl="/" userProfileUrl="/account">
      {selfId && (
        <UserButton.MenuItems>
          <UserButton.Link
            label="My clinician profile"
            labelIcon={<UserCircle className="h-4 w-4" />}
            href={`/clinician/${selfId}`}
          />
        </UserButton.MenuItems>
      )}
    </UserButton>
  )
}

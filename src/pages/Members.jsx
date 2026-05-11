// /settings/members — invite teammates, change roles, remove members.
//
// We mount Clerk's prebuilt <OrganizationProfile /> rather than reimplementing
// the invite + role + remove UI. Clerk already manages organization membership
// for this app (OrgGate in App.jsx activates the workspace's Clerk org per
// subdomain), so the same primitive can drive the in-app members tab without
// any custom server work.
//
// Routing: routePath="/settings/members" tells Clerk to mount its internal
// router under that base so deep links (e.g. /settings/members/invitations)
// keep working without us having to add wildcard routes.

import { OrganizationProfile } from '@clerk/clerk-react'
import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

export default function Members() {
  useDocumentTitle('Members')
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild aria-label="Back to settings">
          <Link to="/settings/workspace">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Members</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Invite teammates, change roles, and manage workspace access.
          </p>
        </div>
      </div>

      <OrganizationProfile routing="path" path="/settings/members" />
    </div>
  )
}

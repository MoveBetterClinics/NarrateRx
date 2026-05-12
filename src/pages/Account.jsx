// /account — user-level profile, email, password, MFA, sessions.
//
// We mount Clerk's prebuilt <UserProfile /> rather than rebuild. The header
// UserButton menu also drops in to this same surface. Routing="path" lets
// Clerk's internal sub-routes (e.g. /account/security) work without us
// adding wildcard routes.

import { UserProfile } from '@clerk/clerk-react'
import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

export default function Account() {
  useDocumentTitle('Your account')
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild aria-label="Back home">
          <Link to="/">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Your account</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Update your profile, email, password, multi-factor authentication, and active sessions.
          </p>
        </div>
      </div>

      <UserProfile routing="path" path="/account" />
    </div>
  )
}

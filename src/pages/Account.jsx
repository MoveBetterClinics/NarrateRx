// /account — login & security only (email, password, MFA, sessions,
// connected accounts). We mount Clerk's prebuilt <UserProfile /> rather
// than rebuild. Routing="path" lets Clerk's internal sub-routes (e.g.
// /account/security) work without us adding wildcard routes.
//
// Clinician-shaped settings (display name, voice playback pace, content
// focus override, voice notes, recipes) live on /clinician/:id. The
// UserButton dropdown surfaces both with their own labels.

import { UserProfile } from '@clerk/react'
import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

export default function Account() {
  useDocumentTitle('Account & security')
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild aria-label="Back home">
          <Link to="/">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center">
            <span
              className="inline-block w-1 h-6 rounded-full shrink-0 mr-2.5"
              style={{ background: '#94a3b8' }}
              aria-hidden="true"
            />
            Account &amp; security
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Email, password, multi-factor authentication, and active sessions. Looking for your display name, voice pace, or content focus? Those live on your staff profile — open it from the avatar menu in the top-right.
          </p>
        </div>
      </div>

      <UserProfile routing="path" path="/account" />
    </div>
  )
}

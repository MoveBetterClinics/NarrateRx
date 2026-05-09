import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import {
  ClerkProvider,
  SignedIn,
  SignedOut,
  SignIn,
  useUser,
  useOrganizationList,
} from '@clerk/clerk-react'
import Layout from '@/components/Layout'
import Dashboard from '@/pages/Dashboard'
import NewInterview from '@/pages/NewInterview'
import InterviewSession from '@/pages/InterviewSession'
import InterviewOutput from '@/pages/InterviewOutput'
import ClinicianProfile from '@/pages/ClinicianProfile'
import Strategy from '@/pages/Strategy'
import ContentHub from '@/pages/ContentHub'
import ReviewPost from '@/pages/ReviewPost'
import ContentCalendar from '@/pages/ContentCalendar'
import MediaHub from '@/pages/MediaHub'
import Integrations from '@/pages/Integrations'
import WorkspaceSettings from '@/pages/WorkspaceSettings'
import { workspace } from '@/lib/workspace'

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

// Fetch the active workspace row from the API. Returns:
//   undefined  — fetch in flight
//   null       — no workspace (apex, preview URL, legacy deployment, local dev)
//   object     — workspace row including clerk_org_id
// Calling /api/workspace/me with no auth; endpoint resolves workspace from Host header.
function useWorkspaceContext() {
  const [ws, setWs] = useState(undefined)
  useEffect(() => {
    fetch('/api/workspace/me')
      .then(r => r.ok ? r.json() : null)
      .catch(() => null)
      .then(setWs)
  }, [])
  return ws
}

// Multitenant gate: verifies signed-in user is a member of the workspace's
// Clerk Org and activates it so subsequent JWTs carry org_id.
//
// Hard-gates per subdomain — only the org bound to this workspace is accepted.
// Cross-workspace switching is a Phase 1C concern (workspace switcher UI).
function OrgGate({ clerkOrgId, children }) {
  const { isLoaded, userMemberships, setActive } = useOrganizationList({
    userMemberships: { infinite: true },
  })
  const [activated, setActivated] = useState(false)

  const memberships = userMemberships?.data ?? []
  const match = isLoaded
    ? memberships.find(m => m.organization.id === clerkOrgId)
    : undefined

  useEffect(() => {
    if (!match || activated) return
    setActive({ organization: match.organization.id }).then(() => setActivated(true))
  }, [match, activated, setActive])

  // Still loading org list or waiting for setActive to settle.
  if (!isLoaded || (match && !activated)) return null

  if (!match) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="max-w-sm text-center space-y-3 p-8 border rounded-xl shadow-sm">
          <p className="text-3xl" aria-hidden="true">🔒</p>
          <h2 className="font-semibold text-lg">No access to this workspace</h2>
          <p className="text-sm text-muted-foreground">
            Your account isn't a member of this workspace. Ask your admin to send you an
            invite, or sign in with a different account.
          </p>
          <button
            onClick={() => window.Clerk?.signOut()}
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            Sign out
          </button>
        </div>
      </div>
    )
  }

  return children
}

// Legacy gate: email-domain check. Used for legacy per-brand Vercel deployments
// (SUPABASE_URL points to per-brand DB; /api/workspace/me returns 404), and for
// local dev where there's no subdomain. Can be retired once Phase 2 cutover
// decommissions the per-brand deployments.
function DomainGuard({ children }) {
  const { user } = useUser()
  const email = user?.primaryEmailAddress?.emailAddress ?? ''
  const allowed = workspace.authDomain
  if (!email.endsWith(`@${allowed}`)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="max-w-sm text-center space-y-3 p-8 border rounded-xl shadow-sm">
          <p className="text-3xl" aria-hidden="true">🚫</p>
          <h2 className="font-semibold text-lg">Access Restricted</h2>
          <p className="text-sm text-muted-foreground">
            This app is only available to <strong>@{allowed}</strong> accounts.
            You're signed in as <span className="font-mono text-xs">{email}</span>.
          </p>
          <button
            onClick={() => window.Clerk?.signOut()}
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            Sign out and try a different account
          </button>
        </div>
      </div>
    )
  }
  return children
}

// Routes shared between org-gated and domain-gated modes.
function AppRoutes() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/new" element={<NewInterview />} />
        <Route path="/interview/:clinicianId/:interviewId" element={<InterviewSession />} />
        <Route path="/output/:clinicianId/:interviewId" element={<InterviewOutput />} />
        <Route path="/clinician/:clinicianId" element={<ClinicianProfile />} />
        <Route path="/strategy" element={<Strategy />} />
        <Route path="/hub" element={<ContentHub />} />
        <Route path="/review/:itemId" element={<ReviewPost />} />
        <Route path="/calendar" element={<ContentCalendar />} />
        <Route path="/media" element={<MediaHub />} />
        <Route path="/settings/integrations" element={<Integrations />} />
        <Route path="/settings/workspace" element={<WorkspaceSettings />} />
      </Routes>
    </Layout>
  )
}

function ProtectedApp() {
  const ws = useWorkspaceContext()

  // Prefer workspace row from API; fall back to static config for sign-in branding.
  const signInName  = ws?.app_name    ?? workspace.appName
  const signInBlurb = ws?.sign_in_blurb ?? workspace.signInBlurb

  return (
    <>
      <SignedIn>
        {/* Hold SignedIn content until workspace fetch resolves to avoid a
            flash of the wrong guard. SignedOut renders immediately below. */}
        {ws === undefined ? null : ws?.clerk_org_id
          ? <OrgGate clerkOrgId={ws.clerk_org_id}><AppRoutes /></OrgGate>
          : <DomainGuard><AppRoutes /></DomainGuard>
        }
      </SignedIn>

      <SignedOut>
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="w-full max-w-md">
            <div className="text-center mb-6">
              <h1 className="text-xl font-bold">{signInName}</h1>
              <p className="text-sm text-muted-foreground">{signInBlurb}</p>
            </div>
            <SignIn
              appearance={{
                elements: {
                  rootBox: 'mx-auto',
                  card: 'shadow-sm border',
                },
              }}
            />
          </div>
        </div>
      </SignedOut>
    </>
  )
}

export default function App() {
  useEffect(() => {
    document.title = workspace.appName
  }, [])

  if (!PUBLISHABLE_KEY) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-sm text-muted-foreground">
          Missing <code>VITE_CLERK_PUBLISHABLE_KEY</code> environment variable.
        </p>
      </div>
    )
  }

  return (
    <ClerkProvider publishableKey={PUBLISHABLE_KEY}>
      <BrowserRouter>
        <ProtectedApp />
      </BrowserRouter>
    </ClerkProvider>
  )
}

import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom'
import {
  ClerkProvider,
  SignedIn,
  SignedOut,
  SignIn,
  useUser,
  useOrganizationList,
  useSession,
} from '@clerk/clerk-react'
import Layout from '@/components/Layout'
import Dashboard from '@/pages/Dashboard'
import { getPendingAnnouncement } from '@/lib/announcements'
const Welcome = lazy(() => import('@/pages/Welcome'))
const NewInterview = lazy(() => import('@/pages/NewInterview'))
const InterviewSession = lazy(() => import('@/pages/InterviewSession'))
const ClinicianProfile = lazy(() => import('@/pages/ClinicianProfile'))
const ReviewPost = lazy(() => import('@/pages/ReviewPost'))
const MediaHub = lazy(() => import('@/pages/MediaHub'))
const Integrations = lazy(() => import('@/pages/Integrations'))
const WorkspaceSettings = lazy(() => import('@/pages/WorkspaceSettings'))
const BrandKitPreview = lazy(() => import('@/pages/BrandKitPreview'))
const BrandKitSettings = lazy(() => import('@/pages/BrandKitSettings'))
const OnboardingBrandKit = lazy(() => import('@/pages/OnboardingBrandKit'))
const Members = lazy(() => import('@/pages/Members'))
const Account = lazy(() => import('@/pages/Account'))
const Onboarding = lazy(() => import('@/pages/Onboarding'))
const Stories = lazy(() => import('@/pages/Stories'))
const StoryDetail = lazy(() => import('@/pages/StoryDetail'))
import { workspace } from '@/lib/workspace'
import { WorkspaceProvider, useWorkspaceState } from '@/lib/WorkspaceContext'
import ErrorBoundary from '@/components/ErrorBoundary'
import RouteErrorBoundary from '@/components/RouteErrorBoundary'
import { setSentryUser, setSentryWorkspace } from '@/lib/sentry'
import { Toaster } from '@/lib/toast'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// Single shared QueryClient. Defaults: staleTime 30s, gcTime 5min,
// refetchOnWindowFocus off, retry once on transient query errors but never
// on 401/403/404 (won't fix themselves), no retry on mutations.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        const status = error?.status
        if (status === 401 || status === 403 || status === 404) return false
        return failureCount < 1
      },
    },
    mutations: { retry: false },
  },
})

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

// Multitenant gate: verifies signed-in user is a member of the workspace's
// Clerk Org and activates it so subsequent JWTs carry org_id.
//
// Hard-gates per subdomain — only the org bound to this workspace is accepted.
// Cross-workspace switching is a Phase 1C concern (workspace switcher UI).
function OrgGate({ clerkOrgId, children }) {
  const { isLoaded, userMemberships, setActive } = useOrganizationList({
    userMemberships: { infinite: true },
  })
  const { session } = useSession()

  const memberships = userMemberships?.data ?? []
  const match = isLoaded
    ? memberships.find(m => m.organization.id === clerkOrgId)
    : undefined

  // Drive setActive off the session's actual lastActiveOrganizationId rather
  // than a one-shot `activated` flag. setActive can resolve without the session
  // actually flipping (race with Clerk's own session restore on page load),
  // which left the JWT with no org_id and every gated endpoint returning
  // wrong-org. Re-running until the session reflects the expected org closes
  // that gap. Children only render once the active org matches.
  const activeOrgId = session?.lastActiveOrganizationId ?? null
  const isActive = match && activeOrgId === clerkOrgId

  useEffect(() => {
    if (!match || isActive) return
    setActive({ organization: match.organization.id }).catch(() => {})
  }, [match, isActive, setActive])

  // Still loading org list, or session hasn't flipped to the right org yet.
  if (!isLoaded || (match && !isActive)) return null

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

// Versioned announcement gate. If the user has any unseen entry in
// ANNOUNCEMENTS (defined in src/lib/announcements.js), redirect them to
// /welcome before showing the rest of the app. The first entry is the new-user
// intro; future entries become "what's new" notifications shown once on next
// login. Per-user seen state lives in Clerk's unsafeMetadata.seenAnnouncements.
// Paths that legitimately render even when there's a pending announcement.
// `/welcome` is the announcement target itself; `/onboard/brand-kit` is the
// final onboarding-wizard step on the new subdomain — both must show before
// the announcement gate redirects.
const WELCOME_GATE_BYPASS = new Set(['/welcome', '/onboard/brand-kit'])

function WelcomeGate({ children }) {
  const { user, isLoaded } = useUser()
  const location = useLocation()
  if (!isLoaded) return null
  const pending = getPendingAnnouncement(user)
  if (pending && !WELCOME_GATE_BYPASS.has(location.pathname)) {
    return <Navigate to="/welcome" replace />
  }
  return children
}

// Wraps a route element in a RouteErrorBoundary so a render throw in one
// page doesn't take out the whole app shell.
function guarded(node) {
  return <RouteErrorBoundary>{node}</RouteErrorBoundary>
}

// Legacy redirect: /output/:clinicianId/:interviewId → /stories/:interviewId
// The InterviewOutput page still exists; this route replaces the old path mapping.
function LegacyOutputRedirect() {
  const { interviewId } = useParams()
  return <Navigate to={`/stories/${interviewId}`} replace />
}

// Routes shared between org-gated and domain-gated modes.
function AppRoutes() {
  const location = useLocation()
  // /welcome renders standalone (no app chrome) so the intro feels like its
  // own surface rather than another dashboard tab. /onboard/brand-kit is the
  // final wizard step on the new subdomain; same treatment so it doesn't
  // double-render the workspace nav before the user has even finished setup.
  if (location.pathname === '/welcome' || location.pathname === '/onboard/brand-kit') {
    return (
      <WelcomeGate>
        <Suspense fallback={null}>
          <Routes>
            <Route path="/welcome" element={guarded(<Welcome />)} />
            <Route path="/onboard/brand-kit" element={guarded(<OnboardingBrandKit />)} />
          </Routes>
        </Suspense>
      </WelcomeGate>
    )
  }
  return (
    <WelcomeGate>
      <Layout>
        <Suspense fallback={null}>
          <Routes>
            <Route path="/" element={guarded(<Dashboard />)} />
            <Route path="/new" element={guarded(<NewInterview />)} />
            <Route path="/interview/:clinicianId/:interviewId" element={guarded(<InterviewSession />)} />
            <Route path="/interview/:clinicianId/:interviewId/output" element={guarded(<InterviewSession />)} />
            {/* /output legacy path → StoryDetail (interviewId is the anchor) */}
            <Route path="/output/:clinicianId/:interviewId" element={<LegacyOutputRedirect />} />
            <Route path="/clinician/:clinicianId" element={guarded(<ClinicianProfile />)} />
            <Route path="/stories" element={guarded(<Stories />)} />
            <Route path="/stories/:storyId" element={guarded(<StoryDetail />)} />
            <Route path="/library" element={guarded(<MediaHub />)} />
            <Route path="/review/:itemId" element={guarded(<ReviewPost />)} />
            <Route path="/review-queue" element={guarded(<Navigate to="/?bucket=review" replace />)} />
            {/* Legacy redirects — bookmark safety */}
            <Route path="/hub" element={<Navigate to="/stories" replace />} />
            <Route path="/calendar" element={<Navigate to="/stories?view=calendar" replace />} />
            <Route path="/strategy" element={<Navigate to="/" replace />} />
            <Route path="/media" element={<Navigate to="/library" replace />} />
            <Route path="/settings/integrations" element={guarded(<Integrations />)} />
            <Route path="/settings/workspace" element={guarded(<WorkspaceSettings />)} />
            <Route path="/settings/brand-kit" element={guarded(<BrandKitSettings />)} />
            <Route path="/settings/brand-kit-preview" element={guarded(<BrandKitPreview />)} />
            {/* Both Clerk-mounted pages use routing="path" so deep links to
                Clerk's own sub-routes resolve under the same base. */}
            <Route path="/settings/members/*" element={guarded(<Members />)} />
            <Route path="/account/*" element={guarded(<Account />)} />
          </Routes>
        </Suspense>
      </Layout>
    </WelcomeGate>
  )
}

// TEMP 2026-05-12: Workaround banner for an open Clerk bug where password
// sign-in on iOS WebKit (Safari + Chrome) silently stalls after first factor
// — clerk-js receives `status: "needs_client_trust"` and does nothing.
// Email-code sign-in bypasses device-trust and works. Remove this component
// (and its usage in SignedOut) once Clerk ships the fix. See:
// ~/.claude/projects/-Users-qbook-Claude-Projects-NarrateRx/memory/feedback_mobile_signin_silent_no_advance.md
function IosSignInHint() {
  const isIos = typeof navigator !== 'undefined' && (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
  if (!isIos) return null
  return (
    <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      <strong className="font-medium">On iPhone or iPad?</strong>{' '}
      If tapping <em>Continue</em> doesn&rsquo;t advance, choose{' '}
      <em>Use another method</em> &rarr; <em>Email verification code</em>{' '}
      to sign in.
    </div>
  )
}

function ProtectedApp() {
  const { workspace: ws, isLoading } = useWorkspaceState()
  const { user } = useUser()

  useEffect(() => { setSentryUser(user?.id ?? null) }, [user?.id])
  useEffect(() => { setSentryWorkspace(ws?.slug ?? null) }, [ws?.slug])

  // workspace row from context (DB on shared deployment; static-shaped fallback otherwise).
  const signInName  = ws?.app_name      ?? workspace.appName
  const signInBlurb = ws?.sign_in_blurb ?? workspace.signInBlurb

  return (
    <>
      <SignedIn>
        {/* Hold SignedIn content until workspace fetch resolves to avoid a
            flash of the wrong guard. SignedOut renders immediately below. */}
        {isLoading ? null : ws?.clerk_org_id
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
            <IosSignInHint />
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

// Apex-only: renders the onboarding wizard. No WorkspaceProvider (no workspace
// exists yet) and no OrgGate/DomainGuard (Clerk Org is created server-side at
// the claim step).
function OnboardingShell() {
  return (
    <Suspense fallback={null}>
      <RouteErrorBoundary>
        <Onboarding />
      </RouteErrorBoundary>
    </Suspense>
  )
}

// The protected app needs WorkspaceProvider so the Settings/etc. pages can
// resolve the active workspace. /onboard wraps with neither — it lives outside
// the workspace context entirely.
function ProtectedAppWithProvider() {
  return (
    <WorkspaceProvider>
      <ProtectedApp />
    </WorkspaceProvider>
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
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ClerkProvider publishableKey={PUBLISHABLE_KEY}>
          <BrowserRouter>
            <Routes>
              {/* /onboard/brand-kit is the post-claim wizard step — it runs on
                  the new subdomain and needs WorkspaceProvider + OrgGate, so
                  it routes through ProtectedAppWithProvider rather than the
                  apex onboarding shell. */}
              <Route path="/onboard/brand-kit" element={<ProtectedAppWithProvider />} />
              <Route path="/onboard/*" element={<OnboardingShell />} />
              <Route path="*" element={<ProtectedAppWithProvider />} />
            </Routes>
          </BrowserRouter>
          <Toaster richColors position="top-right" closeButton />
        </ClerkProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  )
}

import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, Link, useLocation, useParams } from 'react-router-dom'
import { Analytics } from '@vercel/analytics/react'
import PrivacyPolicy from '@/pages/PrivacyPolicy'
import TermsOfService from '@/pages/TermsOfService'
import {
  ClerkProvider,
  SignIn,
  useAuth,
  useUser,
  useOrganizationList,
  useSession,
} from '@clerk/clerk-react'
import Layout from '@/components/Layout'
import Home from '@/pages/Home'
import { getPendingAnnouncement } from '@/lib/announcements'
const Welcome = lazy(() => import('@/pages/Welcome'))
const CapturePicker = lazy(() => import('@/pages/CapturePicker'))
const NewInterview = lazy(() => import('@/pages/NewInterview'))
const VoiceMemo = lazy(() => import('@/pages/VoiceMemo'))
const CaptureReview = lazy(() => import('@/pages/CaptureReview'))
const ImportUrl = lazy(() => import('@/pages/ImportUrl'))
const InterviewSession = lazy(() => import('@/pages/InterviewSession'))
const OnboardingInterview = lazy(() => import('@/pages/OnboardingInterview'))
const ClinicianProfile = lazy(() => import('@/pages/ClinicianProfile'))
const MediaHub = lazy(() => import('@/pages/MediaHub'))
const Integrations = lazy(() => import('@/pages/Integrations'))
const WorkspaceSettings = lazy(() => import('@/pages/WorkspaceSettings'))
const VoiceTonePage = lazy(() => import('@/pages/settings/VoiceTonePage'))
const PatientsTopicsPage = lazy(() => import('@/pages/settings/PatientsTopicsPage'))
const InterviewDefaultsPage = lazy(() => import('@/pages/settings/InterviewDefaultsPage'))
const ChannelsSettings = lazy(() => import('@/pages/settings/ChannelsSettings'))
const LocationsSettings = lazy(() => import('@/pages/settings/LocationsSettings'))
const BillingSettings = lazy(() => import('@/pages/settings/BillingSettings'))
const BrandKitPreview = lazy(() => import('@/pages/BrandKitPreview'))
const BrandKitSettings = lazy(() => import('@/pages/BrandKitSettings'))
const CarouselThemesSettings = lazy(() => import('@/pages/settings/CarouselThemesSettings'))
import SettingsLayout from '@/components/SettingsLayout'
const OnboardingBrandKit = lazy(() => import('@/pages/OnboardingBrandKit'))
const Members = lazy(() => import('@/pages/Members'))
const Account = lazy(() => import('@/pages/Account'))
const Onboarding = lazy(() => import('@/pages/Onboarding'))
const Stories = lazy(() => import('@/pages/Stories'))
const StoryDetail = lazy(() => import('@/pages/StoryDetail'))
const Synthesis = lazy(() => import('@/pages/Synthesis'))
import { workspace } from '@/lib/workspace'
import { WorkspaceProvider, useWorkspaceState } from '@/lib/WorkspaceContext'
import { UploadProgressProvider, useUploadProgress } from '@/lib/UploadProgressContext'
import UploadTray from '@/components/UploadTray'
import ErrorBoundary from '@/components/ErrorBoundary'
import RouteErrorBoundary from '@/components/RouteErrorBoundary'
import { setSentryUser, setSentryWorkspace } from '@/lib/sentry'
import { Toaster } from '@/lib/toast'
import UpdateAvailableModal from '@/components/UpdateAvailableModal'
import { useVersionCheck } from '@/lib/useVersionCheck'
import { useAppBusy } from '@/lib/appBusy'
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
            Your account isn&apos;t a member of this workspace. Ask your admin to send you an
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
            You&apos;re signed in as <span className="font-mono text-xs">{email}</span>.
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
function LegacyOutputRedirect() {
  const { interviewId } = useParams()
  return <Navigate to={`/stories/${interviewId}`} replace />
}

// Legacy redirect: /review/:itemId → /stories/:itemId
function LegacyReviewRedirect() {
  const { itemId } = useParams()
  return <Navigate to={`/stories/${itemId}`} replace />
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
            <Route path="/" element={guarded(<Home />)} />
            <Route path="/new" element={guarded(<CapturePicker />)} />
            <Route path="/new/interview" element={guarded(<NewInterview />)} />
            <Route path="/new/voice-memo" element={guarded(<VoiceMemo />)} />
            <Route path="/new/import" element={guarded(<ImportUrl />)} />
            <Route path="/capture/:clinicianId/:interviewId/review" element={guarded(<CaptureReview />)} />
            <Route path="/interview/:clinicianId/:interviewId" element={guarded(<InterviewSession />)} />
            <Route path="/onboard/interview" element={guarded(<OnboardingInterview />)} />
            {/* Legacy paths — both now redirect to /stories/:interviewId */}
            <Route path="/interview/:clinicianId/:interviewId/output" element={<LegacyOutputRedirect />} />
            <Route path="/output/:clinicianId/:interviewId" element={<LegacyOutputRedirect />} />
            <Route path="/clinician/:clinicianId" element={guarded(<ClinicianProfile />)} />
            <Route path="/stories" element={guarded(<Stories />)} />
            <Route path="/stories/:storyId" element={guarded(<StoryDetail />)} />
            <Route path="/synthesis" element={guarded(<Synthesis />)} />
            <Route path="/library" element={guarded(<MediaHub />)} />
            {/* Legacy redirects — /review/:itemId and /review-queue → new IA paths */}
            <Route path="/review/:itemId" element={<LegacyReviewRedirect />} />
            <Route path="/review-queue" element={<Navigate to="/?bucket=review" replace />} />
            {/* Legacy redirects — bookmark safety */}
            <Route path="/hub" element={<Navigate to="/stories" replace />} />
            <Route path="/calendar" element={<Navigate to="/stories?view=calendar" replace />} />
            <Route path="/strategy" element={<Navigate to="/" replace />} />
            <Route path="/media" element={<Navigate to="/library" replace />} />
            {/* Settings sub-pages share SettingsLayout (sidebar nav). */}
            <Route element={<SettingsLayout />}>
              <Route path="/settings/workspace" element={guarded(<WorkspaceSettings />)} />
              <Route path="/settings/workspace/voice" element={guarded(<VoiceTonePage />)} />
              <Route path="/settings/workspace/patients" element={guarded(<PatientsTopicsPage />)} />
              <Route path="/settings/workspace/interview-defaults" element={guarded(<InterviewDefaultsPage />)} />
              <Route path="/settings/workspace/locations" element={guarded(<LocationsSettings />)} />
              <Route path="/settings/workspace/channels" element={guarded(<ChannelsSettings />)} />
              <Route path="/settings/workspace/billing" element={guarded(<BillingSettings />)} />
              <Route path="/settings/integrations" element={guarded(<Integrations />)} />
              <Route path="/settings/brand-kit" element={guarded(<BrandKitSettings />)} />
              <Route path="/settings/brand-kit-preview" element={guarded(<BrandKitPreview />)} />
              <Route path="/settings/carousel-themes" element={guarded(<CarouselThemesSettings />)} />
              {/* Clerk-mounted pages use routing="path" so their deep links resolve. */}
              <Route path="/settings/members/*" element={guarded(<Members />)} />
            </Route>
            <Route path="/account/*" element={guarded(<Account />)} />
          </Routes>
        </Suspense>
      </Layout>
    </WelcomeGate>
  )
}

function ProtectedApp() {
  const { workspace: ws, isLoading } = useWorkspaceState()
  const { user } = useUser()
  // Explicit Clerk hydration gate. Using <SignedIn>/<SignedOut> directly caused
  // a one-frame flash of the sign-in panel during normal use — Clerk's silent
  // session-token refresh (and tab-focus revalidation) can briefly report
  // `isSignedIn=false` before the new token settles, and the SignedOut branch
  // rendered for that frame. Holding both branches until `isLoaded` is true
  // eliminates the flash because the sign-in panel only renders once Clerk
  // has definitively confirmed there is no session.
  const { isLoaded, isSignedIn } = useAuth()

  useEffect(() => { setSentryUser(user?.id ?? null) }, [user?.id])
  useEffect(() => { setSentryWorkspace(ws?.slug ?? null) }, [ws?.slug])

  // workspace row from context (DB on shared deployment; static-shaped fallback otherwise).
  const signInName  = ws?.app_name      ?? workspace.appName
  const signInBlurb = ws?.sign_in_blurb ?? workspace.signInBlurb

  if (!isLoaded) return null

  if (isSignedIn) {
    // Hold workspace-gated content until the /api/workspace/me fetch resolves
    // so we don't flash the wrong guard (Org vs Domain).
    if (isLoading) return null
    return ws?.clerk_org_id
      ? <OrgGate clerkOrgId={ws.clerk_org_id}><AppRoutes /></OrgGate>
      : <DomainGuard><AppRoutes /></DomainGuard>
  }

  return (
    <div className="min-h-screen flex items-start sm:items-center justify-center bg-background px-4 py-8">
      <div className="w-full flex flex-col items-center">
        <div className="text-center mb-6 max-w-md">
          <h1 className="text-xl font-bold">{signInName}</h1>
          <p className="text-sm text-muted-foreground">{signInBlurb}</p>
        </div>
        <SignIn
          appearance={{
            layout: {
              logoImageUrl: '/narraterx-logo.svg',
              logoPlacement: 'inside',
            },
            elements: {
              rootBox: 'mx-auto w-full max-w-sm',
              card: 'shadow-sm border w-full',
              logoImage: 'h-14 w-auto',
              logoBox: 'h-14',
            },
          }}
        />
        <div className="flex gap-4 justify-center mt-6 text-xs text-muted-foreground">
          <Link to="/privacy" className="hover:text-foreground transition-colors">Privacy Policy</Link>
          <Link to="/terms" className="hover:text-foreground transition-colors">Terms of Service</Link>
          <Link to="/status" className="hover:text-foreground transition-colors">Status</Link>
        </div>
      </div>
    </div>
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
      <UploadProgressProvider>
        <ProtectedApp />
        {/* Floating upload tray — only renders when uploads.length > 0.
            Lives at the protected-app layer so progress survives modal
            close and in-app navigation. */}
        <UploadTray />
        {/* Auto-update notifier — lifted here (inside UploadProgressProvider)
            so it can suppress the reload prompt while uploads/recordings are
            in flight. window.location.reload() mid-recording would discard
            the in-memory transcript before it's persisted. */}
        <VersionUpdateHost />
      </UploadProgressProvider>
    </WorkspaceProvider>
  )
}

function VersionUpdateHost() {
  const { update, reload, dismiss } = useVersionCheck()
  const { hasActiveUploads } = useUploadProgress()
  const interactiveBusy = useAppBusy()
  const busy = hasActiveUploads || interactiveBusy

  function handleReload() {
    if (busy) {
      const ok = window.confirm(
        'You have work in progress (a recording, generation, or upload). Reloading now may discard unsaved changes. Reload anyway?',
      )
      if (!ok) return
    }
    reload()
  }

  return (
    <UpdateAvailableModal
      open={Boolean(update) && !busy}
      update={update}
      onReload={handleReload}
      onDismiss={dismiss}
    />
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
              {/* Public pages — no auth required */}
              <Route path="/privacy" element={<PrivacyPolicy />} />
              <Route path="/terms" element={<TermsOfService />} />
              {/* The apex wizard lives at /onboard exactly. Anything deeper
                  (/onboard/brand-kit, /onboard/interview) is part of the
                  authenticated app and falls through to the * catch-all
                  below, which dispatches to ProtectedAppWithProvider →
                  inner Routes. Older code used /onboard/* here with explicit
                  exemptions for the deep paths, but that pattern broke
                  React Router's descendant-Routes matching: the parent
                  consumed the full URL with no splat remaining, so the
                  inner <Route path="/"> (Home) matched the "empty index"
                  and rendered Home at /onboard/interview. Using /onboard
                  exact + * catch-all sidesteps the descendant-matching
                  trap. */}
              <Route path="/onboard" element={<OnboardingShell />} />
              <Route path="*" element={<ProtectedAppWithProvider />} />
            </Routes>
          </BrowserRouter>
          <Analytics />
          <Toaster richColors position="top-right" closeButton />
        </ClerkProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  )
}

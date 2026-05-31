import { lazy, Suspense, useEffect, useState } from 'react'
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
} from '@clerk/react'
import Layout from '@/components/Layout'
import Home from '@/pages/Home'
import { useCapability } from '@/lib/usePermission'
import { CAP_INTERVIEW_START } from '@/lib/capabilities'
import { getPendingAnnouncement } from '@/lib/announcements'
const Welcome = lazy(() => import('@/pages/Welcome'))
const CapturePicker = lazy(() => import('@/pages/CapturePicker'))
const NewInterview = lazy(() => import('@/pages/NewInterview'))
const VoiceMemo = lazy(() => import('@/pages/VoiceMemo'))
const HandoutCapture = lazy(() => import('@/pages/HandoutCapture'))
const VoiceTraining = lazy(() => import('@/pages/VoiceTraining'))
const PhoneCall = lazy(() => import('@/pages/PhoneCall'))
const CaptureReview = lazy(() => import('@/pages/CaptureReview'))
const ImportUrl = lazy(() => import('@/pages/ImportUrl'))
const InterviewSession = lazy(() => import('@/pages/InterviewSession'))
const OnboardingInterview = lazy(() => import('@/pages/OnboardingInterview'))
const StaffProfile = lazy(() => import('@/pages/StaffProfile'))
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
const CampaignsSettings = lazy(() => import('@/pages/settings/CampaignsSettings'))
const AutoPublishSettings = lazy(() => import('@/pages/settings/AutoPublishSettings'))
import SettingsLayout from '@/components/SettingsLayout'
const OnboardingBrandKit = lazy(() => import('@/pages/OnboardingBrandKit'))
const Members = lazy(() => import('@/pages/Members'))
const AccessMatrix = lazy(() => import('@/pages/AccessMatrix'))
const Account = lazy(() => import('@/pages/Account'))
const Onboarding = lazy(() => import('@/pages/Onboarding'))
const Stories = lazy(() => import('@/pages/Stories'))
const StoryDetail = lazy(() => import('@/pages/StoryDetail'))
const Storyboard = lazy(() => import('@/pages/Storyboard'))
const StoryboardPiece = lazy(() => import('@/pages/StoryboardPiece'))
const StoryboardPublish = lazy(() => import('@/pages/StoryboardPublish'))
const Synthesis = lazy(() => import('@/pages/Synthesis'))
const PreVisitMessage = lazy(() => import('@/pages/PreVisitMessage'))
const AuthorMode = lazy(() => import('@/pages/AuthorMode'))
const Book = lazy(() => import('@/pages/Book'))
const EditorialTest = lazy(() => import('@/pages/EditorialTest'))
const Slate = lazy(() => import('@/pages/Slate'))
const Capture = lazy(() => import('@/pages/Capture'))
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
  const { getToken } = useAuth()

  // tokenReady: the issued JWT actually contains the correct org_id.
  // This closes the race where session.lastActiveOrganizationId has flipped
  // but getToken() still returns the previous org's cached token, causing
  // every API call on first render to return wrong-org.
  const [tokenReady, setTokenReady] = useState(false)

  const memberships = userMemberships?.data ?? []
  const match = isLoaded
    ? memberships.find(m => m.organization.id === clerkOrgId)
    : undefined

  // Drive setActive off the session's actual lastActiveOrganizationId rather
  // than a one-shot `activated` flag. setActive can resolve without the session
  // actually flipping (race with Clerk's own session restore on page load),
  // which left the JWT with no org_id and every gated endpoint returning
  // wrong-org. Re-running until the session reflects the expected org closes
  // that gap. Children only render once the active org matches AND the token
  // confirms the switch.
  const activeOrgId = session?.lastActiveOrganizationId ?? null
  const isActive = match && activeOrgId === clerkOrgId

  // Track whether we've been stuck at "waiting to activate" long enough to
  // show the user something other than a blank screen. Reported 2026-05-25
  // after #837/#840/#841 stopped the wrong-org error screen — but exposed a
  // separate failure mode where setActive resolves without flipping the
  // session and the original one-shot effect never retried, leaving OrgGate
  // returning null forever until manual reload.
  const [stuckLevel, setStuckLevel] = useState(0) // 0=ok, 1=loading-spinner, 2=offer-reload

  // noMatchSettled: have we confirmed "loaded but no membership match" is REAL
  // rather than a transient empty-list during cross-subdomain hydration? A hard
  // navigation to a workspace subdomain (e.g. a PWA cold launch on /capture)
  // can leave useOrganizationList reporting isLoaded:true with an empty
  // memberships array for a beat before Clerk restores the session — which used
  // to flash the "No access" card at a user who IS a member. We only treat
  // no-match as settled after a grace window + one-shot reload (empty list), or
  // immediately (non-empty list → the user genuinely isn't in this workspace).
  const [noMatchSettled, setNoMatchSettled] = useState(false)
  const membershipsEmpty = memberships.length === 0
  // Provisional = loaded, no match, but the list is still empty (likely
  // unhydrated). Hold here rather than rendering the dead-end card.
  const noMatchProvisional = isLoaded && !match && membershipsEmpty && !noMatchSettled

  // Retry setActive periodically while !isActive. Clerk's setActive can
  // resolve without actually updating session.lastActiveOrganizationId
  // (especially after a cross-subdomain navigation where the session is
  // hydrating from cookies). One call isn't enough — keep trying every
  // 500ms. The effect's cleanup runs when isActive flips to true (deps
  // change), so success naturally stops the retries.
  useEffect(() => {
    if (!match || isActive) return
    let cancelled = false
    let attempts = 0
    const MAX_ATTEMPTS = 10 // 10 × 500ms = 5s before giving up

    async function tryActivate() {
      if (cancelled) return
      attempts++
      try {
        await setActive({ organization: match.organization.id })
      } catch (e) {
        console.warn(`[OrgGate] setActive attempt ${attempts} threw:`, e?.message || e)
      }
      // Wait for session state to propagate. If it flipped, isActive becomes
      // true on the next render, this effect's cleanup fires, cancelled=true.
      await new Promise(resolve => { setTimeout(resolve, 500) })
      if (cancelled) return
      if (attempts < MAX_ATTEMPTS) {
        tryActivate()
      } else {
        console.error(`[OrgGate] setActive(${match.organization.id}) failed to flip session after ${MAX_ATTEMPTS} attempts. activeOrgId=${activeOrgId}`)
      }
    }

    tryActivate()
    return () => { cancelled = true }
  }, [match, isActive, setActive, activeOrgId])

  // Stuck-detection timers + auto-reload escape hatch.
  //
  // Despite #842 retrying setActive 10x at 500ms intervals, prod testing
  // confirmed Clerk's session sometimes refuses to flip the active org no
  // matter how many times setActive is called — only a fresh page load
  // rehydrates it correctly. So at the 2s mark we reload automatically
  // (initially 5s in #843, dropped to 2s after the user confirmed setActive
  // retries provide no benefit in the wedged-session case — the wait was
  // just delaying the inevitable reload). 2s is the floor: shorter risks
  // pre-empting a legitimately-slow happy-path render, since Clerk hydration
  // can take up to ~1s on cold loads.
  //
  // Loop guard: sessionStorage flag ensures only ONE auto-reload per arrival.
  // If the reload also doesn't fix it, we leave the manual "Reload page"
  // button visible so the user has agency without us pinging Clerk forever.
  // The flag is cleared the moment children successfully render (effect
  // below), so each new arrival gets a fresh chance to auto-recover.
  useEffect(() => {
    if (!isLoaded || !match) { setStuckLevel(0); return }
    if (isActive && tokenReady) { setStuckLevel(0); return }
    const t1 = setTimeout(() => setStuckLevel(s => Math.max(s, 1)), 800)
    const t2 = setTimeout(() => {
      setStuckLevel(s => Math.max(s, 2))
      // Auto-reload once per arrival. A full page-load reliably re-hydrates
      // Clerk into a clean state where the session reflects the cookie-stored
      // active org (which our switcher's setActive already updated).
      if (typeof window !== 'undefined' && typeof sessionStorage !== 'undefined') {
        try {
          const key = 'narraterx:orggate-stuck-reloaded'
          if (!sessionStorage.getItem(key)) {
            sessionStorage.setItem(key, '1')
            console.warn('[OrgGate] session failed to activate within 2s; auto-reloading once')
            window.location.reload()
          } else {
            console.error('[OrgGate] still stuck after auto-reload; surfacing manual Reload button')
          }
        } catch { /* sessionStorage disabled — show the button */ }
      }
    }, 2000)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [isLoaded, match, isActive, tokenReady])

  // Clear the auto-reload guard the moment the gate successfully unblocks,
  // so the NEXT workspace switch in the same tab starts with a clean slate
  // and can auto-recover if it also gets stuck.
  useEffect(() => {
    if (isActive && tokenReady && typeof sessionStorage !== 'undefined') {
      try { sessionStorage.removeItem('narraterx:orggate-stuck-reloaded') } catch { /* noop */ }
    }
  }, [isActive, tokenReady])

  // No-match hydration race: when loaded with no match AND an empty membership
  // list, give Clerk a grace window to finish restoring the session, then
  // auto-reload once (a fresh load reliably rehydrates the membership list on a
  // cross-subdomain hard navigation — same escape hatch as the stuck-active
  // path above). Only after that reload also yields nothing do we mark the
  // no-match as settled, which surfaces the "No access" card. A non-empty list
  // with no match skips this entirely (the user genuinely isn't a member).
  useEffect(() => {
    if (!noMatchProvisional) return
    const key = 'narraterx:orggate-nomatch-reloaded'
    const t = setTimeout(() => {
      let reloaded = false
      if (typeof window !== 'undefined' && typeof sessionStorage !== 'undefined') {
        try {
          if (!sessionStorage.getItem(key)) {
            sessionStorage.setItem(key, '1')
            console.warn('[OrgGate] loaded with empty memberships and no match within grace; auto-reloading once')
            window.location.reload()
            reloaded = true
          } else {
            console.error('[OrgGate] still no membership match after auto-reload; surfacing No access')
          }
        } catch { /* sessionStorage disabled — fall through to settle */ }
      }
      if (!reloaded) setNoMatchSettled(true)
    }, 2500) // > the 2s active-flip floor; membership-list hydration is a superset
    return () => clearTimeout(t)
  }, [noMatchProvisional])

  // Clear the no-match reload guard once a real match appears, so a later
  // workspace switch in the same tab can auto-recover from this race again.
  useEffect(() => {
    if (match && typeof sessionStorage !== 'undefined') {
      try { sessionStorage.removeItem('narraterx:orggate-nomatch-reloaded') } catch { /* noop */ }
    }
  }, [match])

  // Once the session says the right org is active, confirm the issued token
  // actually carries that org before letting children fetch any API routes.
  //
  // Two failure modes the original single-shot check missed:
  //   A) getToken() rejects (Clerk not yet hydrated on new subdomain, brief
  //      network hiccup) → was immediately optimistic → children rendered with
  //      stale token → wrong-org API failures.
  //   B) token parses but still carries the previous org_id (token rotation
  //      lags behind session flip) → tokenReady stayed false forever because
  //      isActive was already true and the effect never re-ran.
  //
  // Fix: retry both cases at 250ms intervals for up to ~3s before falling back.
  useEffect(() => {
    if (!isActive) { setTokenReady(false); return }
    let cancelled = false
    let attempts = 0
    const MAX_ATTEMPTS = 12 // 12 × 250ms ≈ 3s max wait

    function checkToken() {
      if (cancelled) return
      getToken({ skipCache: true })
        .then((tok) => {
          if (cancelled) return
          try {
            const payload = JSON.parse(atob(tok.split('.')[1]))
            if (payload.org_id === clerkOrgId) {
              setTokenReady(true)
            } else if (attempts++ < MAX_ATTEMPTS) {
              // Token not yet rotated — retry
              setTimeout(checkToken, 250)
            } else {
              // Exhausted retries. Fall through; wrong-org API errors are
              // better UX than a permanently blank screen.
              setTokenReady(true)
            }
          } catch {
            setTokenReady(true) // unparseable token — let it through; API will gate
          }
        })
        .catch(() => {
          if (cancelled) return
          if (attempts++ < MAX_ATTEMPTS) {
            // Clerk not fully hydrated yet or transient network — retry
            setTimeout(checkToken, 250)
          } else {
            setTokenReady(true) // exhausted retries — optimistic fallback
          }
        })
    }

    checkToken()
    return () => { cancelled = true }
  }, [isActive, clerkOrgId, getToken])

  // Still loading org list, org switch pending, or token hasn't refreshed yet.
  // Returns a loading state instead of blank to avoid the "white screen until
  // manual reload" UX reported 2026-05-25.
  if (!isLoaded || (match && (!isActive || !tokenReady)) || noMatchProvisional) {
    if (stuckLevel === 0 && !noMatchProvisional) return null // brief, normal-case — no flash
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="max-w-sm text-center space-y-3 p-8">
          <div
            className="mx-auto h-8 w-8 rounded-full border-2 border-muted border-t-primary animate-spin"
            aria-hidden="true"
          />
          {stuckLevel === 1 && (
            <p className="text-sm text-muted-foreground">Switching workspace…</p>
          )}
          {stuckLevel === 2 && (
            <>
              <p className="text-sm text-muted-foreground">
                Workspace session is taking longer than expected. A page reload
                usually resolves this.
              </p>
              <button
                onClick={() => {
                  try { sessionStorage.removeItem('narraterx:orggate-stuck-reloaded') } catch { /* noop */ }
                  window.location.reload()
                }}
                className="text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                Reload page
              </button>
            </>
          )}
        </div>
      </div>
    )
  }

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

// Legacy redirect: /output/:staffId/:interviewId → /stories/:interviewId
function LegacyOutputRedirect() {
  const { interviewId } = useParams()
  return <Navigate to={`/stories/${interviewId}`} replace />
}

// Legacy redirect: /review/:itemId → /stories/:itemId
function LegacyReviewRedirect() {
  const { itemId } = useParams()
  return <Navigate to={`/stories/${itemId}`} replace />
}

// Legacy redirect: /clinician/:staffId → /staff/:staffId. The roster entity was
// renamed clinician→staff (2026-05-29); preserve old bookmarked profile links
// (and any ?tab=voice query) so in-flight links don't 404.
function LegacyStaffRedirect() {
  const { staffId } = useParams()
  const { search } = useLocation()
  return <Navigate to={`/staff/${staffId}${search}`} replace />
}

// Phase 4: users without interview.start capability (producers in the default
// template, viewers, etc.) land on /slate as their home. Users with the
// capability see Home as before. Wrapped at the / route so the redirect
// happens at the routing layer, not after Home's data fetches kick off.
function HomeOrSlateForProducer() {
  const canStartInterview = useCapability(CAP_INTERVIEW_START)
  if (!canStartInterview) return <Navigate to="/slate" replace />
  return <Home />
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
            <Route path="/" element={guarded(<HomeOrSlateForProducer />)} />
            <Route path="/new" element={guarded(<CapturePicker />)} />
            <Route path="/new/interview" element={guarded(<NewInterview />)} />
            <Route path="/new/voice-memo" element={guarded(<VoiceMemo />)} />
            <Route path="/new/handout" element={guarded(<HandoutCapture />)} />
            <Route path="/settings/voice-training" element={guarded(<VoiceTraining />)} />
            <Route path="/new/live-interview" element={guarded(<PhoneCall />)} />
            {/* Legacy redirect — the Phase 5 spike originally shipped as
                /new/phone-call. Kept for bookmark safety after the
                2026-05-24 rename to /new/live-interview. */}
            <Route path="/new/phone-call" element={<Navigate to="/new/live-interview" replace />} />
            <Route path="/new/import" element={guarded(<ImportUrl />)} />
            <Route path="/capture/:staffId/:interviewId/review" element={guarded(<CaptureReview />)} />
            <Route path="/interview/:staffId/:interviewId" element={guarded(<InterviewSession />)} />
            <Route path="/onboard/interview" element={guarded(<OnboardingInterview />)} />
            {/* Legacy paths — both now redirect to /stories/:interviewId */}
            <Route path="/interview/:staffId/:interviewId/output" element={<LegacyOutputRedirect />} />
            <Route path="/output/:staffId/:interviewId" element={<LegacyOutputRedirect />} />
            <Route path="/staff/:staffId" element={guarded(<StaffProfile />)} />
            <Route path="/clinician/:staffId" element={<LegacyStaffRedirect />} />
            <Route path="/stories" element={guarded(<Stories />)} />
            <Route path="/stories/:storyId" element={guarded(<StoryDetail />)} />
            <Route path="/synthesis" element={guarded(<Synthesis />)} />
            <Route path="/write" element={guarded(<AuthorMode />)} />
            <Route path="/book"  element={guarded(<Book />)} />
            <Route path="/library" element={guarded(<MediaHub />)} />
            {/* Storyboard — the content→media tool. Open a draft to review +
                attach media at full size. /needs-media redirects to it. */}
            <Route path="/storyboard" element={guarded(<Storyboard />)} />
            <Route path="/storyboard/:pieceId" element={guarded(<StoryboardPiece />)} />
            <Route path="/storyboard/:pieceId/publish" element={guarded(<StoryboardPublish />)} />
            <Route path="/needs-media" element={<Navigate to="/storyboard" replace />} />
            {/* Universal PWA capture surface — works on any device with a browser + camera. */}
            <Route path="/capture" element={guarded(<Capture />)} />
            {/* Phase 3 Story Director — daily story slate for producers + clinicians. */}
            <Route path="/slate" element={guarded(<Slate />)} />
            {/* Internal dev surface — Phase 2 editorial pipeline test (search clips + render). */}
            <Route path="/internal/editorial-test" element={guarded(<EditorialTest />)} />
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
              <Route path="/settings/campaigns" element={guarded(<CampaignsSettings />)} />
              <Route path="/settings/workspace/auto-publish" element={guarded(<AutoPublishSettings />)} />
              {/* Clerk-mounted pages use routing="path" so their deep links resolve. */}
              <Route path="/settings/members/*" element={guarded(<Members />)} />
              <Route path="/settings/access" element={guarded(<AccessMatrix />)} />
            </Route>
            <Route path="/pre-visit" element={guarded(<PreVisitMessage />)} />
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

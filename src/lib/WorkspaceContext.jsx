import { createContext, useContext, useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@clerk/clerk-react'
import { workspace as STATIC } from './workspace'
import { queryKeys } from './queries'

// Adapter: shape the static config like a DB row (snake_case, flat).
// Used as fallback on legacy per-brand deployments where /api/workspace/me 404s.
const STATIC_AS_ROW = {
  id: STATIC.id,
  slug: `movebetter-${STATIC.id}`,
  display_name: STATIC.name,
  app_name: STATIC.appName,
  tagline: STATIC.tagline,
  sign_in_blurb: STATIC.signInBlurb,
  website: STATIC.website,
  website_hostname: STATIC.websiteHostname,
  location: STATIC.location,
  region: STATIC.region,
  region_short: STATIC.regionShort,
  social_avatar_initials: STATIC.socialAvatarInitials,
  link_preview_blurb: STATIC.linkPreviewBlurb,
  linkedin_industry: STATIC.linkedInIndustry,
  social: STATIC.social,
  logo: STATIC.logo,
  colors: STATIC.colors,
  clinic_context: STATIC.prompt.clinicContext,
  audience_description: STATIC.prompt.audienceDescription,
  audience_short: STATIC.prompt.audienceShort,
  brand_voice: STATIC.prompt.brandVoice,
  internal_links_markdown: STATIC.prompt.internalLinksMarkdown,
  booking_url: STATIC.prompt.bookingUrl,
  signature_system_name: STATIC.prompt.signatureSystemName,
  signature_system_url: STATIC.prompt.signatureSystemUrl,
  pinterest_boards: STATIC.prompt.pinterestBoards,
  location_keyword: STATIC.prompt.locationKeyword,
  location_hashtag: STATIC.prompt.locationHashtag,
  brand_hashtag: STATIC.prompt.brandHashtag,
  spoken_url: STATIC.prompt.spokenUrl,
  activity_context: STATIC.prompt.sportContext,
  capabilities: STATIC.capabilities || {},
  newsletter_template_name: STATIC.newsletterTemplateName,
  newsletter_copy_header: STATIC.newsletterCopyHeader,
  enabled_outputs: [],
}

const WorkspaceContext = createContext({ workspace: STATIC_AS_ROW, isLoading: false, source: 'static', error: null })

// Apex / www / preview URLs legitimately return 404 from /api/workspace/me and
// fall through to STATIC. Subdomain hosts (the multi-tenant production case)
// should always resolve a DB workspace — a fetch failure there means the user
// is potentially seeing the wrong tenant's branding, so we surface a banner
// rather than silently substituting STATIC.
function isSubdomainHost() {
  if (typeof window === 'undefined') return false
  const host = window.location.hostname
  if (host.endsWith('.narraterx.ai') && host !== 'www.narraterx.ai') return true
  return false
}

// fetchWorkspaceMe returns a discriminated result so the consumer can tell
// "404 — apex/preview, fall back to STATIC silently" from "5xx — something is
// actually wrong on a subdomain". TanStack treats throws as errors and resolves
// as success; we resolve normally and let the consumer branch.
// Attach the Clerk bearer token when the session is hydrated so the server
// returns the full workspace row (brand_voice, patient_context, etc.).
// Unauthenticated callers — including this same fetch on first paint before
// Clerk hydrates — get a slim public-branding shape used by the sign-in page.
async function fetchWorkspaceMe({ skipCache = false } = {}) {
  const headers = {}
  try {
    // skipCache forces Clerk to mint a fresh JWT. We need this on the slim-
    // shape recovery path because Clerk's cached token may have been issued
    // before the org membership we need was active in the session.
    const token = await window.Clerk?.session?.getToken?.(skipCache ? { skipCache: true } : undefined)
    if (token) headers.Authorization = `Bearer ${token}`
  } catch { /* unauth fetch is the supported fallback */ }
  const r = await fetch('/api/workspace/me', { headers, credentials: 'include' })
  if (r.ok) return { row: await r.json(), status: 200 }
  return { row: null, status: r.status }
}

export function WorkspaceProvider({ children }) {
  // Single source of truth for /api/workspace/me. Other components can now
  // invalidate this key (queryKeys.workspace.me) after a settings PATCH to
  // get the new row without a full page reload.
  const { data, isLoading, error: queryError } = useQuery({
    queryKey: queryKeys.workspace.me,
    queryFn: fetchWorkspaceMe,
    // The workspace row changes infrequently — keep it warm across the
    // session. Settings page invalidates on save when the user edits it.
    staleTime: 5 * 60_000,
  })

  // When the Clerk session flips (sign-in, sign-out, org switch), refetch
  // /api/workspace/me so the slim public-branding shape served pre-auth is
  // replaced by the full row — and vice versa on sign-out. Without this, the
  // first fetch (unauth) stays cached for the staleTime window and signed-in
  // pages that need brand_voice / patient_context render empty.
  const { isLoaded, isSignedIn, orgId } = useAuth()
  const qc = useQueryClient()
  useEffect(() => {
    if (!isLoaded) return
    qc.invalidateQueries({ queryKey: queryKeys.workspace.me })
  }, [isLoaded, isSignedIn, orgId, qc])

  // Slim-shape recovery. The server returns { slim_branding: true, ... } when
  // it couldn't bind the request to a JWT matching this workspace's org. That
  // can happen legitimately (truly unauth) but it also fires during sign-in
  // when WorkspaceContext's first fetch raced ahead of Clerk's session
  // hydration: useAuth().isSignedIn flipping true does NOT guarantee that
  // window.Clerk.session.getToken() at the moment fetchWorkspaceMe ran
  // returned a token, and an empty Authorization header silently downgrades
  // to slim. The downstream symptom is fields like `book_mode` being absent
  // from the cached row, so consumers like Layout.jsx read undefined and
  // render the wrong nav. Without this guard the user has to hard-reload.
  //
  // Strategy: when Clerk reports signed-in but the cached row is slim, force
  // a refetch with getToken({ skipCache: true }) to mint a fresh JWT. Cap
  // attempts so a server that legitimately won't bind (e.g. wrong-org wedge
  // already being recovered elsewhere) doesn't produce a refetch loop.
  const slimRecoveryRef = useRef(0)
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return
    if (!data?.row?.slim_branding) return
    if (slimRecoveryRef.current >= 3) return
    slimRecoveryRef.current += 1
    qc.fetchQuery({
      queryKey: queryKeys.workspace.me,
      queryFn: () => fetchWorkspaceMe({ skipCache: true }),
      staleTime: 0,
    }).catch(() => { /* surfaced via the query's error path */ })
  }, [isLoaded, isSignedIn, orgId, data, qc])

  // Resolve workspace + error from the query result. Apex/www/preview hit
  // 404 and silently fall back to STATIC (the build-time legacy shape).
  // Subdomains that 404 or fail surface a banner instead of pretending.
  let workspace = STATIC_AS_ROW
  let source    = 'static'
  let error     = null
  if (data?.row) {
    workspace = data.row
    source    = 'db'
  } else if (queryError) {
    error = isSubdomainHost() ? 'workspace-fetch-failed' : null
  } else if (data && !data.row) {
    error = isSubdomainHost()
      ? (data.status === 404 ? 'workspace-not-found' : 'workspace-fetch-failed')
      : null
  }

  // Expose the workspace's expected clerk_org_id on window so the low-level
  // apiFetch retry path can target it when forcing a stuck Clerk session to
  // flip. apiFetch can't import WorkspaceContext (it's a hook), and threading
  // the org id through every caller is impractical — a window-scoped value
  // is the path of least coupling. Cleared when workspace resolves to STATIC
  // so a logged-out apex render doesn't leave a stale value behind.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (workspace?.clerk_org_id && source === 'db') {
      window.__narraterxExpectedClerkOrgId = workspace.clerk_org_id
    } else {
      delete window.__narraterxExpectedClerkOrgId
    }
  }, [workspace?.clerk_org_id, source])

  const state = { workspace, isLoading, source, error }

  return (
    <WorkspaceContext.Provider value={state}>
      {state.error && <WorkspaceErrorBanner error={state.error} />}
      {children}
    </WorkspaceContext.Provider>
  )
}

function WorkspaceErrorBanner({ error }) {
  const message = error === 'workspace-not-found'
    ? "We couldn't find a workspace for this address. Double-check the subdomain in the URL or contact your admin."
    : "We couldn't load your workspace settings. You're seeing default branding — refresh in a moment, or contact support if this persists."
  return (
    <div
      role="alert"
      className="bg-warning/10 border-b border-warning/30 text-warning px-4 py-2.5 text-sm flex items-start gap-3"
    >
      <span aria-hidden="true">⚠️</span>
      <div className="flex-1">{message}</div>
      <button
        onClick={() => window.location.reload()}
        className="text-xs font-medium underline-offset-4 hover:underline shrink-0"
      >
        Reload
      </button>
    </div>
  )
}

export function useWorkspace() {
  return useContext(WorkspaceContext).workspace
}

export function useWorkspaceState() {
  return useContext(WorkspaceContext)
}

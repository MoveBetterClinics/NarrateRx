import { createContext, useContext } from 'react'
import { useQuery } from '@tanstack/react-query'
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
async function fetchWorkspaceMe() {
  const r = await fetch('/api/workspace/me')
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
      className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-sm flex items-start gap-3"
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

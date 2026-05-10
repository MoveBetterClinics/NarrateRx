import { createContext, useContext, useEffect, useState } from 'react'
import { workspace as STATIC } from './workspace'

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

const WorkspaceContext = createContext({ workspace: STATIC_AS_ROW, isLoading: false, source: 'static' })

export function WorkspaceProvider({ children }) {
  const [state, setState] = useState({ workspace: STATIC_AS_ROW, isLoading: true, source: 'static' })

  useEffect(() => {
    fetch('/api/workspace/me')
      .then(r => r.ok ? r.json() : null)
      .catch(() => null)
      .then(row => {
        if (row) setState({ workspace: row, isLoading: false, source: 'db' })
        else    setState({ workspace: STATIC_AS_ROW, isLoading: false, source: 'static' })
      })
  }, [])

  return <WorkspaceContext.Provider value={state}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace() {
  return useContext(WorkspaceContext).workspace
}

export function useWorkspaceState() {
  return useContext(WorkspaceContext)
}

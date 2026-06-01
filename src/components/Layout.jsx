import { useState, useRef, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { UserButton, useAuth, useClerk } from '@clerk/react'
import { useQuery } from '@tanstack/react-query'
import { useSelfStaffId } from '@/lib/useSelfStaffId'
import { useEnsureSelfStaff } from '@/lib/useEnsureSelfStaff'
import {
  Plus, Settings, Building2, Menu, Palette, Layers, ChevronDown, ChevronLeft,
  Check, UserCircle, Mic2, BookOpen, PenLine, Clapperboard, Camera, GalleryHorizontalEnd,
  LayoutDashboard, Newspaper, FolderOpen, LayoutGrid,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerClose,
} from '@/components/ui/Drawer'
import { workspace as STATIC_WORKSPACE } from '@/lib/workspace'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { useUserRole } from '@/lib/useUserRole'
import { usePermission } from '@/lib/usePermission'
import {
  CAP_SETTINGS_VIEW, CAP_SETTINGS_EDIT, CAP_INTEGRATIONS_CONNECT,
  CAP_BRAND_KIT_EDIT, CAP_INTERVIEW_START,
} from '@/lib/capabilities'
import TrialBanner from '@/components/TrialBanner'

const APP_BYLINE = 'Voice-faithful clinical content'

// Primary navigation, grouped to mirror the producer journey. The first
// (unlabelled) group holds the two top-level surfaces — Home (personal) and
// Overview (clinic-wide) — then the work spine (Produce), the asset pool
// (Library), and the standalone Tools. The active item tracks the current
// stage as the user moves through the flow. All items have icons so they
// render correctly in collapsed (icon-only) mode.
const NAV_SECTIONS = [
  {
    items: [
      { to: '/',         label: 'Home',     match: (p) => p === '/',                  icon: LayoutDashboard,
        requiresCapability: CAP_INTERVIEW_START },
      // Overview — the clinic-wide board. Role-gated to editors (owner /
      // producer / director); individual clinicians never see it.
      { to: '/overview', label: 'Overview', hint: 'Clinic', match: (p) => p.startsWith('/overview'), icon: LayoutGrid,
        requiresEditor: true },
    ],
  },
  {
    label: 'Produce',
    items: [
      { to: '/stories',    label: 'Stories',    hint: 'Words',           match: (p) => p.startsWith('/stories'),  icon: Newspaper,
        requiresCapability: CAP_INTERVIEW_START },
      // Storyboard — the content→media stage (Media · Publish). Ungated like
      // Library so producers (no interview.start) see it. '/needs-media' is
      // the old route, redirected.
      { to: '/storyboard', label: 'Storyboard', hint: 'Media · Publish', match: (p) => p.startsWith('/storyboard') || p.startsWith('/needs-media'), icon: GalleryHorizontalEnd },
    ],
  },
  {
    label: 'Library',
    items: [
      { to: '/library', label: 'Library', match: (p) => p.startsWith('/library'), icon: FolderOpen },
      { to: '/capture', label: 'Capture', match: (p) => p.startsWith('/capture'), icon: Camera },
    ],
  },
  {
    label: 'Tools',
    items: [
      { to: '/book',      label: 'Book',      match: (p) => p.startsWith('/book'),      icon: BookOpen,
        requiresCapability: CAP_INTERVIEW_START },
      { to: '/write',     label: 'Write',     match: (p) => p.startsWith('/write'),     icon: PenLine,
        hideWhenBookMode: 'group', requiresCapability: CAP_INTERVIEW_START },
      { to: '/pre-visit', label: 'Pre-Visit', match: (p) => p.startsWith('/pre-visit'), icon: Mic2,
        requiresCapability: CAP_INTERVIEW_START },
      // Slate — the video→content tool. Only when the workspace opts into the
      // video pipeline.
      { to: '/slate',     label: 'Slate',     match: (p) => p.startsWith('/slate'),     icon: Clapperboard,
        showWhen: (ws) => ws?.video_pipeline_enabled === true },
    ],
  },
]

function readCollapsed() {
  try { return localStorage.getItem('sidebar-collapsed') === 'true' } catch (_e) { return false }
}

export default function Layout({ children }) {
  const location = useLocation()
  const { role, isEditor } = useUserRole()
  const { has: hasCapability } = usePermission()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const ws = useWorkspace()
  const selfStaffId = useSelfStaffId()
  useEnsureSelfStaff()
  const logoSrc = ws?.primary_logo_url || ws?.logo?.main || STATIC_WORKSPACE.logo.main
  const logoAlt = ws?.display_name || ws?.name || STATIC_WORKSPACE.name

  function toggleSidebar() {
    const next = !collapsed
    setCollapsed(next)
    try { localStorage.setItem('sidebar-collapsed', String(next)) } catch (_e) { /* non-critical */ }
  }

  function itemVisible(it) {
    if (it.requiresCapability && !hasCapability(it.requiresCapability)) return false
    if (it.requiresEditor && !isEditor) return false
    if (it.hideWhenBookMode && ws?.book_mode === it.hideWhenBookMode) return false
    if (it.showWhen && !it.showWhen(ws)) return false
    return true
  }
  // Resolve each section to its visible items, then drop any section that has
  // none left (so an empty group never renders a stray header).
  const navSections = NAV_SECTIONS
    .map((s) => ({ ...s, items: s.items.filter(itemVisible) }))
    .filter((s) => s.items.length > 0)

  const sidebarW = collapsed ? 'w-14' : 'w-56'
  const contentML = collapsed ? 'md:ml-14' : 'md:ml-56'

  // The Storyboard spine (queue → media → publish) is media-heavy: large
  // candidate grids and a full-size live preview that want every available
  // pixel. These pages opt out of the centered `.container` cap and run
  // edge-to-edge inside the sidebar offset (just gutter padding), so the grid
  // can grow to more columns and the preview/controls split stays balanced on
  // wide screens. Every other page keeps the comfortable reading-width cap.
  const fullBleed = location.pathname.startsWith('/storyboard')

  return (
    <div className="min-h-screen bg-background flex">

      {/* ── Left sidebar — desktop only ─────────────────────────────────── */}
      <aside className={`hidden md:flex fixed inset-y-0 left-0 ${sidebarW} flex-col border-r bg-white z-30 transition-[width] duration-200`}>

        {/* Logo */}
        <div className={`h-14 border-b shrink-0 flex items-center ${collapsed ? 'justify-center px-0' : 'px-4 gap-2.5'}`}>
          {collapsed ? (
            <Link to="/" aria-label="Home">
              <img src={logoSrc} alt={logoAlt} className="h-8 w-auto" />
            </Link>
          ) : (
            <Link to="/" className="flex items-center gap-2.5 min-w-0">
              <img src={logoSrc} alt={logoAlt} className="h-8 w-auto shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-semibold leading-none truncate">NarrateRx</p>
                <p className="text-3xs text-muted-foreground mt-0.5 leading-none truncate" title={APP_BYLINE}>
                  {APP_BYLINE}
                </p>
              </div>
            </Link>
          )}
        </div>

        {/* Workspace switcher — hidden when collapsed */}
        {!collapsed && (
          <div className="px-3 pt-2">
            <WorkspaceSwitcher inSidebar />
          </div>
        )}

        {/* New Interview — primary action at top of sidebar */}
        {hasCapability(CAP_INTERVIEW_START) && (
          <div className={`px-2 pt-2 pb-1 ${collapsed ? 'flex justify-center' : ''}`}>
            <Button asChild size="sm" className={collapsed ? 'h-9 w-9 p-0' : 'w-full justify-start gap-2'}>
              <Link to="/new" aria-label="New Interview">
                <Plus className="h-4 w-4 shrink-0" />
                {!collapsed && 'New Interview'}
              </Link>
            </Button>
          </div>
        )}

        {/* Primary nav — overflow-visible when collapsed so tooltips aren't clipped */}
        <nav className={`flex-1 px-2 py-2 ${collapsed ? 'overflow-visible' : 'overflow-y-auto'}`}>
          {navSections.map((section, si) => (
            <div key={section.label || 'top'} className={si > 0 ? 'pt-2' : ''}>
              {section.label && (collapsed ? (
                <div className="mx-2 my-1.5 border-t border-border/70" aria-hidden="true" />
              ) : (
                <p className="px-3 pt-1 pb-1 text-3xs font-semibold uppercase tracking-wider text-muted-foreground/60">
                  {section.label}
                </p>
              ))}
              <div className="space-y-0.5">
                {section.items.map((item) => (
                  <SidebarNavLink
                    key={item.to}
                    to={item.to}
                    label={item.label}
                    hint={item.hint}
                    active={item.match(location.pathname)}
                    icon={item.icon}
                    collapsed={collapsed}
                  />
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* Bottom section: secondary links + user button + collapse toggle */}
        <div className="border-t px-2 py-2 space-y-0.5">
          {role === 'admin' && (
            <SidebarNavLink
              to="/synthesis"
              label="Knowledge synthesis"
              icon={Layers}
              active={location.pathname.startsWith('/synthesis')}
              collapsed={collapsed}
            />
          )}
          {hasCapability(CAP_SETTINGS_VIEW) && (
            <SidebarNavLink
              to="/settings/workspace"
              label="Settings"
              icon={Settings}
              active={location.pathname.startsWith('/settings')}
              collapsed={collapsed}
            />
          )}
          {selfStaffId && hasCapability(CAP_INTERVIEW_START) && (
            <SidebarNavLink
              to={`/staff/${selfStaffId}`}
              label="My profile"
              icon={UserCircle}
              active={location.pathname.startsWith(`/staff/${selfStaffId}`)}
              collapsed={collapsed}
            />
          )}

          {/* UserButton */}
          <div className={`pt-1 ${collapsed ? 'flex justify-center' : 'px-1'}`}>
            <UserButton afterSignOutUrl="/" userProfileUrl="/account" />
          </div>

          {/* Collapse toggle */}
          <button
            type="button"
            onClick={toggleSidebar}
            className={`flex items-center gap-2 py-2 w-full rounded-md text-xs text-muted-foreground hover:bg-accent/40 hover:text-foreground transition-colors ${collapsed ? 'justify-center px-0' : 'px-3'}`}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <ChevronLeft className={`h-4 w-4 shrink-0 transition-transform duration-200 ${collapsed ? 'rotate-180' : ''}`} />
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      </aside>

      {/* ── Right column: header (mobile only) + content ───────────────── */}
      <div className={`flex-1 ${contentML} transition-[margin-left] duration-200`}>
        {/* Header is mobile-only — desktop nav lives in the sidebar.
            h-14 kept so SettingsLayout's mobile sticky top-14 rail stays correct. */}
        <header className="md:hidden sticky top-0 z-40 h-14 border-b bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80 shadow-sm flex items-center gap-3 px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2 min-w-0">
            <img src={logoSrc} alt={logoAlt} className="h-8 w-auto shrink-0" />
          </Link>

          <WorkspaceSwitcher />

          <div className="flex-1" />

          {hasCapability(CAP_INTERVIEW_START) && (
            <Button asChild size="sm">
              <Link to="/new">
                <Plus className="h-4 w-4 sm:mr-1.5" />
                <span className="hidden sm:inline">New Interview</span>
                <span className="sr-only sm:hidden">New Interview</span>
              </Link>
            </Button>
          )}

          <UserButton afterSignOutUrl="/" userProfileUrl="/account" />

          <button
            type="button"
            className="inline-flex items-center justify-center h-11 w-11 rounded-md border border-input text-muted-foreground hover:text-foreground active:bg-accent/40"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="h-4 w-4" />
          </button>
        </header>

        <TrialBanner />

        <main className={fullBleed ? 'px-4 sm:px-6 lg:px-8 py-8' : 'container py-8'}>
          {children}
        </main>
      </div>

      {/* ── Mobile drawer — nav + secondary links ───────────────────────── */}
      <Drawer open={mobileOpen} onOpenChange={setMobileOpen}>
        <DrawerContent side="bottom" className="px-4 pt-2 pb-4">
          <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-muted" aria-hidden />
          <DrawerHeader className="border-b-0 p-2">
            <DrawerTitle>Menu</DrawerTitle>
          </DrawerHeader>
          <div className="overflow-y-auto">
            {navSections.map((section, si) => (
              <div key={section.label || 'top'} className={si > 0 ? 'pt-2' : ''}>
                {section.label && (
                  <p className="px-3 pt-1 pb-1 text-2xs font-semibold uppercase tracking-wider text-muted-foreground/60">
                    {section.label}
                  </p>
                )}
                <div className="space-y-1">
                  {section.items.map((item) => (
                    <DrawerClose asChild key={item.to}>
                      <Link
                        to={item.to}
                        className={`flex items-center gap-2 px-3 py-3 rounded-md text-base font-medium ${item.match(location.pathname) ? 'bg-accent/40 text-foreground' : 'text-muted-foreground active:bg-accent/30'}`}
                      >
                        {item.icon && <item.icon className="h-4 w-4 shrink-0" />}
                        <span className="flex-1">{item.label}</span>
                        {item.hint && <span className="text-2xs text-muted-foreground/60">{item.hint}</span>}
                      </Link>
                    </DrawerClose>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="pt-3 mt-2 border-t space-y-1 overflow-y-auto">
            {role === 'admin' && hasCapability(CAP_SETTINGS_VIEW) && (
              <DrawerClose asChild>
                <Link to="/synthesis" className="flex items-center gap-2 px-3 py-3 rounded-md text-sm text-muted-foreground active:bg-accent/30">
                  <Layers className="h-4 w-4" /> Knowledge synthesis
                </Link>
              </DrawerClose>
            )}
            {hasCapability(CAP_SETTINGS_EDIT) && (
              <DrawerClose asChild>
                <Link to="/settings/workspace" className="flex items-center gap-2 px-3 py-3 rounded-md text-sm text-muted-foreground active:bg-accent/30">
                  <Building2 className="h-4 w-4" /> Workspace settings
                </Link>
              </DrawerClose>
            )}
            {hasCapability(CAP_BRAND_KIT_EDIT) && (
              <DrawerClose asChild>
                <Link to="/settings/brand-kit" className="flex items-center gap-2 px-3 py-3 rounded-md text-sm text-muted-foreground active:bg-accent/30">
                  <Palette className="h-4 w-4" /> Brand Kit
                </Link>
              </DrawerClose>
            )}
            {selfStaffId && hasCapability(CAP_INTERVIEW_START) && (
              <DrawerClose asChild>
                <Link to={`/staff/${selfStaffId}`} className="flex items-center gap-2 px-3 py-3 rounded-md text-sm text-muted-foreground active:bg-accent/30">
                  <UserCircle className="h-4 w-4" /> My staff profile
                </Link>
              </DrawerClose>
            )}
            <DrawerClose asChild>
              <Link to="/account" className="flex items-center gap-2 px-3 py-3 rounded-md text-sm text-muted-foreground active:bg-accent/30">
                <UserCircle className="h-4 w-4" /> Account &amp; security
              </Link>
            </DrawerClose>
            {hasCapability(CAP_INTEGRATIONS_CONNECT) && (
              <DrawerClose asChild>
                <Link to="/settings/integrations" className="flex items-center gap-2 px-3 py-3 rounded-md text-sm text-muted-foreground active:bg-accent/30">
                  <Settings className="h-4 w-4" /> Integrations
                </Link>
              </DrawerClose>
            )}
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  )
}

// WorkspaceSwitcher — renders nothing when the user has only one workspace.
// inSidebar=true: fills sidebar width; mobile header instance is md:hidden.
function WorkspaceSwitcher({ inSidebar = false }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const currentWs = useWorkspace()
  const { isSignedIn, getToken } = useAuth()
  const { setActive } = useClerk()

  const { data: workspaces = [] } = useQuery({
    queryKey: ['workspace-list'],
    queryFn: async () => {
      const token = await window.Clerk?.session?.getToken?.().catch(() => null)
      const headers = token ? { Authorization: `Bearer ${token}` } : {}
      const r = await fetch('/api/workspace/list', { credentials: 'include', headers })
      if (!r.ok) return []
      return r.json().catch(() => [])
    },
    enabled: !!isSignedIn,
    staleTime: 5 * 60_000,
    retry: false,
  })

  useEffect(() => {
    if (!open) return
    function onKey(e) { if (e.key === 'Escape') setOpen(false) }
    function onOutside(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onOutside)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onOutside)
    }
  }, [open])

  if (!Array.isArray(workspaces) || workspaces.length <= 1) return null

  async function handleSwitch(ws) {
    if (ws.slug === currentWs?.slug) { setOpen(false); return }
    setOpen(false)
    try {
      await setActive({ organization: ws.clerk_org_id })
      for (let i = 0; i < 8; i++) {
        const tok = await getToken({ skipCache: true }).catch(() => null)
        if (tok) {
          try {
            const { org_id } = JSON.parse(atob(tok.split('.')[1]))
            if (org_id === ws.clerk_org_id) break
          } catch { /* keep polling */ }
        }
        await new Promise(resolve => { setTimeout(resolve, 250) })
      }
    } catch {
      // navigate anyway — OrgGate handles activation on the destination
    }
    window.location.assign(`https://${ws.slug}.narraterx.ai`)
  }

  return (
    <div className={inSidebar ? 'relative w-full' : 'relative hidden sm:block'} ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`inline-flex items-center gap-1 h-6 pl-2 pr-1.5 text-xs font-medium rounded-full border border-border bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors ${inSidebar ? 'w-full justify-between' : ''}`}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="max-w-[140px] truncate">{currentWs?.display_name || 'My Workspace'}</span>
        <ChevronDown className="h-3 w-3 shrink-0" />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Switch workspace"
          className="absolute left-0 top-full mt-1 w-56 rounded-lg border border-border bg-white shadow-md py-1 z-50"
        >
          {workspaces.map(ws => (
            <button
              key={ws.slug}
              type="button"
              role="option"
              aria-selected={ws.slug === currentWs?.slug}
              onClick={() => handleSwitch(ws)}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-muted-foreground hover:bg-accent/30 hover:text-foreground transition-colors"
            >
              <Check className={`h-3.5 w-3.5 shrink-0 ${ws.slug === currentWs?.slug ? 'text-primary' : 'text-transparent'}`} />
              <span className="truncate">{ws.display_name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Vertical sidebar nav link. When collapsed, shows only the icon with a
// hover tooltip to the right (overflow-visible on the parent nav prevents
// clipping of the absolute-positioned tooltip).
function SidebarNavLink({ to, label, hint, active, icon: Icon, collapsed }) {
  const base = `flex items-center rounded-md text-sm font-medium transition-colors group relative
    ${active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground'}`

  return (
    <Link
      to={to}
      className={`${base} ${collapsed ? 'justify-center py-2 px-0' : 'gap-2.5 px-3 py-2'}`}
    >
      {Icon && <Icon className="h-4 w-4 shrink-0" />}
      {!collapsed && <span className="flex-1 truncate">{label}</span>}
      {!collapsed && hint && <span className="text-3xs text-muted-foreground/60 shrink-0">{hint}</span>}
      {collapsed && (
        <span className="absolute left-full ml-2 px-2 py-1 text-xs font-medium bg-popover border border-border text-popover-foreground rounded-md shadow-md
                         invisible group-hover:visible opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-[200]
                         transition-opacity duration-150">
          {label}
        </span>
      )}
    </Link>
  )
}

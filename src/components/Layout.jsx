import { useState, useRef, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { UserButton, useAuth, useClerk } from '@clerk/react'
import { useQuery } from '@tanstack/react-query'
import { useSelfStaffId } from '@/lib/useSelfStaffId'
import { useEnsureSelfStaff } from '@/lib/useEnsureSelfStaff'
import { Plus, Settings, Building2, Menu, Palette, Layers, ChevronDown, Check, UserCircle, Mic2, BookOpen, PenLine, Clapperboard, Camera, ImagePlus } from 'lucide-react'
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

// Primary navigation. requiresCapability and showWhen/hideWhenBookMode work as
// before — also respected in the mobile drawer.
const NAV_ITEMS = [
  { to: '/',           label: 'Home',      match: (p) => p === '/',
    requiresCapability: CAP_INTERVIEW_START },
  { to: '/stories',    label: 'Stories',   match: (p) => p.startsWith('/stories'),
    requiresCapability: CAP_INTERVIEW_START },
  { to: '/library',    label: 'Library',   match: (p) => p.startsWith('/library') },
  { to: '/needs-media', label: 'Needs Media', match: (p) => p.startsWith('/needs-media'), icon: ImagePlus },
  { to: '/capture',    label: 'Capture',   match: (p) => p.startsWith('/capture'), icon: Camera },
  { to: '/pre-visit',  label: 'Pre-Visit', match: (p) => p.startsWith('/pre-visit'), icon: Mic2,
    requiresCapability: CAP_INTERVIEW_START },
  { to: '/book',       label: 'Book',      match: (p) => p.startsWith('/book'),  icon: BookOpen,
    requiresCapability: CAP_INTERVIEW_START },
  { to: '/write',      label: 'Write',     match: (p) => p.startsWith('/write'), icon: PenLine,
    hideWhenBookMode: 'group', requiresCapability: CAP_INTERVIEW_START },
  { to: '/slate',      label: 'Slate',     match: (p) => p.startsWith('/slate'), icon: Clapperboard,
    showWhen: (ws) => ws?.video_pipeline_enabled === true },
]

export default function Layout({ children }) {
  const location = useLocation()
  const { role } = useUserRole()
  const { has: hasCapability } = usePermission()
  const [mobileOpen, setMobileOpen] = useState(false)
  const ws = useWorkspace()
  const selfStaffId = useSelfStaffId()
  useEnsureSelfStaff()
  const logoSrc = ws?.primary_logo_url || ws?.logo?.main || STATIC_WORKSPACE.logo.main
  const logoAlt = ws?.display_name || ws?.name || STATIC_WORKSPACE.name

  const navItems = NAV_ITEMS.filter((it) => {
    if (it.requiresCapability && !hasCapability(it.requiresCapability)) return false
    if (it.hideWhenBookMode && ws?.book_mode === it.hideWhenBookMode) return false
    if (it.showWhen && !it.showWhen(ws)) return false
    return true
  })

  return (
    <div className="min-h-screen bg-background flex">

      {/* ── Left sidebar — desktop only ─────────────────────────────────── */}
      <aside className="hidden md:flex fixed inset-y-0 left-0 w-56 flex-col border-r bg-white z-30">
        {/* Logo */}
        <div className="h-14 px-4 flex items-center gap-2.5 border-b shrink-0">
          <Link to="/" className="flex items-center gap-2.5 min-w-0">
            <img src={logoSrc} alt={logoAlt} className="h-8 w-auto shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-semibold leading-none truncate">NarrateRx</p>
              <p className="text-3xs text-muted-foreground mt-0.5 leading-none truncate" title={APP_BYLINE}>
                {APP_BYLINE}
              </p>
            </div>
          </Link>
        </div>

        {/* Workspace switcher — only rendered when user has >1 workspace */}
        <div className="px-3 pt-2">
          <WorkspaceSwitcher inSidebar />
        </div>

        {/* Primary nav */}
        <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
          {navItems.map((item) => (
            <SidebarNavLink
              key={item.to}
              to={item.to}
              label={item.label}
              active={item.match(location.pathname)}
              icon={item.icon}
            />
          ))}
        </nav>

        {/* Bottom section: secondary links + user button */}
        <div className="border-t px-2 py-2 space-y-0.5">
          {role === 'admin' && (
            <SidebarNavLink
              to="/synthesis"
              label="Knowledge synthesis"
              icon={Layers}
              active={location.pathname.startsWith('/synthesis')}
            />
          )}
          {hasCapability(CAP_SETTINGS_VIEW) && (
            <SidebarNavLink
              to="/settings/workspace"
              label="Settings"
              icon={Settings}
              active={location.pathname.startsWith('/settings')}
            />
          )}
          {selfStaffId && hasCapability(CAP_INTERVIEW_START) && (
            <SidebarNavLink
              to={`/staff/${selfStaffId}`}
              label="My profile"
              icon={UserCircle}
              active={location.pathname.startsWith(`/staff/${selfStaffId}`)}
            />
          )}
          <div className="pt-2 px-1">
            <UserButton afterSignOutUrl="/" userProfileUrl="/account" />
          </div>
        </div>
      </aside>

      {/* ── Right column: slim header + content ─────────────────────────── */}
      <div className="flex-1 md:ml-56">
        {/* h-14 keeps SettingsLayout's sticky top-14 / min-h-[calc(100dvh-3.5rem)] correct */}
        <header className="sticky top-0 z-40 h-14 border-b bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80 shadow-sm flex items-center gap-3 px-4 sm:px-6">
          {/* Logo — mobile only (desktop logo lives in the sidebar) */}
          <Link to="/" className="md:hidden flex items-center gap-2 min-w-0">
            <img src={logoSrc} alt={logoAlt} className="h-8 w-auto shrink-0" />
          </Link>

          {/* Workspace switcher in header for mobile */}
          <div className="md:hidden">
            <WorkspaceSwitcher />
          </div>

          <div className="flex-1" />

          {/* New Interview — gated on interview.start */}
          {hasCapability(CAP_INTERVIEW_START) && (
            <Button asChild size="sm">
              <Link to="/new">
                <Plus className="h-4 w-4 sm:mr-1.5" />
                <span className="hidden sm:inline">New Interview</span>
                <span className="sr-only sm:hidden">New Interview</span>
              </Link>
            </Button>
          )}

          {/* UserButton on mobile (desktop has it in the sidebar) */}
          <div className="md:hidden">
            <UserButton afterSignOutUrl="/" userProfileUrl="/account" />
          </div>

          {/* Hamburger — mobile only */}
          <button
            type="button"
            className="md:hidden inline-flex items-center justify-center h-11 w-11 rounded-md border border-input text-muted-foreground hover:text-foreground active:bg-accent/40"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="h-4 w-4" />
          </button>
        </header>

        <TrialBanner />

        <main className="container py-8">
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
          <div className="overflow-y-auto space-y-1">
            {navItems.map((item) => (
              <DrawerClose asChild key={item.to}>
                <Link
                  to={item.to}
                  className={`flex items-center gap-2 px-3 py-3 rounded-md text-base font-medium ${item.match(location.pathname) ? 'bg-accent/40 text-foreground' : 'text-muted-foreground active:bg-accent/30'}`}
                >
                  {item.icon && <item.icon className="h-4 w-4 shrink-0" />}
                  {item.label}
                </Link>
              </DrawerClose>
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
// inSidebar=true: removes hidden sm:block so it fills the sidebar width;
// the mobile header instance wraps with md:hidden so no double-render on desktop.
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

// Vertical sidebar nav link.
function SidebarNavLink({ to, label, active, icon: Icon }) {
  return (
    <Link
      to={to}
      className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
        active
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground'
      }`}
    >
      {Icon && <Icon className="h-4 w-4 shrink-0" />}
      {label}
    </Link>
  )
}

import { useState, useRef, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { UserButton, useAuth, useClerk } from '@clerk/react'
import { useQuery } from '@tanstack/react-query'
import { useSelfClinicianId } from '@/lib/useSelfClinicianId'
import { useEnsureSelfClinician } from '@/lib/useEnsureSelfClinician'
import { Plus, Settings, Building2, Menu, Palette, Layers, ChevronDown, Check, UserCircle, Mic2, BookOpen, PenLine, Clapperboard } from 'lucide-react'
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

// Top-level nav. Library is a daily working surface for Publishers (media
// attach + schedule + publish) and a frequent reference for Clinicians, so
// it sits in the main bar rather than the settings dropdown.
// Top-level nav. Each item optionally specifies `requiresCapability` — a
// capability the user must have for the item to show. Items WITHOUT this
// field are visible to everyone (the Phase 3 / pre-capability behavior).
// Phase 4 PR 2: Slate sees-by-default, the rest gated by interview/content
// capabilities so producers (no interview.start) get a Slate-focused nav.
const NAV_ITEMS = [
  { to: '/',           label: 'Home',      match: (p) => p === '/',
    requiresCapability: CAP_INTERVIEW_START },
  { to: '/stories',    label: 'Stories',   match: (p) => p.startsWith('/stories'),
    requiresCapability: CAP_INTERVIEW_START },
  { to: '/library',    label: 'Library',   match: (p) => p.startsWith('/library') },
  { to: '/pre-visit',  label: 'Pre-Visit', match: (p) => p.startsWith('/pre-visit'), icon: Mic2,
    requiresCapability: CAP_INTERVIEW_START },
  { to: '/book',       label: 'Book',      match: (p) => p.startsWith('/book'),  icon: BookOpen,
    requiresCapability: CAP_INTERVIEW_START },
  // Hidden for workspaces with book_mode='group' (Move Better-style group books)
  // — see filtering in the component body.
  { to: '/write',      label: 'Write',     match: (p) => p.startsWith('/write'), icon: PenLine,
    hideWhenBookMode: 'group', requiresCapability: CAP_INTERVIEW_START },
  // Story Director slate — only visible when video pipeline is enabled.
  { to: '/slate',      label: 'Slate',     match: (p) => p.startsWith('/slate'), icon: Clapperboard,
    showWhen: (ws) => ws?.video_pipeline_enabled === true },
]

export default function Layout({ children }) {
  const location = useLocation()
  const { role, isEditor } = useUserRole()
  const { has: hasCapability } = usePermission()
  const [mobileOpen, setMobileOpen] = useState(false)
  const ws = useWorkspace()
  const selfClinicianId = useSelfClinicianId()
  // Provision a Self staff/clinician row on first load for invited talent so
  // "My staff profile" appears without waiting for their first interview.
  useEnsureSelfClinician()
  const logoSrc = ws?.primary_logo_url || ws?.logo?.main || STATIC_WORKSPACE.logo.main
  const logoAlt = ws?.display_name || ws?.name || STATIC_WORKSPACE.name

  // Workspace-dependent nav filtering.
  // hideWhenBookMode: hide this item when ws.book_mode equals the value.
  // showWhen: predicate(ws) — item is only shown when it returns true.
  // requiresCapability: hide unless the user has the named capability.
  //                     Phase 4 PR 2 swap-in for the previous isProducerOnly
  //                     blanket check — workspaces that grant their Producer
  //                     interview.start (e.g. Move Better) now see the full nav.
  const navItems = NAV_ITEMS.filter((it) => {
    if (it.requiresCapability && !hasCapability(it.requiresCapability)) return false
    if (it.hideWhenBookMode && ws?.book_mode === it.hideWhenBookMode) return false
    if (it.showWhen && !it.showWhen(ws)) return false
    return true
  })

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80 shadow-sm">
        <div className="container flex h-14 items-center gap-3 sm:gap-4">
          <Link to="/" className="flex items-center gap-3 min-w-0">
            <img src={logoSrc} alt={logoAlt} className="h-9 w-auto shrink-0" />
            <div className="hidden sm:block border-l border-border pl-3 min-w-0">
              <p className="text-xs font-semibold leading-none text-foreground truncate">
                NarrateRx
              </p>
              <p className="text-3xs text-muted-foreground mt-0.5 leading-none truncate" title={APP_BYLINE}>
                {APP_BYLINE}
              </p>
            </div>
          </Link>
          <WorkspaceSwitcher />

          <div className="flex-1" />

          {/* Desktop nav + admin chrome. Hidden below md so the bar doesn't
              overflow on phones — the hamburger holds the same items. */}
          <nav className="hidden md:flex items-center gap-4">
            {navItems.map((item) => (
              <NavLink key={item.to} to={item.to} label={item.label} active={item.match(location.pathname)} icon={item.icon} />
            ))}
          </nav>
          {hasCapability(CAP_SETTINGS_VIEW) && (
            <div className="hidden md:flex items-center gap-1">
              <SettingsMenu role={role} isEditor={isEditor} selfClinicianId={selfClinicianId} />
            </div>
          )}

          {/* New Interview — gated on interview.start. Hidden for producers
              without that capability. */}
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

          {/* Hamburger — mobile only. Opens a dialog with the nav links,
              admin chrome, and campaign chip in a vertical stack. */}
          <button
            type="button"
            className="md:hidden inline-flex items-center justify-center h-11 w-11 rounded-md border border-input text-muted-foreground hover:text-foreground active:bg-accent/40"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="h-4 w-4" />
          </button>
        </div>
      </header>

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
            {/* Admin/staff chrome — gated by individual capabilities. */}
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
            {selfClinicianId && hasCapability(CAP_INTERVIEW_START) && (
              <DrawerClose asChild>
                <Link to={`/clinician/${selfClinicianId}`} className="flex items-center gap-2 px-3 py-3 rounded-md text-sm text-muted-foreground active:bg-accent/30">
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

      <TrialBanner />

      <main className="container py-8">
        {children}
      </main>
    </div>
  )
}

// Chip that lists all workspaces the user has access to. Only rendered when
// the user belongs to more than one workspace (external tenants won't see it).
function WorkspaceSwitcher() {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const currentWs = useWorkspace()
  const { isSignedIn, getToken } = useAuth()
  const { setActive } = useClerk()

  const { data: workspaces = [] } = useQuery({
    queryKey: ['workspace-list'],
    // Use raw fetch (not apiFetch) so a 401 during the org-activation startup
    // race doesn't fire the global "session expired" toast. The switcher is a
    // background enhancement — auth failures should silently return [] and hide
    // the chip rather than alarming the user with a spurious toast.
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
      // After setActive resolves the session object updates, but the JWT can
      // still carry the previous org_id for a short window while Clerk rotates
      // the token. OrgGate on the destination uses an optimistic-on-error
      // fallback that can let children render before the token is ready →
      // wrong-org API failures. Poll here (max ~2s) until the token confirms
      // the switch so OrgGate finds it already correct on arrival.
      for (let i = 0; i < 8; i++) {
        const tok = await getToken({ skipCache: true }).catch(() => null)
        if (tok) {
          try {
            const { org_id } = JSON.parse(atob(tok.split('.')[1]))
            if (org_id === ws.clerk_org_id) break
          } catch { /* unparseable — keep polling */ }
        }
        await new Promise(resolve => { setTimeout(resolve, 250) })
      }
    } catch {
      // navigate anyway — OrgGate will handle activation on the destination
    }
    window.location.assign(`https://${ws.slug}.narraterx.ai`)
  }

  return (
    <div className="relative hidden sm:block" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1 h-6 pl-2 pr-1.5 text-xs font-medium rounded-full border border-border bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
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

function NavLink({ to, label, active, icon: Icon }) {
  return (
    <Link
      to={to}
      className={`inline-flex items-center gap-1.5 text-sm font-medium transition-colors px-1 pb-0.5 border-b-2 ${active ? 'text-foreground border-primary' : 'text-muted-foreground border-transparent hover:text-foreground'}`}
    >
      {Icon && <Icon className="h-3.5 w-3.5 shrink-0" />}
      {label}
    </Link>
  )
}

// Single "⚙ Tools" dropdown that replaces the 4-icon pile in the desktop
// header. Closes on outside click or Escape. All admin items are only
// rendered when role === 'admin'.
function SettingsMenu({ role, isEditor, selfClinicianId }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

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

  const itemClass = 'flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:bg-accent/30 hover:text-foreground rounded-md transition-colors'

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1.5 h-9 px-2.5 rounded-md text-sm text-muted-foreground hover:text-foreground transition-colors"
        aria-expanded={open}
        aria-haspopup="true"
      >
        <Settings className="h-4 w-4" />
        <span className="text-sm">Settings</span>
        <ChevronDown className="h-3 w-3" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-52 rounded-lg border border-border bg-white shadow-md py-1 z-50">
          {role === 'admin' && (
            <Link to="/synthesis" onClick={() => setOpen(false)} className={itemClass}>
              <Layers className="h-4 w-4 shrink-0" /> Knowledge synthesis
            </Link>
          )}
          {role === 'admin' && <div className="border-t border-border my-1" />}
          {selfClinicianId && (
            <Link to={`/clinician/${selfClinicianId}`} onClick={() => setOpen(false)} className={itemClass}>
              <UserCircle className="h-4 w-4 shrink-0" /> My staff profile
            </Link>
          )}
          <Link to="/account" onClick={() => setOpen(false)} className={itemClass}>
            <UserCircle className="h-4 w-4 shrink-0" /> Account &amp; security
          </Link>
          <Link to="/settings/integrations" onClick={() => setOpen(false)} className={itemClass}>
            <Settings className="h-4 w-4 shrink-0" /> Integrations
          </Link>
          {isEditor && (
            <Link to="/settings/brand-kit" onClick={() => setOpen(false)} className={itemClass}>
              <Palette className="h-4 w-4 shrink-0" /> Brand Kit
            </Link>
          )}
          {role === 'admin' && (
            <Link to="/settings/workspace" onClick={() => setOpen(false)} className={itemClass}>
              <Building2 className="h-4 w-4 shrink-0" /> Workspace settings
            </Link>
          )}
        </div>
      )}
    </div>
  )
}

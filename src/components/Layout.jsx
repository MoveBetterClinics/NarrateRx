import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { UserButton } from '@clerk/clerk-react'
import { Plus, Settings, Building2, Menu, Palette, Images, Layers } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose,
} from '@/components/ui/dialog'
import { CampaignModeChip } from '@/components/CampaignWidget'
import { workspace as STATIC_WORKSPACE } from '@/lib/workspace'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { useUserRole } from '@/lib/useUserRole'

// App-level byline shown under the "NarrateRx" wordmark in the header.
// Intentionally NOT the workspace tagline — that belongs to the tenant's brand,
// not to the product. Keep this short so it doesn't wrap on small headers.
const APP_BYLINE = 'Interview-driven patient content'
import TrialBanner from '@/components/TrialBanner'

const NAV_ITEMS = [
  { to: '/',        label: 'Home',    match: (p) => p === '/' },
  { to: '/stories', label: 'Stories', match: (p) => p.startsWith('/stories') },
]

export default function Layout({ children }) {
  const location = useLocation()
  const { role } = useUserRole()
  const [mobileOpen, setMobileOpen] = useState(false)
  const ws = useWorkspace()
  const logoSrc = ws?.primary_logo_url || ws?.logo?.main || STATIC_WORKSPACE.logo.main
  const logoAlt = ws?.display_name || ws?.name || STATIC_WORKSPACE.name

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80 shadow-sm">
        <div className="container flex h-14 items-center gap-3 sm:gap-4">
          <Link to="/" className="flex items-center gap-3 min-w-0">
            <img src={logoSrc} alt={logoAlt} className="h-9 w-auto shrink-0" />
            <div className="hidden sm:block border-l border-border pl-3 min-w-0">
              <p className="text-xs font-semibold leading-none text-foreground truncate" style={{ fontFamily: "'Titillium Web', sans-serif" }}>
                NarrateRx
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5 leading-none truncate" title={APP_BYLINE}>
                {APP_BYLINE}
              </p>
            </div>
          </Link>

          <div className="flex-1" />

          {/* Desktop nav + admin chrome. Hidden below md so the bar doesn't
              overflow on phones — the hamburger holds the same items. */}
          <nav className="hidden md:flex items-center gap-4">
            {NAV_ITEMS.map((item) => (
              <NavLink key={item.to} to={item.to} label={item.label} active={item.match(location.pathname)} />
            ))}
          </nav>
          <div className="hidden md:flex items-center gap-3">
            <CampaignModeChip />
            <Link to="/library" title="Media library" className="inline-flex items-center justify-center h-9 w-9 rounded-md text-muted-foreground hover:text-foreground transition-colors">
              <Images className="h-4 w-4" />
            </Link>
            {role === 'admin' && (
              <Link to="/synthesis" className="inline-flex items-center justify-center h-9 w-9 rounded-md text-muted-foreground hover:text-foreground transition-colors" title="Knowledge synthesis">
                <Layers className="h-4 w-4" />
              </Link>
            )}
            {role === 'admin' && (
              <Link to="/settings/workspace" className="inline-flex items-center justify-center h-9 w-9 rounded-md text-muted-foreground hover:text-foreground transition-colors" title="Workspace settings">
                <Building2 className="h-4 w-4" />
              </Link>
            )}
            <Link to="/settings/integrations" className="inline-flex items-center justify-center h-9 w-9 rounded-md text-muted-foreground hover:text-foreground transition-colors" title="Integrations">
              <Settings className="h-4 w-4" />
            </Link>
          </div>

          {/* New Interview — primary action, visible on every page */}
          <Button asChild size="sm">
            <Link to="/new">
              <Plus className="h-4 w-4 sm:mr-1.5" />
              <span className="hidden sm:inline">New Interview</span>
              <span className="sr-only sm:hidden">New Interview</span>
            </Link>
          </Button>

          <UserButton afterSignOutUrl="/" />

          {/* Hamburger — mobile only. Opens a dialog with the nav links,
              admin chrome, and campaign chip in a vertical stack. */}
          <button
            type="button"
            className="md:hidden inline-flex items-center justify-center h-9 w-9 rounded-md border border-input text-muted-foreground hover:text-foreground"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="h-4 w-4" />
          </button>
        </div>
      </header>

      <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Menu</DialogTitle>
          </DialogHeader>
          <div className="space-y-1">
            {NAV_ITEMS.map((item) => (
              <DialogClose asChild key={item.to}>
                <Link
                  to={item.to}
                  className={`block px-3 py-2 rounded-md text-sm font-medium ${item.match(location.pathname) ? 'bg-accent/40 text-foreground' : 'text-muted-foreground hover:bg-accent/30'}`}
                >
                  {item.label}
                </Link>
              </DialogClose>
            ))}
          </div>
          <div className="pt-3 border-t space-y-1">
            <DialogClose asChild>
              <Link to="/library" className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-accent/30">
                <Images className="h-4 w-4" /> Media library
              </Link>
            </DialogClose>
            {role === 'admin' && (
              <DialogClose asChild>
                <Link to="/synthesis" className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-accent/30">
                  <Layers className="h-4 w-4" /> Knowledge synthesis
                </Link>
              </DialogClose>
            )}
            {role === 'admin' && (
              <DialogClose asChild>
                <Link to="/settings/workspace" className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-accent/30">
                  <Building2 className="h-4 w-4" /> Workspace settings
                </Link>
              </DialogClose>
            )}
            {(role === 'admin' || role === 'editor') && (
              <DialogClose asChild>
                <Link to="/settings/brand-kit" className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-accent/30">
                  <Palette className="h-4 w-4" /> Brand Kit
                </Link>
              </DialogClose>
            )}
            <DialogClose asChild>
              <Link to="/settings/integrations" className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-accent/30">
                <Settings className="h-4 w-4" /> Integrations
              </Link>
            </DialogClose>
            <div className="px-3 py-2">
              <CampaignModeChip />
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <TrialBanner />

      <main className="container py-8">
        {children}
      </main>
    </div>
  )
}

function NavLink({ to, label, active }) {
  return (
    <Link
      to={to}
      className={`text-xs font-medium transition-colors px-1 ${active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
    >
      {label}
    </Link>
  )
}

import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { UserButton } from '@clerk/clerk-react'
import { Plus, Settings, Building2, Menu, Users, UserCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { CampaignModeChip } from '@/components/CampaignWidget'
import { workspace } from '@/lib/workspace'
import { useUserRole } from '@/lib/useUserRole'

const NAV_ITEMS = [
  { to: '/',         label: 'Interviews',  match: (p) => p === '/' },
  { to: '/hub',      label: 'Content Hub', match: (p) => p.startsWith('/hub') || p.startsWith('/review') || p.startsWith('/calendar') },
  { to: '/media',    label: 'Media',       match: (p) => p.startsWith('/media') },
  { to: '/strategy', label: 'Strategy',    match: (p) => p === '/strategy' },
]

export default function Layout({ children }) {
  const location = useLocation()
  const isHome   = location.pathname === '/'
  const { role } = useUserRole()
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div className="min-h-screen bg-background">
      {/* Skip link — visually hidden until keyboard-focused. WCAG 2.4.1. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-md focus:shadow-lg focus:outline-none"
      >
        Skip to main content
      </a>

      <header className="sticky top-0 z-40 border-b bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80 shadow-sm">
        <div className="container flex h-14 items-center gap-3 sm:gap-4">
          <Link to="/" className="flex items-center gap-3 shrink-0" aria-label="NarrateRx home">
            <img src={workspace.logo.main} alt="" className="h-9 w-auto" />
            <div className="hidden sm:block border-l border-border pl-3">
              <p className="text-xs font-semibold leading-none text-foreground" style={{ fontFamily: "'Titillium Web', sans-serif" }}>
                NarrateRx
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5 leading-none">
                {workspace.tagline}
              </p>
            </div>
          </Link>

          <div className="flex-1" />

          {/* Desktop nav — hidden on small screens; a hamburger below replaces it. */}
          <nav aria-label="Primary" className="hidden md:flex items-center gap-1">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                label={item.label}
                active={item.match(location.pathname)}
              />
            ))}
          </nav>

          <div className="hidden md:flex items-center gap-3">
            <CampaignModeChip />
          </div>

          {isHome && (
            <Button asChild size="sm" className="hidden sm:inline-flex">
              <Link to="/new">
                <Plus className="h-4 w-4 mr-1.5" />
                New Interview
              </Link>
            </Button>
          )}

          {role === 'admin' && (
            <>
              <Link
                to="/settings/members"
                aria-label="Members"
                className="hidden sm:inline-flex text-muted-foreground hover:text-foreground transition-colors rounded p-1.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <Users className="h-4 w-4" />
              </Link>
              <Link
                to="/settings/workspace"
                aria-label="Workspace settings"
                className="hidden sm:inline-flex text-muted-foreground hover:text-foreground transition-colors rounded p-1.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <Building2 className="h-4 w-4" />
              </Link>
            </>
          )}
          <Link
            to="/settings/integrations"
            aria-label="Integrations"
            className="hidden sm:inline-flex text-muted-foreground hover:text-foreground transition-colors rounded p-1.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <Settings className="h-4 w-4" />
          </Link>

          {/* Mobile hamburger — opens nav drawer. Hidden on md+. */}
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
            aria-expanded={mobileOpen}
            className="md:hidden inline-flex items-center justify-center rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>

          {/* afterSignOutUrl + userProfileMode point Clerk's UserButton menu
              at our in-app /account page rather than its hosted modal so the
              account surface lives inside the app chrome. */}
          <UserButton
            afterSignOutUrl="/"
            userProfileMode="navigation"
            userProfileUrl="/account"
          />
        </div>
      </header>

      <main id="main" className="container py-8">
        {children}
      </main>

      <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>Menu</DialogTitle>
          </DialogHeader>
          <nav aria-label="Mobile navigation" className="flex flex-col gap-1">
            {NAV_ITEMS.map((item) => {
              const active = item.match(location.pathname)
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => setMobileOpen(false)}
                  aria-current={active ? 'page' : undefined}
                  className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                    active
                      ? 'bg-primary/10 text-primary'
                      : 'text-foreground hover:bg-muted'
                  }`}
                >
                  {item.label}
                </Link>
              )
            })}
            <div className="border-t my-2" />
            {role === 'admin' && (
              <>
                <Link
                  to="/settings/workspace"
                  onClick={() => setMobileOpen(false)}
                  className="rounded-md px-3 py-2 text-sm text-foreground hover:bg-muted flex items-center gap-2"
                >
                  <Building2 className="h-4 w-4" /> Workspace settings
                </Link>
                <Link
                  to="/settings/members"
                  onClick={() => setMobileOpen(false)}
                  className="rounded-md px-3 py-2 text-sm text-foreground hover:bg-muted flex items-center gap-2"
                >
                  <Users className="h-4 w-4" /> Members
                </Link>
              </>
            )}
            <Link
              to="/settings/integrations"
              onClick={() => setMobileOpen(false)}
              className="rounded-md px-3 py-2 text-sm text-foreground hover:bg-muted flex items-center gap-2"
            >
              <Settings className="h-4 w-4" /> Integrations
            </Link>
            <Link
              to="/account"
              onClick={() => setMobileOpen(false)}
              className="rounded-md px-3 py-2 text-sm text-foreground hover:bg-muted flex items-center gap-2"
            >
              <UserCircle className="h-4 w-4" /> Your account
            </Link>
            {isHome && (
              <Link
                to="/new"
                onClick={() => setMobileOpen(false)}
                className="mt-2 rounded-md px-3 py-2 text-sm bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-2"
              >
                <Plus className="h-4 w-4" /> New Interview
              </Link>
            )}
          </nav>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function NavLink({ to, label, active }) {
  return (
    <Link
      to={to}
      aria-current={active ? 'page' : undefined}
      className={`relative text-xs font-medium px-2 py-1.5 rounded transition-colors ${
        active
          ? 'text-foreground'
          : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {label}
      {active && (
        <span
          aria-hidden="true"
          className="absolute -bottom-px left-1.5 right-1.5 h-0.5 bg-primary rounded-full"
        />
      )}
    </Link>
  )
}

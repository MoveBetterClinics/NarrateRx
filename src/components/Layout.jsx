import { Link, useLocation } from 'react-router-dom'
import { UserButton } from '@clerk/clerk-react'
import { Plus, LayoutDashboard, Layers, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CampaignModeChip } from '@/components/CampaignWidget'
import { brand } from '@/lib/brand'

export default function Layout({ children }) {
  const location = useLocation()
  const isHome = location.pathname === '/'
  const isStrategy = location.pathname === '/strategy'

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80 shadow-sm">
        <div className="container flex h-14 items-center gap-4">
          <Link to="/" className="flex items-center gap-3">
            <img src={brand.logo.main} alt={brand.name} className="h-9 w-auto" />
            <div className="hidden sm:block border-l border-border pl-3">
              <p className="text-xs font-semibold leading-none text-foreground" style={{ fontFamily: "'Titillium Web', sans-serif" }}>
                NarrateRx
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5 leading-none">
                {brand.tagline}
              </p>
            </div>
          </Link>

          <div className="flex-1" />

          <NavLink to="/"        label="Interviews" active={location.pathname === '/'} />
          <NavLink to="/hub"     label="Content Hub" active={location.pathname.startsWith('/hub') || location.pathname.startsWith('/review') || location.pathname.startsWith('/calendar')} />
          <NavLink to="/media"   label="Media"       active={location.pathname.startsWith('/media')} />
          <NavLink to="/strategy" label="Strategy"   active={isStrategy} />

          <CampaignModeChip />

          {isHome && (
            <Button asChild size="sm">
              <Link to="/new">
                <Plus className="h-4 w-4 mr-1.5" />
                New Interview
              </Link>
            </Button>
          )}

          <Link to="/settings/integrations" className="text-muted-foreground hover:text-foreground transition-colors" title="Integrations">
            <Settings className="h-4 w-4" />
          </Link>
          <UserButton afterSignOutUrl="/" />
        </div>
      </header>

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

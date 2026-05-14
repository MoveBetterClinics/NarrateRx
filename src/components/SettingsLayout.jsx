import { Outlet, NavLink, useLocation } from 'react-router-dom'
import {
  Settings, Building2, Mic2, Radio, Puzzle, Palette, Users, CreditCard,
} from 'lucide-react'
import { useUserRole } from '@/lib/useUserRole'

const GROUPS = [
  {
    label: 'Workspace',
    items: [
      { to: '/settings/workspace',          label: 'General',            icon: Settings,   exact: true },
      { to: '/settings/workspace/voice',    label: 'Bernard & voice',    icon: Mic2 },
      { to: '/settings/workspace/channels', label: 'Output channels',    icon: Radio },
      { to: '/settings/integrations',       label: 'Integrations',       icon: Puzzle },
      { to: '/settings/brand-kit',          label: 'Brand kit',          icon: Palette },
    ],
  },
  {
    label: 'People',
    items: [
      { to: '/settings/members',            label: 'Members & roles',    icon: Users },
    ],
  },
  {
    label: 'Account',
    items: [
      { to: '/settings/workspace',          label: 'Plan & billing',     icon: CreditCard,  hash: '#billing' },
    ],
  },
]

function SidebarItem({ item }) {
  const location = useLocation()
  const dest = item.hash ? item.to + item.hash : item.to

  // Active: exact match when flagged, or starts-with for nested routes.
  // For the "Plan & billing" hash-link we only highlight when on that exact
  // path (not when on /settings/workspace/voice etc.).
  const isActive = item.hash
    ? location.pathname === item.to && location.hash === item.hash
    : item.exact
      ? location.pathname === item.to
      : location.pathname.startsWith(item.to)

  return (
    <NavLink
      to={dest}
      className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-sm transition-colors ${
        isActive
          ? 'bg-emerald-50 text-emerald-800 font-medium'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      }`}
    >
      <item.icon className="h-4 w-4 shrink-0" />
      {item.label}
    </NavLink>
  )
}

export default function SettingsLayout() {
  const { role, isLoading } = useUserRole()

  // Non-admin users can still reach integrations and account pages, but the
  // workspace-scoped sections gate themselves internally.
  if (isLoading) return null

  return (
    <div className="flex gap-8 min-h-[calc(100vh-3.5rem)] max-w-6xl mx-auto">
      {/* Sidebar */}
      <aside className="w-52 shrink-0 pt-6 pr-2 border-r border-border">
        <div className="sticky top-20 space-y-6">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground px-2.5 mb-1">
              Settings
            </h2>
          </div>
          {GROUPS.map((group) => {
            // Hide workspace/people sections from non-admin users (the pages
            // themselves also guard, but we hide the nav entries to avoid
            // cluttering the sidebar for clinicians who click Settings by
            // accident).
            const workspaceGroup = group.label === 'Workspace' || group.label === 'People'
            if (workspaceGroup && role !== 'admin') return null
            return (
              <div key={group.label}>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 px-2.5 mb-1">
                  {group.label}
                </p>
                <nav className="space-y-0.5">
                  {group.items.map((item) => (
                    <SidebarItem key={item.to + (item.hash || '')} item={item} />
                  ))}
                </nav>
              </div>
            )
          })}
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0 py-6">
        <Outlet />
      </main>
    </div>
  )
}

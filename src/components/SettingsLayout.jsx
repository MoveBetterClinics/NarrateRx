import { Outlet, NavLink, useLocation } from 'react-router-dom'
import {
  Settings, Mic2, Radio, Puzzle, Palette, Users, CreditCard, MapPin,
} from 'lucide-react'
import { useUserRole } from '@/lib/useUserRole'

const GROUPS = [
  {
    label: 'Workspace',
    items: [
      { to: '/settings/workspace',           label: 'General',            icon: Settings,   exact: true },
      {
        label: 'Bernard',
        icon: Mic2,
        children: [
          { to: '/settings/workspace/voice',              label: 'Voice & tone' },
          { to: '/settings/workspace/patients',           label: 'Patients & topics' },
          { to: '/settings/workspace/interview-defaults', label: 'Interview defaults' },
        ],
      },
      { to: '/settings/workspace/locations', label: 'Locations',          icon: MapPin },
      { to: '/settings/workspace/channels',  label: 'Output channels',    icon: Radio },
      { to: '/settings/integrations',        label: 'Integrations',       icon: Puzzle },
      { to: '/settings/brand-kit',           label: 'Brand kit',          icon: Palette },
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
      { to: '/settings/workspace/billing',  label: 'Plan & billing',     icon: CreditCard },
    ],
  },
]

function SidebarItem({ item }) {
  const location = useLocation()

  // Active: exact match when flagged, or starts-with for nested routes.
  const isActive = item.exact
    ? location.pathname === item.to
    : location.pathname.startsWith(item.to)

  return (
    <NavLink
      to={item.to}
      className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-sm transition-colors ${
        isActive
          ? 'bg-success/10 text-success font-medium'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      }`}
    >
      <item.icon className="h-4 w-4 shrink-0" />
      {item.label}
    </NavLink>
  )
}

// Sub-group: a label with nested children indented beneath it. Used for
// "Bernard" inside the Workspace group so the three voice-related pages live
// under one heading without flattening the nav.
function SidebarSubGroup({ item }) {
  const location = useLocation()
  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-2 px-2.5 pt-1 pb-0.5 text-3xs font-semibold text-muted-foreground/70">
        <item.icon className="h-3 w-3 shrink-0" />
        {item.label}
      </div>
      <div className="pl-3 space-y-0.5">
        {item.children.map((child) => {
          const isActive = location.pathname === child.to
            || location.pathname.startsWith(child.to + '/')
          return (
            <NavLink
              key={child.to}
              to={child.to}
              className={`block px-2.5 py-1.5 rounded-md text-sm transition-colors ${
                isActive
                  ? 'bg-success/10 text-success font-medium'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {child.label}
            </NavLink>
          )
        })}
      </div>
    </div>
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
                <p className="text-3xs font-semibold uppercase tracking-widest text-muted-foreground/60 px-2.5 mb-1">
                  {group.label}
                </p>
                <nav className="space-y-0.5">
                  {group.items.map((item) => (
                    item.children
                      ? <SidebarSubGroup key={item.label} item={item} />
                      : <SidebarItem key={item.to} item={item} />
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

import { Outlet, NavLink, useLocation } from 'react-router-dom'
import {
  Settings, Mic2, Radio, Puzzle, Palette, Users, CreditCard, MapPin,
} from 'lucide-react'
import { useUserRole } from '@/lib/useUserRole'

// Flat list used for the mobile chip rail. Order mirrors the desktop
// sidebar reading order so muscle memory carries across breakpoints.
// Children of "Bernard" are inlined here since the mobile rail has no
// hierarchy.
const MOBILE_NAV = [
  { to: '/settings/workspace',                    label: 'General',            icon: Settings,   exact: true },
  { to: '/settings/workspace/voice',              label: 'Voice & tone',       icon: Mic2 },
  { to: '/settings/workspace/patients',           label: 'Patients & topics',  icon: Mic2 },
  { to: '/settings/workspace/interview-defaults', label: 'Interview defaults', icon: Mic2 },
  { to: '/settings/workspace/locations',          label: 'Locations',          icon: MapPin },
  { to: '/settings/workspace/channels',           label: 'Output channels',    icon: Radio },
  { to: '/settings/integrations',                 label: 'Integrations',       icon: Puzzle },
  { to: '/settings/brand-kit',                    label: 'Brand kit',          icon: Palette },
  { to: '/settings/members',                      label: 'Members & roles',    icon: Users },
  { to: '/settings/workspace/billing',            label: 'Plan & billing',     icon: CreditCard },
]

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

function isItemActive(item, pathname) {
  return item.exact ? pathname === item.to : pathname.startsWith(item.to)
}

function SidebarItem({ item }) {
  const location = useLocation()
  const isActive = isItemActive(item, location.pathname)

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

// Mobile section nav — horizontal scrolling chip rail at the top of the
// content area. Sticks below the app header so the user can switch
// sections without scrolling back to the top, and the current section's
// chip auto-scrolls into view on mount.
function MobileNavRail({ visibleItems }) {
  const location = useLocation()
  return (
    <nav
      aria-label="Settings sections"
      className="md:hidden sticky top-14 z-30 -mx-6 px-6 -mt-6 pt-3 pb-2 bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75 border-b border-border/60 flex items-center gap-2 overflow-x-auto flex-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {visibleItems.map((item) => {
        const isActive = isItemActive(item, location.pathname)
        return (
          <NavLink
            key={item.to}
            to={item.to}
            className={`shrink-0 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors min-h-[36px] ${
              isActive
                ? 'border-success/40 bg-success/10 text-success'
                : 'border-border bg-background text-muted-foreground active:bg-accent/40 hover:text-foreground'
            }`}
          >
            <item.icon className="h-3.5 w-3.5 shrink-0" />
            {item.label}
          </NavLink>
        )
      })}
    </nav>
  )
}

export default function SettingsLayout() {
  const { role, isLoading } = useUserRole()

  // Non-admin users can still reach integrations and account pages, but the
  // workspace-scoped sections gate themselves internally.
  if (isLoading) return null

  const isAdmin = role === 'admin'
  // Mobile rail filters the same way the sidebar groups do — hide
  // workspace/people entries from non-admins.
  const mobileVisible = MOBILE_NAV.filter((it) => {
    if (!isAdmin) {
      // Non-admin: only show integrations, brand-kit, billing (the entries
      // that live under non-workspace groups on desktop).
      return ['/settings/integrations', '/settings/brand-kit', '/settings/workspace/billing'].includes(it.to)
    }
    return true
  })

  return (
    <div className="flex flex-col md:flex-row md:gap-8 min-h-[calc(100dvh-3.5rem)] max-w-[1600px] mx-auto md:px-4 xl:px-8">
      {/* Desktop sidebar */}
      <aside className="hidden md:block w-52 shrink-0 pt-6 pr-2 border-r border-border">
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
            if (workspaceGroup && !isAdmin) return null
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

      {/* Main content. The mobile nav rail sits at the top inside the
          content column so the parent main's container padding lines up
          with where settings content actually starts. */}
      <main className="flex-1 min-w-0 py-6">
        <MobileNavRail visibleItems={mobileVisible} />
        <Outlet />
      </main>
    </div>
  )
}

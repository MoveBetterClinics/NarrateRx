import { cn } from '@/lib/utils'

// Size tokens for Lucide icons. Use these instead of raw h-N w-N on icon
// elements so the entire app has a consistent size vocabulary.
//   xs  — 12px  — meta labels, badge icons
//   sm  — 14px  — body-adjacent, form icons
//   md  — 16px  — default, nav, buttons (default)
//   lg  — 20px  — section headers, hero icons
//   xl  — 24px  — page-level icons, empty-states
const SIZES = {
  xs: 'h-3 w-3',
  sm: 'h-3.5 w-3.5',
  md: 'h-4 w-4',
  lg: 'h-5 w-5',
  xl: 'h-6 w-6',
}

export default function Icon({ as: Component, size = 'md', className, ...props }) {
  return <Component className={cn(SIZES[size], className)} aria-hidden="true" {...props} />
}

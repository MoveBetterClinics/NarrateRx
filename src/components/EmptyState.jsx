// Generic empty-state card. Use any time a list/grid/calendar surface has
// zero items and you want to coach the user toward a meaningful next step
// instead of showing a bare "No results" line.
//
// Anatomy:
//   - icon (lucide-react instance)
//   - title  (short noun phrase)
//   - description (one or two sentences)
//   - optional action (CTA Button or Link wrapped in Button asChild)
//
// Mirrors the shape of the Dashboard hero EmptyState — same vocabulary,
// reusable everywhere else (MediaHub, ContentCalendar, ContentHub, etc.).

import { cn } from '@/lib/utils'

export default function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  className,
  size = 'md',
}) {
  const padding =
    size === 'sm' ? 'p-6'  :
    size === 'lg' ? 'p-10' :
                    'p-8'
  const iconSize = size === 'sm' ? 'h-8 w-8' : 'h-10 w-10'
  const iconInner = size === 'sm' ? 'h-4 w-4' : 'h-5 w-5'

  return (
    <div className={cn('rounded-xl border bg-card text-center', padding, className)}>
      <div className="mx-auto max-w-md flex flex-col items-center">
        {icon && (
          <div className={cn('rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-3', iconSize)}>
            <span className={iconInner} aria-hidden="true">
              {icon}
            </span>
          </div>
        )}
        {title && <h2 className="text-base font-semibold">{title}</h2>}
        {description && (
          <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
            {description}
          </p>
        )}
        {(action || secondaryAction) && (
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            {action}
            {secondaryAction}
          </div>
        )}
      </div>
    </div>
  )
}

import { Fragment } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'

/**
 * Breadcrumb — the stable, stated name for a page. Names both the stage and the
 * specific piece, so an error or a hand-off to staff can be described precisely
 * ("the Publish page for Sciatica" rather than "that screen"). The trailing
 * crumb is the current page (bold, not a link); earlier crumbs with a `to`
 * navigate up the pipeline.
 *
 * Usage:
 *   <Breadcrumb items={[
 *     { label: 'Storyboard', to: '/storyboard' },
 *     { label: 'Choose media' },
 *     { label: 'Sciatica (Zach)' },
 *   ]} />
 *
 * This is the per-piece naming affordance for the Storyboard spine now; Phase 4
 * rolls it across the rest of the app.
 */
export default function Breadcrumb({ items = [], className = '' }) {
  const crumbs = items.filter(Boolean)
  if (crumbs.length === 0) return null
  return (
    <nav
      aria-label="Breadcrumb"
      className={`flex items-center gap-1.5 overflow-x-auto text-xs text-muted-foreground ${className}`}
    >
      {crumbs.map((item, i) => {
        const last = i === crumbs.length - 1
        return (
          <Fragment key={`${item.label}-${i}`}>
            {i > 0 && <ChevronRight className="h-3 w-3 shrink-0 opacity-50" aria-hidden />}
            {item.to && !last ? (
              <Link
                to={item.to}
                className="shrink-0 transition-colors hover:text-foreground hover:underline"
              >
                {item.label}
              </Link>
            ) : (
              <span
                className={last ? 'truncate font-medium text-foreground' : 'shrink-0'}
                aria-current={last ? 'page' : undefined}
              >
                {item.label}
              </span>
            )}
          </Fragment>
        )
      })}
    </nav>
  )
}

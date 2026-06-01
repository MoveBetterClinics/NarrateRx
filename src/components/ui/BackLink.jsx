import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

/**
 * Standard back-navigation affordance for the Stories → Storyboard → Publish
 * spine. One component so "go back" looks and reads the same at every step
 * (previously each page hand-rolled its own link with drifting labels and
 * styling — "Back to Stories" / "Back to Storyboard" / "Back to media").
 *
 * The negative left margin keeps the text visually flush with the content
 * column while giving the hover background a comfortable hit area.
 */
export default function BackLink({ to, children, className = '' }) {
  return (
    <Link
      to={to}
      className={`inline-flex items-center gap-1.5 -ml-2 rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground ${className}`}
    >
      <ArrowLeft className="h-4 w-4 shrink-0" />
      {children}
    </Link>
  )
}

import * as React from 'react'
import { cn } from '@/lib/utils'

const PageHeader = React.forwardRef(({ className, title, subtitle, children, ...props }, ref) => (
  <div ref={ref} className={cn('flex items-center justify-between mb-4', className)} {...props}>
    <div>
      <h1 className="text-2xl font-semibold">{title}</h1>
      {subtitle ? <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p> : null}
    </div>
    {children ? <div className="flex items-center gap-2">{children}</div> : null}
  </div>
))
PageHeader.displayName = 'PageHeader'

export { PageHeader }

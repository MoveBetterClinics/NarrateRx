import * as React from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import Icon from '@/components/ui/Icon'

const LoadingState = React.forwardRef(({ className, label = 'Loading…', ...props }, ref) => (
  <div
    ref={ref}
    role="status"
    aria-live="polite"
    className={cn('flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground', className)}
    {...props}
  >
    <Icon as={Loader2} size="xl" className="animate-spin" />
    {label ? <span className="text-sm">{label}</span> : null}
  </div>
))
LoadingState.displayName = 'LoadingState'

export { LoadingState }

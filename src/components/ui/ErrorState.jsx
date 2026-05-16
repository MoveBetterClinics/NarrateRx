import * as React from 'react'
import { AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

const ErrorState = React.forwardRef(({ className, message, onRetry, ...props }, ref) => (
  <div
    ref={ref}
    role="alert"
    className={cn('flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground', className)}
    {...props}
  >
    <AlertCircle className="h-6 w-6 text-destructive" aria-hidden="true" />
    <span className="text-sm">{message}</span>
    {onRetry ? (
      <Button variant="outline" size="sm" onClick={onRetry} className="mt-2">
        Retry
      </Button>
    ) : null}
  </div>
))
ErrorState.displayName = 'ErrorState'

export { ErrorState }

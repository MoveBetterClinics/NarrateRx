import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export default function LoadingState({ className, size = 'md' }) {
  const iconSize = size === 'sm' ? 'h-5 w-5' : size === 'lg' ? 'h-8 w-8' : 'h-6 w-6'
  const padding  = size === 'sm' ? 'py-12'   : size === 'lg' ? 'py-28'   : 'py-20'
  return (
    <div className={cn('flex items-center justify-center', padding, className)}>
      <Loader2 className={cn(iconSize, 'animate-spin text-muted-foreground')} />
    </div>
  )
}

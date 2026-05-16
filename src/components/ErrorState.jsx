import { AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

export default function ErrorState({ message = 'Something went wrong.', className, size = 'md' }) {
  const padding = size === 'sm' ? 'py-12' : size === 'lg' ? 'py-28' : 'py-20'
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 text-center', padding, className)}>
      <AlertCircle className="h-6 w-6 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  )
}

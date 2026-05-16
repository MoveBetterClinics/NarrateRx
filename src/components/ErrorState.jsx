import { AlertCircle } from 'lucide-react'
import Icon from '@/components/ui/Icon'
import { cn } from '@/lib/utils'

export default function ErrorState({ message = 'Something went wrong.', className, size = 'md' }) {
  const padding = size === 'sm' ? 'py-12' : size === 'lg' ? 'py-28' : 'py-20'
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 text-center', padding, className)}>
      <Icon as={AlertCircle} size="xl" className="text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  )
}

// SaveButton — three-state button used by every Save/Submit/Update affordance.
//
// States:
//   idle           — shows children (defaults to "Save")
//   saving (true)  — spinner + "Saving…", disabled
//   saved (true)   — checkmark + "Saved", disabled briefly so the user sees it
//
// Pair with useSaveAction:
//   const { run: save, saving, savedAt } = useSaveAction(saveFn, { ... })
//   <SaveButton saving={saving} saved={!!savedAt} onClick={save} />
//
// Or drive manually from existing inline state. The component is intentionally
// dumb — caller owns the booleans.

import { forwardRef } from 'react'
import { Loader2, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export const SaveButton = forwardRef(function SaveButton(
  {
    saving = false,
    saved  = false,
    disabled,
    children,
    savingLabel = 'Saving…',
    savedLabel  = 'Saved',
    className,
    ...props
  },
  ref,
) {
  const label = saving ? savingLabel : saved ? savedLabel : (children ?? 'Save')
  const icon = saving
    ? <Loader2 className="h-4 w-4 animate-spin" />
    : saved
    ? <Check className="h-4 w-4" />
    : null

  return (
    <Button
      ref={ref}
      type="submit"
      disabled={disabled || saving || saved}
      className={cn(
        saved && 'bg-success hover:bg-success text-white',
        className,
      )}
      aria-live="polite"
      {...props}
    >
      {icon && <span className="mr-1.5 inline-flex items-center">{icon}</span>}
      {label}
    </Button>
  )
})

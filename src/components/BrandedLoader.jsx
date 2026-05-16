// Branded full-screen loader. Used at points where the app would otherwise
// render `return null` while resolving auth, org membership, or workspace
// data — the user previously saw 1-3 white blanks on first sign-in.
//
// Keeps the perception that the app is intentional and loading on purpose
// rather than broken. The 350ms reveal delay avoids a flicker for fast paths
// where the gate resolves in well under 100ms.

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import Icon from '@/components/ui/Icon'

export default function BrandedLoader({
  message = 'Loading…',
  revealDelayMs = 300,
}) {
  const [visible, setVisible] = useState(revealDelayMs <= 0)
  useEffect(() => {
    if (revealDelayMs <= 0) return
    const t = setTimeout(() => setVisible(true), revealDelayMs)
    return () => clearTimeout(t)
  }, [revealDelayMs])

  if (!visible) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="min-h-screen flex items-center justify-center bg-background"
    >
      <div className="flex flex-col items-center gap-4 animate-in fade-in duration-300">
        <img
          src="/narraterx-logo.svg"
          alt="NarrateRx"
          className="h-10 w-auto opacity-90"
          onError={(e) => { e.currentTarget.style.display = 'none' }}
        />
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon as={Loader2} size="md" className="animate-spin" />
          <span>{message}</span>
        </div>
      </div>
    </div>
  )
}

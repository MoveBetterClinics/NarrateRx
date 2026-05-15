import { useState } from 'react'
import { Link } from 'react-router-dom'
import { X, Clock } from 'lucide-react'
import { useOnboardingProgress } from '@/lib/queries'

const STORAGE_KEY = 'trial_banner_dismissed'

function isDismissedThisSession() {
  try {
    return sessionStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function dismissForSession() {
  try {
    sessionStorage.setItem(STORAGE_KEY, '1')
  } catch { /* ignore */ }
}

// Sticky dismissible banner shown to workspaces on a trial plan.
// - Displays days remaining in amber/orange.
// - Hides if plan is not 'trial', if trial has expired, or if dismissed
//   for this session (sessionStorage key trial_banner_dismissed).
// - ≤ 3 days remaining triggers amber/orange styling.
export default function TrialBanner() {
  const [dismissed, setDismissed] = useState(() => isDismissedThisSession())

  const { data: progress } = useOnboardingProgress()

  if (dismissed) return null
  if (!progress) return null

  const { trialDaysLeft, plan } = progress

  // Only show for trial plan with a known days-remaining value.
  if (plan !== 'trial') return null
  if (trialDaysLeft === null || trialDaysLeft === undefined) return null
  // Trial expired — don't show the banner (show a harder gate elsewhere if needed).
  if (trialDaysLeft <= 0) return null

  const isUrgent = trialDaysLeft <= 3

  function handleDismiss() {
    dismissForSession()
    setDismissed(true)
  }

  return (
    <div
      className={`w-full flex items-center justify-center gap-3 px-4 py-2 text-sm ${
        isUrgent
          ? 'bg-primary text-primary-foreground'
          : 'bg-accent border-b border-primary/20 text-accent-foreground'
      }`}
    >
      <Clock className={`h-4 w-4 shrink-0 ${isUrgent ? 'text-primary-foreground' : 'text-primary'}`} />
      <span className="flex-1 text-center">
        {isUrgent ? (
          <>
            <strong>Only {trialDaysLeft} {trialDaysLeft === 1 ? 'day' : 'days'} left</strong> in your free trial.{' '}
          </>
        ) : (
          <>
            You&rsquo;re on a 14-day free trial.{' '}
            <strong>{trialDaysLeft} {trialDaysLeft === 1 ? 'day' : 'days'} remaining.</strong>{' '}
          </>
        )}
        <Link
          to="/settings/workspace#billing"
          className={`underline underline-offset-2 font-medium ${
            isUrgent ? 'text-primary-foreground hover:text-primary-foreground/80' : 'text-primary hover:text-primary/80'
          }`}
        >
          Upgrade now →
        </Link>
      </span>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss trial banner"
        className={`shrink-0 p-1 rounded hover:opacity-70 transition-opacity ${
          isUrgent ? 'text-primary-foreground' : 'text-primary'
        }`}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

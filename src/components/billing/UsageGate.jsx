import { Link } from 'react-router-dom'
import { Lock } from 'lucide-react'

// Feature → minimum plan required.
// Anything not listed here is available on all plans (including trial).
const FEATURE_PLANS = {
  cross_staff_synthesis: 'practice',
  multi_location:        'practice',
  buffer_analyze:        'solo',
}

const PLAN_RANK = { trial: 0, solo: 1, practice: 2, multi: 3 }

// Human-readable plan names for upsell messaging.
const PLAN_LABELS = {
  solo:     'Solo',
  practice: 'Practice',
  multi:    'Multi-location',
}

// Feature labels for upsell copy.
const FEATURE_LABELS = {
  cross_staff_synthesis: 'Cross-staff story synthesis',
  multi_location:        'Multi-location dashboard',
  buffer_analyze:        'Buffer analytics',
}

// UsageGate — wraps a feature with a plan gate.
//
// If the workspace plan meets or exceeds the required plan, renders children.
// Otherwise shows a soft upsell nudge that links to /settings/workspace#billing.
//
// Props:
//   feature  — string key from FEATURE_PLANS (e.g. 'cross_staff_synthesis')
//   plan     — minimum plan string (redundant safety check — falls back to FEATURE_PLANS)
//   currentPlan — the workspace's active plan string; if omitted, gate is open (fail-open for loading state)
//   children — the feature UI to render when unlocked
//
// Usage:
//   <UsageGate feature="cross_staff_synthesis" currentPlan={workspace?.plan}>
//     <StoriesThemesView ... />
//   </UsageGate>

export default function UsageGate({ feature, plan, currentPlan, children }) {
  // Determine required plan: explicit prop takes precedence over the map.
  const requiredPlan = plan || FEATURE_PLANS[feature] || 'trial'
  const requiredRank = PLAN_RANK[requiredPlan] ?? 0
  const currentRank  = PLAN_RANK[currentPlan]  ?? 0

  // Fail-open when currentPlan is unknown (loading state / no workspace).
  if (!currentPlan) return children

  // Unlocked — render the feature.
  if (currentRank >= requiredRank) return children

  // Locked — render a soft upsell nudge.
  const featureLabel  = FEATURE_LABELS[feature] || 'This feature'
  const planLabel     = PLAN_LABELS[requiredPlan] || requiredPlan

  return (
    <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center">
      <Lock className="mx-auto h-8 w-8 text-gray-400" aria-hidden="true" />
      <h3 className="mt-3 text-sm font-semibold text-gray-900 dark:text-gray-100">
        {planLabel} plan feature
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">
        {featureLabel} is available on the {planLabel} plan and above.
      </p>
      <Link
        to="/settings/workspace#billing"
        className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 transition-colors"
      >
        View plans →
      </Link>
    </div>
  )
}

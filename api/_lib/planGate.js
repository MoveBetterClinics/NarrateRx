// api/_lib/planGate.js
//
// Server-side plan enforcement — mirrors the PLAN_RANK + FEATURE_PLANS logic
// in src/components/billing/UsageGate.jsx so gated features are blocked at
// the API layer, not just hidden in the UI.
//
// Rule: 'internal' plan always passes (all Move Better + Studio workspaces).
// Expired trials are treated as rank -1 (below trial) so everything except
// ungated features is blocked.
//
// Usage in an API handler:
//   const gate = requirePlan(res, ws, 'cross_staff_synthesis')
//   if (gate) return gate   // 402 already sent
//   ... continue ...

// Keep in sync with UsageGate.jsx
const PLAN_RANK = { trial: 0, solo: 1, practice: 2, multi: 3, internal: 4 }

const FEATURE_PLANS = {
  cross_staff_synthesis: 'practice',
  multi_location:        'practice',
  buffer_analyze:        'solo',
}

/**
 * Returns true if the workspace's current plan allows the given feature.
 *
 * @param {object} ws        — workspace row (needs .plan and .trial_ends_at)
 * @param {string} feature   — key from FEATURE_PLANS, or any plan string for a
 *                             direct minimum-plan check
 */
export function planAllows(ws, feature) {
  const plan = ws?.plan || 'trial'

  // Internal workspaces (Move Better + Studio + qbook) bypass all gates.
  if (plan === 'internal') return true

  // Expired trial → below-trial rank; blocks all paid features.
  if (plan === 'trial') {
    const trialEndsAt = ws?.trial_ends_at
    if (trialEndsAt && new Date(trialEndsAt) < new Date()) return false
  }

  // past_due → same as trial (all paid features blocked until payment resolves)
  const effectivePlan = plan === 'past_due' ? 'trial' : plan

  const required = FEATURE_PLANS[feature] ?? feature  // feature can be a plan name directly
  const currentRank  = PLAN_RANK[effectivePlan] ?? 0
  const requiredRank = PLAN_RANK[required]      ?? 0
  return currentRank >= requiredRank
}

/**
 * Express-style gate for Node runtime API handlers.
 *
 * If the workspace plan doesn't allow the feature, sends a 402 response and
 * returns it so the caller can `return requirePlan(res, ws, feature)`.
 * If allowed, returns null — the handler continues normally.
 *
 * @param {object} res      — Express response object
 * @param {object} ws       — workspace row from workspaceContext()
 * @param {string} feature  — feature key or minimum plan name
 * @returns {object|null}   — the res.status().json() return value, or null
 */
export function requirePlan(res, ws, feature) {
  if (planAllows(ws, feature)) return null
  const requiredPlan = FEATURE_PLANS[feature] ?? feature
  return res.status(402).json({
    error:        'plan-required',
    feature,
    requiredPlan,
  })
}

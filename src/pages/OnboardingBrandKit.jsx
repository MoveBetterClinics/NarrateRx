import { useNavigate } from 'react-router-dom'
import BrandKit from '@/components/BrandKit'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

// Final step of the onboarding wizard. Mounted on the new workspace's subdomain
// (after /api/onboarding/claim and SSL cert provisioning) because the brand-kit
// upload endpoints resolve workspace via Host header — they can't run on the
// apex onboarding page where no subdomain exists yet.
//
// `onAdvance` is wired to both "Looks good — continue" (after auto-assign) and
// the lightweight "Skip for now" links inside BrandKit. Either way the user
// lands on the billing/plan picker so they can subscribe before entering the app.
// Internal workspaces (plan='internal') are bounced straight to home by
// BillingSettings when it sees the ?onboarding=1 param.
export default function OnboardingBrandKit() {
  useDocumentTitle('Add your brand assets')
  const navigate = useNavigate()
  return <BrandKit variant="onboarding" onAdvance={() => navigate('/settings/workspace/billing?onboarding=1', { replace: true })} />
}

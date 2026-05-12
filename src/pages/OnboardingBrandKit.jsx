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
// lands on `/?welcome=1` and the normal WelcomeGate / dashboard chrome takes
// over from there.
export default function OnboardingBrandKit() {
  useDocumentTitle('Add your brand assets')
  const navigate = useNavigate()
  return <BrandKit variant="onboarding" onAdvance={() => navigate('/?welcome=1', { replace: true })} />
}

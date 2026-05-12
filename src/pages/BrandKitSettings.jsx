import BrandKit from '@/components/BrandKit'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

// Live Brand Kit settings page — mounts the BrandKit component against the
// real backend (assets via /api/brand-kit/list, mutations via the role/style/
// asset endpoints). The same component renders the design preview at
// /settings/brand-kit-preview with `mockup={true}`.
export default function BrandKitSettings() {
  useDocumentTitle('Brand Kit')
  return <BrandKit variant="settings" />
}

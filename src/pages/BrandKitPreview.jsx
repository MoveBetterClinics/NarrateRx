import { useState } from 'react'
import BrandKit from '@/components/BrandKit'

// Static mockup harness — lets you flip between the settings and onboarding
// variants of the Brand Kit component without wiring up the onboarding
// wizard. Fixture data lives in components/brandKitFixtures.js. No backend
// calls; every action mutates local component state.
export default function BrandKitPreview() {
  const [variant, setVariant] = useState('settings')
  return (
    <div className="min-h-screen bg-background">
      <div className="border-b bg-warning/10 dark:bg-warning/15">
        <div className="max-w-6xl mx-auto px-6 py-2 flex items-center justify-between gap-3">
          <div className="text-xs text-warning">
            <strong>Brand Kit — preview / mockup.</strong> Fixture data only, no backend wiring. Use the toggle to compare variants.
          </div>
          <div className="flex items-center gap-1 text-xs">
            <button
              onClick={() => setVariant('settings')}
              className={`px-2 py-1 rounded-md transition-colors ${variant === 'settings' ? 'bg-warning/30 dark:bg-warning/40 font-semibold' : 'hover:bg-warning/20 dark:hover:bg-warning/30'}`}
            >Settings variant</button>
            <button
              onClick={() => setVariant('onboarding')}
              className={`px-2 py-1 rounded-md transition-colors ${variant === 'onboarding' ? 'bg-warning/30 dark:bg-warning/40 font-semibold' : 'hover:bg-warning/20 dark:hover:bg-warning/30'}`}
            >Onboarding variant</button>
          </div>
        </div>
      </div>
      <BrandKit key={variant} variant={variant} mockup={true} />
    </div>
  )
}

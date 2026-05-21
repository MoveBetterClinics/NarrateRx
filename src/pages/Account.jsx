// /account — user-level profile, email, password, MFA, sessions.
//
// We mount Clerk's prebuilt <UserProfile /> rather than rebuild. The header
// UserButton menu also drops in to this same surface. Routing="path" lets
// Clerk's internal sub-routes (e.g. /account/security) work without us
// adding wildcard routes.

import { useState } from 'react'
import { UserProfile, useUser } from '@clerk/clerk-react'
import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { toast } from '@/lib/toast'
import { syncClinicianName } from '@/lib/api'
import { useClinicianSummaries, useClinician } from '@/lib/queries'
import VoicePlaybackCard from '@/components/VoicePlaybackCard'

function DisplayNameCard() {
  const { user } = useUser()
  const current = user?.unsafeMetadata?.display_name || ''
  const [value, setValue] = useState(current)
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (!user || value.trim() === current) return
    setSaving(true)
    try {
      await user.update({ unsafeMetadata: { ...user.unsafeMetadata, display_name: value.trim() || null } })
      // Propagate the new label onto the user's Self clinician row(s) in
      // this workspace so existing recipes/interviews keep the same
      // identity but display the new name everywhere. Falls back to the
      // user's Clerk full name if they cleared the display name.
      const effective = value.trim() || user.fullName || ''
      if (effective) {
        try {
          await syncClinicianName(effective)
        } catch {
          // Non-fatal — the display name itself saved successfully; the
          // clinician row will pick up the new name on the next interview
          // through the user_id binding path. Logged for observability.
          console.warn('[Account] clinician name sync failed; will pick up on next interview')
        }
      }
      toast.success('Display name saved')
    } catch (e) {
      toast.error('Could not save', { description: e.message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-lg border bg-card p-5 space-y-4">
      <div>
        <h2 className="text-sm font-semibold">Interview display name</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          How you prefer to be identified in interviews — e.g. &ldquo;Dr. Q&rdquo; or &ldquo;Dr. Quasney&rdquo;. Leave blank to use your full name.
        </p>
      </div>
      <div className="flex gap-3 items-end">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="display-name" className="text-xs">Display name</Label>
          <Input
            id="display-name"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={user?.fullName || 'e.g. Dr. Q'}
            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
          />
        </div>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={saving || value.trim() === current}
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  )
}

// Resolves the signed-in user's Self clinician in the current workspace
// (the row where clinicians.user_id === Clerk user id), then renders the
// VoicePlaybackCard against that clinician's tts_settings. If the user
// doesn't have a Self clinician yet — they haven't completed their first
// interview — show a friendly hint instead of an empty card.
function VoicePlaybackSection() {
  const { user } = useUser()
  const { data: summaries = [], isLoading: summariesLoading } = useClinicianSummaries()
  const selfSummary = user?.id
    ? summaries.find((c) => c.user_id === user.id)
    : null
  // Pull the full clinician row (the summaries view doesn't include
  // tts_settings — see CLINICIAN_FIELDS_CARD in api/db/clinicians.js).
  const { data: clinician, isLoading: clinicianLoading } = useClinician(selfSummary?.id)

  if (summariesLoading || (selfSummary && clinicianLoading)) {
    return (
      <div className="rounded-lg border bg-card p-5">
        <p className="text-sm text-muted-foreground">Loading voice settings&hellip;</p>
      </div>
    )
  }

  if (!selfSummary) {
    return (
      <div className="rounded-lg border bg-card p-5 space-y-1">
        <h2 className="text-sm font-semibold">Voice pace</h2>
        <p className="text-xs text-muted-foreground">
          Start your first interview to set up your personal voice pace. You&rsquo;ll be able to adjust how fast Bernard speaks once your clinician profile exists.
        </p>
      </div>
    )
  }

  if (!clinician) return null
  return <VoicePlaybackCard clinician={clinician} />
}

export default function Account() {
  useDocumentTitle('Your account')
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild aria-label="Back home">
          <Link to="/">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center">
            <span
              className="inline-block w-1 h-6 rounded-full shrink-0 mr-2.5"
              style={{ background: '#94a3b8' }}
              aria-hidden="true"
            />
            Your account
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Update your profile, email, password, multi-factor authentication, and active sessions.
          </p>
        </div>
      </div>

      <DisplayNameCard />

      <VoicePlaybackSection />

      <UserProfile routing="path" path="/account" />
    </div>
  )
}

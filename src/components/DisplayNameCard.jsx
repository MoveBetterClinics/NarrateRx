// Self-only display-name editor. Updates Clerk unsafeMetadata.display_name
// (the source of truth) and propagates the new label to the user's Self
// clinician row(s) in this workspace so existing recipes / interviews keep
// the same identity but display the new name everywhere.
//
// Lives on the clinician profile rather than /account because the same name
// surfaces on every interview, content piece, and arc summary — clinicians
// expect to find it where their other identity controls are. Auth-shaped
// settings (email, password, MFA, sessions) stay on /account.
//
// Renders nothing when there's no signed-in user. Caller is responsible for
// only mounting this on the owner's own clinician profile (isMyClinicianProfile).

import { useState } from 'react'
import { useUser } from '@clerk/clerk-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { syncClinicianName } from '@/lib/api'
import { toast } from '@/lib/toast'

export function DisplayNameCard() {
  const { user } = useUser()
  const current = user?.unsafeMetadata?.display_name || ''
  const [value, setValue] = useState(current)
  const [saving, setSaving] = useState(false)

  if (!user) return null

  async function handleSave() {
    if (value.trim() === current) return
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
          console.warn('[DisplayNameCard] clinician name sync failed; will pick up on next interview')
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
            placeholder={user.fullName || 'e.g. Dr. Q'}
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

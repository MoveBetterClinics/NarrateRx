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
          <h1 className="text-2xl font-bold tracking-tight">Your account</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Update your profile, email, password, multi-factor authentication, and active sessions.
          </p>
        </div>
      </div>

      <DisplayNameCard />

      <UserProfile routing="path" path="/account" />
    </div>
  )
}

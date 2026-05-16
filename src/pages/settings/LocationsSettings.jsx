import { useState, useEffect, useCallback } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'
import {
  Loader2, AlertCircle, CheckCircle2, ChevronDown, ChevronRight,
  Trash2, Plus, Star,
} from 'lucide-react'
import { Section } from '@/components/settings/helpers'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useUserRole } from '@/lib/useUserRole'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

// Per-location CRUD lifted from the General tab. The server mirrors the
// primary location's city/state/keyword/hashtag back to the umbrella columns
// on `workspaces` (api/workspace/locations.js) so existing prompts keep
// rendering — users only edit locations here.
export default function LocationsSettings() {
  useDocumentTitle('Settings — Locations')
  const { getToken } = useAuth()
  const { role, isLoading: roleLoading } = useUserRole()
  const [ws, setWs] = useState(undefined)

  useEffect(() => {
    fetch('/api/workspace/me')
      .then(r => r.ok ? r.json() : null)
      .catch(() => null)
      .then(setWs)
  }, [])

  if (roleLoading || ws === undefined) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (role !== 'admin') return <Navigate to="/" replace />
  if (!ws) return (
    <div className="py-16 text-center text-sm text-muted-foreground">
      Workspace settings are only available on a <code className="font-mono text-xs">*.narraterx.ai</code> deployment.
    </div>
  )

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Locations</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Each physical site you operate. The primary location&apos;s city, state, keyword, and hashtag flow into all generated content. Per-post location targeting comes online in a follow-up.
        </p>
      </div>

      <Section title="Your locations">
        <LocationsPanel getToken={getToken} />
      </Section>
    </div>
  )
}

function LocationsPanel({ getToken }) {
  const [locations, setLocations] = useState(null)
  const [error, setError] = useState(null)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState(emptyLocationDraft())

  const reload = useCallback(async () => {
    try {
      const r = await fetch('/api/workspace/locations', {
        headers: { Authorization: `Bearer ${await getToken({ skipCache: true })}` },
      })
      if (!r.ok) {
        setLocations([])
        setError(r.status === 403 ? 'forbidden' : `load-failed (${r.status})`)
        return
      }
      const data = await r.json()
      setLocations(Array.isArray(data?.locations) ? data.locations : [])
      setError(null)
    } catch {
      setLocations([])
      setError('network-error')
    }
  }, [getToken])

  useEffect(() => { reload() }, [reload])

  async function handleCreate() {
    if (!draft.city.trim()) {
      setError('city-required')
      return
    }
    setError(null)
    try {
      const r = await fetch('/api/workspace/locations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${await getToken({ skipCache: true })}`,
        },
        body: JSON.stringify({
          ...draft,
          is_primary: locations && locations.length === 0,
        }),
      })
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        setError(e.error || 'save-failed')
        return
      }
      setDraft(emptyLocationDraft())
      setAdding(false)
      await reload()
    } catch {
      setError('network-error')
    }
  }

  if (locations === null) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading locations…
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {error && (
        <div className="text-xs text-destructive flex items-center gap-1">
          <AlertCircle className="h-3.5 w-3.5" />{error}
        </div>
      )}
      {locations.length === 0 && (
        <p className="text-xs text-muted-foreground">No locations yet — add the first one below.</p>
      )}
      <div className="space-y-2">
        {locations.map(loc => (
          <LocationRow
            key={loc.id}
            location={loc}
            getToken={getToken}
            onChange={reload}
            isOnlyLocation={locations.length === 1}
          />
        ))}
      </div>

      {adding ? (
        <div className="rounded-md border border-input p-3 space-y-3">
          <LocationFields draft={draft} setDraft={setDraft} />
          <div className="flex items-center gap-2 justify-end">
            <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setDraft(emptyLocationDraft()) }}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleCreate}>Add location</Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1 text-xs text-orange-600 hover:underline"
        >
          <Plus className="h-3.5 w-3.5" /> Add another location
        </button>
      )}
    </div>
  )
}

function emptyLocationDraft() {
  return {
    label: '', city: '', region: '',
    location_keyword: '', location_hashtag: '',
    visit_url: '', gbp_location_id: '',
  }
}

function LocationRow({ location, getToken, onChange, isOnlyLocation }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState({
    label: location.label || '',
    city: location.city || '',
    region: location.region || '',
    location_keyword: location.location_keyword || '',
    location_hashtag: location.location_hashtag || '',
    visit_url: location.visit_url || '',
    gbp_location_id: location.gbp_location_id || '',
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved]   = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    setDraft({
      label: location.label || '',
      city: location.city || '',
      region: location.region || '',
      location_keyword: location.location_keyword || '',
      location_hashtag: location.location_hashtag || '',
      visit_url: location.visit_url || '',
      gbp_location_id: location.gbp_location_id || '',
    })
  }, [location])

  async function handleSave() {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const r = await fetch(`/api/workspace/locations?id=${encodeURIComponent(location.id)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${await getToken({ skipCache: true })}`,
        },
        body: JSON.stringify(draft),
      })
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        setError(e.error || 'save-failed')
      } else {
        onChange?.()
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
      }
    } catch {
      setError('network-error')
    } finally {
      setSaving(false)
    }
  }

  async function handleMakePrimary() {
    setSaving(true)
    setError(null)
    try {
      const r = await fetch(`/api/workspace/locations?id=${encodeURIComponent(location.id)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${await getToken({ skipCache: true })}`,
        },
        body: JSON.stringify({ is_primary: true }),
      })
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        setError(e.error || 'save-failed')
      } else {
        onChange?.()
      }
    } catch {
      setError('network-error')
    } finally {
      setSaving(false)
    }
  }

  async function handleArchive() {
    if (location.is_primary) return
    if (!confirm(`Archive "${location.label || location.city}"? This won't delete past content tagged to it.`)) return
    setSaving(true)
    setError(null)
    try {
      const r = await fetch(`/api/workspace/locations?id=${encodeURIComponent(location.id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${await getToken({ skipCache: true })}` },
      })
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        setError(e.error || 'archive-failed')
      } else {
        onChange?.()
      }
    } catch {
      setError('network-error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-md border border-input">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between gap-2 p-3 text-left hover:bg-accent/30"
      >
        <div className="flex items-center gap-2 min-w-0">
          {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
          <div className="text-sm font-medium">
            {location.label || location.city}
          </div>
          {location.is_primary && (
            <span className="text-3xs uppercase tracking-wide bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300 px-1.5 py-0.5 rounded inline-flex items-center gap-0.5">
              <Star className="h-2.5 w-2.5" /> Primary
            </span>
          )}
        </div>
        <div className="text-2xs text-muted-foreground truncate">
          {[location.city, location.region].filter(Boolean).join(', ')}
          {location.location_hashtag ? ` · ${location.location_hashtag}` : ''}
        </div>
      </button>
      {open && (
        <div className="border-t border-input p-3 space-y-3">
          <LocationFields draft={draft} setDraft={setDraft} />
          <div className="flex items-center gap-2 justify-end">
            {error && (
              <span className="text-xs text-destructive flex items-center gap-1">
                <AlertCircle className="h-3.5 w-3.5" />{error}
              </span>
            )}
            {!location.is_primary && (
              <Button size="sm" variant="ghost" onClick={handleMakePrimary} disabled={saving}>
                <Star className="h-3.5 w-3.5 mr-1" /> Make primary
              </Button>
            )}
            {!location.is_primary && !isOnlyLocation && (
              <Button size="sm" variant="ghost" onClick={handleArchive} disabled={saving}>
                <Trash2 className="h-3.5 w-3.5 mr-1" /> Archive
              </Button>
            )}
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving
                ? <><Loader2 className="h-4 w-4 animate-spin mr-1.5" />Save</>
                : saved
                  ? <><CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />Saved</>
                  : 'Save'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function LocationFields({ draft, setDraft }) {
  function set(k) { return v => setDraft(d => ({ ...d, [k]: v })) }
  return (
    <>
      <div className="grid grid-cols-12 gap-2">
        <div className="col-span-5 space-y-1">
          <Label className="text-xs">City</Label>
          <Input value={draft.city} onChange={e => set('city')(e.target.value)} placeholder="Portland" className="text-sm" autoComplete="address-level2" />
        </div>
        <div className="col-span-3 space-y-1">
          <Label className="text-xs">State</Label>
          <Input value={draft.region} onChange={e => set('region')(e.target.value)} placeholder="OR" className="text-sm" autoComplete="address-level1" />
        </div>
        <div className="col-span-4 space-y-1">
          <Label className="text-xs">Label</Label>
          <Input value={draft.label} onChange={e => set('label')(e.target.value)} placeholder="optional" className="text-sm" />
        </div>
      </div>
      <div className="grid grid-cols-12 gap-2">
        <div className="col-span-6 space-y-1">
          <Label className="text-xs">Location keyword</Label>
          <Input
            value={draft.location_keyword}
            onChange={e => set('location_keyword')(e.target.value)}
            placeholder="Portland"
            className="text-sm"
          />
          <p className="text-3xs text-muted-foreground">Used in copy and &apos;near me&apos; SEO.</p>
        </div>
        <div className="col-span-6 space-y-1">
          <Label className="text-xs">Location hashtag</Label>
          <Input
            value={draft.location_hashtag}
            onChange={e => set('location_hashtag')(e.target.value)}
            placeholder="#YourCity"
            className="text-sm"
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Visit URL</Label>
        <Input
          type="url"
          value={draft.visit_url}
          onChange={e => set('visit_url')(e.target.value)}
          placeholder="https://yourpractice.com/visit/portland"
          className="text-sm"
          autoComplete="off"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Buffer GBP channel ID</Label>
        <Input
          value={draft.gbp_location_id}
          onChange={e => set('gbp_location_id')(e.target.value)}
          placeholder="e.g. 6612a8c7d4e3f2b1a09f8765"
          className="text-sm font-mono"
        />
        <p className="text-3xs text-muted-foreground">
          Buffer profile ID for this location&apos;s Google Business listing. Find it
          at <a className="underline" href="https://publish.buffer.com/" target="_blank" rel="noreferrer">publish.buffer.com</a> →
          select the GBP channel → copy the ID from the URL
          (<code>publish.buffer.com/profile/&lt;id&gt;/...</code>), or call
          <code> GET https://api.bufferapp.com/1/profiles.json?access_token=&lt;token&gt;</code> and
          pick the entry whose <code>service</code> is googlebusiness.
          Leave blank if this location has no GBP listing.
        </p>
      </div>
    </>
  )
}

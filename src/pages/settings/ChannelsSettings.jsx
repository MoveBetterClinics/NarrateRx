import { useState, useEffect } from 'react'
import { Navigate, Link } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'
import {
  Loader2, FileText, Mail, MapPin, Instagram, Facebook, Linkedin,
  Youtube, Twitter, Pin, Music2, MessageCircle, Cloud, Megaphone,
  LayoutTemplate, Radio, Film, Puzzle,
} from 'lucide-react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useUserRole } from '@/lib/useUserRole'
import { useUnsavedChanges } from '@/lib/useUnsavedChanges'
import { useSaveShortcut } from '@/lib/useSaveShortcut'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { OUTPUT_CHANNELS, EXPORT_SHAPES, PUBLISH_MODES } from '@/lib/outputChannels'

// Icon per channel id. Falls back to Radio for any new channel we forget to map.
const CHANNEL_ICONS = {
  blog:           FileText,
  email:          Mail,
  gbp:            MapPin,
  instagram_post: Instagram,
  instagram_reel: Film,
  facebook:       Facebook,
  linkedin:       Linkedin,
  tiktok:         Music2,
  youtube_short:  Youtube,
  pinterest:      Pin,
  twitter:        Twitter,
  threads:        MessageCircle,
  bluesky:        Cloud,
  mastodon:       MessageCircle,
  google_ads:     Megaphone,
  ig_ads:         Megaphone,
  landing_page:   LayoutTemplate,
}

// Friendlier labels for export-shape / publish-mode badges.
const SHAPE_LABEL = {
  [EXPORT_SHAPES.MARKDOWN]:        'Markdown export',
  [EXPORT_SHAPES.SOCIAL_COMPOSE]:  'Caption + image',
  [EXPORT_SHAPES.HTML_EMAIL]:      'HTML email',
}
const MODE_LABEL = {
  [PUBLISH_MODES.BUFFER]:  'via Buffer',
  [PUBLISH_MODES.WEBSITE]: 'Direct publish',
  [PUBLISH_MODES.TDC]:     'TrustDrivenCare',
}

// Channels are grouped for visual scanning; order within each group is
// preserved from OUTPUT_CHANNELS.
const GROUPS = [
  { id: 'long', label: 'Long-form',  members: ['blog', 'email'] },
  { id: 'local', label: 'Local',      members: ['gbp'] },
  { id: 'social', label: 'Social',    members: ['instagram_post', 'facebook', 'linkedin', 'twitter', 'threads', 'bluesky', 'mastodon', 'pinterest'] },
  { id: 'video',  label: 'Short video', members: ['instagram_reel', 'tiktok', 'youtube_short'] },
  { id: 'paid',   label: 'Paid',     members: ['google_ads', 'ig_ads'] },
  { id: 'web',    label: 'Web',      members: ['landing_page'] },
]

function groupedChannels() {
  const all = Object.values(OUTPUT_CHANNELS)
  const assigned = new Set(GROUPS.flatMap((g) => g.members))
  const grouped = GROUPS.map((g) => ({
    label: g.label,
    channels: g.members.map((id) => all.find((c) => c.id === id)).filter(Boolean),
  })).filter((g) => g.channels.length > 0)
  const leftovers = all.filter((c) => !assigned.has(c.id))
  if (leftovers.length > 0) grouped.push({ label: 'Other', channels: leftovers })
  return grouped
}

export default function ChannelsSettings() {
  useDocumentTitle('Settings — Output channels')
  const { getToken } = useAuth()
  const { role, isLoading: roleLoading } = useUserRole()
  const [ws, setWs]           = useState(undefined)
  const [form, setForm]       = useState(null)
  const [pristine, setPristine] = useState(null)
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)
  const [error, setError]     = useState(null)

  useEffect(() => {
    fetch('/api/workspace/me')
      .then(r => r.ok ? r.json() : null)
      .catch(() => null)
      .then(data => {
        setWs(data)
        if (data) {
          const initial = { enabled_outputs: Array.isArray(data.enabled_outputs) ? data.enabled_outputs : [] }
          setForm(initial)
          setPristine(initial)
        }
      })
  }, [])

  const isDirty = !!form && !!pristine && JSON.stringify(form) !== JSON.stringify(pristine)
  useUnsavedChanges(isDirty)
  useSaveShortcut(() => { if (isDirty && !saving) handleSave() }, { disabled: !isDirty || saving })

  async function handleSave() {
    setSaving(true); setError(null); setSaved(false)
    try {
      const token = await getToken()
      const r = await fetch('/api/workspace/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ enabled_outputs: form.enabled_outputs }),
      })
      if (!r.ok) {
        const err = await r.json().catch(() => ({}))
        setError(err.error || 'save-failed')
      } else {
        const updated = await r.json()
        const refreshed = { enabled_outputs: Array.isArray(updated.enabled_outputs) ? updated.enabled_outputs : [] }
        setForm(refreshed); setPristine(refreshed)
        setSaved(true); setTimeout(() => setSaved(false), 3000)
      }
    } catch {
      setError('network-error')
    } finally {
      setSaving(false)
    }
  }

  function toggle(channelId, on) {
    setForm((f) => {
      const cur = Array.isArray(f.enabled_outputs) ? f.enabled_outputs : []
      const next = on
        ? (cur.includes(channelId) ? cur : [...cur, channelId])
        : cur.filter((id) => id !== channelId)
      return { ...f, enabled_outputs: next }
    })
  }

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

  const enabled = new Set(form.enabled_outputs)
  const groups = groupedChannels()

  return (
    <div className="space-y-6 pb-16">
      {/* Sticky header / save bar */}
      <div className="md:sticky md:top-14 z-20 py-4 bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70 border-b border-border/60 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Output channels</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Toggle the channels this workspace generates content for. Each interview lets the author pick a subset.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 pt-1">
          {saved && <span className="text-xs text-success">Saved</span>}
          {error && <span className="text-xs text-destructive">{error}</span>}
          <Button size="sm" onClick={handleSave} disabled={saving || !isDirty}>
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
            Save changes
          </Button>
        </div>
      </div>

      {groups.map((group) => (
        <Card key={group.label} className="shadow-none">
          <CardHeader className="pb-4">
            <CardTitle className="text-base">{group.label}</CardTitle>
            <CardDescription className="text-xs">
              {group.channels.length} channel{group.channels.length === 1 ? '' : 's'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {group.channels.map((channel) => (
                <ChannelTile
                  key={channel.id}
                  channel={channel}
                  checked={enabled.has(channel.id)}
                  onToggle={(on) => toggle(channel.id, on)}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      ))}

      <Card className="shadow-none bg-muted/40">
        <CardContent className="flex items-start gap-3 py-4">
          <Puzzle className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground">
            Publishing credentials (Buffer / WordPress / Astro) are managed on the{' '}
            <Link to="/settings/integrations" className="underline underline-offset-2 hover:text-foreground">
              Integrations
            </Link>
            {' '}page. Channels marked <span className="font-medium">via Buffer</span> need a Buffer token connected.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

function ChannelTile({ channel, checked, onToggle }) {
  const Icon = CHANNEL_ICONS[channel.id] || Radio
  const badge = channel.publishMode
    ? MODE_LABEL[channel.publishMode]
    : SHAPE_LABEL[channel.exportShape] || 'Export'
  return (
    <label
      className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
        checked
          ? 'border-success/30 bg-success/10 hover:bg-success/15'
          : 'border-input hover:bg-accent/30'
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onToggle(e.target.checked)}
        className="h-4 w-4 shrink-0"
      />
      <div className={`flex h-9 w-9 items-center justify-center rounded-md shrink-0 ${
        checked ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground'
      }`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium leading-tight truncate">{channel.label}</div>
        <div className="text-2xs text-muted-foreground mt-0.5 truncate">{badge}</div>
      </div>
    </label>
  )
}

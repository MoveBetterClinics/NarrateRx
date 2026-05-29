import { useState, useEffect } from 'react'
import { Clapperboard, MapPin, Instagram, Facebook, Linkedin, Music2, Youtube, FileText, Info } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { SaveBar } from '@/components/settings/helpers'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { useUnsavedChanges } from '@/lib/useUnsavedChanges'
import { useSaveShortcut } from '@/lib/useSaveShortcut'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { apiFetch } from '@/lib/api'

// Channels available for auto-publish configuration.
// 'live' = wired and active at launch. 'soon' = accepted but not yet executed by the cron.
const CHANNELS = [
  { id: 'gbp',       label: 'Google Business Posts', icon: MapPin,    status: 'live',
    description: 'Auto-posts expire after 7 days. Lowest blast radius — good starting point.' },
  { id: 'instagram', label: 'Instagram',              icon: Instagram, status: 'soon' },
  { id: 'facebook',  label: 'Facebook',               icon: Facebook,  status: 'soon' },
  { id: 'linkedin',  label: 'LinkedIn',               icon: Linkedin,  status: 'soon' },
  { id: 'tiktok',    label: 'TikTok',                 icon: Music2,    status: 'soon' },
  { id: 'youtube',   label: 'YouTube Shorts',         icon: Youtube,   status: 'soon' },
  { id: 'blog',      label: 'Blog (website)',         icon: FileText,  status: 'soon' },
]

const DEFAULT_VOICE_FIDELITY_MIN = 7   // 1–10 scale to match captionFidelity.js scorer output
const DEFAULT_SIMILARITY_MIN     = 0.65

function channelDefaults(existing = {}) {
  return {
    enabled:            Boolean(existing.enabled),
    voice_fidelity_min: existing.voice_fidelity_min ?? DEFAULT_VOICE_FIDELITY_MIN,
    similarity_min:     existing.similarity_min     ?? DEFAULT_SIMILARITY_MIN,
  }
}

function buildInitialState(autoPublishSettings) {
  const settings = autoPublishSettings || {}
  const out = {}
  for (const ch of CHANNELS) {
    out[ch.id] = channelDefaults(settings[ch.id])
  }
  return out
}

export default function AutoPublishSettings() {
  useDocumentTitle('Auto-publish — Settings')
  const ws = useWorkspace()
  const [state, setState] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [initialSnapshot, setInitialSnapshot] = useState(null)

  useEffect(() => {
    if (!ws) return
    const init = buildInitialState(ws.auto_publish_settings)
    setState(init)
    setInitialSnapshot(JSON.stringify(init))
  }, [ws?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const isDirty = state !== null && initialSnapshot !== null && JSON.stringify(state) !== initialSnapshot
  useUnsavedChanges(isDirty)
  useSaveShortcut(isDirty ? handleSave : null)

  async function handleSave() {
    if (!isDirty || saving) return
    setSaving(true)
    setError(null)
    try {
      await apiFetch('/api/workspace/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auto_publish_settings: state }),
      })
      setInitialSnapshot(JSON.stringify(state))
    } catch (e) {
      setError(e?.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  function setChannel(channelId, patch) {
    setState((prev) => ({
      ...prev,
      [channelId]: { ...prev[channelId], ...patch },
    }))
  }

  if (!ws?.video_pipeline_enabled) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
        <Clapperboard className="h-10 w-10 text-muted-foreground" />
        <p className="font-semibold text-lg">Auto-publish is part of the video pipeline</p>
        <p className="text-sm text-muted-foreground max-w-sm">
          {"The video pipeline isn't enabled for this workspace yet. Contact your workspace admin to turn it on."}
        </p>
      </div>
    )
  }

  if (!state) return null

  return (
    <div className="space-y-6 pb-24">
      <div>
        <h2 className="text-lg font-semibold">Auto-publish</h2>
        <p className="text-sm text-muted-foreground mt-1">
          High-confidence packages skip the manual distribution step and go straight to the
          channel. All four gate signals must pass: voice fidelity, clip match, consent, and no
          QC flags. Start with GBP — it has the lowest blast radius.
        </p>
      </div>

      <Card className="bg-amber-50 border-amber-200">
        <CardContent className="pt-4 pb-3">
          <div className="flex gap-2 text-sm text-amber-800">
            <Info className="h-4 w-4 mt-0.5 shrink-0" />
            <p>
              <strong>Safety model:</strong> auto-published posts go into your Buffer queue (not
              immediately live), so you have a window to review or delete them in Buffer before
              they send. The cron runs every 10 minutes.
            </p>
          </div>
        </CardContent>
      </Card>

      {CHANNELS.map(({ id, label, icon: Icon, status, description }) => {
        const ch = state[id]
        const isLive = status === 'live'
        return (
          <Card key={id} className={isLive ? '' : 'opacity-60'}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                  <CardTitle className="text-sm font-medium">{label}</CardTitle>
                  {!isLive && (
                    <span className="text-3xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium uppercase tracking-wide">
                      Coming soon
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={ch.enabled}
                  disabled={!isLive}
                  onClick={() => isLive && setChannel(id, { enabled: !ch.enabled })}
                  className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                    ch.enabled ? 'border-primary bg-primary' : 'border-input bg-input'
                  } ${!isLive ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
                  aria-label={`Enable auto-publish for ${label}`}
                >
                  <span className={`pointer-events-none block h-5 w-5 rounded-full bg-white shadow-lg ring-0 transition-transform ${
                    ch.enabled ? 'translate-x-5' : 'translate-x-0'
                  }`} />
                </button>
              </div>
              {description && (
                <CardDescription className="text-xs mt-1">{description}</CardDescription>
              )}
            </CardHeader>

            {ch.enabled && isLive && (
              <CardContent className="space-y-5 pt-0">
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <Label className="text-xs text-muted-foreground">
                      Min voice fidelity score
                    </Label>
                    <span className="text-xs font-mono tabular-nums">
                      {ch.voice_fidelity_min.toFixed(1)} / 10
                    </span>
                  </div>
                  <input
                    type="range" min={5} max={10} step={0.5}
                    value={ch.voice_fidelity_min}
                    onChange={(e) => setChannel(id, { voice_fidelity_min: parseFloat(e.target.value) })}
                    className="w-full h-2 rounded-full accent-primary cursor-pointer"
                  />
                  <div className="flex justify-between text-2xs text-muted-foreground/60 mt-0.5">
                    <span>Permissive</span><span>Default (7)</span><span>Strict</span>
                  </div>
                  <p className="text-2xs text-muted-foreground">
                    Default 7.0 (out of 10). Packages below this score are held for manual review.
                    Rubric: 9–10 = on-voice, 7–8 = mostly faithful, 5–6 = noticeable drift.
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between">
                    <Label className="text-xs text-muted-foreground">
                      Min clip-topic similarity
                    </Label>
                    <span className="text-xs font-mono tabular-nums">
                      {(ch.similarity_min * 100).toFixed(0)}%
                    </span>
                  </div>
                  <input
                    type="range" min={0.40} max={0.95} step={0.01}
                    value={ch.similarity_min}
                    onChange={(e) => setChannel(id, { similarity_min: parseFloat(e.target.value) })}
                    className="w-full h-2 rounded-full accent-primary cursor-pointer"
                  />
                  <div className="flex justify-between text-2xs text-muted-foreground/60 mt-0.5">
                    <span>Permissive</span><span>Default</span><span>Strict</span>
                  </div>
                  <p className="text-2xs text-muted-foreground">
                    Default 65%. Ensures the visual matches the claim before publishing
                    without manual review.
                  </p>
                </div>
              </CardContent>
            )}
          </Card>
        )
      })}

      <SaveBar dirty={isDirty} saving={saving} onSave={handleSave} error={error} />
    </div>
  )
}

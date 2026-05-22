import { useState, useEffect, useRef } from 'react'
import { Target, Check, ChevronDown } from 'lucide-react'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { fetchCampaign, updateCampaign } from '@/lib/api'
import { CAMPAIGN_MODES } from '@/lib/campaigns'

const CHIP_LABELS = {
  bookings: 'Bookings',
  seminars: 'Seminars',
  referrals: 'Referrals',
}

// Convert ISO ↔ datetime-local input value (which has no timezone).
// Browser inputs use "YYYY-MM-DDTHH:mm" in local time. We round-trip through
// the JS Date constructor so the stored value is always ISO/UTC.
function isoToInputValue(iso) {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    const pad = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  } catch {
    return ''
  }
}
function inputValueToIso(v) {
  if (!v) return null
  try {
    const d = new Date(v)
    if (Number.isNaN(d.getTime())) return null
    return d.toISOString()
  } catch {
    return null
  }
}

export function useCampaign() {
  const [campaign, setCampaign] = useState({ mode: 'bookings', notes: '', cta_url: '', cta_label: '', cta_pitch: '', event_at: null })
  const [saving, setSaving] = useState(false)
  const [notesSaved, setNotesSaved] = useState(false)
  const debounceTimerRef = useRef(null)

  useEffect(() => {
    fetchCampaign().then(setCampaign).catch(() => {})
  }, [])

  async function handleModeChange(mode) {
    setCampaign((c) => ({ ...c, mode }))
    setSaving(true)
    try {
      await updateCampaign({ mode })
    } catch { /* empty */ }
    setSaving(false)
  }

  // Generic debounced field saver — used by notes + CTA fields. Saves the
  // whole change set on the trailing edge so a fast typist doesn't generate
  // a flurry of PATCH calls (the existing notes pattern). Brief "Saved" pill
  // appears on success.
  function scheduleFieldSave(patch) {
    setCampaign((c) => ({ ...c, ...patch }))
    setNotesSaved(false)
    clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = setTimeout(async () => {
      try {
        await updateCampaign(patch)
        setNotesSaved(true)
        setTimeout(() => setNotesSaved(false), 2000)
      } catch { /* empty */ }
    }, 800)
  }

  function handleNotesChange(notes) {
    scheduleFieldSave({ notes })
  }
  function handleCtaUrlChange(cta_url) {
    scheduleFieldSave({ cta_url })
  }
  function handleCtaLabelChange(cta_label) {
    scheduleFieldSave({ cta_label })
  }
  function handleCtaPitchChange(cta_pitch) {
    scheduleFieldSave({ cta_pitch })
  }
  function handleEventAtChange(inputValue) {
    scheduleFieldSave({ event_at: inputValueToIso(inputValue) })
  }

  return {
    campaign,
    saving,
    notesSaved,
    handleModeChange,
    handleNotesChange,
    handleCtaUrlChange,
    handleCtaLabelChange,
    handleCtaPitchChange,
    handleEventAtChange,
  }
}

export function CampaignWidget({
  campaign,
  saving,
  notesSaved,
  onModeChange,
  onNotesChange,
  onCtaUrlChange,
  onCtaLabelChange,
  onCtaPitchChange,
  onEventAtChange,
}) {
  const currentMode = CAMPAIGN_MODES[campaign.mode] || CAMPAIGN_MODES.bookings
  const { showNotes, showCta, showCtaPitch, showEventDate } = currentMode

  return (
    <div className="rounded-xl border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" />
          <p className="text-sm font-semibold">Content Focus</p>
        </div>
        {saving && <span className="text-xs text-muted-foreground">Saving…</span>}
        {!saving && notesSaved && (
          <span className="flex items-center gap-1 text-xs text-green-600">
            <Check className="h-3 w-3" /> Saved
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {Object.entries(CAMPAIGN_MODES).map(([key, def]) => (
          <button
            key={key}
            onClick={() => onModeChange(key)}
            className={`text-left rounded-lg border p-3 transition-colors text-sm ${
              campaign.mode === key
                ? 'bg-primary/5 border-primary/40 text-primary'
                : 'hover:bg-muted/50 text-foreground'
            }`}
          >
            <p className="font-medium text-xs leading-snug">{def.label}</p>
            <p className="text-2xs text-muted-foreground mt-1 leading-snug line-clamp-2">{def.description}</p>
          </button>
        ))}
      </div>

      {showCta && (
        <div className="space-y-3 pt-1">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">{currentMode.ctaUrlLabel}</label>
            <Input
              type="url"
              value={campaign.cta_url || ''}
              onChange={(e) => onCtaUrlChange?.(e.target.value)}
              placeholder={currentMode.ctaUrlPlaceholder}
              className="text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">{currentMode.ctaLabelLabel}</label>
            <Input
              type="text"
              value={campaign.cta_label || ''}
              onChange={(e) => onCtaLabelChange?.(e.target.value)}
              placeholder={currentMode.ctaLabelPlaceholder}
              className="text-sm"
              maxLength={60}
            />
          </div>
          {showCtaPitch && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">{currentMode.ctaPitchLabel}</label>
              <Textarea
                value={campaign.cta_pitch || ''}
                onChange={(e) => onCtaPitchChange?.(e.target.value)}
                placeholder={currentMode.ctaPitchPlaceholder}
                className="text-sm min-h-[60px] resize-none"
                maxLength={240}
              />
            </div>
          )}
          {showEventDate && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">{currentMode.eventDateLabel}</label>
              <Input
                type="datetime-local"
                value={isoToInputValue(campaign.event_at)}
                onChange={(e) => onEventAtChange?.(e.target.value)}
                className="text-sm"
              />
            </div>
          )}
        </div>
      )}

      {showNotes && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Additional context</label>
          <Textarea
            value={campaign.notes || ''}
            onChange={(e) => onNotesChange(e.target.value)}
            placeholder={currentMode.notesPlaceholder}
            className="text-sm min-h-[72px] resize-none"
          />
          <p className="text-2xs text-muted-foreground">
            These details flow into every new social post, email excerpt, and video script generated from your interviews. The blog post stays evergreen.
          </p>
        </div>
      )}
    </div>
  )
}

export function CampaignModeChip() {
  const {
    campaign,
    saving,
    notesSaved,
    handleModeChange,
    handleNotesChange,
    handleCtaUrlChange,
    handleCtaLabelChange,
    handleCtaPitchChange,
    handleEventAtChange,
  } = useCampaign()
  const [open, setOpen] = useState(false)
  const containerRef = useRef(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false)
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const chipLabel = CHIP_LABELS[campaign.mode] || 'Bookings'
  const currentMode = CAMPAIGN_MODES[campaign.mode] || {}

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border bg-primary/5 border-primary/30 text-primary hover:bg-primary/10 transition-colors"
        title="Content Focus mode"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-primary" />
        Mode: {chipLabel}
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute left-0 sm:left-auto sm:right-0 top-full mt-2 w-[calc(100vw-1rem)] sm:w-[360px] rounded-xl border bg-white shadow-lg z-50 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Content Focus</p>
            {saving && <span className="text-2xs text-muted-foreground">Saving…</span>}
            {!saving && notesSaved && (
              <span className="flex items-center gap-1 text-2xs text-green-600">
                <Check className="h-3 w-3" /> Saved
              </span>
            )}
          </div>

          <div className="space-y-1.5">
            {Object.entries(CAMPAIGN_MODES).map(([key, def]) => (
              <button
                key={key}
                onClick={() => handleModeChange(key)}
                className={`w-full text-left rounded-lg border p-2.5 transition-colors text-sm ${
                  campaign.mode === key
                    ? 'bg-primary/5 border-primary/40 text-primary'
                    : 'hover:bg-muted/50 text-foreground'
                }`}
              >
                <p className="font-medium text-xs leading-snug">{def.label}</p>
                <p className="text-2xs text-muted-foreground mt-0.5 leading-snug">{def.description}</p>
              </button>
            ))}
          </div>

          {currentMode.showCta && (
            <div className="space-y-2 pt-1">
              <Input
                type="url"
                value={campaign.cta_url || ''}
                onChange={(e) => handleCtaUrlChange(e.target.value)}
                placeholder={currentMode.ctaUrlPlaceholder}
                className="text-xs"
              />
              <Input
                type="text"
                value={campaign.cta_label || ''}
                onChange={(e) => handleCtaLabelChange(e.target.value)}
                placeholder={currentMode.ctaLabelPlaceholder}
                className="text-xs"
                maxLength={60}
              />
              {currentMode.showCtaPitch && (
                <Textarea
                  value={campaign.cta_pitch || ''}
                  onChange={(e) => handleCtaPitchChange(e.target.value)}
                  placeholder={currentMode.ctaPitchPlaceholder}
                  className="text-xs min-h-[52px] resize-none"
                  maxLength={240}
                />
              )}
              {currentMode.showEventDate && (
                <Input
                  type="datetime-local"
                  value={isoToInputValue(campaign.event_at)}
                  onChange={(e) => handleEventAtChange(e.target.value)}
                  className="text-xs"
                />
              )}
            </div>
          )}

          {currentMode.showNotes && (
            <div className="space-y-1.5 pt-1">
              <Textarea
                value={campaign.notes || ''}
                onChange={(e) => handleNotesChange(e.target.value)}
                placeholder={currentMode.notesPlaceholder}
                className="text-xs min-h-[64px] resize-none"
              />
            </div>
          )}

          <p className="text-2xs text-muted-foreground pt-1 border-t">
            Flows into new social / email / video drafts (blog stays evergreen). Full settings in{' '}
            <a href="/settings/workspace" className="text-primary underline">Workspace Settings</a>.
          </p>
        </div>
      )}
    </div>
  )
}

import { useState, useEffect, useRef } from 'react'
import { useUser } from '@clerk/clerk-react'
import { Target, Check, ChevronDown } from 'lucide-react'
import { Textarea } from '@/components/ui/textarea'
import { fetchCampaign, updateCampaign } from '@/lib/api'
import { CAMPAIGN_MODES } from '@/lib/campaigns'

const CHIP_LABELS = {
  bookings: 'Bookings',
  seminars: 'Seminars',
  referrals: 'Referrals',
}

export function useCampaign() {
  const { user } = useUser()
  const [campaign, setCampaign] = useState({ mode: 'bookings', notes: '' })
  const [saving, setSaving] = useState(false)
  const [notesSaved, setNotesSaved] = useState(false)
  const notesTimerRef = useRef(null)

  useEffect(() => {
    fetchCampaign().then(setCampaign).catch(() => {})
  }, [])

  async function handleModeChange(mode) {
    setCampaign((c) => ({ ...c, mode }))
    setSaving(true)
    try {
      await updateCampaign({ mode }, user?.id)
    } catch { /* empty */ }
    setSaving(false)
  }

  function handleNotesChange(notes) {
    setCampaign((c) => ({ ...c, notes }))
    setNotesSaved(false)
    clearTimeout(notesTimerRef.current)
    notesTimerRef.current = setTimeout(async () => {
      try {
        await updateCampaign({ notes }, user?.id)
        setNotesSaved(true)
        setTimeout(() => setNotesSaved(false), 2000)
      } catch { /* empty */ }
    }, 800)
  }

  return { campaign, saving, notesSaved, handleModeChange, handleNotesChange }
}

export function CampaignWidget({ campaign, saving, notesSaved, onModeChange, onNotesChange }) {
  const currentMode = CAMPAIGN_MODES[campaign.mode] || CAMPAIGN_MODES.bookings
  const showNotes = currentMode.showNotes

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
            <p className="text-[11px] text-muted-foreground mt-1 leading-snug line-clamp-2">{def.description}</p>
          </button>
        ))}
      </div>

      {showNotes && (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">{currentMode.notesPlaceholder}</p>
          <Textarea
            value={campaign.notes || ''}
            onChange={(e) => onNotesChange(e.target.value)}
            placeholder={currentMode.notesPlaceholder}
            className="text-sm min-h-[72px] resize-none"
          />
          <p className="text-[11px] text-muted-foreground">
            These details are injected into every content generation for this condition. Update them whenever event or campaign details change.
          </p>
        </div>
      )}
    </div>
  )
}

export function CampaignModeChip() {
  const { campaign, saving, notesSaved, handleModeChange, handleNotesChange } = useCampaign()
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
        <div className="absolute right-0 top-full mt-2 w-[360px] rounded-xl border bg-white shadow-lg z-50 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Content Focus</p>
            {saving && <span className="text-[11px] text-muted-foreground">Saving…</span>}
            {!saving && notesSaved && (
              <span className="flex items-center gap-1 text-[11px] text-green-600">
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
                <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{def.description}</p>
              </button>
            ))}
          </div>

          {(CAMPAIGN_MODES[campaign.mode] || {}).showNotes && (
            <div className="space-y-1.5 pt-1">
              <Textarea
                value={campaign.notes || ''}
                onChange={(e) => handleNotesChange(e.target.value)}
                placeholder={CAMPAIGN_MODES[campaign.mode].notesPlaceholder}
                className="text-xs min-h-[64px] resize-none"
              />
            </div>
          )}

          <p className="text-[11px] text-muted-foreground pt-1 border-t">
            Affects every content generation. Full settings on the <a href="/strategy" className="text-primary underline">Strategy</a> page.
          </p>
        </div>
      )}
    </div>
  )
}

import { useState } from 'react'
import { ChevronDown, RotateCcw } from 'lucide-react'
import { PLATFORM_SCHEDULE_PREFS } from '@/lib/scheduleHeuristics'

// Platforms surfaced in the settings UI. Mirrors PLATFORM_SCHEDULE_PREFS, but
// excludes ads + landing_page (those aren't reviewer-facing publish flows).
const TUNABLE_PLATFORMS = [
  { id: 'linkedin',  label: 'LinkedIn'        },
  { id: 'instagram', label: 'Instagram'       },
  { id: 'facebook',  label: 'Facebook'        },
  { id: 'tiktok',    label: 'TikTok'          },
  { id: 'youtube',   label: 'YouTube'         },
  { id: 'gbp',       label: 'Google Business' },
  { id: 'blog',      label: 'Blog'            },
  { id: 'email',     label: 'Email'           },
]

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function formatHourChip(h) {
  if (h === 0) return '12am'
  if (h === 12) return '12pm'
  return h < 12 ? `${h}am` : `${h - 12}pm`
}

function parseHoursInput(text) {
  if (!text || typeof text !== 'string') return null
  const parts = text.split(/[,\s]+/).map((p) => p.trim()).filter(Boolean)
  if (parts.length === 0) return null
  const out = []
  for (const p of parts) {
    const n = Number.parseInt(p, 10)
    if (!Number.isInteger(n) || n < 0 || n > 23) return null
    if (!out.includes(n)) out.push(n)
  }
  out.sort((a, b) => a - b)
  return out
}

function hoursToInput(hours) {
  return hours.map((h) => String(h)).join(', ')
}

function summarize(prefs) {
  if (!prefs) return null
  const sorted = [...prefs.days].sort((a, b) => a - b)
  const contiguous = sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1)
  const dayText = contiguous && sorted.length > 1
    ? `${DAY_NAMES[sorted[0]]}–${DAY_NAMES[sorted[sorted.length - 1]]}`
    : sorted.map((d) => DAY_NAMES[d]).join('/')
  const hourText = prefs.hours.map(formatHourChip).join(', ')
  return `${dayText} · ${hourText}`
}

function PlatformRow({ label, override, defaults, onChange }) {
  const [open, setOpen] = useState(false)
  const effective = override || defaults
  const isOverridden = !!override

  const [draftDays, setDraftDays] = useState(effective.days)
  const [draftHoursText, setDraftHoursText] = useState(hoursToInput(effective.hours))
  const [hoursError, setHoursError] = useState(false)

  function commit(nextDays, nextHoursText) {
    const nextHours = parseHoursInput(nextHoursText)
    if (!nextHours) { setHoursError(true); return }
    setHoursError(false)
    if (nextDays.length === 0) return
    onChange({ days: nextDays.slice().sort((a, b) => a - b), hours: nextHours })
  }

  function toggleDay(d) {
    const next = draftDays.includes(d)
      ? draftDays.filter((x) => x !== d)
      : [...draftDays, d]
    if (next.length === 0) return // never let the user save zero days
    setDraftDays(next)
    commit(next, draftHoursText)
  }

  function onHoursBlur() {
    commit(draftDays, draftHoursText)
  }

  function reset() {
    onChange(null)
    setDraftDays(defaults.days)
    setDraftHoursText(hoursToInput(defaults.hours))
    setHoursError(false)
  }

  return (
    <div className="rounded-lg border bg-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-muted/40 transition-colors"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{label}</span>
            {isOverridden && (
              <span className="text-2xs uppercase tracking-wide rounded-full bg-primary/10 text-primary px-1.5 py-0.5">
                Workspace
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5 truncate">
            {summarize(effective)}
          </div>
        </div>
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="border-t px-3 py-3 space-y-3">
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-1.5">Days of week</div>
            <div className="flex flex-wrap gap-1.5">
              {DAY_NAMES.map((name, i) => {
                const selected = draftDays.includes(i)
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => toggleDay(i)}
                    className={`px-2.5 py-1 rounded-full border text-xs ${
                      selected
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background text-muted-foreground border-input hover:bg-accent'
                    }`}
                  >
                    {name}
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <div className="text-xs font-medium text-muted-foreground mb-1.5">
              Hours (24-hour, comma-separated)
            </div>
            <input
              type="text"
              value={draftHoursText}
              onChange={(e) => setDraftHoursText(e.target.value)}
              onBlur={onHoursBlur}
              placeholder="e.g. 8, 10, 14"
              className={`w-full h-8 px-2 text-sm rounded border ${hoursError ? 'border-destructive' : 'border-input'} bg-background`}
            />
            {hoursError && (
              <p className="text-xs text-destructive mt-1">
                Enter integers between 0 and 23, separated by commas.
              </p>
            )}
          </div>

          {isOverridden && (
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="h-3 w-3" />
              Reset to default ({summarize(defaults)})
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// Inline editor for workspaces.schedule_prefs. Each platform expands to a
// day-of-week chip group + comma-separated hours input. Empty means "use
// defaults" — the API stores null per-platform and the heuristic falls back.
export default function SchedulePrefsSection({ value, onChange }) {
  const prefs = value && typeof value === 'object' ? value : {}

  function updatePlatform(platformId, next) {
    const nextPrefs = { ...prefs }
    if (next === null) delete nextPrefs[platformId]
    else nextPrefs[platformId] = next
    onChange(Object.keys(nextPrefs).length === 0 ? null : nextPrefs)
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Override NarrateRx&rsquo;s built-in optimal posting times on a per-platform basis.
        Untouched platforms use defaults — your overrides drive the &ldquo;Schedule for&rdquo;
        suggestion on the approve action sheet and the optimal-time tint on the calendar.
      </p>
      {TUNABLE_PLATFORMS.map(({ id, label }) => (
        <PlatformRow
          key={id}
          label={label}
          override={prefs[id] || null}
          defaults={PLATFORM_SCHEDULE_PREFS[id]}
          onChange={(next) => updatePlatform(id, next)}
        />
      ))}
    </div>
  )
}

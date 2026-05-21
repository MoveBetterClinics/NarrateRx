import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Textarea2 } from '@/components/settings/helpers'
import { TONES } from '@/lib/prompts'

// Single tone-mode card. Collapsed shows emoji + label + truncated current
// modifier (or "Using system default" when blank). Expanded reveals the
// textarea plus the system-default description that ships out of the box,
// so admins can see what they're inheriting before they write a modifier.
//
// systemDefault: optional string describing what Bernard uses when the
// modifier is blank. Surfaces inside the expanded panel as a quiet hint.
export function ToneCard({ toneObj, label, value, onChange, systemDefault }) {
  const [expanded, setExpanded] = useState(false)
  const hasContent = value.trim().length > 0

  return (
    <div className={`rounded-lg border ${hasContent ? 'border-input' : 'border-dashed border-input/60'} bg-card`}>
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-accent/30 rounded-lg text-left"
      >
        <span className="text-base shrink-0">{toneObj?.emoji || '🎙'}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium leading-tight">{label}</p>
          {hasContent ? (
            <p className="text-xs text-muted-foreground mt-0.5 truncate">{value.slice(0, 80)}{value.length > 80 ? '…' : ''}</p>
          ) : systemDefault ? (
            <p className="text-xs text-muted-foreground/60 mt-0.5 truncate italic">{systemDefault.slice(0, 90)}{systemDefault.length > 90 ? '…' : ''}</p>
          ) : (
            <p className="text-xs text-muted-foreground/60 mt-0.5 italic">Using system default</p>
          )}
        </div>
        {expanded
          ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
          : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        }
      </button>
      {expanded && (
        <div className="border-t border-input px-3 pb-3 pt-2 space-y-2">
          {systemDefault && !hasContent && (
            <div className="rounded-md bg-muted/40 border border-input px-2.5 py-1.5">
              <p className="text-3xs uppercase tracking-wider text-muted-foreground/70 font-semibold mb-0.5">System default</p>
              <p className="text-2xs text-muted-foreground italic leading-relaxed">{systemDefault}</p>
            </div>
          )}
          <Textarea2
            label=""
            value={value}
            onChange={onChange}
            rows={6}
            hint={`Injected when this tone is selected. Use {display_name} and {activity_context} as placeholders.`}
          />
        </div>
      )}
    </div>
  )
}

// All four tone modes rendered as a stack of ToneCards. Form keys are
// tone_active / tone_clinical / tone_warm / tone_smart and map to a
// matching id in the TONES array (which carries emoji + system defaults).
export function ToneModifierCards({ form, set }) {
  const toneObjects = Object.fromEntries(TONES.map(t => [t.id, t]))
  const TONE_KEYS = [
    { key: 'tone_active',   id: 'active',   label: 'Active & Driven' },
    { key: 'tone_clinical', id: 'clinical', label: 'Clinical & In-Depth' },
    { key: 'tone_warm',     id: 'warm',     label: 'Warm & Reassuring' },
    { key: 'tone_smart',    id: 'smart',    label: 'Smart Default' },
  ]

  return (
    <div className="space-y-3">
      {TONE_KEYS.map(({ key, id, label }) => {
        const toneObj = toneObjects[id]
        const value = form[key] || ''
        const systemDefault = toneObj?.probe_goal || toneObj?.description || null
        return (
          <ToneCard
            key={key}
            toneObj={toneObj}
            label={label}
            value={value}
            onChange={set(key)}
            systemDefault={systemDefault}
          />
        )
      })}
    </div>
  )
}

// Patient archetype editor. Each prototype is a record inside the
// workspace's patient_context.prototypes array. The grid view shows the
// archetypes Bernard knows; clicking a card opens the full PrototypeCard
// edit form. PRs #3 + #4 of the Voice-Settings redesign both consume this,
// so it lives in components/settings/ not in a page file.

import { useEffect, useState } from 'react'
import { Pencil } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Textarea2 } from '@/components/settings/helpers'

export function PrototypeCard({ proto, onChange, onRemove, defaultExpanded = true }) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  // Keep the textarea text in local state so spaces and blank lines aren't
  // eaten on every keystroke. The parent stores characteristics as a normalized
  // string array (trimmed, no empties); we still push that up on every change
  // so the dirty flag and save work, but the visible text is no longer
  // re-derived from it mid-edit. Resync only when the edited archetype changes.
  const [charsText, setCharsText] = useState(() => (proto.characteristics || []).join('\n'))
  useEffect(() => {
    setCharsText((proto.characteristics || []).join('\n'))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proto.id])

  return (
    <div className="rounded-lg border border-input bg-card">
      <div
        className="flex items-center gap-2 p-3 cursor-pointer select-none"
        onClick={() => setExpanded(e => !e)}
      >
        <span className="text-base w-6 text-center shrink-0">{proto.emoji || '👤'}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">
            {proto.label || <em className="font-normal text-muted-foreground">Untitled archetype</em>}
          </p>
          {proto.coreDesire && (
            <p className="text-xs text-muted-foreground truncate">{proto.coreDesire}</p>
          )}
        </div>
        <span className="text-xs text-muted-foreground shrink-0">{expanded ? '▲' : '▼'}</span>
      </div>

      {expanded && (
        <div className="border-t border-input p-3 space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label className="text-xs mb-1 block">Emoji</Label>
              <input
                className="w-full h-8 rounded-md border border-input bg-background px-2 text-sm"
                value={proto.emoji || ''}
                onChange={e => onChange({ emoji: e.target.value })}
                placeholder="👤"
              />
            </div>
            <div>
              <Label className="text-xs mb-1 block">Short label</Label>
              <input
                className="w-full h-8 rounded-md border border-input bg-background px-2 text-sm"
                value={proto.shortLabel || ''}
                onChange={e => onChange({ shortLabel: e.target.value })}
                placeholder="e.g. Reconnect"
              />
            </div>
            <div>
              <Label className="text-xs mb-1 block">ID (internal)</Label>
              <input
                className="w-full h-8 rounded-md border border-input bg-background px-2 text-sm font-mono"
                value={proto.id || ''}
                onChange={e => onChange({ id: e.target.value })}
                placeholder="reconnect"
              />
            </div>
          </div>
          <div>
            <Label className="text-xs mb-1 block">Full label</Label>
            <input
              className="w-full h-8 rounded-md border border-input bg-background px-2 text-sm"
              value={proto.label || ''}
              onChange={e => onChange({ label: e.target.value })}
              placeholder="e.g. The Reconnector"
            />
          </div>
          <div>
            <Label className="text-xs mb-1 block">Core desire</Label>
            <input
              className="w-full h-8 rounded-md border border-input bg-background px-2 text-sm"
              value={proto.coreDesire || ''}
              onChange={e => onChange({ coreDesire: e.target.value })}
              placeholder="What does this archetype most want?"
            />
          </div>
          <Textarea2
            label="Characteristics (one per line)"
            value={charsText}
            onChange={v => {
              setCharsText(v)
              onChange({ characteristics: v.split('\n').map(l => l.trim()).filter(Boolean) })
            }}
            rows={4}
            hint="Bernard uses these to calibrate tone when generating for this archetype."
          />
          <button
            type="button"
            onClick={onRemove}
            className="text-xs text-destructive hover:underline"
          >
            Remove this archetype
          </button>
        </div>
      )}
    </div>
  )
}

function buildArchetypeProbeText(proto, interviewerName) {
  const chars = (proto.characteristics || []).slice(0, 4)
  if (chars.length === 0 && !proto.coreDesire) {
    return `Click to add what ${interviewerName} should probe for this archetype.`
  }
  const parts = []
  if (chars.length > 0) {
    const listed = chars.length <= 2
      ? chars.join(' and ')
      : `${chars.slice(0, -1).join(', ')}, and ${chars[chars.length - 1]}`
    parts.push(`${interviewerName} probes about ${listed}.`)
  }
  if (proto.coreDesire) parts.push(proto.coreDesire)
  return parts.join(' ')
}

export function ArchetypeCardsSection({ value, onChange, interviewerName }) {
  const [editingIdx, setEditingIdx] = useState(null)

  let pc = {}
  try { if (value?.trim()) pc = JSON.parse(value) } catch { /* invalid JSON — show empty state */ }
  const prototypes = pc.prototypes || []

  function update(patch) {
    onChange(JSON.stringify({ ...pc, ...patch }, null, 2))
  }
  function updatePrototype(idx, patch) {
    update({ prototypes: prototypes.map((p, i) => (i === idx ? { ...p, ...patch } : p)) })
  }
  function addPrototype() {
    const next = [...prototypes, { id: `archetype_${Date.now()}`, label: '', shortLabel: '', emoji: '👤', coreDesire: '', characteristics: [] }]
    update({ prototypes: next })
    setEditingIdx(next.length - 1)
  }
  function removePrototype(idx) {
    update({ prototypes: prototypes.filter((_, i) => i !== idx) })
    setEditingIdx(null)
  }

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        Patient archetypes {interviewerName} knows
      </p>

      {prototypes.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">
          No archetypes yet — add one to help {interviewerName} frame content for different patient groups.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {prototypes.map((proto, idx) => {
            if (editingIdx === idx) {
              return (
                <div key={proto.id || idx} className="col-span-1 sm:col-span-2 rounded-lg border border-primary/30 bg-card p-3 space-y-3">
                  <PrototypeCard
                    proto={proto}
                    onChange={patch => updatePrototype(idx, patch)}
                    onRemove={() => removePrototype(idx)}
                  />
                  <button
                    type="button"
                    onClick={() => setEditingIdx(null)}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    ← Done editing
                  </button>
                </div>
              )
            }
            return (
              <button
                key={proto.id || idx}
                type="button"
                onClick={() => setEditingIdx(idx)}
                className="group text-left rounded-lg border border-input bg-card p-4 hover:border-primary/40 hover:bg-accent/20 transition-colors"
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-lg shrink-0">{proto.emoji || '👤'}</span>
                  <span className="text-sm font-semibold flex-1">
                    {proto.label || <em className="font-normal text-muted-foreground">Untitled archetype</em>}
                  </span>
                  <Pencil className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {buildArchetypeProbeText(proto, interviewerName)}
                </p>
              </button>
            )
          })}
        </div>
      )}

      <button type="button" onClick={addPrototype} className="text-xs text-primary hover:underline">
        + Add an archetype {interviewerName} should learn
      </button>
    </div>
  )
}

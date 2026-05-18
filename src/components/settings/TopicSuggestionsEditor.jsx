// Edits the workspace.topic_suggestions array. Each row is a topic Bernard
// can propose at interview-start time, optionally tagged with one or more
// patient archetypes (so the topic only surfaces for matching archetypes).

import { useState } from 'react'
import { Label } from '@/components/ui/label'
import { Textarea2 } from '@/components/settings/helpers'

const PRIORITY_COLORS = {
  high: 'bg-rose-100 text-rose-700',
  medium: 'bg-amber-100 text-amber-700',
  low: 'bg-slate-100 text-slate-600',
}

export function TopicSuggestionsEditor({ topicsJson, patientContextJson, onChange }) {
  let topics = null
  let parseError = null
  let archetypes = []

  try {
    const parsed = JSON.parse(topicsJson)
    if (Array.isArray(parsed)) topics = parsed
    else parseError = 'Expected a JSON array'
  } catch (e) {
    parseError = e.message
  }

  try {
    const pc = JSON.parse(patientContextJson)
    if (pc && Array.isArray(pc.prototypes)) archetypes = pc.prototypes
  } catch { /* ignore */ }

  if (parseError) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-destructive">JSON parse error — editing as raw JSON until fixed: {parseError}</p>
        <Textarea2 label="Topic suggestions (raw JSON)" value={topicsJson} onChange={onChange} rows={14} mono />
      </div>
    )
  }

  const list = topics || []

  function commit(next) {
    onChange(JSON.stringify(next, null, 2))
  }

  function updateTopic(idx, patch) {
    commit(list.map((t, i) => (i === idx ? { ...t, ...patch } : t)))
  }

  function removeTopic(idx) {
    commit(list.filter((_, i) => i !== idx))
  }

  function addTopic() {
    commit([...list, { id: Date.now(), topic: '', category: '', priority: 'medium', keywords: [] }])
  }

  function toggleArchetype(idx, archetypeId) {
    const row = list[idx]
    const cur = Array.isArray(row.prototypes) ? row.prototypes : []
    const next = cur.includes(archetypeId) ? cur.filter(id => id !== archetypeId) : [...cur, archetypeId]
    const { prototypes: _drop, ...rest } = row
    const updated = next.length > 0 ? { ...rest, prototypes: next } : rest
    commit(list.map((t, i) => (i === idx ? updated : t)))
  }

  return (
    <div className="space-y-3">
      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No topic suggestions yet.</p>
      ) : (
        <div className="rounded-md border border-input divide-y divide-input max-h-[640px] overflow-y-auto">
          {list.map((row, idx) => (
            <TopicRow
              key={row.id ?? `topic_${idx}`}
              row={row}
              archetypes={archetypes}
              onUpdate={patch => updateTopic(idx, patch)}
              onRemove={() => removeTopic(idx)}
              onToggleArchetype={id => toggleArchetype(idx, id)}
            />
          ))}
        </div>
      )}
      <button type="button" onClick={addTopic} className="text-xs text-primary hover:underline">
        + Add topic
      </button>
    </div>
  )
}

function TopicRow({ row, archetypes, onUpdate, onRemove, onToggleArchetype }) {
  const [expanded, setExpanded] = useState(false)
  const tags = Array.isArray(row.prototypes) ? row.prototypes : []
  const keywordsText = Array.isArray(row.keywords)
    ? row.keywords.join(', ')
    : (row.keywords || '')

  return (
    <div className="p-2.5">
      <div className="flex items-start gap-2">
        <input
          className="flex-1 min-w-0 text-xs font-medium bg-transparent border-0 border-b border-transparent hover:border-input focus:border-primary focus:outline-none py-0.5 transition-colors"
          value={row.topic || ''}
          onChange={e => onUpdate({ topic: e.target.value })}
          placeholder="Topic name"
        />
        <select
          value={row.priority || 'medium'}
          onChange={e => onUpdate({ priority: e.target.value })}
          className={`shrink-0 text-3xs px-1.5 py-0.5 rounded-full border-0 cursor-pointer appearance-none ${PRIORITY_COLORS[row.priority] || PRIORITY_COLORS.medium}`}
        >
          <option value="high">high</option>
          <option value="medium">medium</option>
          <option value="low">low</option>
        </select>
        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          className="shrink-0 text-3xs text-muted-foreground hover:text-foreground px-1"
        >
          {expanded ? '▲' : '▼'}
        </button>
      </div>

      {archetypes.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {archetypes.map(a => {
            const active = tags.includes(a.id)
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => onToggleArchetype(a.id)}
                title={a.coreDesire || a.label}
                className={`inline-flex items-center gap-0.5 text-3xs px-1.5 py-0.5 rounded-full border transition-colors ${
                  active
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-input hover:bg-accent/40'
                }`}
              >
                {a.emoji && <span>{a.emoji}</span>}
                {a.shortLabel || a.label || a.id}
              </button>
            )
          })}
        </div>
      )}

      {expanded && (
        <div className="mt-2.5 space-y-2">
          <div>
            <Label className="text-3xs mb-0.5 block text-muted-foreground">Category</Label>
            <input
              className="w-full text-xs rounded-md border border-input bg-background px-2 py-1"
              value={row.category || ''}
              onChange={e => onUpdate({ category: e.target.value })}
              placeholder="e.g. Recovery, Prevention"
            />
          </div>
          <div>
            <Label className="text-3xs mb-0.5 block text-muted-foreground">Keywords (comma-separated)</Label>
            <input
              className="w-full text-xs rounded-md border border-input bg-background px-2 py-1"
              value={keywordsText}
              onChange={e =>
                onUpdate({ keywords: e.target.value.split(',').map(k => k.trim()).filter(Boolean) })
              }
              placeholder="e.g. knee, rehab, return to sport"
            />
          </div>
          {'pnwNote' in row && (
            <div>
              <Label className="text-3xs mb-0.5 block text-muted-foreground">Regional note</Label>
              <input
                className="w-full text-xs rounded-md border border-input bg-background px-2 py-1"
                value={row.pnwNote || ''}
                onChange={e => onUpdate({ pnwNote: e.target.value })}
              />
            </div>
          )}
          <button type="button" onClick={onRemove} className="text-3xs text-destructive hover:underline">
            Remove topic
          </button>
        </div>
      )}
    </div>
  )
}

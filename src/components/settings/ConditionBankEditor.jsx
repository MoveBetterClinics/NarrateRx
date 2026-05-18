// Structured editor for workspace.interview_context, the JSONB column
// that drives per-condition interview steering (formatInterviewContext
// ForPrompt in src/lib/prompts.js).
//
// Shape (as consumed in prompts.js):
//   {
//     conditions: {
//       [key]: {
//         audienceProfile: string,
//         audienceStakes:  string,
//         regionalAngles:  string[],
//         interviewTopics: string[],
//         chronicRelevant: boolean,
//       },
//     },
//     keywordAliases: { [keyword]: conditionKey },
//     fallback: <same shape as a condition entry>
//   }
//
// PR #3 replaces the legacy 18-row raw-JSON textarea with this. The
// "Raw JSON" escape hatch remains for the rare case where a power user
// needs to paste a blob, but the structured form is the default surface.

import { useEffect, useState } from 'react'
import { Plus, X, ChevronDown, ChevronUp, Code } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Textarea2 } from '@/components/settings/helpers'

function tryParse(jsonText) {
  if (!jsonText || !jsonText.trim()) return { ok: true, value: {} }
  try {
    const parsed = JSON.parse(jsonText)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { ok: true, value: parsed }
    }
    return { ok: false, error: 'Expected an object' }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

export function ConditionBankEditor({ value, onChange }) {
  const parsed = tryParse(value)
  const [rawMode, setRawMode] = useState(false)

  // On parse failure, force raw mode so the user can recover the text.
  if (!parsed.ok) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-destructive">JSON parse error — editing as raw JSON until fixed: {parsed.error}</p>
        <Textarea2 label="" value={value} onChange={onChange} rows={18} mono />
      </div>
    )
  }

  const ctx = parsed.value
  const conditions = ctx.conditions && typeof ctx.conditions === 'object' ? ctx.conditions : {}
  const keywordAliases = ctx.keywordAliases && typeof ctx.keywordAliases === 'object' ? ctx.keywordAliases : {}
  const fallback = ctx.fallback && typeof ctx.fallback === 'object' ? ctx.fallback : null
  const conditionKeys = Object.keys(conditions)

  function commit(next) {
    onChange(JSON.stringify(next, null, 2))
  }

  function updateCondition(key, patch) {
    commit({
      ...ctx,
      conditions: { ...conditions, [key]: { ...conditions[key], ...patch } },
    })
  }

  function renameConditionKey(oldKey, newKey) {
    if (!newKey || newKey === oldKey) return
    if (conditions[newKey]) return // collision; ignore
    const next = { ...conditions }
    next[newKey] = next[oldKey]
    delete next[oldKey]
    // Rewrite aliases that pointed at the old key
    const nextAliases = Object.fromEntries(
      Object.entries(keywordAliases).map(([kw, val]) => [kw, val === oldKey ? newKey : val]),
    )
    commit({ ...ctx, conditions: next, keywordAliases: nextAliases })
  }

  function removeCondition(key) {
    const next = { ...conditions }
    delete next[key]
    const nextAliases = Object.fromEntries(
      Object.entries(keywordAliases).filter(([, v]) => v !== key),
    )
    commit({ ...ctx, conditions: next, keywordAliases: nextAliases })
  }

  function addCondition() {
    const base = 'new_condition'
    let key = base
    let i = 2
    while (conditions[key]) { key = `${base}_${i++}` }
    commit({
      ...ctx,
      conditions: {
        ...conditions,
        [key]: {
          audienceProfile: '',
          audienceStakes: '',
          regionalAngles: [],
          interviewTopics: [],
          chronicRelevant: false,
        },
      },
    })
  }

  function updateAlias(oldKw, newKw, target) {
    const next = { ...keywordAliases }
    if (oldKw && oldKw !== newKw) delete next[oldKw]
    if (newKw) next[newKw] = target
    commit({ ...ctx, keywordAliases: next })
  }
  function removeAlias(kw) {
    const next = { ...keywordAliases }
    delete next[kw]
    commit({ ...ctx, keywordAliases: next })
  }
  function addAlias() {
    const firstCondition = conditionKeys[0] || ''
    commit({ ...ctx, keywordAliases: { ...keywordAliases, '': firstCondition } })
  }

  function setFallback(patch) {
    const cur = fallback || { audienceProfile: '', audienceStakes: '', regionalAngles: [], interviewTopics: [], chronicRelevant: false }
    commit({ ...ctx, fallback: { ...cur, ...patch } })
  }
  function clearFallback() {
    const { fallback: _drop, ...rest } = ctx
    commit(rest)
  }

  if (rawMode) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">Editing as raw JSON.</p>
          <button
            type="button"
            onClick={() => setRawMode(false)}
            className="text-xs text-primary hover:underline"
          >
            ← Back to structured view
          </button>
        </div>
        <Textarea2 label="" value={value} onChange={onChange} rows={18} mono />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Conditions list */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            Conditions ({conditionKeys.length})
          </Label>
          <button
            type="button"
            onClick={() => setRawMode(true)}
            className="inline-flex items-center gap-1 text-2xs text-muted-foreground hover:text-foreground"
          >
            <Code className="h-3 w-3" /> Raw JSON
          </button>
        </div>
        {conditionKeys.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            No conditions yet. Add one to give Bernard a per-condition steering brief.
          </p>
        ) : (
          <div className="space-y-2">
            {conditionKeys.map(key => (
              <ConditionCard
                key={key}
                conditionKey={key}
                condition={conditions[key]}
                onChange={patch => updateCondition(key, patch)}
                onRename={newKey => renameConditionKey(key, newKey)}
                onRemove={() => removeCondition(key)}
              />
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={addCondition}
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          <Plus className="h-3.5 w-3.5" /> Add condition
        </button>
      </div>

      {/* Keyword aliases */}
      <div className="space-y-2 pt-2 border-t border-input">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">
          Keyword aliases ({Object.keys(keywordAliases).length})
        </Label>
        <p className="text-2xs text-muted-foreground">
          When an interview topic contains the keyword, Bernard uses the matched condition&apos;s brief.
        </p>
        {Object.keys(keywordAliases).length === 0 ? (
          <p className="text-2xs text-muted-foreground italic">No aliases yet.</p>
        ) : (
          <div className="space-y-1.5">
            {Object.entries(keywordAliases).map(([kw, target]) => (
              <AliasRow
                key={kw || `__empty_${target}`}
                keyword={kw}
                target={target}
                conditionKeys={conditionKeys}
                onChange={(newKw, newTarget) => updateAlias(kw, newKw, newTarget)}
                onRemove={() => removeAlias(kw)}
              />
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={addAlias}
          disabled={conditionKeys.length === 0}
          title={conditionKeys.length === 0 ? 'Add at least one condition before creating an alias' : undefined}
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline disabled:opacity-40 disabled:cursor-not-allowed disabled:no-underline"
        >
          <Plus className="h-3.5 w-3.5" /> Add alias
        </button>
      </div>

      {/* Fallback */}
      <div className="space-y-2 pt-2 border-t border-input">
        <div className="flex items-baseline justify-between">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            Fallback brief
          </Label>
          {fallback && (
            <button
              type="button"
              onClick={clearFallback}
              className="text-2xs text-muted-foreground hover:text-destructive"
            >
              Clear
            </button>
          )}
        </div>
        <p className="text-2xs text-muted-foreground">
          Used when no condition or alias matches the interview topic.
        </p>
        {fallback ? (
          <div className="rounded-lg border border-input bg-card p-3">
            <ConditionFields
              condition={fallback}
              onChange={setFallback}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setFallback({})}
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <Plus className="h-3.5 w-3.5" /> Add fallback brief
          </button>
        )}
      </div>
    </div>
  )
}

// ── A single condition card ──────────────────────────────────────────────

function ConditionCard({ conditionKey, condition, onChange, onRename, onRemove }) {
  const [expanded, setExpanded] = useState(false)
  const [keyDraft, setKeyDraft] = useState(conditionKey)
  // Sync draft when parent renames the key externally (e.g. undo/redo)
  useEffect(() => { setKeyDraft(conditionKey) }, [conditionKey])
  const c = condition || {}
  const summary = (c.audienceProfile || '').slice(0, 80)

  return (
    <div className="rounded-lg border border-input bg-card">
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-accent/30 rounded-lg text-left"
      >
        <code className="text-2xs font-mono bg-muted/60 text-foreground px-1.5 py-0.5 rounded shrink-0">{conditionKey}</code>
        <span className="flex-1 min-w-0 text-xs text-muted-foreground truncate">
          {summary || <em>No audience profile yet</em>}
        </span>
        {c.chronicRelevant && (
          <span className="text-3xs px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700 shrink-0">chronic</span>
        )}
        {expanded
          ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
      </button>
      {expanded && (
        <div className="border-t border-input p-3 space-y-3">
          <div>
            <Label className="text-xs mb-1 block">Condition key</Label>
            <input
              className="w-full h-8 rounded-md border border-input bg-background px-2 text-sm font-mono"
              value={keyDraft}
              onChange={e => setKeyDraft(e.target.value)}
              onBlur={() => onRename(keyDraft.trim())}
              placeholder="e.g. low_back_pain"
            />
            <p className="text-2xs text-muted-foreground mt-1">
              Lowercase identifier. Bernard matches incoming topics against this key.
            </p>
          </div>
          <ConditionFields condition={c} onChange={onChange} />
          <button
            type="button"
            onClick={onRemove}
            className="text-xs text-destructive hover:underline"
          >
            Remove this condition
          </button>
        </div>
      )}
    </div>
  )
}

// Shared field set — used for both condition cards and the fallback editor.
function ConditionFields({ condition, onChange }) {
  const c = condition || {}
  const angles = Array.isArray(c.regionalAngles) ? c.regionalAngles : []
  const topics = Array.isArray(c.interviewTopics) ? c.interviewTopics : []

  return (
    <div className="space-y-3">
      <Textarea2
        label="Who shows up for this"
        value={c.audienceProfile || ''}
        onChange={v => onChange({ audienceProfile: v })}
        rows={3}
        hint="One-sentence description of the patient most likely searching this."
      />
      <Textarea2
        label="What's at stake for them"
        value={c.audienceStakes || ''}
        onChange={v => onChange({ audienceStakes: v })}
        rows={2}
        hint="What they lose if they don't address it."
      />
      <Textarea2
        label="Regional angles (one per line)"
        value={angles.join('\n')}
        onChange={v => onChange({ regionalAngles: v.split('\n').map(s => s.trim()).filter(Boolean) })}
        rows={3}
        hint="Local references that make content feel native to your region."
      />
      <Textarea2
        label="Interview topics (one per line)"
        value={topics.join('\n')}
        onChange={v => onChange({ interviewTopics: v.split('\n').map(s => s.trim()).filter(Boolean) })}
        rows={4}
        hint="Question areas Bernard probes for this condition."
      />
      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={!!c.chronicRelevant}
          onChange={e => onChange({ chronicRelevant: e.target.checked })}
          className="mt-0.5"
        />
        <div>
          <p className="text-xs font-medium">Chronic angle relevant</p>
          <p className="text-2xs text-muted-foreground">
            Tells Bernard to explore long-standing/chronic presentations when this condition comes up.
          </p>
        </div>
      </label>
    </div>
  )
}

function AliasRow({ keyword, target, conditionKeys, onChange, onRemove }) {
  return (
    <div className="flex items-center gap-2">
      <input
        className="flex-1 h-7 rounded-md border border-input bg-background px-2 text-xs font-mono"
        value={keyword}
        onChange={e => onChange(e.target.value, target)}
        placeholder="keyword"
      />
      <span className="text-muted-foreground text-2xs">→</span>
      <select
        className="flex-1 h-7 rounded-md border border-input bg-background px-2 text-xs font-mono"
        value={target}
        onChange={e => onChange(keyword, e.target.value)}
      >
        <option value="">(none)</option>
        {conditionKeys.map(k => (
          <option key={k} value={k}>{k}</option>
        ))}
      </select>
      <button
        type="button"
        onClick={onRemove}
        className="h-7 w-7 inline-flex items-center justify-center text-muted-foreground hover:text-destructive shrink-0"
        aria-label="Remove alias"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

import { useState, useEffect } from 'react'
import { Navigate, Link } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'
import { Loader2 } from 'lucide-react'
import { Section, Field, Textarea2, SaveBar } from '@/components/settings/helpers'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { useUserRole } from '@/lib/useUserRole'
import { useUnsavedChanges } from '@/lib/useUnsavedChanges'
import { useSaveShortcut } from '@/lib/useSaveShortcut'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

function formFromWorkspace(ws) {
  return {
    clinic_context:       ws.clinic_context       ?? '',
    audience_short:       ws.audience_short        ?? '',
    audience_description: ws.audience_description  ?? '',
    activity_context:     ws.activity_context      ?? '',
    brand_voice:          ws.brand_voice           ?? '',
    tone_active:          ws.tone_modifiers?.active   ?? '',
    tone_clinical:        ws.tone_modifiers?.clinical ?? '',
    tone_warm:            ws.tone_modifiers?.warm     ?? '',
    tone_smart:           ws.tone_modifiers?.smart    ?? '',
    patient_context_json:    JSON.stringify(ws.patient_context   ?? {}, null, 2),
    interview_context_json:  JSON.stringify(ws.interview_context ?? {}, null, 2),
    topic_suggestions_json:  JSON.stringify(ws.topic_suggestions ?? [], null, 2),
  }
}

function tryParseJson(text, fallback) {
  if (!text || !text.trim()) return { ok: true, value: fallback }
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

function formToPatch(form) {
  return {
    clinic_context:       form.clinic_context,
    audience_short:       form.audience_short,
    audience_description: form.audience_description,
    activity_context:     form.activity_context,
    brand_voice:          form.brand_voice,
    tone_modifiers: {
      active:   form.tone_active   ?? '',
      clinical: form.tone_clinical ?? '',
      warm:     form.tone_warm     ?? '',
      smart:    form.tone_smart    ?? '',
    },
    patient_context:   form._parsed_patient_context,
    interview_context: form._parsed_interview_context,
    topic_suggestions: form._parsed_topic_suggestions,
  }
}

export default function VoiceSettings() {
  useDocumentTitle('Settings — Bernard & voice')
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
          const initial = formFromWorkspace(data)
          setForm(initial)
          setPristine(initial)
        }
      })
  }, [])

  const isDirty = !!form && !!pristine && JSON.stringify(form) !== JSON.stringify(pristine)
  useUnsavedChanges(isDirty)
  useSaveShortcut(() => { if (isDirty && !saving) handleSave() }, { disabled: !isDirty || saving })

  function set(key) {
    return v => setForm(f => ({ ...f, [key]: v }))
  }

  async function handleSave() {
    setSaving(true); setError(null); setSaved(false)
    try {
      const pc = tryParseJson(form.patient_context_json, {})
      const ic = tryParseJson(form.interview_context_json, {})
      const ts = tryParseJson(form.topic_suggestions_json, [])
      if (!pc.ok)  { setError(`Patient context JSON: ${pc.error}`);   setSaving(false); return }
      if (!ic.ok)  { setError(`Interview context JSON: ${ic.error}`); setSaving(false); return }
      if (!ts.ok)  { setError(`Topic suggestions JSON: ${ts.error}`); setSaving(false); return }
      const formWithParsed = {
        ...form,
        _parsed_patient_context:   pc.value,
        _parsed_interview_context: ic.value,
        _parsed_topic_suggestions: ts.value,
      }
      const token = await getToken()
      const r = await fetch('/api/workspace/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(formToPatch(formWithParsed)),
      })
      if (!r.ok) {
        const err = await r.json().catch(() => ({}))
        setError(err.error || 'save-failed')
      } else {
        const updated = await r.json()
        setWs(updated)
        const refreshed = formFromWorkspace(updated)
        setForm(refreshed); setPristine(refreshed)
        setSaved(true); setTimeout(() => setSaved(false), 3000)
      }
    } catch {
      setError('network-error')
    } finally {
      setSaving(false)
    }
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

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Bernard &amp; voice</h1>
        <p className="text-muted-foreground text-sm mt-1">
          How the clinic sounds in AI-generated content. Changes apply from the next content generation.
        </p>
      </div>

      <Section
        title="AI voice context"
        description="Injected into every prompt. Write these as if briefing a copywriter."
      >
        <Textarea2 label="Clinic context"
          value={form.clinic_context} onChange={set('clinic_context')} rows={3} />
        <Field label="Audience (short)"
          value={form.audience_short} onChange={set('audience_short')} />
        <Textarea2 label="Audience (long form)"
          value={form.audience_description} onChange={set('audience_description')}
          rows={4}
          hint="Full description of who you're writing for." />
        <Field label="Activity context"
          value={form.activity_context} onChange={set('activity_context')}
          hint="Sport / discipline / lifestyle vocabulary used in 'active' tone." />
        <Textarea2 label="Brand voice"
          value={form.brand_voice} onChange={set('brand_voice')} rows={6} />
      </Section>

      <Separator />

      <Section
        title="AI tone modifiers"
        description="Per-tone prompt fragments injected when generating content. Use {display_name} and {activity_context} as placeholders. Leave a tone blank to skip its modifier."
      >
        <Textarea2 label="Active &amp; Driven"
          value={form.tone_active} onChange={set('tone_active')} rows={6}
          hint="Used when the author picks the 'Active & Driven' tone." />
        <Textarea2 label="Clinical &amp; In-Depth"
          value={form.tone_clinical} onChange={set('tone_clinical')} rows={6}
          hint="Used when the author picks the 'Clinical & In-Depth' tone." />
        <Textarea2 label="Warm &amp; Reassuring"
          value={form.tone_warm} onChange={set('tone_warm')} rows={6}
          hint="Used when the author picks the 'Warm & Reassuring' tone." />
        <Textarea2 label="Smart Default"
          value={form.tone_smart} onChange={set('tone_smart')} rows={6}
          hint="Used when the author picks 'Smart Default' or no tone." />
      </Section>

      <Separator />

      <Section
        title="Patient archetypes"
        description="Bernard's understanding of who your patients are. These archetypes shape tone and framing in every generated piece."
      >
        <PatientContextEditor
          value={form.patient_context_json}
          onChange={set('patient_context_json')}
        />
      </Section>

      <Separator />

      <Section
        title="Topic suggestions"
        description="The topics Bernard proposes during interviews. Tag each topic with the archetypes it serves — leave untagged to apply to all."
      >
        <TopicSuggestionsEditor
          topicsJson={form.topic_suggestions_json}
          patientContextJson={form.patient_context_json}
          onChange={set('topic_suggestions_json')}
        />
      </Section>

      <Separator />

      <details className="rounded-lg border border-input">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium select-none hover:bg-accent/30 list-none flex items-center justify-between rounded-lg">
          <span>Condition bank <span className="text-xs font-normal text-muted-foreground ml-1">(advanced JSON)</span></span>
          <span className="text-muted-foreground text-xs">▼</span>
        </summary>
        <div className="px-4 pb-4 space-y-2">
          <p className="text-xs text-muted-foreground pt-3">
            Per-condition interview structure — audience profile, regional angles, interview topics per condition.
            Shape: {`{ conditions: { [key]: { audienceProfile, audienceStakes, regionalAngles[], interviewTopics[], chronicRelevant } }, keywordAliases, fallback }`}
          </p>
          <Textarea2
            label=""
            value={form.interview_context_json}
            onChange={set('interview_context_json')}
            rows={18}
          />
        </div>
      </details>

      {/* Per-clinician voice fingerprints live on each clinician's profile.
          Surface the link here so admins know where to find / refresh them. */}
      <div className="rounded-lg border border-indigo-100 bg-indigo-50/60 px-4 py-3 flex items-start gap-3">
        <span className="text-base mt-0.5">🎙</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-indigo-900">Per-clinician voice notes</p>
          <p className="text-xs text-indigo-700 mt-0.5">
            As clinicians edit AI drafts, Bernard learns how each person writes — their preferred phrases, what they keep, what they cut. These notes live on each clinician&apos;s profile and automatically refine future drafts.
          </p>
          <Link
            to="/stories"
            className="inline-block mt-1.5 text-xs font-medium text-indigo-700 hover:text-indigo-900 underline underline-offset-2"
          >
            Go to Stories → open any story → visit the clinician&apos;s profile to view their voice notes
          </Link>
        </div>
      </div>

      <SaveBar
        saving={saving} saved={saved} error={error} isDirty={isDirty}
        onSave={handleSave}
        onDiscard={() => { setForm(pristine); setError(null) }}
      />
    </div>
  )
}

// ── PatientContextEditor ─────────────────────────────────────────────────────
// Structured editor for patient_context_json. Renders summaryBlurb,
// primaryAvatar, prototypes (as expandable cards), and priorProviderPainPoints
// as a line-list. Falls back to a raw textarea when JSON is unparseable.

function PatientContextEditor({ value, onChange }) {
  let parsed = null
  let parseError = null
  try {
    if (value && value.trim()) parsed = JSON.parse(value)
  } catch (e) {
    parseError = e.message
  }

  if (parseError) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-destructive">JSON parse error — editing as raw JSON until fixed: {parseError}</p>
        <Textarea2 label="Patient context (raw JSON)" value={value} onChange={onChange} rows={14} />
      </div>
    )
  }

  const pc = parsed ?? {}

  function update(patch) {
    onChange(JSON.stringify({ ...pc, ...patch }, null, 2))
  }

  function updatePrototype(idx, patch) {
    const next = (pc.prototypes || []).map((p, i) => (i === idx ? { ...p, ...patch } : p))
    update({ prototypes: next })
  }

  function addPrototype() {
    const next = [
      ...(pc.prototypes || []),
      { id: `archetype_${Date.now()}`, label: '', shortLabel: '', emoji: '', coreDesire: '', characteristics: [] },
    ]
    update({ prototypes: next })
  }

  function removePrototype(idx) {
    update({ prototypes: (pc.prototypes || []).filter((_, i) => i !== idx) })
  }

  const painPointsText = (pc.priorProviderPainPoints || []).join('\n')

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Textarea2
          label="Patient summary"
          value={pc.summaryBlurb || ''}
          onChange={v => update({ summaryBlurb: v })}
          rows={3}
          hint="One paragraph Bernard uses to orient tone and framing across all content."
        />
        <PrimaryAvatarEditor
          value={pc.primaryAvatar}
          onChange={v => update({ primaryAvatar: v })}
        />
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">Archetypes</Label>
          <button
            type="button"
            onClick={addPrototype}
            className="text-xs text-primary hover:underline"
          >
            + Add archetype
          </button>
        </div>
        {(pc.prototypes || []).length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            No archetypes defined yet. Add one to enable archetype-aware topic tagging and content framing.
          </p>
        ) : (
          <div className="space-y-2">
            {(pc.prototypes || []).map((proto, idx) => (
              <PrototypeCard
                key={proto.id || idx}
                proto={proto}
                onChange={patch => updatePrototype(idx, patch)}
                onRemove={() => removePrototype(idx)}
              />
            ))}
          </div>
        )}
      </div>

      <Textarea2
        label="What patients often say went wrong before"
        value={painPointsText}
        onChange={v => update({ priorProviderPainPoints: v.split('\n').map(l => l.trim()).filter(Boolean) })}
        rows={4}
        hint="One per line. Bernard uses these to frame 'what this clinic does differently.'"
      />
    </div>
  )
}

// Primary avatar field can be either a string (simple tenant shape) or a
// structured object with name/story/whatTheyWant + list fields (legacy
// paradigm shape used by Move Better workspaces). Detect the shape and
// render the right editor — passing the raw value back through onChange.
function PrimaryAvatarEditor({ value, onChange }) {
  const isObject = value != null && typeof value === 'object' && !Array.isArray(value)
  if (!isObject) {
    return (
      <Textarea2
        label="Primary avatar"
        value={typeof value === 'string' ? value : ''}
        onChange={onChange}
        rows={3}
        hint="The archetypal patient in plain language — who Bernard is always writing for."
      />
    )
  }

  const av = value
  const update = (patch) => onChange({ ...av, ...patch })
  const listFields = ['fears', 'beliefs', 'painPoints', 'demographics']

  return (
    <div className="rounded-lg border border-input bg-card p-3 space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">Primary avatar</Label>
        <span className="text-[10px] text-muted-foreground italic">structured</span>
      </div>
      <div>
        <Label className="text-xs mb-1 block">Name</Label>
        <input
          className="w-full h-8 rounded-md border border-input bg-background px-2 text-sm"
          value={av.name || ''}
          onChange={e => update({ name: e.target.value })}
          placeholder="e.g. The Frustrated Active Adult"
        />
      </div>
      <Textarea2
        label="Their story"
        value={av.story || ''}
        onChange={v => update({ story: v })}
        rows={4}
        hint="A short narrative of where this patient is coming from."
      />
      <Textarea2
        label="What they want"
        value={av.whatTheyWant || ''}
        onChange={v => update({ whatTheyWant: v })}
        rows={3}
        hint="The outcome this patient is reaching for."
      />
      <details className="rounded border border-input">
        <summary className="cursor-pointer px-3 py-2 text-xs text-muted-foreground hover:bg-accent/30 list-none">
          ▾ Fears, beliefs, pain points, demographics (one per line)
        </summary>
        <div className="p-3 pt-0 space-y-3">
          {listFields.map((key) => {
            const arr = Array.isArray(av[key]) ? av[key] : []
            return (
              <Textarea2
                key={key}
                label={key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1')}
                value={arr.join('\n')}
                onChange={v => update({ [key]: v.split('\n').map(s => s.trim()).filter(Boolean) })}
                rows={3}
              />
            )
          })}
        </div>
      </details>
    </div>
  )
}

function PrototypeCard({ proto, onChange, onRemove }) {
  const [expanded, setExpanded] = useState(false)
  const charsText = (proto.characteristics || []).join('\n')

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
            onChange={v => onChange({ characteristics: v.split('\n').map(l => l.trim()).filter(Boolean) })}
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

// ── TopicSuggestionsEditor ────────────────────────────────────────────────────
// Replaces the raw topic_suggestions_json textarea + the old TopicArchetypeEditor.
// Each topic row shows an inline name/priority editor + archetype toggle chips,
// with an expandable panel for category, keywords, and regional notes.

function TopicSuggestionsEditor({ topicsJson, patientContextJson, onChange }) {
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
        <Textarea2 label="Topic suggestions (raw JSON)" value={topicsJson} onChange={onChange} rows={14} />
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
    commit([...list, { topic: '', category: '', priority: 'medium', keywords: [] }])
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
              key={idx}
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

  const PRIORITY_COLORS = {
    high: 'bg-rose-100 text-rose-700',
    medium: 'bg-amber-100 text-amber-700',
    low: 'bg-slate-100 text-slate-600',
  }

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
          className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded-full border-0 cursor-pointer appearance-none ${PRIORITY_COLORS[row.priority] || PRIORITY_COLORS.medium}`}
        >
          <option value="high">high</option>
          <option value="medium">medium</option>
          <option value="low">low</option>
        </select>
        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          className="shrink-0 text-[10px] text-muted-foreground hover:text-foreground px-1"
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
                className={`inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full border transition-colors ${
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
            <Label className="text-[10px] mb-0.5 block text-muted-foreground">Category</Label>
            <input
              className="w-full text-xs rounded-md border border-input bg-background px-2 py-1"
              value={row.category || ''}
              onChange={e => onUpdate({ category: e.target.value })}
              placeholder="e.g. Recovery, Prevention"
            />
          </div>
          <div>
            <Label className="text-[10px] mb-0.5 block text-muted-foreground">Keywords (comma-separated)</Label>
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
              <Label className="text-[10px] mb-0.5 block text-muted-foreground">Regional note</Label>
              <input
                className="w-full text-xs rounded-md border border-input bg-background px-2 py-1"
                value={row.pnwNote || ''}
                onChange={e => onUpdate({ pnwNote: e.target.value })}
              />
            </div>
          )}
          <button type="button" onClick={onRemove} className="text-[10px] text-destructive hover:underline">
            Remove topic
          </button>
        </div>
      )}
    </div>
  )
}

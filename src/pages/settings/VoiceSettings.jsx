import { useState, useEffect } from 'react'
import { Navigate } from 'react-router-dom'
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
    booking_url:          ws.booking_url           ?? '',
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
    booking_url:          form.booking_url,
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
        <Field label="Booking URL"
          value={form.booking_url} onChange={set('booking_url')}
          placeholder="https://..." type="url" autoComplete="off" />
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
        title="Paradigm content (advanced)"
        description="Structured prompt context — patient archetypes, the per-condition interview bank, and the topic-suggestions list. Edit as JSON. Invalid JSON blocks save and shows the parse error inline. Leave empty to skip injection."
      >
        <Textarea2 label="Patient / audience context"
          value={form.patient_context_json} onChange={set('patient_context_json')}
          rows={14}
          hint="Shape: { summaryBlurb, primaryAvatar, prototypes[], priorProviderPainPoints[], staffProfiles[] }" />
        <Textarea2 label="Interview context (condition bank)"
          value={form.interview_context_json} onChange={set('interview_context_json')}
          rows={18}
          hint="Shape: { conditions: { [key]: { audienceProfile, audienceStakes, regionalAngles[], interviewTopics[], chronicRelevant } }, keywordAliases, fallback }" />
        <Textarea2 label="Topic suggestions"
          value={form.topic_suggestions_json} onChange={set('topic_suggestions_json')}
          rows={14}
          hint="Shape: array of { topic, category, priority: 'high'|'medium'|'low', keywords[], pnwNote, prototypes?: string[] }. prototypes is the list of archetype ids (from patient_context.prototypes[].id) this topic primarily serves — empty/missing = all archetypes." />
        <TopicArchetypeEditor
          topicsJson={form.topic_suggestions_json}
          patientContextJson={form.patient_context_json}
          onChange={set('topic_suggestions_json')}
        />
      </Section>

      <SaveBar
        saving={saving} saved={saved} error={error} isDirty={isDirty}
        onSave={handleSave}
        onDiscard={() => { setForm(pristine); setError(null) }}
      />
    </div>
  )
}

// Per-topic archetype-tag editor. Renders each parsed topic_suggestions[]
// entry as a row with toggle chips for each archetype defined in
// patient_context.prototypes[]. Writes back into the JSON textarea so the
// shared Save flow handles persistence (no separate API path needed).
function TopicArchetypeEditor({ topicsJson, patientContextJson, onChange }) {
  let topics = null
  let archetypes = []
  try {
    const parsed = JSON.parse(topicsJson)
    if (Array.isArray(parsed)) topics = parsed
  } catch { /* fall through */ }
  try {
    const pc = JSON.parse(patientContextJson)
    if (pc && Array.isArray(pc.prototypes)) archetypes = pc.prototypes
  } catch { /* fall through */ }

  if (!topics) {
    return (
      <p className="text-[11px] text-muted-foreground italic">
        Per-topic archetype tags: fix the topic-suggestions JSON above to enable this editor.
      </p>
    )
  }
  if (archetypes.length === 0) {
    return (
      <p className="text-[11px] text-muted-foreground italic">
        Per-topic archetype tags: define <code>patient_context.prototypes[]</code> (each with an <code>id</code>) above to enable this editor.
      </p>
    )
  }
  if (topics.length === 0) {
    return (
      <p className="text-[11px] text-muted-foreground italic">
        Per-topic archetype tags: add a topic above first.
      </p>
    )
  }

  function toggle(idx, archetypeId) {
    const next = topics.map((row, i) => {
      if (i !== idx) return row
      const cur = Array.isArray(row.prototypes) ? row.prototypes : []
      const without = cur.filter((t) => t !== archetypeId)
      const newTags = cur.includes(archetypeId) ? without : [...without, archetypeId]
      const { prototypes: _drop, ...rest } = row
      return newTags.length > 0 ? { ...rest, prototypes: newTags } : rest
    })
    onChange(JSON.stringify(next, null, 2))
  }

  return (
    <div className="space-y-2">
      <Label className="text-xs">Per-topic archetype tags</Label>
      <p className="text-[11px] text-muted-foreground">
        Toggle which archetype(s) each topic primarily serves. Empty row = applies to all archetypes. Changes write to the JSON above; click Save to persist.
      </p>
      <div className="rounded-md border border-input divide-y divide-input max-h-96 overflow-y-auto">
        {topics.map((row, idx) => {
          const tags = Array.isArray(row.prototypes) ? row.prototypes : []
          return (
            <div key={idx} className="p-2 flex flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium truncate">{row.topic || <em className="text-muted-foreground">(untitled)</em>}</div>
                {row.category && (
                  <div className="text-[10px] text-muted-foreground truncate">{row.category}</div>
                )}
              </div>
              <div className="flex flex-wrap gap-1">
                {archetypes.map((a) => {
                  const active = tags.includes(a.id)
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => toggle(idx, a.id)}
                      className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border transition-colors ${
                        active
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'border-input hover:bg-accent/40'
                      }`}
                      title={a.coreDesire || a.label}
                    >
                      {a.emoji && <span>{a.emoji}</span>}
                      {a.shortLabel || a.label || a.id}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

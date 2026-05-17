import { useState, useEffect } from 'react'
import { Navigate, Link } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'
import { Loader2, Sparkles, Pencil, Plus, X, ChevronDown, ChevronUp, ChevronRight } from 'lucide-react'
import { Section, Field, Textarea2, SaveBar } from '@/components/settings/helpers'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { useUserRole } from '@/lib/useUserRole'
import { useUnsavedChanges } from '@/lib/useUnsavedChanges'
import { useSaveShortcut } from '@/lib/useSaveShortcut'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { TONES } from '@/lib/prompts'
import { apiFetch } from '@/lib/api'
import { useClinicians } from '@/lib/queries'
import { ClinicianChip } from '@/components/ClinicianChip'
import {
  AUDIENCE_CATALOG,
  STORY_TYPE_CATALOG,
  MAX_CATALOG_SLOTS,
  MAX_CUSTOM_SLOTS,
} from '@/lib/interviewOptionsCatalog'

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
    audience_options:        Array.isArray(ws.audience_options)   ? ws.audience_options   : [],
    story_type_options:      Array.isArray(ws.story_type_options) ? ws.story_type_options : [],
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
    audience_options:   form.audience_options,
    story_type_options: form.story_type_options,
  }
}

export default function VoiceSettings() {
  useDocumentTitle('Settings — Bernard & voice')
  const { getToken } = useAuth()
  const runtimeWs = useWorkspace()
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

  const interviewerName = runtimeWs?.interviewer_name || ws?.interviewer_name || 'Bernard'
  const clinicName = runtimeWs?.display_name || ws?.display_name || 'your practice'

  return (
    <div className="max-w-2xl space-y-8">
      {/* ── Page header — narrative framing ── */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          What {interviewerName} knows about {clinicName}
        </h1>
        <p className="text-muted-foreground text-sm mt-1.5 leading-relaxed">
          This is the brief {interviewerName} reads before every interview and every piece of content.
          What you write here shapes how your clinicians sound — and how faithfully that voice
          carries into every draft.
        </p>
      </div>

      {/* ── Bernard's working summary (P0-E) ── */}
      <WorkingSummaryCallout form={form} interviewerName={interviewerName} />

      {/* ── Patient archetypes — front-and-centre read/edit cards ── */}
      <ArchetypeCardsSection
        value={form.patient_context_json}
        onChange={set('patient_context_json')}
        interviewerName={interviewerName}
      />

      {/* ── Preview Bernard's voice (P1-F) — near the top, next to archetypes ── */}
      <PreviewBernardCard interviewerName={interviewerName} />

      <Separator />

      {/* ── How your practice sounds ── */}
      <div id="voice-context-anchor" className="scroll-mt-20" />
      <Section
        title={`How ${clinicName} sounds`}
        description={`The core brief ${interviewerName} uses to stay on-brand in every piece of content.`}
      >
        <Textarea2
          label="What this clinic is about"
          value={form.clinic_context}
          onChange={set('clinic_context')}
          rows={3}
          hint={`${interviewerName} uses this to orient tone and framing across all content.`}
        />
        <Textarea2
          label="Brand voice"
          value={form.brand_voice}
          onChange={set('brand_voice')}
          rows={6}
          hint="How your content should feel — the adjectives, cadences, and phrases that make your voice yours."
        />
      </Section>

      <Separator />

      {/* ── Who you serve ── */}
      <Section
        title="Who you serve"
        description={`${interviewerName} uses this to calibrate language and empathy — who is actually reading this content?`}
      >
        <Field
          label="Audience in one line"
          value={form.audience_short}
          onChange={set('audience_short')}
          hint={`A short label ${interviewerName} can reference quickly — e.g. "active adults 35–60 returning from injury."`}
        />
        <Textarea2
          label="Full audience description"
          value={form.audience_description}
          onChange={set('audience_description')}
          rows={4}
          hint="The fuller picture of who you're writing for — their goals, fears, and what gets them to take action."
        />
        <Field
          label="Activity or discipline vocabulary"
          value={form.activity_context}
          onChange={set('activity_context')}
          hint={`Sport, discipline, or lifestyle terms that belong in the ${clinicName} lexicon.`}
        />
      </Section>

      <Separator />

      {/* ── Tone modes ── */}
      <Section
        title="How tone shifts"
        description={`When a clinician picks a tone at the start of an interview, ${interviewerName} applies the matching modifier below. Leave any tone blank to skip it.`}
      >
        <ToneModifierCards form={form} set={set} />
      </Section>

      <Separator />

      {/* ── Topic suggestions ── */}
      <Section
        title={`What ${interviewerName} asks about`}
        description={`The interview topics ${interviewerName} proposes. Tag each topic with the archetypes it serves — leave untagged to offer it to everyone.`}
      >
        <TopicSuggestionsEditor
          topicsJson={form.topic_suggestions_json}
          patientContextJson={form.patient_context_json}
          onChange={set('topic_suggestions_json')}
        />
      </Section>

      <Separator />

      {/* ── Pre-interview options — audience + story-type slots ── */}
      <Section
        title="Pre-interview choices"
        description="The audience and story-type options clinicians can pick from before starting an interview. Curate from the master catalog or add custom slots. Up to 6 catalog + 2 custom in each list."
      >
        <div className="space-y-6">
          <SlotEditor
            label="Audience"
            description="Who the piece is for. Shapes how the interviewer probes and how the output is worded."
            catalog={AUDIENCE_CATALOG}
            value={form.audience_options}
            onChange={set('audience_options')}
          />
          <SlotEditor
            label="Story type"
            description="What kind of piece you're making. Drives what the interviewer probes for (case study → timeline; principle → analogy)."
            catalog={STORY_TYPE_CATALOG}
            value={form.story_type_options}
            onChange={set('story_type_options')}
          />
        </div>
      </Section>

      <Separator />

      {/* ── Patient context details — avatar, pain points (advanced) ── */}
      <details className="group rounded-lg border border-input">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium select-none hover:bg-accent/30 list-none flex items-center justify-between rounded-lg">
          <span>Patient context details <span className="text-xs font-normal text-muted-foreground ml-1">(advanced)</span></span>
          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <div className="px-4 pb-4 pt-2">
          <PatientContextEditor
            value={form.patient_context_json}
            onChange={set('patient_context_json')}
          />
        </div>
      </details>

      <Separator />

      {/* ── Condition bank — advanced ── */}
      <details className="group rounded-lg border border-input">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium select-none hover:bg-accent/30 list-none flex items-center justify-between rounded-lg">
          <span>Condition bank <span className="text-xs font-normal text-muted-foreground ml-1">(advanced)</span></span>
          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
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
            mono
          />
        </div>
      </details>

      {/* ── Per-clinician voice memory ── */}
      <VoiceMemorySection interviewerName={interviewerName} />

      <SaveBar
        saving={saving} saved={saved} error={error} isDirty={isDirty}
        onSave={handleSave}
        onDiscard={() => { setForm(pristine); setError(null) }}
      />
    </div>
  )
}

// ── Pre-interview slot editor (Phase 1 — workspace curates audience + story type) ──
//
// Renders the full catalog as toggleable cards (selected ones are highlighted
// and counted against the 6-catalog cap) and a separate list of custom slots
// (up to 2) with inline label + description editing.
//
// All edits flow through onChange as the canonical slots array of
// { key, label, emoji, description, is_custom } objects — the shape the
// server expects on PATCH /api/workspace/me.

function SlotEditor({ label, description, catalog, value, onChange }) {
  const slots = Array.isArray(value) ? value : []
  const selectedCatalogKeys = new Set(
    slots.filter((s) => !s.is_custom).map((s) => s.key),
  )
  const customSlots = slots.filter((s) => s.is_custom)
  const catalogCount = selectedCatalogKeys.size

  // Pending row — filled before being committed via "Add" button
  const [pending, setPending] = useState(null)

  function toggleCatalogItem(item) {
    if (selectedCatalogKeys.has(item.key)) {
      onChange(slots.filter((s) => !(!s.is_custom && s.key === item.key)))
      return
    }
    if (catalogCount >= MAX_CATALOG_SLOTS) return
    onChange([...slots, { ...item, is_custom: false }])
  }

  function openPendingRow() {
    if (customSlots.length >= MAX_CUSTOM_SLOTS) return
    setPending({ emoji: '⭐', label: '', description: '' })
  }

  function commitPending() {
    if (!pending || !pending.label.trim()) return
    const key = `custom_${Date.now().toString(36)}`
    onChange([
      ...slots,
      { key, label: pending.label.trim(), emoji: pending.emoji || '⭐', description: pending.description.trim(), is_custom: true },
    ])
    setPending(null)
  }

  function updateCustomSlot(key, patch) {
    onChange(slots.map((s) => (s.key === key ? { ...s, ...patch } : s)))
  }

  function removeCustomSlot(key) {
    onChange(slots.filter((s) => s.key !== key))
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>

      {/* Catalog grid */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            From catalog
          </Label>
          <span className="text-xs text-muted-foreground">
            {catalogCount} / {MAX_CATALOG_SLOTS} selected
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {catalog.map((item) => {
            const selected = selectedCatalogKeys.has(item.key)
            const disabled = !selected && catalogCount >= MAX_CATALOG_SLOTS
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => toggleCatalogItem(item)}
                disabled={disabled}
                className={`flex items-start gap-2 rounded-lg border p-2.5 text-left transition-all ${
                  selected
                    ? 'border-primary bg-primary/5 ring-1 ring-primary'
                    : disabled
                    ? 'border-input opacity-40 cursor-not-allowed'
                    : 'border-input hover:border-primary/40 hover:bg-accent/30'
                }`}
              >
                <span className="text-base shrink-0 mt-0.5">{item.emoji}</span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold leading-tight">{item.label}</p>
                  <p className="text-2xs text-muted-foreground mt-0.5 leading-tight">
                    {item.description}
                  </p>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Custom slots */}
      <div className="space-y-2 border-t border-border pt-3">
        <div className="flex items-baseline justify-between">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            Custom slots
          </Label>
          <span className="text-xs text-muted-foreground">
            {customSlots.length} / {MAX_CUSTOM_SLOTS}
          </span>
        </div>
        {customSlots.length === 0 && !pending && (
          <p className="text-xs text-muted-foreground italic">
            No custom slots. Add one if the catalog doesn&rsquo;t cover what you need.
          </p>
        )}
        {customSlots.map((slot) => (
          <div
            key={slot.key}
            className="flex items-start gap-2 rounded-lg border border-input bg-muted/30 p-2.5"
          >
            <Input
              value={slot.emoji}
              onChange={(e) => updateCustomSlot(slot.key, { emoji: e.target.value.slice(0, 4) })}
              className="w-12 text-center text-base h-8 shrink-0"
              maxLength={4}
              aria-label="Emoji"
            />
            <div className="flex-1 min-w-0 space-y-1">
              <Input
                value={slot.label}
                onChange={(e) => updateCustomSlot(slot.key, { label: e.target.value })}
                placeholder="Label (e.g. Equine owners)"
                maxLength={60}
                className="h-8 text-xs font-semibold"
              />
              <Input
                value={slot.description}
                onChange={(e) => updateCustomSlot(slot.key, { description: e.target.value })}
                placeholder="Short description (shown beneath the label)"
                maxLength={120}
                className="h-8 text-2xs text-muted-foreground"
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => removeCustomSlot(slot.key)}
              className="h-8 w-8 p-0 shrink-0 text-muted-foreground hover:text-destructive"
              aria-label="Remove custom slot"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))}

        {/* Pending (uncommitted) row */}
        {pending && (
          <div className="flex items-start gap-2 rounded-lg border border-primary/40 bg-primary/5 p-2.5">
            <Input
              value={pending.emoji}
              onChange={(e) => setPending(p => ({ ...p, emoji: e.target.value.slice(0, 4) }))}
              className="w-12 text-center text-base h-8 shrink-0"
              maxLength={4}
              aria-label="Emoji"
            />
            <div className="flex-1 min-w-0 space-y-1">
              <Input
                value={pending.label}
                onChange={(e) => setPending(p => ({ ...p, label: e.target.value }))}
                placeholder="Label (e.g. Equine owners)"
                maxLength={60}
                className="h-8 text-xs font-semibold"
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') commitPending(); if (e.key === 'Escape') setPending(null) }}
              />
              <Input
                value={pending.description}
                onChange={(e) => setPending(p => ({ ...p, description: e.target.value }))}
                placeholder="Short description (shown beneath the label)"
                maxLength={120}
                className="h-8 text-2xs text-muted-foreground"
                onKeyDown={(e) => { if (e.key === 'Enter') commitPending(); if (e.key === 'Escape') setPending(null) }}
              />
            </div>
            <div className="flex flex-col gap-1 shrink-0">
              <Button
                type="button"
                size="sm"
                onClick={commitPending}
                disabled={!pending.label.trim()}
                className="h-8 text-xs px-2"
              >
                Add
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setPending(null)}
                className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                aria-label="Cancel"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {!pending && customSlots.length < MAX_CUSTOM_SLOTS && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={openPendingRow}
            className="text-xs"
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add custom slot
          </Button>
        )}
      </div>
    </div>
  )
}

// ── Per-clinician voice memory (P1-H) ────────────────────────────────────────

function VoiceMemorySection({ interviewerName }) {
  const { data: clinicians = [], isLoading } = useClinicians()

  return (
    <div className="rounded-lg border border-indigo-100 bg-indigo-50/60 px-4 py-4">
      <div className="flex items-start gap-3 mb-3">
        <span className="text-base mt-0.5">🎙</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-indigo-900">Per-clinician voice memory</p>
          <p className="text-xs text-indigo-700 mt-0.5">
            As clinicians edit AI drafts, {interviewerName} learns how each person writes — phrases
            they keep, ones they cut, the way they naturally say things. These fingerprints
            sharpen every future draft for that clinician.
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-2 pl-7">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-400" />
          <span className="text-xs text-indigo-600">Loading clinicians…</span>
        </div>
      ) : clinicians.length === 0 ? (
        <p className="text-xs text-indigo-600 pl-7">No clinicians yet — add one to start building voice memory.</p>
      ) : (
        <ul className="space-y-1 pl-7">
          {clinicians.map(c => {
            const hasNotes = !!(c.voice_notes || '').trim()
            return (
              <li key={c.id}>
                <Link
                  to={`/clinician/${c.id}`}
                  className="flex items-center gap-2.5 py-1 group"
                >
                  <ClinicianChip id={c.id} name={c.name} size="sm" showName nameClassName="text-xs text-indigo-800 group-hover:text-indigo-950" />
                  <span className={`text-3xs font-medium px-1.5 py-0.5 rounded-full ${hasNotes ? 'bg-indigo-200 text-indigo-800' : 'bg-indigo-100/60 text-indigo-500'}`}>
                    {hasNotes ? 'voice notes' : 'no notes yet'}
                  </span>
                  <ChevronRight className="h-3 w-3 text-indigo-400 group-hover:text-indigo-700 ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// ── Working summary callout (P0-E) ───────────────────────────────────────────

function buildWorkingSummary(form, interviewerName) {
  const brandVoice = (form?.brand_voice || '').trim()
  const audience = (form?.audience_short || '').trim()
  if (!brandVoice && !audience) return null
  const tones = [form?.tone_active, form?.tone_clinical, form?.tone_warm, form?.tone_smart]
    .map(t => (t || '').trim()).filter(Boolean)
  const name = interviewerName || 'Bernard'
  const sentences = []
  if (brandVoice && audience) {
    const voiceSnippet = brandVoice.slice(0, 120) + (brandVoice.length > 120 ? '…' : '')
    sentences.push(`${name} will write for ${audience} in a voice that comes across as ${voiceSnippet}.`)
  } else if (brandVoice) {
    const voiceSnippet = brandVoice.slice(0, 160) + (brandVoice.length > 160 ? '…' : '')
    sentences.push(`${name} will write in a voice that comes across as ${voiceSnippet}.`)
  } else if (audience) {
    sentences.push(`${name} will tailor content for ${audience}.`)
  }
  if (tones.length) {
    sentences.push(`${tones.length} tone mode${tones.length === 1 ? '' : 's'} configured so each piece can shift register when needed.`)
  }
  return sentences.join(' ')
}

function WorkingSummaryCallout({ form, interviewerName }) {
  const summary = buildWorkingSummary(form, interviewerName)
  function scrollToVoiceContext(e) {
    e.preventDefault()
    document.getElementById('voice-context-anchor')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-amber-700">
          {interviewerName}&apos;s working summary
        </p>
        <a
          href="#voice-context-anchor"
          onClick={scrollToVoiceContext}
          className="inline-flex items-center gap-1 text-xs text-amber-700 hover:text-amber-900"
        >
          <Pencil className="h-3 w-3" /> Edit
        </a>
      </div>
      {summary ? (
        <p className="text-sm text-foreground mt-1.5 leading-relaxed">{summary}</p>
      ) : (
        <p className="text-sm italic text-foreground/70 mt-1.5 leading-relaxed">
          {interviewerName} hasn&apos;t learned your voice yet — fill in the sections below and he&apos;ll mirror it back.
        </p>
      )}
    </div>
  )
}

// ── Preview Bernard's voice card (P1-F) ──────────────────────────────────────

function PreviewBernardCard({ interviewerName }) {
  const [opener, setOpener] = useState(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(null)

  async function generate() {
    setLoading(true); setErr(null)
    try {
      const data = await apiFetch('/api/voice-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      setOpener(data.opener)
    } catch (e) {
      setErr(e?.message || 'Preview failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card>
      <CardContent className="pt-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">Preview {interviewerName}&apos;s voice</p>
            <p className="text-xs text-muted-foreground mt-0.5">See a sample opener given the current settings.</p>
          </div>
          <Button onClick={generate} disabled={loading} size="sm" className="shrink-0 gap-1.5">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {loading ? 'Generating preview…' : 'Try a preview'}
          </Button>
        </div>
        {opener && (
          <blockquote className="border-l-2 border-primary/40 pl-3 text-base italic text-foreground/80 leading-relaxed">
            &ldquo;{opener}&rdquo;
            <footer className="mt-1 text-xs not-italic text-muted-foreground">— {interviewerName}</footer>
          </blockquote>
        )}
        {err && <p className="text-xs text-destructive">{err}</p>}
      </CardContent>
    </Card>
  )
}

// ── ToneModifierCards ────────────────────────────────────────────────────────

function ToneModifierCards({ form, set }) {
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
        return (
          <ToneCard
            key={key}
            toneObj={toneObj}
            label={label}
            value={value}
            onChange={set(key)}
          />
        )
      })}
    </div>
  )
}

function ToneCard({ toneObj, label, value, onChange }) {
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
          ) : (
            <p className="text-xs text-muted-foreground/60 mt-0.5 italic">No modifier — using defaults</p>
          )}
        </div>
        {expanded
          ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
          : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        }
      </button>
      {expanded && (
        <div className="border-t border-input px-3 pb-3 pt-2">
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

// ── PatientContextEditor ─────────────────────────────────────────────────────

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
        <Textarea2 label="Patient context (raw JSON)" value={value} onChange={onChange} rows={14} mono />
      </div>
    )
  }

  const pc = parsed ?? {}

  function update(patch) {
    onChange(JSON.stringify({ ...pc, ...patch }, null, 2))
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
        <span className="text-3xs text-muted-foreground italic">structured</span>
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

function PrototypeCard({ proto, onChange, onRemove, defaultExpanded = true }) {
  const [expanded, setExpanded] = useState(defaultExpanded)
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

// ── ArchetypeCardsSection ─────────────────────────────────────────────────────
// Read-mode grid of patient archetypes shown near the top of Voice Settings.
// Click any card to expand it into the full PrototypeCard edit form.
// "+ Add an archetype" creates a new one and immediately opens its edit form.

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

function ArchetypeCardsSection({ value, onChange, interviewerName }) {
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

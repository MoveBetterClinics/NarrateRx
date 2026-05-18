// Lean Voice & tone settings page — first of the three pages that replace
// the legacy fat VoiceSettings.jsx (see .claude/mockups/voice-settings-
// redesign-mapping.md). Owns the fields that shape Bernard's voice + tone:
//
//   clinic_context, brand_voice
//   audience_short, audience_description, activity_context
//   tone_modifiers (active / clinical / warm / smart)
//
// Patient archetypes, topic suggestions, slot editors, and per-clinician
// voice memory live on sibling pages (PRs #3 + #4).

import { useState, useEffect } from 'react'
import { Navigate, Link } from 'react-router-dom'
import { Loader2, Sparkles, Pencil, ArrowRight } from 'lucide-react'
import { Section, Field, Textarea2, SaveBar } from '@/components/settings/helpers'
import { Button } from '@/components/ui/button'
import { useUserRole } from '@/lib/useUserRole'
import { useUnsavedChanges } from '@/lib/useUnsavedChanges'
import { useSaveShortcut } from '@/lib/useSaveShortcut'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { apiFetch } from '@/lib/api'
import { ToneModifierCards } from '@/components/settings/ToneCard'

// Pull only the fields this page owns from a workspace row. PATCH covers
// the same keys so saving here never accidentally clears archetypes,
// topics, or slot lists owned by sibling pages.
function formFromWorkspace(ws) {
  return {
    clinic_context:       ws.clinic_context       ?? '',
    brand_voice:          ws.brand_voice           ?? '',
    audience_short:       ws.audience_short        ?? '',
    audience_description: ws.audience_description  ?? '',
    activity_context:     ws.activity_context      ?? '',
    tone_active:          ws.tone_modifiers?.active   ?? '',
    tone_clinical:        ws.tone_modifiers?.clinical ?? '',
    tone_warm:            ws.tone_modifiers?.warm     ?? '',
    tone_smart:           ws.tone_modifiers?.smart    ?? '',
  }
}

function formToPatch(form) {
  return {
    clinic_context:       form.clinic_context,
    brand_voice:          form.brand_voice,
    audience_short:       form.audience_short,
    audience_description: form.audience_description,
    activity_context:     form.activity_context,
    tone_modifiers: {
      active:   form.tone_active   ?? '',
      clinical: form.tone_clinical ?? '',
      warm:     form.tone_warm     ?? '',
      smart:    form.tone_smart    ?? '',
    },
  }
}

export default function VoiceTonePage() {
  useDocumentTitle('Settings — Voice & tone')
  const runtimeWs = useWorkspace()
  const { role, isLoading: roleLoading } = useUserRole()
  const [ws, setWs] = useState(undefined)
  const [form, setForm] = useState(null)
  const [pristine, setPristine] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    apiFetch('/api/workspace/me')
      .then(data => {
        setWs(data)
        if (data) {
          const initial = formFromWorkspace(data)
          setForm(initial)
          setPristine(initial)
        }
      })
      .catch(() => setWs(null))
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
      const updated = await apiFetch('/api/workspace/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formToPatch(form)),
      })
      setWs(updated)
      const refreshed = formFromWorkspace(/** @type {any} */ (updated))
      setForm(refreshed); setPristine(refreshed)
      setSaved(true); setTimeout(() => setSaved(false), 3000)
    } catch (e) {
      setError(/** @type {any} */ (e)?.message || 'save-failed')
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
      {/* Breadcrumb + heading */}
      <div>
        <div className="flex items-center justify-between">
          <p className="text-2xs text-muted-foreground/80">
            Settings · {interviewerName} · Voice &amp; tone
          </p>
          <Link
            to="/settings/workspace/patients"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            Next: Patients &amp; topics
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        <h1 className="text-2xl font-bold tracking-tight mt-0.5">
          How {clinicName} sounds
        </h1>
        <p className="text-muted-foreground text-sm mt-1.5 leading-relaxed">
          The brief {interviewerName} reads before every draft. Tone modes shift register when a clinician asks.
        </p>
      </div>

      {/* Unified brief + preview card */}
      <BriefAndPreviewCard form={form} interviewerName={interviewerName} />

      {/* The clinic */}
      <Section
        title="The clinic"
        description={`The core orienting brief ${interviewerName} uses to stay on-brand in every piece of content.`}
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

      {/* Who you serve */}
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

      {/* Tone modes */}
      <Section
        title="Tone modes"
        description={`When a clinician picks a tone at the start of an interview, ${interviewerName} applies the matching modifier below. Leave any tone blank to fall back to the system default shown inside the card.`}
      >
        <ToneModifierCards form={form} set={set} />
      </Section>

      <SaveBar
        saving={saving} saved={saved} error={error} isDirty={isDirty}
        onSave={handleSave}
        onDiscard={() => { setForm(pristine); setError(null) }}
      />
    </div>
  )
}

// ── BriefAndPreviewCard ──────────────────────────────────────────────────────
// Merges what used to be two separate things on the legacy page:
//   - WorkingSummaryCallout: deterministic string-template of the brief
//   - PreviewBernardCard: live LLM opener generated from current settings
//
// One card. Resting state shows the deterministic summary; "Try a live
// preview" hits /api/voice-preview and renders the opener below in a
// blockquote. Avoids two answers to the "what does Bernard think" question.

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

function BriefAndPreviewCard({ form, interviewerName }) {
  const summary = buildWorkingSummary(form, interviewerName)
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
    <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-3.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-2xs font-semibold uppercase tracking-widest text-amber-800">
          {interviewerName}&apos;s brief, as he reads it
        </p>
        <Button
          onClick={generate}
          disabled={loading}
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 border-amber-300 bg-amber-100/50 text-amber-900 hover:bg-amber-200/60 hover:text-amber-950"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          <span className="text-xs">{loading ? 'Generating…' : 'Try a live preview'}</span>
        </Button>
      </div>
      {summary ? (
        <p className="text-sm text-foreground mt-2 leading-relaxed">{summary}</p>
      ) : (
        <p className="text-sm italic text-foreground/70 mt-2 leading-relaxed flex items-center gap-1.5">
          <Pencil className="h-3 w-3 text-amber-700/80 shrink-0" />
          {interviewerName} hasn&apos;t learned your voice yet — fill in the sections below and he&apos;ll mirror it back.
        </p>
      )}
      {opener && (
        <blockquote className="mt-3 border-l-2 border-amber-400/60 pl-3 text-sm italic text-foreground/80 leading-relaxed">
          &ldquo;{opener}&rdquo;
          <footer className="mt-1 text-2xs not-italic text-muted-foreground">— {interviewerName}, sample opener</footer>
        </blockquote>
      )}
      {err && <p className="text-2xs text-destructive mt-2">{err}</p>}
    </div>
  )
}

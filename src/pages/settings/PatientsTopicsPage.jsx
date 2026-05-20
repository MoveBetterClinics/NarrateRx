// Lean Patients & topics settings page — second of the three pages that
// replace the legacy fat VoiceSettings.jsx (see .claude/mockups/voice-
// settings-redesign-mapping.md). Owns the fields that describe WHO
// Bernard probes and WHAT he probes about:
//
//   patient_context  — archetypes (prototypes[]), summary blurb,
//                      primary avatar, prior-provider pain points
//   topic_suggestions — interview-time topic catalog (with archetype tags)
//   interview_context — per-condition steering brief (structured editor,
//                       replaces legacy raw-JSON textarea)
//
// Voice / brand-voice / tone modifiers live on VoiceTonePage; the
// pre-interview slot editors live on InterviewDefaultsPage (PR #4).

import { useState, useEffect } from 'react'
import { Navigate, Link } from 'react-router-dom'
import { Loader2, ArrowLeft, ArrowRight } from 'lucide-react'
import { Section, SaveBar } from '@/components/settings/helpers'
import { useUserRole } from '@/lib/useUserRole'
import { useUnsavedChanges } from '@/lib/useUnsavedChanges'
import { useSaveShortcut } from '@/lib/useSaveShortcut'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { apiFetch } from '@/lib/api'
import { ArchetypeCardsSection } from '@/components/settings/PatientArchetypes'
import { PatientContextEditor } from '@/components/settings/PatientContextEditor'
import { TopicSuggestionsEditor } from '@/components/settings/TopicSuggestionsEditor'
import { ConditionBankEditor } from '@/components/settings/ConditionBankEditor'

function formFromWorkspace(ws) {
  return {
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

export default function PatientsTopicsPage() {
  useDocumentTitle('Settings — Patients & topics')
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
      const pc = tryParseJson(form.patient_context_json, {})
      const ic = tryParseJson(form.interview_context_json, {})
      const ts = tryParseJson(form.topic_suggestions_json, [])
      if (!pc.ok) { setError(`Patient context JSON: ${pc.error}`);   setSaving(false); return }
      if (!ic.ok) { setError(`Interview context JSON: ${ic.error}`); setSaving(false); return }
      if (!ts.ok) { setError(`Topic suggestions JSON: ${ts.error}`); setSaving(false); return }

      const updated = await apiFetch('/api/workspace/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient_context:   pc.value,
          interview_context: ic.value,
          topic_suggestions: ts.value,
        }),
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
    <div className="space-y-8">
      {/* Breadcrumb + heading */}
      <div>
        <div className="flex items-center justify-between">
          <p className="text-2xs text-muted-foreground/80">
            Settings · {interviewerName} · Patients &amp; topics
          </p>
          <div className="flex items-center gap-3">
            <Link
              to="/settings/workspace/voice"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3 w-3" />
              Back: Voice &amp; tone
            </Link>
            <Link
              to="/settings/workspace/interview-defaults"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              Next: Interview defaults
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </div>
        <h1 className="text-2xl font-bold tracking-tight mt-0.5 flex items-center">
          <span
            className="inline-block w-1 h-6 rounded-full shrink-0 mr-2.5"
            style={{ background: 'hsl(var(--primary))' }}
            aria-hidden="true"
          />
          Who {interviewerName} interviews about
        </h1>
        <p className="text-muted-foreground text-sm mt-1.5 leading-relaxed">
          The patients {clinicName} serves, the questions {interviewerName} should probe, and the per-condition
          steering briefs {interviewerName} reads when an interview topic matches.
        </p>
      </div>

      {/* Patient archetypes — front-and-centre cards-as-read-mode */}
      <ArchetypeCardsSection
        value={form.patient_context_json}
        onChange={set('patient_context_json')}
        interviewerName={interviewerName}
      />

      {/* Patient context details — summary, avatar, pain points */}
      <Section
        title="Patient context details"
        description={`The orienting brief ${interviewerName} reads before every interview — the patient summary, the primary avatar, and what patients say went wrong before.`}
      >
        <PatientContextEditor
          value={form.patient_context_json}
          onChange={set('patient_context_json')}
          interviewerName={interviewerName}
        />
      </Section>

      {/* Topic suggestions */}
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

      {/* Condition bank — structured editor replaces the legacy raw-JSON textarea */}
      <Section
        title="Condition bank"
        description={`Per-condition steering briefs. When an interview topic matches a condition key (or a keyword alias), ${interviewerName} reads the matching brief to sharpen his questions.`}
      >
        <ConditionBankEditor
          value={form.interview_context_json}
          onChange={set('interview_context_json')}
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

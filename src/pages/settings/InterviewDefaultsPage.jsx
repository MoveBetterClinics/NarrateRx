// Lean Interview defaults page — third of three pages that replace the
// legacy fat VoiceSettings.jsx (see .claude/mockups/voice-settings-
// redesign-mapping.md). Owns the per-workspace UI defaults that show up
// at the start of every interview:
//
//   audience_options    — slot list (catalog + custom) the clinician
//                         chooses from for "who is this for"
//   story_type_options  — slot list for "what kind of piece are we making"
//
// Also surfaces a read-only per-clinician voice-memory roster. The roster
// lived on the legacy VoiceSettings page where it was an awkward fit
// under "Voice & tone"; here it groups naturally with "what shows up at
// interview start" — both are about the moment the clinician kicks off
// a conversation. Each row links to the clinician's profile where the
// voice notes are actually edited.

import { useState, useEffect } from 'react'
import { Navigate, Link } from 'react-router-dom'
import { Loader2, ChevronRight, ArrowLeft, Mic } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { Section, SaveBar } from '@/components/settings/helpers'
import { useUserRole } from '@/lib/useUserRole'
import { useUnsavedChanges } from '@/lib/useUnsavedChanges'
import { useSaveShortcut } from '@/lib/useSaveShortcut'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { useClinicians } from '@/lib/queries'
import { ClinicianChip } from '@/components/ClinicianChip'
import { SlotEditor } from '@/components/settings/SlotEditor'
import {
  AUDIENCE_CATALOG,
  STORY_TYPE_CATALOG,
} from '@/lib/interviewOptionsCatalog'

function formFromWorkspace(ws) {
  return {
    audience_options:   Array.isArray(ws.audience_options)   ? ws.audience_options   : [],
    story_type_options: Array.isArray(ws.story_type_options) ? ws.story_type_options : [],
  }
}

export default function InterviewDefaultsPage() {
  useDocumentTitle('Settings — Interview defaults')
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
        body: JSON.stringify({
          audience_options:   form.audience_options,
          story_type_options: form.story_type_options,
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

  return (
    <div className="max-w-2xl space-y-8">
      {/* Breadcrumb + heading */}
      <div>
        <div className="flex items-center justify-between">
          <p className="text-2xs text-muted-foreground/80">
            Settings · {interviewerName} · Interview defaults
          </p>
          <Link
            to="/settings/workspace/patients"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" />
            Back: Patients &amp; topics
          </Link>
        </div>
        <h1 className="text-2xl font-bold tracking-tight mt-0.5">
          What clinicians see at interview start
        </h1>
        <p className="text-muted-foreground text-sm mt-1.5 leading-relaxed">
          The audience and story-type choices a clinician picks from before {interviewerName} starts asking
          questions. Curate from the master catalog or add custom slots — up to 6 catalog + 2 custom per list.
        </p>
      </div>

      {/* Pre-interview slot editors */}
      <Section
        title="Pre-interview choices"
        description={`The two pickers ${interviewerName} surfaces at the start of every new interview.`}
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

      {/* Per-clinician voice memory roster (read-only nav, edits live on the profile) */}
      <VoiceMemoryRoster interviewerName={interviewerName} />

      <SaveBar
        saving={saving} saved={saved} error={error} isDirty={isDirty}
        onSave={handleSave}
        onDiscard={() => { setForm(pristine); setError(null) }}
      />
    </div>
  )
}

// ── Per-clinician voice memory roster ────────────────────────────────────────
//
// Read-only directory of clinicians with a "voice notes" badge. The full
// edit surface for a clinician's voice notes lives on their profile at
// /clinician/:id — this card is a fast scanner + nav shortcut.

function VoiceMemoryRoster({ interviewerName }) {
  const { data: clinicians = [], isLoading } = useClinicians()

  return (
    <div className="rounded-lg border border-indigo-100 bg-indigo-50/60 px-4 py-4">
      <div className="flex items-start gap-3 mb-3">
        <Mic className="h-4 w-4 mt-0.5 text-indigo-700/80 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-indigo-900">Per-clinician voice memory</p>
          <p className="text-xs text-indigo-700 mt-0.5">
            As clinicians edit AI drafts, {interviewerName} learns how each person writes — phrases
            they keep, ones they cut, the way they naturally say things. Open a clinician&rsquo;s profile
            to review or add notes that sharpen every future draft for them.
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

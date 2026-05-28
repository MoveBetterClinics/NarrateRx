import { useState, useMemo, useEffect, useCallback } from 'react'
import { Navigate } from 'react-router-dom'
import {
  Loader2, Target, Calendar, Plus, Pencil, X, Save,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { apiFetch } from '@/lib/api'
import { useClinicianSummaries } from '@/lib/queries'
import { toast } from '@/lib/toast'
import { useUserRole } from '@/lib/useUserRole'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

// Phase 4 Tentpole PR A — Multi-campaign admin surface.
//
// Lets workspace admins create + edit time-windowed campaigns. The slate
// generator (PR B) will read currently-active campaigns and bias today's
// package selection accordingly.

const CONTENT_STYLE_OPTIONS = [
  {
    value: 'clinical',
    label: 'Clinical',
    description: 'Standard clinical content — adjustments, assessments, patient stories.',
  },
  {
    value: 'promotional',
    label: 'Promotional',
    description: 'Event-registration push — every post drives RSVPs.',
  },
  {
    value: 'referral',
    label: 'Referral',
    description: 'Peer-to-peer — voice aimed at trainers, coaches, PTs, surgeons, and other referring providers.',
  },
  {
    value: 'relationship',
    label: 'Relationship',
    description: 'Community / retention — non-clinical, suppresses clinical topic gaps during the window.',
  },
]

// Format an ISO datetime for a <input type="datetime-local">.
function isoToLocal(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function localToIso(local) {
  if (!local) return null
  const d = new Date(local)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}
function fmtDateRange(start, end, event) {
  const f = (iso) => {
    if (!iso) return null
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
    })
  }
  if (event) return `Event ${f(event)}`
  if (start && end) return `${f(start)} → ${f(end)}`
  if (start) return `Starts ${f(start)}`
  if (end) return `Ends ${f(end)}`
  return 'Evergreen'
}

function campaignWindowState(c) {
  const now = Date.now()
  const s = c.start_at ? new Date(c.start_at).getTime() : -Infinity
  const e = c.end_at   ? new Date(c.end_at).getTime()   :  Infinity
  if (c.status === 'archived') return { label: 'Archived', tone: 'muted' }
  if (c.status === 'complete') return { label: 'Complete', tone: 'muted' }
  if (now < s) return { label: 'Upcoming', tone: 'sky' }
  if (now > e) return { label: 'Window ended', tone: 'amber' }
  return { label: 'Active', tone: 'emerald' }
}

const TONE_CLASS = {
  emerald: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  sky:     'bg-sky-50 text-sky-800 border-sky-200',
  amber:   'bg-amber-50 text-amber-800 border-amber-200',
  muted:   'bg-muted text-muted-foreground border-border',
}

export default function CampaignsSettings() {
  useDocumentTitle('Settings — Campaigns')
  const { role, isLoading: roleLoading } = useUserRole()
  const [campaigns, setCampaigns] = useState(null)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(null) // null | 'new' | campaign object

  // Clinician map for rendering target labels on campaign rows.
  const { data: clinicians = [] } = useClinicianSummaries()
  const clinicianMap = useMemo(
    () => Object.fromEntries(clinicians.map((c) => [c.id, c.name])),
    [clinicians]
  )

  const load = useCallback(async () => {
    setError(null)
    try {
      const data = await apiFetch('/api/campaigns/list')
      setCampaigns(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e?.message || 'Failed to load campaigns')
    }
  }, [])

  useEffect(() => { load() }, [load])

  // All hooks must run before any conditional return.
  const active   = useMemo(() => (campaigns || []).filter((c) => campaignWindowState(c).tone === 'emerald'), [campaigns])
  const upcoming = useMemo(() => (campaigns || []).filter((c) => campaignWindowState(c).tone === 'sky'), [campaigns])
  const other    = useMemo(() => (campaigns || []).filter((c) => {
    const t = campaignWindowState(c).tone
    return t !== 'emerald' && t !== 'sky'
  }), [campaigns])

  if (roleLoading) {
    return <div className="flex justify-center py-24"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
  }
  if (role !== 'admin') return <Navigate to="/" replace />

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" /> Campaigns
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-xl">
            Time-windowed pushes the slate generator biases toward. Define a window,
            an event date, and a theme — the slate will allocate packages by event proximity.
          </p>
        </div>
        <Button onClick={() => setEditing('new')} disabled={!!editing}>
          <Plus className="h-4 w-4 mr-1.5" /> New campaign
        </Button>
      </div>

      {editing && (
        <CampaignEditor
          initial={editing === 'new' ? null : editing}
          onCancel={() => setEditing(null)}
          onSaved={(saved) => {
            setEditing(null)
            // Optimistic merge — refresh from server too.
            setCampaigns((cs) => {
              if (!cs) return [saved]
              const ix = cs.findIndex((c) => c.id === saved.id)
              if (ix >= 0) {
                const copy = cs.slice()
                copy[ix] = saved
                return copy
              }
              return [saved, ...cs]
            })
            load()
          }}
        />
      )}

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 text-destructive px-4 py-3 text-sm">
          {error} <button className="underline" onClick={load}>Retry</button>
        </div>
      )}

      {campaigns === null && !error && (
        <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      )}

      {campaigns && campaigns.length === 0 && !editing && (
        <div className="rounded-xl border-2 border-dashed border-border py-16 px-4 text-center text-sm text-muted-foreground">
          {"No campaigns yet. Click "}<strong>New campaign</strong>{" to create one."}
        </div>
      )}

      {campaigns && campaigns.length > 0 && (
        <>
          {active.length > 0 && (
            <CampaignList
              title="Active"
              items={active}
              onEdit={setEditing}
              clinicianMap={clinicianMap}
            />
          )}
          {upcoming.length > 0 && (
            <CampaignList
              title="Upcoming"
              items={upcoming}
              onEdit={setEditing}
              clinicianMap={clinicianMap}
            />
          )}
          {other.length > 0 && (
            <CampaignList
              title="Past & archived"
              items={other}
              onEdit={setEditing}
              muted
              clinicianMap={clinicianMap}
            />
          )}
        </>
      )}
    </div>
  )
}

// ─── List + row ──────────────────────────────────────────────────────────────

function CampaignList({ title, items, onEdit, muted, clinicianMap }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className={`text-2xs font-bold uppercase tracking-widest ${muted ? 'text-muted-foreground/70' : 'text-muted-foreground'}`}>
        {title} <span className="opacity-70">· {items.length}</span>
      </h2>
      <div className="flex flex-col gap-2">
        {items.map((c) => (
          <CampaignRow
            key={c.id}
            campaign={c}
            onEdit={onEdit}
            muted={muted}
            clinicianMap={clinicianMap}
          />
        ))}
      </div>
    </section>
  )
}

function CampaignRow({ campaign: c, onEdit, muted, clinicianMap }) {
  const ws = campaignWindowState(c)
  const targets = Array.isArray(c.target_clinician_ids) ? c.target_clinician_ids : []
  const targetLabel = targets.length === 0
    ? 'Workspace-wide'
    : `Targets: ${targets.map((id) => clinicianMap?.[id] || 'Unknown').join(', ')}`
  return (
    <button
      type="button"
      onClick={() => onEdit(c)}
      className={`flex items-start gap-3 text-left p-4 rounded-xl border border-border bg-card hover:bg-accent/20 transition-colors ${muted ? 'opacity-70' : ''}`}
    >
      <Target className="h-4 w-4 text-primary mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold">{c.name}</span>
          <span className={`inline-flex items-center text-3xs font-bold uppercase tracking-wider px-2 py-0.5 rounded-md border ${TONE_CLASS[ws.tone]}`}>
            {ws.label}
          </span>
          <span className="inline-flex items-center text-3xs font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded">
            {c.content_style || 'clinical'}
          </span>
          <span className={`inline-flex items-center text-3xs font-semibold px-2 py-0.5 rounded ${
            targets.length === 0
              ? 'text-muted-foreground bg-muted'
              : 'text-primary bg-primary/10 border border-primary/20'
          }`}>
            {targetLabel}
          </span>
        </div>
        <div className="text-xs text-muted-foreground mt-1 flex items-center gap-3 flex-wrap">
          <span className="inline-flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            {fmtDateRange(c.start_at, c.end_at, c.event_at)}
          </span>
          {c.theme_notes && (
            <span className="truncate max-w-md">— {c.theme_notes}</span>
          )}
        </div>
      </div>
      <Pencil className="h-3.5 w-3.5 text-muted-foreground mt-1 shrink-0" />
    </button>
  )
}

// ─── Editor ──────────────────────────────────────────────────────────────────

function CampaignEditor({ initial, onCancel, onSaved }) {
  const isNew = !initial
  const [form, setForm] = useState(() => ({
    id:             initial?.id || null,
    name:           initial?.name || '',
    description:    initial?.description || '',
    status:         initial?.status || 'active',
    start_at:       isoToLocal(initial?.start_at),
    end_at:         isoToLocal(initial?.end_at),
    event_at:       isoToLocal(initial?.event_at),
    theme_notes:    initial?.theme_notes || '',
    content_style:  initial?.content_style || 'clinical',
    cta_url:        initial?.cta_url || '',
    cta_label:      initial?.cta_label || '',
    cta_pitch:      initial?.cta_pitch || '',
    target_clinician_ids: Array.isArray(initial?.target_clinician_ids) ? initial.target_clinician_ids : [],
  }))
  const [saving, setSaving] = useState(false)

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  async function handleSave() {
    if (!form.name.trim()) {
      toast.error('Name is required.')
      return
    }
    setSaving(true)
    try {
      const payload = {
        ...(form.id ? { id: form.id } : {}),
        name:          form.name.trim(),
        description:   form.description.trim() || null,
        status:        form.status,
        start_at:      localToIso(form.start_at),
        end_at:        localToIso(form.end_at),
        event_at:      localToIso(form.event_at),
        theme_notes:   form.theme_notes.trim() || null,
        content_style: form.content_style,
        cta_url:       form.cta_url.trim() || null,
        cta_label:     form.cta_label.trim() || null,
        cta_pitch:     form.cta_pitch.trim() || null,
        target_clinician_ids: form.target_clinician_ids || [],
      }
      const saved = await apiFetch('/api/campaigns/upsert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      toast(isNew ? 'Campaign created.' : 'Campaign saved.')
      onSaved(saved)
    } catch (err) {
      toast.error(err?.message || 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-xl border-2 border-primary/30 bg-card p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-bold flex items-center gap-2">
          {isNew ? <Plus className="h-4 w-4 text-primary" /> : <Pencil className="h-4 w-4 text-primary" />}
          {isNew ? 'New campaign' : `Editing: ${initial.name}`}
        </h3>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="p-1 text-muted-foreground hover:text-foreground"
          aria-label="Close editor"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <Field label="Name" hint="Short, distinctive — appears on slate packages.">
        <Input
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="e.g. Low back pain seminar — Mar 15"
          maxLength={120}
        />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="Active from">
          <Input type="datetime-local" value={form.start_at} onChange={(e) => set('start_at', e.target.value)} />
        </Field>
        <Field label="Active until">
          <Input type="datetime-local" value={form.end_at} onChange={(e) => set('end_at', e.target.value)} />
        </Field>
        <Field label="Event date" hint="The big moment, if applicable.">
          <Input type="datetime-local" value={form.event_at} onChange={(e) => set('event_at', e.target.value)} />
        </Field>
      </div>

      <Field label="Theme notes" hint="What this campaign is about — used by the AI to bias topic selection during the window.">
        <Textarea
          rows={3}
          value={form.theme_notes}
          onChange={(e) => set('theme_notes', e.target.value)}
          placeholder="e.g. Free public seminar on low back pain. Targeted at first-time visitors. Emphasize practical assessment tips and a friendly community vibe."
        />
      </Field>

      <Field label="Content style" hint="Drives the tone of content generated during this campaign's window.">
        <div className="flex flex-col gap-2">
          {CONTENT_STYLE_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                form.content_style === opt.value
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/40'
              }`}
            >
              <input
                type="radio"
                name="content_style"
                value={opt.value}
                checked={form.content_style === opt.value}
                onChange={(e) => set('content_style', e.target.value)}
                className="mt-1"
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold">{opt.label}</div>
                <div className="text-xs text-muted-foreground">{opt.description}</div>
              </div>
            </label>
          ))}
        </div>
      </Field>

      <ClinicianTargetPicker
        selected={form.target_clinician_ids}
        onChange={(ids) => set('target_clinician_ids', ids)}
      />

      <div className="border-t border-border pt-4 flex flex-col gap-3">
        <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Call to action (optional)</h4>
        <Field label="URL" hint="Registration page, sign-up link, etc.">
          <Input
            type="url"
            value={form.cta_url}
            onChange={(e) => set('cta_url', e.target.value)}
            placeholder="https://example.com/rsvp"
          />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Button label" hint="Short — for platforms with a literal button.">
            <Input
              value={form.cta_label}
              onChange={(e) => set('cta_label', e.target.value)}
              placeholder="Reserve your seat"
              maxLength={80}
            />
          </Field>
          <Field label="Invitation sentence" hint="Used in social caption / email body.">
            <Input
              value={form.cta_pitch}
              onChange={(e) => set('cta_pitch', e.target.value)}
              placeholder="Come to our free seminar on Mar 15."
              maxLength={500}
            />
          </Field>
        </div>
      </div>

      <div className="border-t border-border pt-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">Status:</Label>
          <select
            value={form.status}
            onChange={(e) => set('status', e.target.value)}
            className="text-sm border border-border rounded-md px-2 py-1.5 bg-card"
          >
            <option value="active">Active</option>
            <option value="complete">Complete</option>
            <option value="archived">Archived</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Saving…</> :
              <><Save className="h-3.5 w-3.5 mr-1.5" />Save campaign</>}
          </Button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, hint, children }) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-sm font-semibold">{label}</Label>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      {children}
    </div>
  )
}

// Multi-select clinician picker. Empty selection = workspace-wide
// (the default + most common case — most campaigns apply across all clinicians).
function ClinicianTargetPicker({ selected, onChange }) {
  const { data: clinicians = [], isLoading } = useClinicianSummaries()
  const selectedSet = new Set(selected || [])

  function toggle(id) {
    const next = new Set(selectedSet)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange(Array.from(next))
  }

  return (
    <Field
      label="Target clinicians"
      hint="Empty = workspace-wide (campaign applies to every clinician's content). Pick specific clinicians to scope this campaign — e.g. Q's running seminar shouldn't bias Whitney's post-partum atoms."
    >
      {isLoading ? (
        <div className="text-xs text-muted-foreground py-2">Loading…</div>
      ) : clinicians.length === 0 ? (
        <div className="text-xs text-muted-foreground py-2">No clinicians in this workspace yet.</div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <label
            className={`flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
              selected.length === 0
                ? 'border-primary bg-primary/5'
                : 'border-border hover:border-primary/40'
            }`}
            onClick={(e) => { e.preventDefault(); onChange([]) }}
          >
            <input type="checkbox" checked={selected.length === 0} readOnly className="pointer-events-none" />
            <div className="flex-1">
              <div className="text-sm font-semibold">Workspace-wide</div>
              <div className="text-xs text-muted-foreground">Apply to every clinician at this workspace.</div>
            </div>
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
            {clinicians.map((c) => (
              <label
                key={c.id}
                className={`flex items-center gap-2 px-2.5 py-2 rounded-md border text-sm cursor-pointer transition-colors ${
                  selectedSet.has(c.id)
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/40'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedSet.has(c.id)}
                  onChange={() => toggle(c.id)}
                />
                <span className="truncate">{c.name}</span>
              </label>
            ))}
          </div>
          {selected.length > 0 && (
            <p className="text-2xs text-muted-foreground mt-0.5">
              Targeting {selected.length} clinician{selected.length !== 1 ? 's' : ''}.
              Atoms from other clinicians won&apos;t see this campaign&apos;s context.
            </p>
          )}
        </div>
      )}
    </Field>
  )
}


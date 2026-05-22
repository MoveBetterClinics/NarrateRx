// Per-clinician campaign override surface. Mounts on the clinician's profile
// page. Three states:
//
//   1. Read-only (someone viewing another clinician's profile, not admin):
//      shows whether the clinician is on a personal override or workspace
//      default, plus the effective mode summary. No edit controls.
//
//   2. Editable + currently using workspace default:
//      shows the workspace's active mode + a "Set personal override" toggle.
//      Flipping it on reveals the override editor seeded with the workspace
//      default's values.
//
//   3. Editable + currently using personal override:
//      shows the mode picker + CTA fields, plus a "Use workspace default"
//      button to clear the override.
//
// Edit permission: isOwner (the clinician themselves) OR isAdmin.
// Read permission: any authenticated workspace member.

import { useState, useEffect, useRef } from 'react'
import { Target, Check } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { CAMPAIGN_MODES } from '@/lib/campaigns'
import { fetchCampaign, fetchClinicianCampaign, updateClinicianCampaign } from '@/lib/api'
import { toast } from '@/lib/toast'

function isoToInputValue(iso) {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    const pad = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  } catch {
    return ''
  }
}
function inputValueToIso(v) {
  if (!v) return null
  try {
    const d = new Date(v)
    if (Number.isNaN(d.getTime())) return null
    return d.toISOString()
  } catch {
    return null
  }
}

const EMPTY_OVERRIDE = { mode: 'bookings', notes: '', cta_url: '', cta_label: '', cta_pitch: '', event_at: null }

export function ClinicianCampaignCard({ clinician, canEdit }) {
  const [loaded, setLoaded] = useState(false)
  const [workspaceDefault, setWorkspaceDefault] = useState(EMPTY_OVERRIDE)
  const [override, setOverride] = useState(/** @type {object | null} */ (null))
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const debounceTimerRef = useRef(null)

  // Initial load — workspace default for context + this clinician's override.
  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetchCampaign().catch(() => EMPTY_OVERRIDE),
      fetchClinicianCampaign(clinician.id).catch(() => ({ settings: null })),
    ]).then(([wsDefault, mine]) => {
      if (cancelled) return
      setWorkspaceDefault({ ...EMPTY_OVERRIDE, ...wsDefault })
      setOverride(mine?.settings || null)
      setLoaded(true)
    })
    return () => { cancelled = true }
  }, [clinician.id])

  function flashSaved() {
    setSavedFlash(true)
    setTimeout(() => setSavedFlash(false), 1800)
  }

  async function clearOverride() {
    setSaving(true)
    try {
      await updateClinicianCampaign(clinician.id, null)
      setOverride(null)
      flashSaved()
    } catch (e) {
      toast.error(e?.message || 'Failed to clear override')
    }
    setSaving(false)
  }

  async function startOverride() {
    // Seed the override with the workspace default's values so flipping the
    // toggle on doesn't blow away context the clinician was about to keep.
    const seed = {
      mode:      workspaceDefault.mode      || 'bookings',
      notes:     workspaceDefault.notes     || '',
      cta_url:   workspaceDefault.cta_url   || '',
      cta_label: workspaceDefault.cta_label || '',
      cta_pitch: workspaceDefault.cta_pitch || '',
      event_at:  workspaceDefault.event_at  || null,
    }
    setSaving(true)
    try {
      await updateClinicianCampaign(clinician.id, seed)
      setOverride(seed)
      flashSaved()
    } catch (e) {
      toast.error(e?.message || 'Failed to enable override')
    }
    setSaving(false)
  }

  function scheduleOverrideSave(patch) {
    if (!override) return
    const next = { ...override, ...patch }
    setOverride(next)
    clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = setTimeout(async () => {
      try {
        await updateClinicianCampaign(clinician.id, next)
        flashSaved()
      } catch (e) {
        toast.error(e?.message || 'Save failed')
      }
    }, 700)
  }

  if (!loaded) {
    return (
      <Card>
        <CardContent className="p-4 text-xs text-muted-foreground">Loading content focus…</CardContent>
      </Card>
    )
  }

  const effective = override || workspaceDefault
  const effectiveModeDef = CAMPAIGN_MODES[effective.mode] || CAMPAIGN_MODES.bookings
  const usingDefault = !override

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-primary" />
            <div>
              <p className="text-sm font-semibold">{clinician.name?.split(' ')[0] || 'Clinician'}&apos;s Content Focus</p>
              <p className="text-2xs text-muted-foreground">
                Applies to new social / email / video drafts generated from {clinician.name?.split(' ')[0] || 'this clinician'}&apos;s interviews. Blog stays evergreen.
              </p>
            </div>
          </div>
          {saving && <span className="text-xs text-muted-foreground">Saving…</span>}
          {!saving && savedFlash && (
            <span className="flex items-center gap-1 text-xs text-green-600">
              <Check className="h-3 w-3" /> Saved
            </span>
          )}
        </div>

        {/* Source-of-truth banner: which mode is actually being used? */}
        <div className={`rounded-lg border p-3 text-xs ${usingDefault ? 'bg-muted/30' : 'bg-primary/5 border-primary/30'}`}>
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="font-medium">
                {usingDefault ? 'Using workspace default' : 'Personal override active'}
                : <span className="text-primary">{effectiveModeDef.label}</span>
              </p>
              {usingDefault ? (
                <p className="text-2xs text-muted-foreground mt-0.5">
                  Whatever your admin sets for the whole workspace.
                </p>
              ) : (
                <p className="text-2xs text-muted-foreground mt-0.5">
                  {clinician.name?.split(' ')[0] || 'This clinician'}&apos;s drafts won&apos;t reflect the workspace default while this is on.
                </p>
              )}
            </div>
            {canEdit && (
              usingDefault ? (
                <Button size="sm" variant="outline" onClick={startOverride} disabled={saving}>
                  Set personal override
                </Button>
              ) : (
                <Button size="sm" variant="outline" onClick={clearOverride} disabled={saving}>
                  Use workspace default
                </Button>
              )
            )}
          </div>
        </div>

        {/* Override editor — only when an override is active AND user can edit. */}
        {override && canEdit && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {Object.entries(CAMPAIGN_MODES).map(([key, def]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => scheduleOverrideSave({ mode: key })}
                  className={`text-left rounded-lg border p-3 transition-colors text-sm ${
                    override.mode === key
                      ? 'bg-primary/5 border-primary/40 text-primary'
                      : 'hover:bg-muted/50 text-foreground'
                  }`}
                >
                  <p className="font-medium text-xs leading-snug">{def.label}</p>
                  <p className="text-2xs text-muted-foreground mt-1 leading-snug line-clamp-2">{def.description}</p>
                </button>
              ))}
            </div>

            {(() => {
              const def = CAMPAIGN_MODES[override.mode] || CAMPAIGN_MODES.bookings
              return (
                <>
                  {def.showCta && (
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground">{def.ctaUrlLabel}</label>
                        <Input
                          type="url"
                          value={override.cta_url || ''}
                          onChange={(e) => scheduleOverrideSave({ cta_url: e.target.value })}
                          placeholder={def.ctaUrlPlaceholder}
                          className="text-sm"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground">{def.ctaLabelLabel}</label>
                        <Input
                          type="text"
                          value={override.cta_label || ''}
                          onChange={(e) => scheduleOverrideSave({ cta_label: e.target.value })}
                          placeholder={def.ctaLabelPlaceholder}
                          className="text-sm"
                          maxLength={60}
                        />
                      </div>
                      {def.showCtaPitch && (
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-muted-foreground">{def.ctaPitchLabel}</label>
                          <Textarea
                            value={override.cta_pitch || ''}
                            onChange={(e) => scheduleOverrideSave({ cta_pitch: e.target.value })}
                            placeholder={def.ctaPitchPlaceholder}
                            className="text-sm min-h-[60px] resize-none"
                            maxLength={240}
                          />
                        </div>
                      )}
                      {def.showEventDate && (
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-muted-foreground">{def.eventDateLabel}</label>
                          <Input
                            type="datetime-local"
                            value={isoToInputValue(override.event_at)}
                            onChange={(e) => scheduleOverrideSave({ event_at: inputValueToIso(e.target.value) })}
                            className="text-sm"
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {def.showNotes && (
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">Additional context</label>
                      <Textarea
                        value={override.notes || ''}
                        onChange={(e) => scheduleOverrideSave({ notes: e.target.value })}
                        placeholder={def.notesPlaceholder}
                        className="text-sm min-h-[64px] resize-none"
                      />
                    </div>
                  )}
                </>
              )
            })()}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

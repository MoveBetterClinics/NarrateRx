import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Navigate } from 'react-router-dom'
import { Shield, Lock, Check, Minus } from 'lucide-react'
import { apiFetch } from '../lib/api.js'
import { useAppMutation } from '../lib/useAppMutation.js'
import { toast } from '../lib/toast'
import { useWorkspace } from '../lib/WorkspaceContext'
import { usePermission } from '../lib/usePermission.js'
import {
  CAPABILITY_GROUPS,
  OWNER_ONLY_CAPABILITIES,
  capabilityShortLabel,
  capabilityLabel,
} from '../lib/capabilities.js'

const TIER_PILL = {
  owner:     'bg-[#fff7f0] text-[#c04d18] ring-1 ring-[#fde0d2]',
  producer:  'bg-[#f5f3ff] text-[#7c3aed]',
  clinician: 'bg-[#e0f2fe] text-[#0284c7]',
  viewer:    'bg-[#f1f5f9] text-[#475569]',
}
const TIER_LABEL = { owner: '★ Owner', producer: 'Producer', clinician: 'Clinician', viewer: 'Viewer' }

const AVATAR_COLORS = ['#0b111e', '#058ac7', '#7c3aed', '#e26628', '#0284c7', '#059669', '#d97706']
function avatarFor(person, i) {
  const initials = (person.name || '?')
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('')
  return { initials: initials || '?', color: AVATAR_COLORS[i % AVATAR_COLORS.length] }
}

export default function AccessMatrix() {
  const ws = useWorkspace()
  const { has } = usePermission()
  const queryClient = useQueryClient()

  const { data, isLoading, error } = useQuery({
    queryKey: ['access-matrix'],
    queryFn: () => apiFetch('/api/workspace/access-matrix'),
    enabled: has('members.invite'),
  })

  // Local, editable overrides keyed by staff id: { [id]: { [cap]: bool } }
  const [localOverrides, setLocalOverrides] = useState({})
  const seededRef = useRef(false)

  const staff = useMemo(() => data?.staff || [], [data])

  useEffect(() => {
    if (seededRef.current || !staff.length) return
    const seed = {}
    for (const s of staff) seed[s.id] = { ...(s.capability_overrides || {}) }
    setLocalOverrides(seed)
    seededRef.current = true
  }, [staff])

  // Per-person dirty check vs the server's original overrides.
  const dirtyIds = useMemo(() => {
    const set = new Set()
    for (const s of staff) {
      const orig = JSON.stringify(s.capability_overrides || {})
      const local = JSON.stringify(localOverrides[s.id] || {})
      if (orig !== local) set.add(s.id)
    }
    return set
  }, [staff, localOverrides])

  const saveMutation = useAppMutation({
    mutationFn: async (ids) => {
      await Promise.all(
        ids.map((id) =>
          apiFetch('/api/staff/capabilities', {
            method: 'PATCH',
            body: { id, overrides: localOverrides[id] || {} },
          })
        )
      )
    },
    errorMessage: 'Could not save permissions',
    onSuccess: () => {
      toast.success('Permissions saved')
      seededRef.current = false // re-seed from the refetched server state
      queryClient.invalidateQueries({ queryKey: ['access-matrix'] })
    },
  })

  if (!has('members.invite')) return <Navigate to="/settings" replace />

  // ── cell state resolution ──────────────────────────────────────────────────
  function cellState(person, cap) {
    const isOwner = person.permission_tier === 'owner'
    const tierDefault = (person.tier_capabilities || []).includes(cap)
    const ovr = localOverrides[person.id]?.[cap]
    const hasOverride = ovr !== undefined
    const effective = hasOverride ? ovr : tierDefault
    const ownerOnly = OWNER_ONLY_CAPABILITIES.has(cap)
    const locked = isOwner || ownerOnly
    const clickable = !person.pending && !person.is_self && !isOwner && !ownerOnly
    return { effective, hasOverride, locked, clickable, isOwner, tierDefault }
  }

  function toggleCap(person, cap) {
    const { clickable, effective, tierDefault } = cellState(person, cap)
    if (!clickable) return
    setLocalOverrides((prev) => {
      const next = { ...prev }
      const personOvr = { ...(next[person.id] || {}) }
      const newState = !effective
      if (newState === tierDefault) delete personOvr[cap]
      else personOvr[cap] = newState
      next[person.id] = personOvr
      return next
    })
  }

  function resetPerson(id) {
    setLocalOverrides((prev) => ({ ...prev, [id]: {} }))
  }

  function resetAll() {
    setLocalOverrides((prev) => {
      const next = {}
      for (const id of Object.keys(prev)) next[id] = {}
      return next
    })
  }

  const wsName = ws?.display_name || ws?.name || 'Workspace'

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <p className="text-2xs text-muted-foreground/80">Settings &middot; {wsName} &middot; Access matrix</p>
        <h1 className="text-2xl font-bold tracking-tight mt-0.5 flex items-center">
          <span className="inline-block w-1 h-6 rounded-full shrink-0 mr-2.5" style={{ background: 'hsl(var(--primary))' }} aria-hidden="true" />
          Team access matrix
        </h1>
        <p className="text-muted-foreground text-sm mt-1.5 leading-relaxed max-w-2xl">
          One row per person, one column per capability. Click any cell to grant or revoke.
          An <span className="text-[#d97706] font-semibold">amber dot</span> marks a cell that differs from the tier default for that person &mdash;
          easy to spot custom access as the team grows.
        </p>
      </div>

      {/* Scale note */}
      <div className="rounded-xl border border-[#fde0d2] bg-[#faf0eb] px-4 py-3.5 flex items-start gap-3">
        <Shield className="h-4 w-4 text-[#c04d18] shrink-0 mt-0.5" />
        <p className="text-2xs text-[#7c3a18] leading-relaxed">
          <b>Built to grow.</b> At 3 people, tiers are enough. At 10, a blanket rule like all-clinicians-get-everything breaks down &mdash;
          one publishes, another does not, a new hire sits in between. This matrix shows the
          <em> actual</em> per-person state, so nobody has to guess who can do what.
        </p>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
        <Legend swatch="bg-[#ecfdf5] text-[#059669]" icon={<Check className="h-3 w-3" />} label="tier default on" />
        <Legend swatch="bg-[#faf0eb] text-[#c04d18] ring-1 ring-[#fde0d2]" icon={<Check className="h-3 w-3" />} label="custom grant" />
        <Legend swatch="bg-[#f8fafc] text-[#cbd5e1]" icon={<Minus className="h-3 w-3" />} label="off" />
        <Legend swatch="bg-white ring-1 ring-[#e2e8f0] text-[#94a3b8]" icon={<Lock className="h-2.5 w-2.5" />} label="owner-only" />
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#f59f0a] inline-block" /> custom override</span>
      </div>

      {isLoading && <div className="text-sm text-muted-foreground py-8 text-center">Loading team&hellip;</div>}
      {error && <div className="text-sm text-destructive py-8 text-center">Could not load the access matrix. Try refreshing.</div>}

      {/* Matrix */}
      {!isLoading && !error && (
        <div className="rounded-xl border border-border bg-card overflow-x-auto">
          <table className="border-collapse w-max min-w-full text-sm">
            <thead className="sticky top-0 z-10">
              {/* group row */}
              <tr>
                <th className="sticky left-0 z-20 bg-card border-b border-border" style={{ minWidth: 220 }} />
                {CAPABILITY_GROUPS.map((g) => (
                  <th
                    key={g.label}
                    colSpan={g.caps.length}
                    className="text-3xs font-bold uppercase tracking-wider text-muted-foreground text-center px-2 py-2.5 border-b-2 border-border border-l-2 border-l-border bg-card"
                  >
                    {g.label}
                  </th>
                ))}
              </tr>
              {/* capability header row */}
              <tr>
                <th className="sticky left-0 z-20 bg-card border-b-2 border-border border-r-2 border-r-border" style={{ minWidth: 220 }} />
                {CAPABILITY_GROUPS.map((g) =>
                  g.caps.map((cap, i) => (
                    <th
                      key={cap}
                      title={capabilityLabel(cap)}
                      className={`bg-card border-b-2 border-border align-bottom px-1 pb-2 ${i === 0 ? 'border-l-2 border-l-border' : 'border-r border-r-[#edf0f4]'}`}
                      style={{ height: 110 }}
                    >
                      <span
                        className="text-2xs font-semibold text-foreground inline-block whitespace-nowrap"
                        style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
                      >
                        {capabilityShortLabel(cap)}
                      </span>
                    </th>
                  ))
                )}
              </tr>
            </thead>
            <tbody>
              {staff.map((person, idx) => {
                const av = avatarFor(person, idx)
                return (
                  <tr key={person.id} className="group">
                    {/* person cell */}
                    <td className="sticky left-0 z-10 bg-card group-hover:bg-[#fafbfc] border-b border-border border-r-2 border-r-border px-4 py-2.5" style={{ minWidth: 220 }}>
                      <div className="flex items-center gap-2.5">
                        <span
                          className="inline-flex items-center justify-center rounded-full text-white font-bold shrink-0"
                          style={{ width: 32, height: 32, background: av.color, fontSize: 11, opacity: person.pending ? 0.5 : 1 }}
                        >
                          {av.initials}
                        </span>
                        <div className="min-w-0">
                          <div className="font-semibold text-xs leading-tight flex items-center gap-1.5 truncate">
                            <span className={person.pending ? 'opacity-60' : ''}>{person.name}</span>
                            {person.is_self && <span className="text-3xs text-muted-foreground">&middot; you</span>}
                            {person.pending && <span className="px-1.5 py-px rounded-full text-3xs font-bold bg-[#fff7ed] text-[#d97706]">invite pending</span>}
                          </div>
                          <div className="mt-1 flex items-center gap-1.5">
                            <span className={`px-2 py-px rounded-full text-3xs font-bold ${TIER_PILL[person.permission_tier] || TIER_PILL.viewer}`}>
                              {TIER_LABEL[person.permission_tier] || person.permission_tier}
                            </span>
                            {dirtyIds.has(person.id) && (
                              <button onClick={() => resetPerson(person.id)} className="text-3xs text-[#c04d18] hover:underline">reset</button>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* capability cells */}
                    {CAPABILITY_GROUPS.map((g) =>
                      g.caps.map((cap, i) => {
                        const st = cellState(person, cap)
                        return (
                          <td
                            key={cap}
                            className={`text-center border-b border-border group-hover:bg-[#fafbfc] ${i === 0 ? 'border-l-2 border-l-border' : 'border-r border-r-[#edf0f4]'}`}
                            style={{ height: 52 }}
                          >
                            <Cell person={person} st={st} onClick={() => toggleCap(person, cap)} />
                          </td>
                        )
                      })
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Save bar */}
      {!isLoading && !error && (
        <div className="sticky bottom-0 z-20 -mx-6 md:mx-0 px-4 py-3 flex items-center gap-3 border md:rounded-lg border-x-0 md:border-x border-border bg-background/95 backdrop-blur">
          {dirtyIds.size > 0 ? (
            <span className="text-xs text-[#d97706] font-semibold flex items-center gap-1.5">
              {dirtyIds.size} {dirtyIds.size === 1 ? 'person' : 'people'} changed
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">No unsaved changes.</span>
          )}
          <span className="flex-1 text-xs text-muted-foreground hidden md:inline">Changes take effect on the next session for that person.</span>
          <button onClick={resetAll} className="px-3.5 py-2 rounded-[10px] text-xs font-semibold border border-border bg-white text-foreground hover:bg-[#f8fafc]" disabled={saveMutation.isPending}>
            Reset all to defaults
          </button>
          <button
            onClick={() => saveMutation.mutate([...dirtyIds])}
            disabled={dirtyIds.size === 0 || saveMutation.isPending}
            className="px-4 py-2 rounded-[10px] text-xs font-semibold text-white disabled:opacity-50"
            style={{ background: 'hsl(var(--primary))' }}
          >
            {saveMutation.isPending ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      )}
    </div>
  )
}

function Legend({ swatch, icon, label }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`inline-flex items-center justify-center rounded-full ${swatch}`} style={{ width: 20, height: 20 }}>{icon}</span>
      {label}
    </span>
  )
}

function Cell({ person, st, onClick }) {
  if (person.pending) {
    return <span className="inline-flex items-center justify-center rounded-full bg-[#fafafa] text-[#d1d5db]" style={{ width: 30, height: 30 }} title="Not yet accepted invite"><Minus className="h-3.5 w-3.5" /></span>
  }
  if (st.locked) {
    return (
      <span
        className="inline-flex items-center justify-center rounded-full bg-white ring-1 ring-[#e2e8f0] text-[#94a3b8]"
        style={{ width: 30, height: 30 }}
        title={st.isOwner ? 'Owner always has access' : 'Owner-only — cannot be granted to other tiers'}
      >
        <Lock className="h-3 w-3" />
      </span>
    )
  }
  let cls
  if (st.hasOverride && st.effective) cls = 'bg-[#faf0eb] text-[#c04d18] ring-2 ring-[#fde0d2]'
  else if (st.effective) cls = 'bg-[#ecfdf5] text-[#059669]'
  else cls = 'bg-[#f8fafc] text-[#cbd5e1]'
  const icon = st.effective ? <Check className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />

  return (
    <button
      onClick={onClick}
      disabled={!st.clickable}
      className={`relative inline-flex items-center justify-center rounded-full transition ${cls} ${st.clickable ? 'hover:scale-110 cursor-pointer' : 'cursor-default'}`}
      style={{ width: 30, height: 30 }}
      title={
        person.is_self
          ? 'You cannot change your own access'
          : st.hasOverride
            ? (st.effective ? 'Custom grant (tier default: off)' : 'Custom revoke (tier default: on)')
            : (st.effective ? 'On — tier default' : 'Off — tier default')
      }
    >
      {icon}
      {st.hasOverride && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-[#f59f0a] ring-2 ring-white" />}
    </button>
  )
}

// Canonical content_item status tokens — single source of truth for
// content-piece status colours across the pipeline UI.
//
// label  — human-readable status name
// badge  — Tailwind classes for badge/pill backgrounds (bg + text)
// accent — Tailwind border class for lane containers / outlined cards
//
// Mirrors the shape of stageTokens.js (label/badge) and adds `accent`
// for the kanban lane borders. Keep the palette aligned with the
// existing PipelineKanban lanes so visual output stays identical.

// See also src/lib/contentMeta.js (STATUS_META — badge+icon variant used by ContentHub/Stories surfaces with the "Approved" label and an `archived` row).
export const CONTENT_STATUS_TOKENS = {
  draft:     { label: 'Draft',               badge: 'bg-slate-100 text-slate-700',    accent: 'border-slate-200'   },
  in_review: { label: 'Needs Review',        badge: 'bg-amber-100 text-amber-700',    accent: 'border-amber-200'   },
  approved:  { label: 'Ready to Distribute', badge: 'bg-amber-50 text-amber-700',     accent: 'border-amber-300'   },
  scheduled: { label: 'Scheduled',           badge: 'bg-purple-100 text-purple-700',  accent: 'border-purple-200'  },
  published: { label: 'Published',           badge: 'bg-emerald-100 text-emerald-700', accent: 'border-emerald-200' },
  failed:    { label: 'Failed',              badge: 'bg-red-100 text-red-700',         accent: 'border-red-200'     },
}

/** @param {string} status @returns {{ label: string, badge: string, accent: string }} */
export function getContentStatusToken(status) {
  return (
    CONTENT_STATUS_TOKENS[status] ?? {
      label: status,
      badge: 'bg-slate-100 text-slate-600',
      accent: 'border-slate-200',
    }
  )
}

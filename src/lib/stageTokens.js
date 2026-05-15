// Canonical stage tokens — single source of truth for story stage colours.
//
// badge — Tailwind classes for <Badge> (StoryDetail, StoryCard)
// dot   — Tailwind classes for dot indicators (StoriesThemesView)
// label — human-readable stage name

export const STAGE_TOKENS = {
  capture:   { label: 'Capture',    badge: 'bg-sky-100 text-sky-700',      dot: 'bg-sky-400'    },
  drafting:  { label: 'Drafting',   badge: 'bg-slate-100 text-slate-700',  dot: 'bg-slate-400'  },
  review:    { label: 'In Review',  badge: 'bg-amber-100 text-amber-700',  dot: 'bg-amber-400'  },
  scheduled: { label: 'Scheduled',  badge: 'bg-purple-100 text-purple-700', dot: 'bg-purple-400' },
  published: { label: 'Published',  badge: 'bg-green-100 text-green-700',  dot: 'bg-green-500'  },
}

/** @param {string} stage @returns {{ label: string, badge: string, dot: string }} */
export function getStageToken(stage) {
  return STAGE_TOKENS[stage] ?? { label: stage, badge: 'bg-slate-100 text-slate-600', dot: 'bg-slate-300' }
}

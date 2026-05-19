// Cleanup level — how aggressively the post-interview cleanup pass rewrites
// the raw Web Speech transcript. The level lives on the interview row and
// is selected per-interview (typically via a clinician recipe).
//
// All three options preserve role sequence and turn count — only the content
// strings change. The cleanup pass itself is implemented in
// api/interviews/cleanup-transcript.js; the levels map to different prompt
// instructions there.

export const CLEANUP_LEVELS = [
  {
    id: 'verbatim',
    label: 'My words',
    emoji: '✏️',
    description: 'Stay close to what you said — minimal cleanup, only obvious mis-transcriptions get fixed.',
  },
  {
    id: 'balanced',
    label: 'Light cleanup',
    emoji: '⚖️',
    description: 'Remove filler words and re-flow run-ons, keep the voice intact. (Does not affect blog or newsletter length — use the Length picker on the piece for that.)',
  },
  {
    id: 'polished',
    label: 'Polished',
    emoji: '💎',
    description: 'Tighten rambling, merge fragments — read like clean prose.',
  },
]

export const DEFAULT_CLEANUP_LEVEL = 'balanced'

export function getCleanupLevel(id) {
  return CLEANUP_LEVELS.find((l) => l.id === id) || CLEANUP_LEVELS.find((l) => l.id === DEFAULT_CLEANUP_LEVEL)
}

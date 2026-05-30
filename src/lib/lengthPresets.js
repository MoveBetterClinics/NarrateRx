// Length preset — controls target word count and voice-fidelity instructions
// for long-form generation (blog today; newsletter follow-up).
//
// Three presets, selectable per-piece. A clinician-level default
// (`clinicians.preferred_length`) is used when a piece has no explicit preset.
// 'standard' preserves the historical hardcoded behavior of each prompt
// (clinical blog: 700–950 words; general blog: 900–1200 words). 'tight' and
// 'expansive' override the prompt's length instruction with the values below.

export const LENGTH_PRESETS = [
  {
    id: 'tight',
    label: 'Tight',
    emoji: '✂️',
    description: 'Lean and quick — fewer expanded sections.',
    targetWords: '450–650',
    // When non-null, replaces the prompt's TARGET LENGTH line entirely.
    overrideLengthLine:
      'TARGET LENGTH: 450–650 words. Stay lean — pick the strongest material from the interview and skip sections that would only be filler. It is OK to merge two of the smaller sections into one if doing so produces a tighter piece. Do not pad to hit a length.',
  },
  {
    id: 'standard',
    label: 'Standard',
    emoji: '📄',
    description: 'Default length — every section developed.',
    targetWords: '700–950 (clinical) / 900–1200 (general)',
    overrideLengthLine: null, // keep the prompt's existing length line
  },
  {
    id: 'expansive',
    label: 'Expansive',
    emoji: '📖',
    description: 'Long-form and voice-faithful — leans on the clinician\'s actual phrasing.',
    targetWords: '1300–1800',
    overrideLengthLine: `TARGET LENGTH: 1300–1800 words. Develop every section in depth. Lean heavily on the clinician's actual phrasing from the interview — preserve direct quotes, rhythm, and idioms wherever they fit. When a section feels short, add depth from underused moments in the transcript (specific patient details, second examples, the "why" behind a claim) rather than padding with generic content. Voice fidelity matters more than polish here — if the clinician would say it a certain way, write it that way.`,
  },
]

export const DEFAULT_LENGTH_PRESET = 'standard'

export function getLengthPreset(id) {
  return (
    LENGTH_PRESETS.find((p) => p.id === id) ||
    LENGTH_PRESETS.find((p) => p.id === DEFAULT_LENGTH_PRESET)
  )
}

// Resolve the preset to apply for a piece, given per-piece override and
// clinician default. Returns the preset id (never null).
export function resolveLengthPreset(pieceLevel, staffDefault) {
  if (pieceLevel && LENGTH_PRESETS.some((p) => p.id === pieceLevel)) return pieceLevel
  if (staffDefault && LENGTH_PRESETS.some((p) => p.id === staffDefault)) return staffDefault
  return DEFAULT_LENGTH_PRESET
}

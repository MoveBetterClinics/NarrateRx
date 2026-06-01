import { Check } from 'lucide-react'

// The producer spine, made legible: Interview → Words → Media → Publish. Shown
// at the top of each stage page so the four steps read as one connected flow
// and the producer always knows where a piece is + what's left.
//
// Purely presentational: it reflects the current stage, it does NOT navigate.
// `current` is one of the stage ids below.
const STAGES = [
  ['interview', 'Interview'],
  ['words', 'Words'],
  ['media', 'Media'],
  ['publish', 'Publish'],
]

export default function PipelineStepper({ current, className = '' }) {
  const ci = STAGES.findIndex((s) => s[0] === current)

  return (
    <nav
      aria-label="Pipeline progress"
      className={`flex items-center gap-1 sm:gap-1.5 text-2xs font-medium overflow-x-auto pb-0.5 ${className}`}
    >
      {STAGES.map(([id, label], i) => {
        const done = i < ci
        const active = i === ci
        const pill = active
          ? 'bg-primary text-primary-foreground'
          : done
            ? 'bg-emerald-50 text-emerald-700'
            : 'bg-muted text-muted-foreground'
        const badge = active
          ? 'bg-white/25 text-primary-foreground'
          : done
            ? 'bg-emerald-200/60 text-emerald-700'
            : 'bg-muted-foreground/15 text-muted-foreground'

        return (
          <div key={id} className="flex shrink-0 items-center gap-1 sm:gap-1.5">
            <span
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 ${pill}`}
              aria-current={active ? 'step' : undefined}
            >
              <span className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-3xs ${badge}`}>
                {done ? <Check className="h-2.5 w-2.5" aria-hidden="true" /> : i + 1}
              </span>
              {label}
            </span>
            {i < STAGES.length - 1 && (
              <span
                className={`h-px w-3 sm:w-6 shrink-0 ${done ? 'bg-emerald-300' : 'bg-border'}`}
                aria-hidden="true"
              />
            )}
          </div>
        )
      })}
    </nav>
  )
}

import { useState } from 'react'
import { ShieldCheck, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react'

// Voice-fidelity audit surface (PR 3 — see
// .claude/design-interview-output-voice-fidelity.md, section 6).
//
// Renders the pass-2 audit result stored on a content_item:
//   piece.voice_fidelity_score (0-100) + piece.voice_audit
//     { score, summary, flags:[{type,severity,excerpt,issue,suggestion}],
//       sources, voice_mode, model, audited_at }
//
// v1 is flag-only: we surface the score + the drift flags as suggestions for
// human review. We do NOT auto-revert. Renders nothing until an audit lands so
// the fire-and-forget pass doesn't leave a visible "pending" stub.

const FLAG_LABELS = {
  vocabulary_swap:   'Vocabulary swap',
  imposed_structure: 'Imposed structure',
  smoothed_opinion:  'Smoothed opinion',
  fabricated_claim:  'Fabricated claim',
}

// Tier → semantic token. >=90 reads as the clinician; <50 has been translated
// out of their voice. Uses the shared semantic tokens (see CLAUDE.md brand-
// color checklist) rather than raw colors.
function scoreTier(score) {
  if (score >= 90) return { label: 'Faithful', text: 'text-success', bg: 'bg-success/10', border: 'border-success/30', Icon: ShieldCheck }
  if (score >= 70) return { label: 'Mostly faithful', text: 'text-info', bg: 'bg-info/10', border: 'border-info/30', Icon: ShieldCheck }
  if (score >= 50) return { label: 'Worth a look', text: 'text-warning', bg: 'bg-warning/10', border: 'border-warning/30', Icon: AlertTriangle }
  return { label: 'Doesn\'t sound like you', text: 'text-destructive', bg: 'bg-destructive/10', border: 'border-destructive/30', Icon: AlertTriangle }
}

const SEVERITY_DOT = {
  high:   'bg-destructive',
  medium: 'bg-warning',
  low:    'bg-muted-foreground',
}

export default function VoiceFidelityBadge({ piece }) {
  const [open, setOpen] = useState(false)
  const audit = piece?.voice_audit
  const score = piece?.voice_fidelity_score

  // Not audited yet — stay invisible (the fire-and-forget pass lands on next fetch).
  if (!audit) return null

  // A pass ran but failed / had nothing to compare against.
  if (audit.error) {
    return (
      <div className="text-2xs text-muted-foreground italic">
        Voice fidelity check unavailable for this draft.
      </div>
    )
  }

  const tier = scoreTier(typeof score === 'number' ? score : (audit.score ?? 0))
  const flags = Array.isArray(audit.flags) ? audit.flags : []
  const { Icon } = tier

  return (
    <div className={`rounded-md border ${tier.border} ${tier.bg}`}>
      <button
        type="button"
        onClick={() => flags.length && setOpen((v) => !v)}
        className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left ${flags.length ? 'cursor-pointer' : 'cursor-default'}`}
      >
        <Icon className={`h-3.5 w-3.5 shrink-0 ${tier.text}`} />
        <span className={`text-xs font-medium ${tier.text}`}>
          Voice fidelity {typeof score === 'number' ? score : audit.score}/100 · {tier.label}
        </span>
        {flags.length > 0 && (
          <span className="text-2xs text-muted-foreground">
            {flags.length} {flags.length === 1 ? 'thing to check' : 'things to check'}
          </span>
        )}
        {flags.length > 0 && (
          open
            ? <ChevronDown className="h-3.5 w-3.5 ml-auto text-muted-foreground" />
            : <ChevronRight className="h-3.5 w-3.5 ml-auto text-muted-foreground" />
        )}
      </button>

      {audit.summary && (
        <p className="px-2.5 pb-1.5 -mt-0.5 text-2xs text-muted-foreground leading-snug">
          {audit.summary}
        </p>
      )}

      {open && flags.length > 0 && (
        <ul className="border-t border-border/50 divide-y divide-border/40">
          {flags.map((f, i) => (
            <li key={i} className="px-2.5 py-2 space-y-1">
              <div className="flex items-center gap-1.5">
                <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${SEVERITY_DOT[f.severity] || 'bg-muted-foreground'}`} />
                <span className="text-2xs font-medium text-foreground">
                  {FLAG_LABELS[f.type] || f.type}
                </span>
              </div>
              {f.excerpt && (
                <p className="text-2xs text-foreground/70 italic border-l-2 border-border pl-2">
                  “{f.excerpt}”
                </p>
              )}
              {f.issue && <p className="text-2xs text-muted-foreground">{f.issue}</p>}
              {f.suggestion && (
                <p className="text-2xs text-foreground/80">
                  <span className="font-medium">Suggestion:</span> {f.suggestion}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

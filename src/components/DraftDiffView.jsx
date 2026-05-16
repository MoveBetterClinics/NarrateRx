import { useMemo, useState } from 'react'
import { diffWordsWithSpace } from 'diff'
import { Check, X, Sparkles, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'

// Reusable diff modal. Compares a previous body against a proposed new body
// (typically an AI redraft) and lets the editor accept or reject each change
// individually before applying. Default state is "nothing accepted" — the
// editor has to actively keep changes, so AI never edits silently.
//
// A change is a contiguous block of model-removed + model-added words. The
// rejected change keeps the previous text; the accepted change keeps the
// new text. "Apply selected" builds the merged body by walking the diff and
// emitting either the old or new segment per change based on the toggle.
//
// Token-level diff via `diff.diffWordsWithSpace` — granular enough that the
// editor can keep a noun change while rejecting a phrase rewrite around it.

export default function DraftDiffView({
  open,
  previous,
  proposed,
  onCancel,
  onApply,
  title = 'Review redraft',
  description = 'Each change is rejected by default. Accept the ones you want, then apply selected.',
}) {
  // Build a stable list of changes (each = one delete+insert pair, or a
  // lone delete, or a lone insert) plus the un-changed segments around
  // them. Re-derived only when the inputs change.
  const { segments, changes } = useMemo(() => buildChangeList(previous, proposed), [previous, proposed])

  const [accepted, setAccepted] = useState(() => new Set())

  function toggle(id) {
    setAccepted((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function acceptAll() {
    setAccepted(new Set(changes.map((c) => c.id)))
  }
  function rejectAll() {
    setAccepted(new Set())
  }

  function handleApply() {
    let body = ''
    for (const seg of segments) {
      if (seg.kind === 'unchanged') {
        body += seg.text
      } else if (seg.kind === 'change') {
        body += accepted.has(seg.id) ? seg.newText : seg.oldText
      }
    }
    onApply(body)
  }

  const acceptedCount = accepted.size
  const totalChanges = changes.length

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onCancel() }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <Sparkles className="h-4 w-4 text-primary shrink-0" />
            {title}
            <Badge className="ml-auto text-xs font-normal bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-50">
              All AI changes off by default
            </Badge>
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-3">
            <Badge variant="secondary" className="font-normal">
              {totalChanges === 0 ? 'No differences' : `${totalChanges} change${totalChanges === 1 ? '' : 's'}`}
            </Badge>
            {totalChanges > 0 && (
              <span>{acceptedCount} of {totalChanges} accepted</span>
            )}
          </div>
          {totalChanges > 0 && (
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" onClick={acceptAll} className="h-7 text-xs">
                Accept all
              </Button>
              <Button variant="ghost" size="sm" onClick={rejectAll} className="h-7 text-xs">
                Reject all
              </Button>
            </div>
          )}
        </div>

        <ScrollArea className="max-h-[55vh] rounded-md border bg-background p-4">
          <div className="text-sm leading-relaxed whitespace-pre-wrap font-serif">
            {segments.map((seg, i) => {
              if (seg.kind === 'unchanged') {
                return <span key={i}>{seg.text}</span>
              }
              const isAccepted = accepted.has(seg.id)
              return (
                <ChangeChip
                  key={i}
                  segment={seg}
                  accepted={isAccepted}
                  onToggle={() => toggle(seg.id)}
                />
              )
            })}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={handleApply}>
            Apply {acceptedCount > 0 ? `${acceptedCount} change${acceptedCount === 1 ? '' : 's'}` : 'selected'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ChangeChip({ segment, accepted, onToggle }) {
  const { oldText, newText } = segment
  // Render style depends on what kind of change it is:
  // - pure deletion: oldText present, newText empty → show strikethrough old
  // - pure insertion: oldText empty, newText present → show inserted new
  // - replacement: both present → show old → new
  const isInsertion = !oldText && newText
  const isDeletion = oldText && !newText
  const isReplacement = oldText && newText

  return (
    <button
      type="button"
      onClick={onToggle}
      className={`inline align-baseline cursor-pointer rounded px-1 -mx-0.5 transition-colors border ${
        accepted
          ? 'bg-emerald-50 border-emerald-200 hover:bg-emerald-100'
          : 'bg-rose-50/60 border-rose-200/70 hover:bg-rose-100/60'
      }`}
      title={accepted ? 'Accepted — click to reject' : 'Rejected — click to accept'}
    >
      {isReplacement && (
        <span>
          <span className={accepted ? 'line-through text-muted-foreground/60' : 'text-foreground'}>{oldText}</span>
          <ArrowRight className="inline h-3 w-3 mx-1 align-baseline text-muted-foreground" />
          <span className={accepted ? 'text-emerald-800 font-medium' : 'text-muted-foreground/60 line-through'}>{newText}</span>
        </span>
      )}
      {isDeletion && (
        <span className={accepted ? 'line-through text-rose-700' : 'text-foreground'}>{oldText}</span>
      )}
      {isInsertion && (
        <span className={accepted ? 'text-emerald-800 font-medium' : 'text-muted-foreground/60 line-through'}>{newText}</span>
      )}
      <span className="inline-flex items-center justify-center align-middle ml-0.5 w-3.5 h-3.5 rounded-full bg-white border text-[10px]">
        {accepted ? <Check className="h-2.5 w-2.5 text-emerald-700" /> : <X className="h-2.5 w-2.5 text-rose-500" />}
      </span>
    </button>
  )
}

// Walk the word-level diff and collapse adjacent remove/add into a single
// "change" segment. Equal segments pass through as "unchanged". The
// returned `changes` array is the set of toggleable units; `segments` is
// the ordered render list that mixes both kinds.
function buildChangeList(previous, proposed) {
  const prev = previous ?? ''
  const next = proposed ?? ''
  const parts = diffWordsWithSpace(prev, next)
  const segments = []
  const changes = []
  let i = 0
  let id = 0
  while (i < parts.length) {
    const p = parts[i]
    if (!p.added && !p.removed) {
      segments.push({ kind: 'unchanged', text: p.value })
      i += 1
      continue
    }
    // Pair a removed with the immediately following added (or vice versa)
    // into a single change so the chip reads as "old → new".
    let oldText = ''
    let newText = ''
    if (p.removed) {
      oldText += p.value
      i += 1
      if (i < parts.length && parts[i].added) {
        newText += parts[i].value
        i += 1
      }
    } else if (p.added) {
      newText += p.value
      i += 1
    }
    const change = {
      kind: 'change',
      id: `c${id++}`,
      oldText,
      newText,
    }
    segments.push(change)
    changes.push(change)
  }
  return { segments, changes }
}

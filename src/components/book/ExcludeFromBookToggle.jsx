// Admin-only toggle for marking a source (interview, voice memo, or corpus
// document) as excluded from the workspace book's next regeneration.
//
// Two visual variants:
//   - 'header' → labelled pill + optional "Regenerate now" affordance.
//                Used on the StoryDetail page header.
//   - 'inline' → compact icon button. Used in the AuthorMode drafts list.
//
// Both share the same react-query cache via useBookExclusion so toggling on
// one surface is visible on the other after invalidate.

import { useState } from 'react'
import { BookMinus, BookPlus, Loader2, RefreshCw } from 'lucide-react'
import { useUserRole } from '@/lib/useUserRole'
import { useBookExclusion, regenerateBook } from '@/lib/bookExclusions'
import { useAppMutation } from '@/lib/useAppMutation'
import { toast } from '@/lib/toast'

const VALID_TABLES = new Set(['interviews', 'clinician_corpus_documents'])

export default function ExcludeFromBookToggle({
  sourceTable,
  sourceId,
  variant = 'header',
}) {
  const { role, isLoading: roleLoading } = useUserRole()
  const isAdmin = role === 'admin'

  // Skip the network call for non-admins so we don't expose the endpoint.
  const { isExcluded, isLoading, setExcluded } = useBookExclusion({
    sourceTable,
    sourceId,
    enabled: isAdmin && !!sourceId && VALID_TABLES.has(sourceTable),
  })

  const regen = useAppMutation({
    mutationFn: regenerateBook,
    onSuccess: () => toast.success('Regenerating book — check the Book page in a minute or two.'),
    errorMessage: 'Could not start book regeneration',
  })

  if (roleLoading || !isAdmin) return null
  if (!sourceId || !VALID_TABLES.has(sourceTable)) return null

  if (variant === 'inline') {
    return (
      <InlineVariant
        isExcluded={isExcluded}
        isLoading={isLoading}
        pending={setExcluded.isPending}
        onToggle={() => setExcluded.mutate(!isExcluded)}
      />
    )
  }

  return (
    <HeaderVariant
      isExcluded={isExcluded}
      isLoading={isLoading}
      pending={setExcluded.isPending}
      regenPending={regen.isPending}
      onToggle={() => setExcluded.mutate(!isExcluded)}
      onRegen={() => regen.mutate()}
    />
  )
}

function HeaderVariant({ isExcluded, isLoading, pending, regenPending, onToggle, onRegen }) {
  const [hover, setHover] = useState(false)

  if (isLoading) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      </span>
    )
  }

  return (
    <div className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={onToggle}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        disabled={pending}
        title={
          isExcluded
            ? "Currently excluded from the workspace book. Click to include again."
            : "Exclude from the workspace book's next regeneration."
        }
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors disabled:opacity-50 ${
          isExcluded
            ? 'border-amber-300/60 bg-amber-50 text-amber-900 hover:bg-amber-100'
            : 'border-border bg-card text-muted-foreground hover:bg-muted/60 hover:text-foreground'
        }`}
      >
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : isExcluded ? (
          <BookMinus className="h-3.5 w-3.5" />
        ) : (
          <BookPlus className="h-3.5 w-3.5" />
        )}
        <span>
          {isExcluded
            ? (hover ? 'Include in book' : 'Excluded from book')
            : 'Exclude from book'}
        </span>
      </button>

      {isExcluded && (
        <button
          type="button"
          onClick={onRegen}
          disabled={regenPending}
          title="Trigger a full book regeneration now so the change takes effect immediately."
          className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 disabled:opacity-50"
        >
          {regenPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          <span>Regenerate now</span>
        </button>
      )}
    </div>
  )
}

function InlineVariant({ isExcluded, isLoading, pending, onToggle }) {
  if (isLoading) return null

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      disabled={pending}
      title={
        isExcluded
          ? "Excluded from book — click to include again"
          : "Exclude from book — won't be woven into the next regeneration"
      }
      aria-label={isExcluded ? 'Include in book' : 'Exclude from book'}
      className={`shrink-0 inline-flex items-center justify-center h-6 w-6 rounded-md transition-colors disabled:opacity-50 ${
        isExcluded
          ? 'text-amber-700 hover:bg-amber-100'
          : 'text-muted-foreground opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-muted/60 hover:text-foreground'
      }`}
    >
      {pending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : isExcluded ? (
        <BookMinus className="h-3.5 w-3.5" />
      ) : (
        <BookPlus className="h-3.5 w-3.5" />
      )}
    </button>
  )
}

// Book — read-mostly view of the workspace's auto-synthesized manuscript.
//
// In group workspaces (book_mode='group') this is the headline writing
// surface; /write is hidden from the nav for the same workspaces. In
// personal workspaces (book_mode='personal') /write stays as the
// single-author typing environment and /book is the rolled-up read.
//
// Lifecycle:
//   - Initial load: GET /api/book → {manuscript_md, chapters, source_counts,
//     last_regen_at, stale_at, regen_status, regen_error, book_mode}
//   - Admin clicks "Regenerate now" → POST /api/book/regenerate (PR 2).
//   - While regen_status='regenerating', the page polls every 4s until the
//     server flips back to 'idle' or 'error' (60s hard cap so a silent
//     failure can't poll forever).

import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import { BookOpen, RefreshCw, AlertTriangle, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAppMutation } from '@/lib/useAppMutation'
import { apiFetch } from '@/lib/api'
import { useUserRole } from '@/lib/useUserRole'
import { toast } from '@/lib/toast'

// ── API helpers ──────────────────────────────────────────────────────────

function fetchBook() {
  return apiFetch('/api/book')
}

function regenerateBook() {
  return apiFetch('/api/book/regenerate', { method: 'POST' })
}

// ── Provenance line ──────────────────────────────────────────────────────

function ProvenanceLine({ book }) {
  if (!book) return null
  const c = book.source_counts || {}
  const parts = []
  if (c.interviews)      parts.push(`${c.interviews} interview${c.interviews === 1 ? '' : 's'}`)
  if (c.voice_memos)     parts.push(`${c.voice_memos} voice memo${c.voice_memos === 1 ? '' : 's'}`)
  if (c.original_blogs)  parts.push(`${c.original_blogs} original article${c.original_blogs === 1 ? '' : 's'}`)
  if (c.uploaded_drafts) parts.push(`${c.uploaded_drafts} draft${c.uploaded_drafts === 1 ? '' : 's'}`)

  const lastRegen = book.last_regen_at
    ? new Date(book.last_regen_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : null

  if (!lastRegen && parts.length === 0) return null

  const ago = lastRegen ? `Last updated ${lastRegen}` : 'Never regenerated'
  const woven = parts.length ? ` · ${parts.join(' · ')} woven in` : ''
  return (
    <p className="text-xs text-muted-foreground">
      {ago}{woven}
    </p>
  )
}

// ── Empty / status states ────────────────────────────────────────────────

function EmptyState({ isAdmin, onRegenerate, isRegenerating }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card px-8 py-16 flex flex-col items-center gap-4 text-center">
      <Sparkles className="h-8 w-8 text-muted-foreground" />
      <div className="max-w-md flex flex-col gap-2">
        <h2 className="text-lg font-semibold text-foreground">Your book hasn&rsquo;t been written yet</h2>
        <p className="text-sm text-muted-foreground">
          The book is woven from your practice&rsquo;s interviews, voice memos, and original articles — written
          as one collective voice. {isAdmin
            ? 'Click below to generate the first version.'
            : 'A workspace admin can generate the first version from this page.'}
        </p>
      </div>
      {isAdmin && (
        <Button onClick={onRegenerate} disabled={isRegenerating}>
          {isRegenerating ? 'Weaving…' : 'Generate the book'}
        </Button>
      )}
    </div>
  )
}

function RegeneratingState() {
  return (
    <div className="rounded-lg border border-border bg-card px-8 py-16 flex flex-col items-center gap-3 text-center">
      <RefreshCw className="h-7 w-7 text-primary animate-spin" />
      <div className="max-w-md flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-foreground">Weaving your book…</h2>
        <p className="text-sm text-muted-foreground">
          This usually takes a minute or two. You can leave this page open or come back later — the
          manuscript will be here when it&rsquo;s ready.
        </p>
      </div>
    </div>
  )
}

function ErrorState({ error, isAdmin, onRegenerate, isRegenerating }) {
  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-8 py-12 flex flex-col items-center gap-3 text-center">
      <AlertTriangle className="h-7 w-7 text-destructive" />
      <div className="max-w-md flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-foreground">Last regeneration failed</h2>
        <p className="text-sm text-muted-foreground break-words">
          {error || 'Unknown error.'}
        </p>
      </div>
      {isAdmin && (
        <Button onClick={onRegenerate} disabled={isRegenerating} variant="outline">
          {isRegenerating ? 'Trying again…' : 'Try again'}
        </Button>
      )}
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 4000
const POLL_CAP_MS      = 5 * 60 * 1000

export default function Book() {
  const { role } = useUserRole()
  const isAdmin = role === 'admin'

  // Track when polling began so we can cap it. Reset whenever a fresh
  // regen kicks off.
  const pollStartRef = useRef({ at: 0 })

  const {
    data: book,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['book'],
    queryFn:  fetchBook,
    refetchInterval: (q) => {
      const d = q.state.data
      if (d?.regen_status !== 'regenerating') return false
      if (!pollStartRef.current.at) pollStartRef.current.at = Date.now()
      if (Date.now() - pollStartRef.current.at > POLL_CAP_MS) return false
      return POLL_INTERVAL_MS
    },
    refetchOnWindowFocus: false,
  })

  // Reset poll cap on status transitions away from regenerating.
  useEffect(() => {
    if (book?.regen_status !== 'regenerating') {
      pollStartRef.current = { at: 0 }
    }
  }, [book?.regen_status])

  const regenMutation = useAppMutation({
    mutationFn: regenerateBook,
    onSuccess:  () => {
      toast.success('Book regenerated')
      refetch()
    },
    onError: (e) => {
      const msg = e?.body?.error || e?.message || 'Regeneration failed'
      toast.error(msg)
      refetch()
    },
  })

  const onRegenerate = () => {
    pollStartRef.current = { at: Date.now() }
    regenMutation.mutate()
  }

  const isRegenerating = book?.regen_status === 'regenerating' || regenMutation.isPending
  const hasManuscript  = !!(book?.manuscript_md && book.manuscript_md.trim())
  const showError      = book?.regen_status === 'error' && !hasManuscript
  const showEmpty      = !isLoading && !hasManuscript && !isRegenerating && !showError
  const staleBadge     = !!book?.stale_at && hasManuscript

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <BookOpen className="h-5 w-5 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-foreground">Book</h1>
            <p className="text-sm text-muted-foreground">
              {book?.book_mode === 'group'
                ? 'A living manuscript woven from your practice’s interviews and original work.'
                : 'A living manuscript woven from your interviews and original work.'}
            </p>
          </div>
        </div>

        {isAdmin && hasManuscript && (
          <div className="flex items-center gap-2 shrink-0">
            {staleBadge && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
                New material since last regen
              </span>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={onRegenerate}
              disabled={isRegenerating}
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isRegenerating ? 'animate-spin' : ''}`} />
              {isRegenerating ? 'Weaving…' : 'Regenerate'}
            </Button>
          </div>
        )}
      </div>

      <ProvenanceLine book={book} />

      {/* Body */}
      {isLoading ? (
        <div className="rounded-lg border border-border bg-card px-8 py-16 flex items-center justify-center">
          <RefreshCw className="h-5 w-5 text-muted-foreground animate-spin" />
        </div>
      ) : isRegenerating && !hasManuscript ? (
        <RegeneratingState />
      ) : showError ? (
        <ErrorState
          error={book?.regen_error}
          isAdmin={isAdmin}
          onRegenerate={onRegenerate}
          isRegenerating={isRegenerating}
        />
      ) : showEmpty ? (
        <EmptyState
          isAdmin={isAdmin}
          onRegenerate={onRegenerate}
          isRegenerating={isRegenerating}
        />
      ) : (
        <article
          className="rounded-lg border border-border bg-card px-8 sm:px-12 py-10 prose max-w-none
            prose-headings:font-bold prose-headings:tracking-tight prose-headings:text-slate-900
            prose-h2:text-2xl prose-h2:mt-10 prose-h2:mb-4 first:prose-h2:mt-0
            prose-h3:text-lg prose-h3:mt-6 prose-h3:mb-2
            prose-p:leading-relaxed prose-p:text-slate-700
            prose-blockquote:border-l-primary prose-blockquote:text-slate-700 prose-blockquote:italic
            prose-strong:text-slate-900
            prose-li:text-slate-700"
        >
          <ReactMarkdown>{book?.manuscript_md || ''}</ReactMarkdown>
        </article>
      )}
    </div>
  )
}

// Author Mode — two-panel writing environment.
//
// Left panel (65%): titled textarea editor with word count and Save Draft.
// Right panel (35%): "From your interviews" semantic sidebar that debounces
//   the editor content (800ms) and fires POST /api/corpus/search, returning
//   3–5 chunks from the clinician's interview transcripts and approved content.
//
// Drafts list sits above the editor — click to load any existing draft.
// Insert button appends a blockquote to the textarea value.
import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BookOpen, FileText, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAppMutation } from '@/lib/useAppMutation'
import { apiFetch } from '@/lib/api'
import { toast } from '@/lib/toast'
import ExcludeFromBookToggle from '@/components/book/ExcludeFromBookToggle'

// ── API helpers ────────────────────────────────────────────────────────────

function fetchDrafts() {
  return apiFetch('/api/corpus/documents?docType=uploaded_draft')
}

function fetchOriginalBlogs() {
  return apiFetch('/api/corpus/documents?docType=original_blog')
}

function searchCorpus(query) {
  return apiFetch('/api/corpus/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, topK: 5 }),
  })
}

function saveDraft({ title, body }) {
  return apiFetch('/api/corpus/ingest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ docType: 'uploaded_draft', title, body }),
  })
}

// ── Word count ────────────────────────────────────────────────────────────

function wordCount(text) {
  return text.trim() ? text.trim().split(/\s+/).length : 0
}

// ── Sidebar chunk card ────────────────────────────────────────────────────

function ChunkCard({ chunk, onInsert }) {
  const excerpt = chunk.text.length > 150
    ? `${chunk.text.slice(0, 150).trimEnd()}…`
    : chunk.text

  return (
    <div className="rounded-lg border border-border bg-card p-3 flex flex-col gap-1.5 text-sm">
      <p className="text-xs font-medium text-muted-foreground truncate" title={chunk.source_label}>
        {chunk.source_label || 'Your corpus'}
      </p>
      <p className="text-foreground leading-snug">{excerpt}</p>
      <button
        type="button"
        onClick={() => onInsert(chunk)}
        className="self-start mt-0.5 inline-flex items-center gap-1 text-xs text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded"
      >
        ↗ Insert
      </button>
    </div>
  )
}

// ── Skeleton shimmer ──────────────────────────────────────────────────────

function ChunkSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-card p-3 animate-pulse">
      <div className="h-3 w-2/3 bg-muted rounded mb-2" />
      <div className="h-3 w-full bg-muted rounded mb-1" />
      <div className="h-3 w-4/5 bg-muted rounded" />
    </div>
  )
}

// ── Draft list item ───────────────────────────────────────────────────────

function DraftItem({ draft, isActive, onLoad }) {
  const date = draft.updated_at
    ? new Date(draft.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : ''
  return (
    <div
      className={`group flex items-center gap-1 pr-1 rounded-md transition-colors ${
        isActive
          ? 'bg-primary/10 text-foreground'
          : 'text-muted-foreground hover:bg-accent/30 hover:text-foreground'
      }`}
    >
      <button
        type="button"
        onClick={() => onLoad(draft)}
        className={`flex-1 min-w-0 text-left px-3 py-2 text-sm ${isActive ? 'font-medium' : ''}`}
      >
        <span className="block truncate">{draft.title || 'Untitled'}</span>
        {date && <span className="block text-xs text-muted-foreground">{date}</span>}
      </button>
      <ExcludeFromBookToggle
        sourceTable="staff_corpus_documents"
        sourceId={draft.id}
        variant="inline"
      />
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────

export default function AuthorMode() {
  const [title, setTitle]               = useState('')
  const [body, setBody]                 = useState('')
  const [activeDraftId, setActiveDraftId] = useState(null)
  const [searchResults, setSearchResults] = useState([])
  const [isSearching, setIsSearching]   = useState(false)
  const debounceRef = useRef(null)

  // Fetch existing drafts.
  const {
    data: drafts = [],
    isLoading: draftsLoading,
    refetch: refetchDrafts,
  } = useQuery({
    queryKey: ['corpus-drafts'],
    queryFn: fetchDrafts,
  })

  // Fetch original blog imports — read-mostly here. Loading one into the
  // editor uses it as a starting point; saving creates a NEW uploaded_draft
  // (the original_blog row stays untouched). The reason this list exists in
  // this surface at all is the per-row admin "Exclude from book" toggle —
  // there's no other UI today that lists staff_corpus_documents.
  const {
    data: originalBlogs = [],
    isLoading: originalBlogsLoading,
  } = useQuery({
    queryKey: ['corpus-original-blogs'],
    queryFn: fetchOriginalBlogs,
  })

  // Save mutation.
  const saveMutation = useAppMutation({
    mutationFn: saveDraft,
    onSuccess: (saved) => {
      setActiveDraftId(saved.id)
      refetchDrafts()
      toast.success('Draft saved')
    },
  })

  // Debounced semantic search whenever body changes.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const trimmed = body.trim()
    if (!trimmed || trimmed.length < 20) {
      setSearchResults([])
      return
    }
    debounceRef.current = setTimeout(async () => {
      setIsSearching(true)
      try {
        const results = await searchCorpus(trimmed.slice(0, 1500))
        setSearchResults(Array.isArray(results) ? results : [])
      } catch {
        // Swallow search errors — sidebar is non-blocking.
        setSearchResults([])
      } finally {
        setIsSearching(false)
      }
    }, 800)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [body])

  const handleLoad = useCallback((draft) => {
    setActiveDraftId(draft.id)
    setTitle(draft.title || '')
    setBody(draft.body || '')
    setSearchResults([])
  }, [])

  const handleNew = useCallback(() => {
    setActiveDraftId(null)
    setTitle('')
    setBody('')
    setSearchResults([])
  }, [])

  const handleSave = useCallback(() => {
    if (!title.trim()) {
      toast.error('Add a title before saving')
      return
    }
    saveMutation.mutate({ title: title.trim(), body })
  }, [title, body, saveMutation])

  const handleInsert = useCallback((chunk) => {
    const blockquote = `\n\n> ${chunk.text}\n— ${chunk.source_label || 'Your corpus'}`
    setBody((prev) => prev + blockquote)
  }, [])

  const words = wordCount(body)

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <BookOpen className="h-5 w-5 text-muted-foreground shrink-0" />
        <div>
          <h1 className="text-xl font-semibold text-foreground">Write</h1>
          <p className="text-sm text-muted-foreground">
            Your past words surface as you write — drawn from interviews and approved content.
          </p>
        </div>
      </div>

      {/* Main two-panel layout */}
      <div className="flex gap-6 items-start">

        {/* ── Left: editor (65%) ── */}
        <div className="flex-[65] min-w-0 flex flex-col gap-4">

          {/* Drafts list */}
          {draftsLoading ? (
            <div className="h-8 w-48 bg-muted rounded animate-pulse" />
          ) : drafts.length > 0 ? (
            <div className="rounded-lg border border-border bg-card p-2">
              <div className="flex items-center justify-between px-1 mb-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Your drafts
                </p>
                <button
                  type="button"
                  onClick={handleNew}
                  className="text-xs text-primary hover:underline focus:outline-none"
                >
                  + New
                </button>
              </div>
              <div className="max-h-40 overflow-y-auto space-y-0.5">
                {drafts.map((d) => (
                  <DraftItem
                    key={d.id}
                    draft={d}
                    isActive={d.id === activeDraftId}
                    onLoad={handleLoad}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {/* Original blog imports — separate section so admins can manage
              what's woven into the book without confusing them with drafts. */}
          {!originalBlogsLoading && originalBlogs.length > 0 && (
            <div className="rounded-lg border border-border bg-card p-2">
              <div className="flex items-center justify-between px-1 mb-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Original articles
                </p>
              </div>
              <div className="max-h-40 overflow-y-auto space-y-0.5">
                {originalBlogs.map((d) => (
                  <DraftItem
                    key={d.id}
                    draft={d}
                    isActive={d.id === activeDraftId}
                    onLoad={handleLoad}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Editor card */}
          <div className="rounded-lg border border-border bg-card p-4 flex flex-col gap-3">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title"
              className="text-xl font-semibold bg-transparent border-none outline-none placeholder:text-muted-foreground/50 w-full"
            />
            <div className="border-t border-border" />
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Start writing…"
              rows={22}
              className="w-full resize-none bg-transparent border-none outline-none text-base leading-relaxed placeholder:text-muted-foreground/40 font-serif"
            />
            <div className="flex items-center justify-between pt-2 border-t border-border">
              <span className="text-xs text-muted-foreground">
                {words.toLocaleString()} {words === 1 ? 'word' : 'words'}
              </span>
              <div className="flex items-center gap-2">
                {activeDraftId && (
                  <button
                    type="button"
                    onClick={handleNew}
                    title="New draft"
                    className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/30 transition-colors"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </button>
                )}
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={saveMutation.isPending}
                >
                  {saveMutation.isPending ? 'Saving…' : 'Save Draft'}
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* ── Right: semantic sidebar (35%) ── */}
        <div className="flex-[35] min-w-0 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
            <h2 className="text-sm font-medium text-foreground">From your interviews</h2>
          </div>

          {isSearching ? (
            <div className="flex flex-col gap-2">
              <ChunkSkeleton />
              <ChunkSkeleton />
              <ChunkSkeleton />
            </div>
          ) : searchResults.length > 0 ? (
            <div className="flex flex-col gap-2">
              {searchResults.map((chunk) => (
                <ChunkCard
                  key={`${chunk.source_type}-${chunk.source_id}-${chunk.chunk_index ?? 0}`}
                  chunk={chunk}
                  onInsert={handleInsert}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic leading-relaxed">
              {body.trim().length >= 20
                ? 'No matching passages found in your corpus yet.'
                : 'Start writing — your interviews will surface here.'}
            </p>
          )}
        </div>

      </div>
    </div>
  )
}

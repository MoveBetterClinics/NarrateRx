import { useEffect, useState, useCallback } from 'react'
import { Sparkles, Loader2, ChevronDown, ChevronRight, Filter } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { listContentPieces } from '@/lib/contentLib'
import ContentBriefDetail from './ContentBriefDetail'

const STATUS_FILTERS = [
  { id: 'open',        label: 'Active' },        // synthetic — not-rejected, not-archived
  { id: 'suggested',   label: 'Suggested' },
  { id: 'accepted',    label: 'Accepted' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'returned',    label: 'Returned' },
  { id: 'rejected',    label: 'Rejected' },
  { id: 'archived',    label: 'Archived' },
  { id: '',            label: 'All' },
]

// Edit-brief queue. Lists content_pieces with filters; click into a brief to
// review, edit, accept/reject, or upload the finished file. Default expanded
// when there are pending briefs; otherwise collapsed.
export default function ContentBriefList({ refreshKey, expandedDefault = true }) {
  const [filter, setFilter]     = useState('open')
  const [briefs, setBriefs]     = useState([])
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [selected, setSelected] = useState(null)
  const [expanded, setExpanded] = useState(expandedDefault)

  const refresh = useCallback(async () => {
    setLoading(true); setError('')
    try {
      // 'open' is synthetic — fetch all then filter client-side; lets us keep
      // the API surface tiny and filters fast.
      const rows = await listContentPieces({ limit: 200 })
      setBriefs(rows)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh, refreshKey])

  const visible = briefs.filter((b) => {
    if (filter === '') return true
    if (filter === 'open') return !['rejected', 'archived', 'published'].includes(b.status)
    return b.status === filter
  })
  const pendingCount = briefs.filter((b) => !['rejected', 'archived', 'published'].includes(b.status)).length

  return (
    <div className="rounded-2xl border border-border bg-card shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-muted/40 transition-colors rounded-t-2xl"
      >
        <div className="flex items-center gap-2">
          <span
            className="inline-block w-1 h-5 rounded-full shrink-0"
            style={{ background: '#d97706' }}
            aria-hidden="true"
          />
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <Sparkles className="h-4 w-4 text-amber-600" />
          <span className="text-base font-bold tracking-tight">Edit briefs</span>
          {pendingCount > 0 && (
            <span className="ml-1 inline-flex items-center rounded-full bg-amber-50 text-amber-700 text-2xs font-bold px-2 py-0.5">{pendingCount} active</span>
          )}
        </div>
        <span className="text-2xs text-muted-foreground">
          AI suggestions and manual briefs that turn source clips into finished posts
        </span>
      </button>

      {expanded && (
        <div className="border-t">
          {/* Filters */}
          <div className="flex items-center gap-1.5 flex-wrap px-4 py-2 border-b">
            <Filter className="h-3.5 w-3.5 text-muted-foreground" />
            {STATUS_FILTERS.map((s) => (
              <button
                key={s.id || 'all'}
                onClick={() => setFilter(s.id)}
                className={`text-2xs px-2.5 py-1 rounded-full border transition-colors ${
                  filter === s.id ? 'bg-primary text-white border-primary' : 'bg-muted text-muted-foreground border-border hover:border-primary/50'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          {/* List */}
          {error && <div className="text-sm text-destructive bg-destructive/10 m-3 rounded p-2">{error}</div>}
          {loading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground text-xs">
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading…
            </div>
          ) : visible.length === 0 ? (
            <div className="text-center text-xs text-muted-foreground py-8">
              No briefs in this view. Upload a tagged interview or click &quot;New brief&quot; on a media item to add one manually.
            </div>
          ) : (
            <ul className="divide-y">
              {visible.map((b) => (
                <li
                  key={b.id}
                  onClick={() => setSelected(b)}
                  className="px-4 py-3 hover:bg-muted/40 cursor-pointer flex items-start gap-3"
                >
                  <Badge variant="outline" className="text-3xs uppercase shrink-0 mt-0.5">{b.status}</Badge>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {b.target_platform && (
                        <span className="text-3xs uppercase font-medium text-primary">{b.target_platform}</span>
                      )}
                      <span className="text-xs text-muted-foreground truncate" title={b.source_quote || ''}>
                        {b.source_quote ? `"${b.source_quote.slice(0, 80)}${b.source_quote.length > 80 ? '…' : ''}"` : '(no quote)'}
                      </span>
                    </div>
                    <div className="text-2xs text-muted-foreground mt-0.5 truncate" title={b.final_caption || b.ai_caption || ''}>
                      {b.final_caption?.slice(0, 120) || b.ai_caption?.slice(0, 120) || '(no caption draft)'}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {selected && (
        <ContentBriefDetail
          brief={selected}
          onClose={() => setSelected(null)}
          onChange={() => { refresh(); }}
        />
      )}
    </div>
  )
}

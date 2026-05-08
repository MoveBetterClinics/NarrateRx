import { useState, useEffect, useCallback } from 'react'
import { useUser } from '@clerk/clerk-react'
import { Search, Loader2, Filter, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import MediaUploader from '@/components/MediaUploader'
import MediaGrid from '@/components/MediaGrid'
import MediaDetail from '@/components/MediaDetail'
import { listMedia, getMediaAsset } from '@/lib/mediaLib'
import { useUserRole } from '@/lib/useUserRole'

const KIND_FILTERS   = [{ id: '', label: 'All' }, { id: 'video', label: 'Video' }, { id: 'photo', label: 'Photo' }]
// Default ('Any active') excludes archived rows server-side. The explicit
// 'Archived' option opts in to viewing the trash bin.
const STATUS_FILTERS = [
  { id: '',         label: 'Any active' },
  { id: 'raw',      label: 'Raw' },
  { id: 'tagged',   label: 'Tagged' },
  { id: 'rendered', label: 'Rendered' },
  { id: 'approved', label: 'Approved' },
  { id: 'archived', label: 'Archived' },
]

export default function MediaHub() {
  const { user } = useUser()
  const { canUpload } = useUserRole()
  const [assets, setAssets]     = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')
  const [kind, setKind]         = useState('')
  const [status, setStatus]     = useState('')
  const [search, setSearch]     = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [selected, setSelected] = useState(null)  // full asset row

  // Debounce search input.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const refresh = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const rows = await listMedia({ kind: kind || undefined, status: status || undefined, q: debouncedSearch || undefined, limit: 120 })
      setAssets(rows)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [kind, status, debouncedSearch])

  useEffect(() => { refresh() }, [refresh])

  async function openDetail(asset) {
    // Refetch full row so any AI fields populated since list runs are visible.
    try {
      const fresh = await getMediaAsset(asset.id)
      setSelected(fresh || asset)
    } catch {
      setSelected(asset)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Media Hub</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Your library of raw and edited clips. Tag, organize, and drop into posts.
        </p>
      </div>

      {/* Uploader — surfaced to every role per HANDOFF role table */}
      {canUpload && <MediaUploader createdBy={user?.id} onUploaded={refresh} />}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search filename, notes, condition, patient…"
            className="pl-8 pr-8 h-8 text-sm"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2.5 top-2 text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {KIND_FILTERS.map((k) => (
            <button
              key={k.id || 'all-kind'}
              onClick={() => setKind(k.id)}
              className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                kind === k.id ? 'bg-primary text-white border-primary' : 'bg-muted text-muted-foreground border-border hover:border-primary/50'
              }`}
            >
              {k.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="text-[11px] h-7 px-2 rounded-md border border-border bg-background text-foreground"
          >
            {STATUS_FILTERS.map((s) => (
              <option key={s.id || 'all-status'} value={s.id}>{s.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Results */}
      {error && (
        <div className="text-sm text-destructive bg-destructive/10 rounded-lg p-3">{error}</div>
      )}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <MediaGrid assets={assets} selectedId={selected?.id} onSelect={openDetail} />
      )}

      {selected && (
        <MediaDetail
          asset={selected}
          onClose={() => setSelected(null)}
          onChange={refresh}
        />
      )}
    </div>
  )
}

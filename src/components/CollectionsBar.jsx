import { useState, useEffect, useCallback } from 'react'
import { FolderPlus, Loader2, Plus, X, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  listCollections,
  createCollection,
  updateCollection,
} from '@/lib/collectionsLib'
import { useUserRole } from '@/lib/useUserRole'

const KIND_OPTIONS = [
  { id: 'campaign', label: 'Campaign' },
  { id: 'series',   label: 'Series'   },
  { id: 'session',  label: 'Session'  },
  { id: 'adhoc',    label: 'Ad-hoc'   },
]

// Horizontal chip strip of collections at the top of the Media Hub. Click a
// chip to filter the library; "+ New" inline-creates one. Editor/admin only
// can create. Selection is hoisted via onSelect/selectedId so MediaHub.jsx
// owns the active filter state.
export default function CollectionsBar({ selectedId, onSelect, refreshKey = 0 }) {
  const { canEdit } = useUserRole()
  const [collections, setCollections] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [name, setName] = useState('')
  const [kind, setKind] = useState('campaign')
  const [editing, setEditing] = useState(null)
  const [editName, setEditName] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const rows = await listCollections({ status: 'active', limit: 200 })
      setCollections(rows)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh, refreshKey])

  async function submitCreate() {
    const trimmed = name.trim()
    if (!trimmed) return
    setSubmitting(true); setError('')
    try {
      const row = await createCollection({ name: trimmed, kind })
      setCollections((prev) => [{ ...row, item_count: 0 }, ...prev])
      setName(''); setKind('campaign'); setCreating(false)
      onSelect?.(row.id)
    } catch (e) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function submitRename() {
    if (!editing) return
    const trimmed = editName.trim()
    if (!trimmed || trimmed === editing.name) { setEditing(null); return }
    setSubmitting(true); setError('')
    try {
      const updated = await updateCollection(editing.id, { name: trimmed })
      setCollections((prev) => prev.map((c) => (c.id === editing.id ? { ...c, ...updated } : c)))
      setEditing(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function archiveCollection(c) {
    if (!confirm(`Archive "${c.name}"? Members stay in the library; the collection is hidden until restored.`)) return
    setSubmitting(true); setError('')
    try {
      await updateCollection(c.id, { status: 'archived' })
      setCollections((prev) => prev.filter((row) => row.id !== c.id))
      if (selectedId === c.id) onSelect?.(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-2xs uppercase tracking-wide text-muted-foreground font-medium pr-1">
          Collections
        </span>

        <button
          onClick={() => onSelect?.(null)}
          className={`text-2xs px-2.5 py-1 rounded-full border transition-colors ${
            !selectedId ? 'bg-primary text-white border-primary' : 'bg-muted text-muted-foreground border-border hover:border-primary/50'
          }`}
        >
          All
        </button>

        {loading ? (
          <span className="text-2xs text-muted-foreground flex items-center gap-1.5">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading…
          </span>
        ) : (
          collections.map((c) => {
            const active = selectedId === c.id
            const isEditing = editing?.id === c.id
            if (isEditing) {
              return (
                <span key={c.id} className="inline-flex items-center gap-1">
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submitRename()
                      if (e.key === 'Escape') setEditing(null)
                    }}
                    autoFocus
                    className="h-7 w-36 text-2xs px-2"
                  />
                  <Button size="sm" variant="ghost" className="h-7 px-2" onClick={submitRename} disabled={submitting}>
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setEditing(null)}>
                    Cancel
                  </Button>
                </span>
              )
            }
            return (
              <span key={c.id} className="inline-flex items-stretch">
                <button
                  onClick={() => onSelect?.(c.id)}
                  className={`text-2xs pl-2.5 pr-2 py-1 rounded-l-full border-l border-y transition-colors flex items-center gap-1.5 ${
                    active ? 'bg-primary text-white border-primary' : 'bg-muted text-muted-foreground border-border hover:border-primary/50'
                  }`}
                  title={c.description || c.name}
                >
                  <span className="truncate max-w-[160px]">{c.name}</span>
                  {c.item_count > 0 && (
                    <Badge
                      variant="secondary"
                      className={`text-3xs h-4 px-1 ${active ? 'bg-white/20 text-white' : ''}`}
                    >
                      {c.item_count}
                    </Badge>
                  )}
                </button>
                {canEdit && (
                  <span className={`flex items-center border-r border-y rounded-r-full ${
                    active ? 'border-primary' : 'border-border'
                  }`}>
                    <button
                      onClick={(e) => { e.stopPropagation(); setEditing(c); setEditName(c.name) }}
                      title="Rename"
                      className={`h-full px-1.5 transition-colors ${
                        active ? 'text-white/80 hover:text-white' : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); archiveCollection(c) }}
                      title="Archive collection"
                      className={`h-full pr-2 pl-1 transition-colors ${
                        active ? 'text-white/80 hover:text-white' : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                )}
              </span>
            )
          })
        )}

        {canEdit && !creating && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setCreating(true)}
            className="h-7 gap-1.5 text-2xs rounded-full"
          >
            <FolderPlus className="h-3.5 w-3.5" />
            New
          </Button>
        )}
      </div>

      {creating && canEdit && (
        <div className="flex flex-wrap items-center gap-2 p-2 rounded-md border bg-muted/40">
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitCreate()
              if (e.key === 'Escape') setCreating(false)
            }}
            placeholder="Collection name (e.g. May 2026 promo)"
            className="h-8 text-sm flex-1 min-w-[220px]"
          />
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="text-2xs h-8 px-2 rounded-md border border-border bg-background text-foreground"
          >
            {KIND_OPTIONS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
          </select>
          <Button size="sm" onClick={submitCreate} disabled={submitting || !name.trim()}>
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
            Create
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { setCreating(false); setName('') }}>Cancel</Button>
        </div>
      )}

      {error && <div className="text-xs text-destructive">{error}</div>}
    </div>
  )
}

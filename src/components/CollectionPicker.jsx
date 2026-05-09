import { useState, useEffect, useCallback } from 'react'
import { Loader2, Plus, X, FolderPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  listCollections,
  addAssetsToCollection,
  removeAssetFromCollection,
  createCollection,
} from '@/lib/collectionsLib'
import { useUserRole } from '@/lib/useUserRole'

// Membership manager surfaced inside MediaDetail. Shows the collections the
// asset already belongs to as removable chips, and offers a dropdown of all
// active workspace collections to add the asset to. Editor/admin only — read-only
// users see the chips but no add/remove affordances.
//
// Notifies the parent when membership changes (`onChange`) so the parent can
// refresh chips/filter counts without coupling to internal state.
export default function CollectionPicker({ assetId, onChange }) {
  const { canEdit } = useUserRole()
  const [memberships, setMemberships] = useState([])
  const [allActive, setAllActive]     = useState([])
  const [loading, setLoading]         = useState(true)
  const [busy, setBusy]               = useState(null) // collection id while a mutation is in flight
  const [error, setError]             = useState('')
  const [picking, setPicking]         = useState(false)
  const [creatingNew, setCreatingNew] = useState(false)
  const [newName, setNewName]         = useState('')

  const refresh = useCallback(async () => {
    if (!assetId) return
    setLoading(true); setError('')
    try {
      const [member, all] = await Promise.all([
        listCollections({ status: 'active', assetId, limit: 200 }),
        listCollections({ status: 'active', limit: 200 }),
      ])
      setMemberships(member)
      setAllActive(all)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [assetId])

  useEffect(() => { refresh() }, [refresh])

  const memberIds = new Set(memberships.map((c) => c.id))
  const candidates = allActive.filter((c) => !memberIds.has(c.id))

  async function add(collection) {
    setBusy(collection.id); setError('')
    try {
      await addAssetsToCollection(collection.id, [assetId])
      setMemberships((prev) => [...prev, collection])
      setPicking(false)
      onChange?.()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(null)
    }
  }

  async function remove(collection) {
    setBusy(collection.id); setError('')
    try {
      await removeAssetFromCollection(collection.id, assetId)
      setMemberships((prev) => prev.filter((c) => c.id !== collection.id))
      onChange?.()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(null)
    }
  }

  async function submitNew() {
    const name = newName.trim()
    if (!name) return
    setBusy('new'); setError('')
    try {
      const created = await createCollection({ name, kind: 'campaign' })
      await addAssetsToCollection(created.id, [assetId])
      setMemberships((prev) => [...prev, created])
      setAllActive((prev) => [created, ...prev])
      setNewName(''); setCreatingNew(false); setPicking(false)
      onChange?.()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground block mb-1.5">
        Collections
      </label>
      <div className="flex flex-wrap gap-1.5 items-center">
        {loading ? (
          <span className="text-[11px] text-muted-foreground flex items-center gap-1.5">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading…
          </span>
        ) : memberships.length === 0 ? (
          <span className="text-[11px] text-muted-foreground italic">Not in any collection</span>
        ) : (
          memberships.map((c) => (
            <Badge
              key={c.id}
              variant="secondary"
              className={`gap-1 ${canEdit ? 'cursor-pointer' : ''}`}
              onClick={() => canEdit && remove(c)}
              title={canEdit ? `Remove from "${c.name}"` : c.name}
            >
              {c.name}
              {canEdit && (busy === c.id
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <X className="h-3 w-3" />)}
            </Badge>
          ))
        )}

        {canEdit && !picking && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPicking(true)}
            className="h-7 gap-1.5 text-[11px] rounded-full"
          >
            <Plus className="h-3.5 w-3.5" />
            Add to collection
          </Button>
        )}
      </div>

      {picking && canEdit && (
        <div className="mt-2 rounded-md border bg-muted/40 p-2 space-y-2">
          {candidates.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {candidates.map((c) => (
                <button
                  key={c.id}
                  onClick={() => add(c)}
                  disabled={busy === c.id}
                  className="text-[11px] px-2.5 py-1 rounded-full border border-border bg-background hover:border-primary/50 disabled:opacity-60 flex items-center gap-1.5"
                >
                  {busy === c.id
                    ? <Loader2 className="h-3 w-3 animate-spin" />
                    : <Plus className="h-3 w-3" />}
                  {c.name}
                  {c.item_count > 0 && (
                    <span className="text-muted-foreground">· {c.item_count}</span>
                  )}
                </button>
              ))}
            </div>
          )}
          {candidates.length === 0 && !creatingNew && (
            <div className="text-[11px] text-muted-foreground italic">
              No other collections — create one below.
            </div>
          )}

          {!creatingNew ? (
            <div className="flex gap-2">
              <Button
                size="sm" variant="ghost"
                onClick={() => setCreatingNew(true)}
                className="h-7 gap-1.5 text-[11px]"
              >
                <FolderPlus className="h-3.5 w-3.5" />
                New collection…
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPicking(false)} className="h-7 text-[11px]">
                Done
              </Button>
            </div>
          ) : (
            <div className="flex gap-2 items-center">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitNew()
                  if (e.key === 'Escape') { setCreatingNew(false); setNewName('') }
                }}
                placeholder="New collection name"
                className="h-8 px-2 text-sm flex-1 rounded-md border border-border bg-background"
              />
              <Button size="sm" onClick={submitNew} disabled={busy === 'new' || !newName.trim()} className="h-8">
                {busy === 'new' && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                Create + add
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setCreatingNew(false); setNewName('') }} className="h-8">
                Cancel
              </Button>
            </div>
          )}
        </div>
      )}

      {error && <div className="text-[11px] text-destructive mt-1">{error}</div>}
    </div>
  )
}

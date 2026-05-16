import { useState, useEffect, useCallback } from 'react'
import {
  Loader2, Plus, FolderPlus, X, Check, CheckCheck,
  Archive, ArchiveRestore, Tag, FolderMinus, Sparkles, Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import {
  listCollections,
  addAssetsToCollection,
  removeAssetsFromCollection,
  createCollection,
} from '@/lib/collectionsLib'
import {
  archiveMediaAsset,
  restoreMediaAsset,
  updateMediaAsset,
  purgeMediaAsset,
  tagMediaAsset,
} from '@/lib/mediaLib'
import { useUserRole } from '@/lib/useUserRole'

const STATUS_OPTIONS = [
  { id: 'raw',      label: 'Raw' },
  { id: 'tagged',   label: 'Tagged' },
  { id: 'rendered', label: 'Rendered' },
  { id: 'approved', label: 'Approved' },
]

// Run an async fn over items with bounded concurrency. Used to throttle the
// slower bulk actions (AI tagging, purge) so we don't fan 50 simultaneous
// blob/Gemini calls at the server. Returns Promise.allSettled-shaped results.
async function pMap(items, fn, concurrency = 5) {
  const results = new Array(items.length)
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const idx = cursor++
      try { results[idx] = { status: 'fulfilled', value: await fn(items[idx], idx) } }
      catch (reason) { results[idx] = { status: 'rejected', reason } }
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length))
  await Promise.all(Array.from({ length: n }, worker))
  return results
}

function summarize(results, verb) {
  const ok = results.filter((r) => r.status === 'fulfilled').length
  const bad = results.length - ok
  if (bad === 0) return `${verb} ${ok} item${ok === 1 ? '' : 's'}.`
  if (ok === 0) return `Couldn’t ${verb.toLowerCase()} any of ${results.length} — ${results[0]?.reason?.message || 'see console'}.`
  return `${verb} ${ok} of ${results.length} — ${bad} failed (${results.find((r) => r.status === 'rejected')?.reason?.message || 'see console'}).`
}

// Sticky action bar shown when multi-select is active. Surfaces the count plus
// every bulk action available against the selection. Selection state and the
// refresh side-effect live in MediaHub.jsx; this component only renders the
// UI and dispatches the mutations.
//
// Props:
//   selectedIds       — array of asset ids currently selected
//   assets            — visible (filtered) list, used for "Select all visible"
//                       and to look up each asset's filename for purge
//   currentStatus     — the active status filter ('' | 'archived' | etc.) so
//                       we can swap Archive ↔ Restore and gate Purge to the
//                       Archived view
//   currentCollectionId — non-null when a collection chip is active; enables
//                       "Remove from collection"
//   onClear / onSelectAll / onExit — selection-state callbacks
//   onChange          — called after a successful Add/Remove on a collection
//                       so MediaHub can refresh CollectionsBar counts
//   onRefresh         — called after status/archive/restore/purge/tag so
//                       MediaHub re-fetches the list
export default function BulkActionBar({
  selectedIds,
  assets = [],
  hasMore = false,
  currentStatus = '',
  currentCollectionId = null,
  onClear,
  onSelectAll,
  onExit,
  onChange,
  onRefresh,
}) {
  const { canEdit, canArchive, canRestore, canPurge } = useUserRole()
  const [panel, setPanel]             = useState(null) // 'collection' | 'status' | null
  const [collections, setCollections] = useState([])
  const [loadingList, setLoadingList] = useState(false)
  const [busy, setBusy]               = useState(null) // collection id or action key while in flight
  const [justAdded, setJustAdded]     = useState(null)
  const [creating, setCreating]       = useState(false)
  const [newName, setNewName]         = useState('')
  const [error, setError]             = useState('')
  const [message, setMessage]         = useState('')
  const [purgeOpen, setPurgeOpen]     = useState(false)
  const [purgeConfirm, setPurgeConfirm] = useState('')
  const [selectingAll, setSelectingAll] = useState(false)

  const count = selectedIds.length
  const visibleCount = assets.length
  // We only claim "all selected" when there's nothing more on the server to
  // load — otherwise the user could think they have everything when more
  // pages still exist off-screen.
  const allVisibleSelected = visibleCount > 0 && !hasMore && count >= visibleCount &&
    assets.every((a) => selectedIds.includes(a.id))
  const viewingArchived = currentStatus === 'archived'
  const inCollection    = !!currentCollectionId

  // Hydrate collections only when the picker is open.
  const loadCollections = useCallback(async () => {
    setLoadingList(true); setError('')
    try {
      const rows = await listCollections({ status: 'active', limit: 200 })
      setCollections(rows)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoadingList(false)
    }
  }, [])
  useEffect(() => {
    if (panel === 'collection') loadCollections()
  }, [panel, loadCollections])

  // Auto-clear the per-action checkmark.
  useEffect(() => {
    if (!justAdded) return
    const t = setTimeout(() => setJustAdded(null), 1400)
    return () => clearTimeout(t)
  }, [justAdded])

  // Auto-clear the bulk-result toast after a few seconds so it doesn't pile up.
  useEffect(() => {
    if (!message) return
    const t = setTimeout(() => setMessage(''), 4000)
    return () => clearTimeout(t)
  }, [message])

  function selectedAssets() {
    const idSet = new Set(selectedIds)
    return assets.filter((a) => idSet.has(a.id))
  }

  // ── Collection actions ─────────────────────────────────────────────────────

  async function addToExisting(collection) {
    if (!count) return
    setBusy(collection.id); setError('')
    try {
      await addAssetsToCollection(collection.id, selectedIds)
      setJustAdded(collection.id)
      onChange?.()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(null)
    }
  }

  async function submitNewCollection() {
    const name = newName.trim()
    if (!name || !count) return
    setBusy('new'); setError('')
    try {
      const created = await createCollection({ name, kind: 'campaign' })
      await addAssetsToCollection(created.id, selectedIds)
      setCollections((prev) => [{ ...created, item_count: count }, ...prev])
      setJustAdded(created.id)
      setCreating(false); setNewName('')
      onChange?.()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(null)
    }
  }

  async function removeFromCurrentCollection() {
    if (!count || !currentCollectionId) return
    if (!confirm(`Remove ${count} item${count === 1 ? '' : 's'} from this collection? They stay in the library.`)) return
    setBusy('remove-collection'); setError('')
    try {
      await removeAssetsFromCollection(currentCollectionId, selectedIds)
      setMessage(`Removed ${count} from collection.`)
      onChange?.()
      onRefresh?.()
      onClear?.()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(null)
    }
  }

  // ── Status / archive / restore / purge / re-tag ────────────────────────────

  async function setStatus(statusId) {
    if (!count) return
    setBusy(`status:${statusId}`); setError('')
    const results = await pMap(selectedIds, (id) => updateMediaAsset(id, { status: statusId }), 8)
    setMessage(summarize(results, `Set status to "${statusId}" on`))
    setBusy(null); setPanel(null)
    onRefresh?.()
    onClear?.()
  }

  async function archiveAll() {
    if (!count) return
    if (!confirm(`Archive ${count} item${count === 1 ? '' : 's'}? They’ll move to the trash bin and can be restored.`)) return
    setBusy('archive'); setError('')
    const results = await pMap(selectedIds, (id) => archiveMediaAsset(id), 8)
    setMessage(summarize(results, 'Archived'))
    setBusy(null)
    onRefresh?.()
    onClear?.()
  }

  async function restoreAll() {
    if (!count) return
    setBusy('restore'); setError('')
    const results = await pMap(selectedIds, (id) => restoreMediaAsset(id), 8)
    setMessage(summarize(results, 'Restored'))
    setBusy(null)
    onRefresh?.()
    onClear?.()
  }

  async function tagAll() {
    if (!count) return
    setBusy('tag'); setError('')
    // AI tagging is server-heavy (vision + transcription, 10–60s/video). Cap
    // concurrency low so we don't queue dozens of simultaneous Gemini calls.
    const results = await pMap(selectedIds, (id) => tagMediaAsset(id), 3)
    setMessage(summarize(results, 'Re-tagged'))
    setBusy(null)
    onRefresh?.()
    // Selection retained — items stay in view, user may want to chain another
    // action (e.g. set status to "tagged") on the same set.
  }

  async function purgeAll() {
    if (!count) return
    setBusy('purge'); setError('')
    // Server requires the exact filename per asset as a typed-confirm. We
    // already have it client-side; the bar's master "DELETE" gate is the
    // human safeguard.
    const sel = selectedAssets()
    const results = await pMap(sel, (a) => purgeMediaAsset(a.id, a.filename), 3)
    setMessage(summarize(results, 'Permanently deleted'))
    setBusy(null); setPurgeOpen(false); setPurgeConfirm('')
    onRefresh?.()
    onClear?.()
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="sticky top-14 z-30">
      <div className="rounded-lg border-2 border-primary/30 bg-background/95 backdrop-blur shadow-md p-3 space-y-2">
        {/* Row 1: count + select-all + primary CTA + clear/done */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold pl-1">
            {count === 0
              ? `0 of ${visibleCount} selected`
              : `${count} selected${count < visibleCount ? ` of ${visibleCount}` : ''}`}
          </span>

          {visibleCount > 0 && onSelectAll && (
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                if (allVisibleSelected) { onClear?.(); return }
                setSelectingAll(true)
                try { await onSelectAll() } finally { setSelectingAll(false) }
              }}
              disabled={selectingAll}
              className="h-8 gap-1.5 text-xs rounded-full"
              title={allVisibleSelected
                ? 'Deselect all currently loaded items'
                : hasMore
                  ? 'Load every remaining page in the current filter and select all of them'
                  : 'Select every item in the current filter'}
            >
              {selectingAll
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <CheckCheck className="h-3.5 w-3.5" />}
              {selectingAll
                ? 'Selecting all…'
                : allVisibleSelected
                  ? 'Deselect all'
                  : hasMore
                    ? `Select all matching${visibleCount ? ` (${visibleCount}+)` : ''}`
                    : `Select all ${visibleCount}`}
            </Button>
          )}

          {canEdit && (
            <Button
              size="sm"
              onClick={() => setPanel(panel === 'collection' ? null : 'collection')}
              disabled={count === 0}
              className="h-8 gap-1.5 text-xs rounded-full px-3"
            >
              <Plus className="h-4 w-4" />
              {count === 0
                ? 'Add to collection…'
                : `Add ${count} to collection…`}
            </Button>
          )}

          <div className="ml-auto flex items-center gap-1.5">
            {count > 0 && (
              <Button size="sm" variant="ghost" onClick={onClear} className="h-8 text-xs">
                Clear
              </Button>
            )}
            <Button
              size="sm" variant="ghost" onClick={onExit}
              className="h-8 text-xs gap-1" title="Exit selection mode"
            >
              <X className="h-3.5 w-3.5" />
              Done
            </Button>
          </div>
        </div>

        {/* Row 2: secondary bulk actions (only meaningful when items are selected) */}
        {canEdit && count > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pl-1">
            <Button
              size="sm" variant="outline"
              onClick={() => setPanel(panel === 'status' ? null : 'status')}
              className="h-7 gap-1.5 text-2xs rounded-full"
            >
              <Tag className="h-3.5 w-3.5" />
              Set status…
            </Button>

            {inCollection && (
              <Button
                size="sm" variant="outline"
                onClick={removeFromCurrentCollection}
                disabled={busy === 'remove-collection'}
                className="h-7 gap-1.5 text-2xs rounded-full"
              >
                {busy === 'remove-collection'
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <FolderMinus className="h-3.5 w-3.5" />}
                Remove from this collection
              </Button>
            )}

            <Button
              size="sm" variant="outline"
              onClick={tagAll}
              disabled={busy === 'tag'}
              className="h-7 gap-1.5 text-2xs rounded-full"
              title="Re-run vision + transcription tagging. Slow (10–60s per video)."
            >
              {busy === 'tag'
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Sparkles className="h-3.5 w-3.5" />}
              Re-run AI tags
            </Button>

            {viewingArchived ? (
              canRestore && (
                <Button
                  size="sm" variant="outline"
                  onClick={restoreAll}
                  disabled={busy === 'restore'}
                  className="h-7 gap-1.5 text-2xs rounded-full"
                >
                  {busy === 'restore'
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <ArchiveRestore className="h-3.5 w-3.5" />}
                  Restore
                </Button>
              )
            ) : (
              canArchive && (
                <Button
                  size="sm" variant="outline"
                  onClick={archiveAll}
                  disabled={busy === 'archive'}
                  className="h-7 gap-1.5 text-2xs rounded-full"
                >
                  {busy === 'archive'
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Archive className="h-3.5 w-3.5" />}
                  Archive
                </Button>
              )
            )}

            {viewingArchived && canPurge && (
              <Button
                size="sm" variant="outline"
                onClick={() => setPurgeOpen(true)}
                disabled={busy === 'purge'}
                className="h-7 gap-1.5 text-2xs rounded-full text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete permanently…
              </Button>
            )}
          </div>
        )}

        {/* Status submenu */}
        {panel === 'status' && canEdit && count > 0 && (
          <div className="rounded-md border bg-muted/40 p-2 space-y-2">
            <div className="text-2xs text-muted-foreground px-1">
              Set status on {count} item{count === 1 ? '' : 's'}:
            </div>
            <div className="flex flex-wrap gap-1.5">
              {STATUS_OPTIONS.map((s) => {
                const isBusy = busy === `status:${s.id}`
                return (
                  <button
                    key={s.id}
                    onClick={() => setStatus(s.id)}
                    disabled={!!busy}
                    className="text-2xs px-2.5 py-1 rounded-full border border-border bg-background hover:border-primary/50 disabled:opacity-60 flex items-center gap-1.5"
                  >
                    {isBusy
                      ? <Loader2 className="h-3 w-3 animate-spin" />
                      : <Tag className="h-3 w-3" />}
                    {s.label}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Add-to-collection submenu */}
        {panel === 'collection' && canEdit && count > 0 && (
          <div className="rounded-md border bg-muted/40 p-2 space-y-2">
            {loadingList ? (
              <span className="text-2xs text-muted-foreground flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading collections…
              </span>
            ) : collections.length === 0 && !creating ? (
              <div className="text-2xs text-muted-foreground italic">
                No collections yet — create one below.
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {collections.map((c) => {
                  const isBusy = busy === c.id
                  const wasAdded = justAdded === c.id
                  return (
                    <button
                      key={c.id}
                      onClick={() => addToExisting(c)}
                      disabled={isBusy}
                      className="text-2xs px-2.5 py-1 rounded-full border border-border bg-background hover:border-primary/50 disabled:opacity-60 flex items-center gap-1.5"
                      title={c.description || c.name}
                    >
                      {isBusy
                        ? <Loader2 className="h-3 w-3 animate-spin" />
                        : wasAdded
                          ? <Check className="h-3 w-3 text-success" />
                          : <Plus className="h-3 w-3" />}
                      <span className="truncate max-w-[160px]" title={c.name}>{c.name}</span>
                      {c.item_count > 0 && (
                        <span className="text-muted-foreground">· {c.item_count}</span>
                      )}
                    </button>
                  )
                })}
              </div>
            )}

            {!creating ? (
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => setCreating(true)} className="h-7 gap-1.5 text-2xs">
                  <FolderPlus className="h-3.5 w-3.5" />
                  New collection…
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setPanel(null)} className="h-7 text-2xs">
                  Close
                </Button>
              </div>
            ) : (
              <div className="flex gap-2 items-center">
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitNewCollection()
                    if (e.key === 'Escape') { setCreating(false); setNewName('') }
                  }}
                  placeholder="New collection name"
                  className="h-8 px-2 text-sm flex-1 rounded-md border border-border bg-background"
                />
                <Button size="sm" onClick={submitNewCollection} disabled={busy === 'new' || !newName.trim()} className="h-8">
                  {busy === 'new' && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                  Create + add
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setCreating(false); setNewName('') }} className="h-8">
                  Cancel
                </Button>
              </div>
            )}
          </div>
        )}

        {message && (
          <div className="text-xs text-success bg-success/10 border border-success/30 rounded-md px-2 py-1">
            {message}
          </div>
        )}
        {error && <div className="text-2xs text-destructive px-1">{error}</div>}
      </div>

      {/* Purge confirmation — typed-confirm gate matching the per-asset UX */}
      <Dialog open={purgeOpen} onOpenChange={(v) => { setPurgeOpen(v); if (!v) setPurgeConfirm('') }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive flex items-center gap-2">
              <Trash2 className="h-4 w-4" />
              Permanently delete {count} item{count === 1 ? '' : 's'}?
            </DialogTitle>
            <DialogDescription>
              This deletes the blob and the database row. It cannot be undone.
              The server only allows purge after a 30-day cooldown — items still
              in cooldown will be skipped.
            </DialogDescription>
          </DialogHeader>
          <div>
            <label className="text-xs font-medium block mb-1.5">
              Type <span className="font-mono bg-muted px-1 py-0.5 rounded">DELETE</span> to confirm:
            </label>
            <input
              autoFocus
              value={purgeConfirm}
              onChange={(e) => setPurgeConfirm(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && purgeConfirm === 'DELETE') purgeAll() }}
              className="h-9 w-full px-2 text-sm rounded-md border border-border bg-background"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPurgeOpen(false)} disabled={busy === 'purge'}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={purgeAll}
              disabled={busy === 'purge' || purgeConfirm !== 'DELETE'}
            >
              {busy === 'purge' && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              Permanently delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

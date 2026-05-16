import { useState, useEffect, useCallback } from 'react'
import {
  Loader2, Plus, FolderPlus, X, Check, CheckCheck,
  Archive, ArchiveRestore, Tag, FolderMinus, Sparkles, Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import Icon from '@/components/ui/Icon'
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

// Separator between pill action groups.
function Sep() {
  return <span className="w-px h-4 bg-slate-700 shrink-0" aria-hidden />
}

// Dark pill button style helper — returns a className string.
function pillBtn(extraClass = '') {
  return `text-xs text-slate-200 hover:text-emerald-300 transition-colors disabled:opacity-50 ${extraClass}`
}

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
    // Fixed bottom-center dark pill. Sub-panels open upward via absolute
    // bottom-full so they don't push the pill off screen.
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2">
      {/* Sub-panels open above the pill ------------------------------------ */}

      {/* Status submenu */}
      {panel === 'status' && canEdit && count > 0 && (
        <div className="rounded-xl border border-slate-700 bg-slate-900 shadow-2xl p-3 space-y-2 min-w-[260px]">
          <div className="text-2xs text-slate-400 px-1">
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
                  className="text-2xs px-2.5 py-1 rounded-full border border-slate-600 bg-slate-800 text-slate-200 hover:border-emerald-500 hover:text-emerald-300 disabled:opacity-60 flex items-center gap-1.5"
                >
                  {isBusy
                    ? <Icon as={Loader2} size="xs" className="animate-spin" />
                    : <Icon as={Tag} size="xs" />}
                  {s.label}
                </button>
              )
            })}
          </div>
          <button onClick={() => setPanel(null)} className="text-2xs text-slate-500 hover:text-slate-300 px-1">Close</button>
        </div>
      )}

      {/* Add-to-collection submenu */}
      {panel === 'collection' && canEdit && count > 0 && (
        <div className="rounded-xl border border-slate-700 bg-slate-900 shadow-2xl p-3 space-y-2 min-w-[280px] max-w-[380px]">
          {loadingList ? (
            <span className="text-2xs text-slate-400 flex items-center gap-1.5">
              <Icon as={Loader2} size="xs" className="animate-spin" /> Loading…
            </span>
          ) : collections.length === 0 && !creating ? (
            <div className="text-2xs text-slate-400 italic">No collections yet — create one below.</div>
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
                    className="text-2xs px-2.5 py-1 rounded-full border border-slate-600 bg-slate-800 text-slate-200 hover:border-emerald-500 hover:text-emerald-300 disabled:opacity-60 flex items-center gap-1.5"
                    title={c.description || c.name}
                  >
                    {isBusy
                      ? <Icon as={Loader2} size="xs" className="animate-spin" />
                      : wasAdded
                        ? <Icon as={Check} size="xs" className="text-emerald-400" />
                        : <Icon as={Plus} size="xs" />}
                    <span className="truncate max-w-[160px]">{c.name}</span>
                    {c.item_count > 0 && <span className="text-slate-500">· {c.item_count}</span>}
                  </button>
                )
              })}
            </div>
          )}
          {!creating ? (
            <div className="flex gap-2">
              <button onClick={() => setCreating(true)} className="text-2xs text-slate-400 hover:text-emerald-300 flex items-center gap-1">
                <Icon as={FolderPlus} size="xs" /> New collection…
              </button>
              <button onClick={() => setPanel(null)} className="text-2xs text-slate-500 hover:text-slate-300 ml-auto">Close</button>
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
                className="h-7 px-2 text-xs flex-1 rounded-md border border-slate-600 bg-slate-800 text-white placeholder:text-slate-500"
              />
              <button onClick={submitNewCollection} disabled={busy === 'new' || !newName.trim()} className="text-2xs text-emerald-400 hover:text-emerald-300 disabled:opacity-50 flex items-center gap-1">
                {busy === 'new' && <Icon as={Loader2} size="xs" className="animate-spin" />}
                Create + add
              </button>
              <button onClick={() => { setCreating(false); setNewName('') }} className="text-2xs text-slate-500 hover:text-slate-300">Cancel</button>
            </div>
          )}
        </div>
      )}

      {/* Result / error toasts */}
      {(message || error) && (
        <div className={`rounded-xl px-4 py-2 text-xs shadow-xl ${message ? 'bg-emerald-800 text-emerald-100' : 'bg-rose-900 text-rose-100'}`}>
          {message || error}
        </div>
      )}

      {/* Primary dark pill ------------------------------------------------- */}
      <div className="rounded-full bg-slate-900 border border-slate-700 shadow-2xl px-4 py-2.5 flex items-center gap-3 text-xs select-none">
        {/* Count */}
        <span className="font-semibold text-white whitespace-nowrap">
          {count === 0 ? `0 of ${visibleCount}` : count} selected
        </span>

        {/* Select-all */}
        {visibleCount > 0 && onSelectAll && (
          <>
            <Sep />
            <button
              className={pillBtn()}
              onClick={async () => {
                if (allVisibleSelected) { onClear?.(); return }
                setSelectingAll(true)
                try { await onSelectAll() } finally { setSelectingAll(false) }
              }}
              disabled={selectingAll}
              title={allVisibleSelected ? 'Deselect all' : hasMore ? 'Select all matching' : `Select all ${visibleCount}`}
            >
              {selectingAll
                ? <Icon as={Loader2} size="sm" className="animate-spin inline" />
                : <Icon as={CheckCheck} size="sm" className="inline mr-0.5" />}
              {allVisibleSelected ? 'Deselect all' : `All ${visibleCount}${hasMore ? '+' : ''}`}
            </button>
          </>
        )}

        {count > 0 && (
          <>
            <Sep />

            {/* Status */}
            {canEdit && (
              <button
                className={pillBtn(panel === 'status' ? 'text-emerald-300' : '')}
                onClick={() => setPanel(panel === 'status' ? null : 'status')}
              >
                <Icon as={Tag} size="sm" className="inline mr-0.5" />
                Tag
              </button>
            )}

            {/* Add to collection */}
            {canEdit && (
              <button
                className={pillBtn(panel === 'collection' ? 'text-emerald-300' : '')}
                onClick={() => setPanel(panel === 'collection' ? null : 'collection')}
              >
                <Icon as={Plus} size="sm" className="inline mr-0.5" />
                Collection
              </button>
            )}

            {/* AI re-tag */}
            {canEdit && (
              <button
                className={pillBtn()}
                onClick={tagAll}
                disabled={busy === 'tag'}
                title="Re-run vision + transcription tagging (slow)"
              >
                {busy === 'tag'
                  ? <Icon as={Loader2} size="sm" className="animate-spin inline mr-0.5" />
                  : <Icon as={Sparkles} size="sm" className="inline mr-0.5" />}
                AI tags
              </button>
            )}

            {/* Archive / Restore */}
            {viewingArchived ? (
              canRestore && (
                <button
                  className={pillBtn()}
                  onClick={restoreAll}
                  disabled={busy === 'restore'}
                >
                  {busy === 'restore'
                    ? <Icon as={Loader2} size="sm" className="animate-spin inline mr-0.5" />
                    : <Icon as={ArchiveRestore} size="sm" className="inline mr-0.5" />}
                  Restore
                </button>
              )
            ) : (
              canArchive && (
                <button
                  className={pillBtn()}
                  onClick={archiveAll}
                  disabled={busy === 'archive'}
                >
                  {busy === 'archive'
                    ? <Icon as={Loader2} size="sm" className="animate-spin inline mr-0.5" />
                    : <Icon as={Archive} size="sm" className="inline mr-0.5" />}
                  Archive
                </button>
              )
            )}

            {/* Remove from collection */}
            {inCollection && canEdit && (
              <button
                className={pillBtn()}
                onClick={removeFromCurrentCollection}
                disabled={busy === 'remove-collection'}
              >
                {busy === 'remove-collection'
                  ? <Icon as={Loader2} size="sm" className="animate-spin inline mr-0.5" />
                  : <Icon as={FolderMinus} size="sm" className="inline mr-0.5" />}
                Remove
              </button>
            )}

            {/* Delete permanently */}
            {viewingArchived && canPurge && (
              <button
                className="text-xs text-rose-400 hover:text-rose-300 transition-colors"
                onClick={() => setPurgeOpen(true)}
                disabled={busy === 'purge'}
              >
                <Icon as={Trash2} size="sm" className="inline mr-0.5" />
                Delete…
              </button>
            )}

            <Sep />
          </>
        )}

        {/* Clear + Done */}
        {count > 0 && (
          <button className={pillBtn()} onClick={onClear}>Clear</button>
        )}
        <button
          className="text-xs text-slate-400 hover:text-slate-200 transition-colors flex items-center gap-1"
          onClick={onExit}
          title="Exit selection mode (Esc)"
        >
          <Icon as={X} size="sm" />
          Done
          <span className="text-3xs bg-slate-800 border border-slate-600 rounded px-1 py-0.5 text-slate-400 font-mono">esc</span>
        </button>
      </div>

      {/* Purge confirmation dialog — stays portal-rendered outside the pill */}
      <Dialog open={purgeOpen} onOpenChange={(v) => { setPurgeOpen(v); if (!v) setPurgeConfirm('') }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive flex items-center gap-2">
              <Icon as={Trash2} size="md" />
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
            <Button variant="ghost" onClick={() => setPurgeOpen(false)} disabled={busy === 'purge'}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={purgeAll}
              disabled={busy === 'purge' || purgeConfirm !== 'DELETE'}
            >
              {busy === 'purge' && <Icon as={Loader2} size="sm" className="animate-spin mr-1.5" />}
              Permanently delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

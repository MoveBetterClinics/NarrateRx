import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Video, Image as ImageIcon, Play, Check, Download, Link2 } from 'lucide-react'
import { toast } from '@/lib/toast'

const STATUS_LABEL = {
  raw:      { label: 'Raw',      tone: 'bg-slate-200 text-slate-700' },
  tagged:   { label: 'Tagged',   tone: 'bg-blue-100 text-blue-700' },
  rendered: { label: 'Rendered', tone: 'bg-violet-100 text-violet-700' },
  approved: { label: 'Approved', tone: 'bg-success/15 text-success' },
  archived: { label: 'Archived', tone: 'bg-muted text-muted-foreground' },
}

// Derive up to 2 initials from a Clerk user ID or display name.
// Clerk user IDs look like "user_2abc…" — we show "?" for those since
// we don't have the real name from the media list query. Callers that
// pass a proper display name get real initials.
function initials(value) {
  if (!value) return '?'
  // If it looks like a Clerk ID (user_xxx), return a placeholder glyph.
  if (/^user_/.test(value)) return '?'
  const parts = value.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  return value.slice(0, 2).toUpperCase()
}

// Thumb renders the per-asset preview. loading="lazy" + decoding="async" keep
// the initial paint cheap for libraries of hundreds-to-thousands of assets;
// the audit flagged this as a P1 (every img was eager-loaded). alt is set
// to the human-readable alt_text when present, falling back to the filename
// so screen readers still get something useful.
function Thumb({ asset }) {
  const alt = asset.alt_text || asset.filename || 'Media asset'
  if (asset.kind === 'photo') {
    const src = asset.thumbnail_url || asset.blob_url
    if (src) return <img src={src} alt={alt} loading="lazy" decoding="async" className="w-full h-full object-cover" />
    return <div className="h-full bg-muted flex items-center justify-center"><ImageIcon className="h-6 w-6 text-muted-foreground" /></div>
  }
  // video
  return (
    <div className="relative h-full w-full">
      {asset.thumbnail_url ? (
        <img src={asset.thumbnail_url} alt={alt} loading="lazy" decoding="async" className="w-full h-full object-cover" />
      ) : (
        <div className="h-full bg-slate-800 flex flex-col items-center justify-center gap-1 px-1">
          <Video className="h-6 w-6 text-slate-400 shrink-0" />
          <span className="text-3xs text-slate-400 text-center leading-tight line-clamp-3">{asset.filename}</span>
        </div>
      )}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="h-8 w-8 rounded-full bg-black/55 flex items-center justify-center">
          <Play className="h-4 w-4 text-white ml-0.5" />
        </div>
      </div>
    </div>
  )
}

// Drag-from-card to other browser tabs: putting the asset URL on the
// dataTransfer's text/uri-list lets the user drop a thumbnail straight onto
// any web upload widget that accepts URL drops. Photos also natively drag
// as image data because of the inner <img> element.
function handleDragStart(e, asset) {
  if (!asset.blob_url) return
  try {
    e.dataTransfer.effectAllowed = 'copy'
    e.dataTransfer.setData('text/uri-list', asset.blob_url)
    e.dataTransfer.setData('text/plain', asset.blob_url)
    const thumbImg = e.currentTarget.querySelector('img')
    if (thumbImg) e.dataTransfer.setDragImage(thumbImg, 16, 16)
  } catch { /* empty */ }
}

// Tailwind breakpoint → column count. Matches the className on the grid
// container below; if the grid breakpoints change, mirror it here. Used by
// the keyboard navigator to translate ArrowUp/Down into "move by one row."
function useColumnCount() {
  const [cols, setCols] = useState(() => columnsAt(typeof window !== 'undefined' ? window.innerWidth : 1024))
  useEffect(() => {
    function onResize() { setCols(columnsAt(window.innerWidth)) }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return cols
}

function columnsAt(width) {
  if (width >= 1024) return 5  // lg
  if (width >= 768)  return 4  // md
  if (width >= 640)  return 3  // sm
  return 2                     // default
}

// Quick-action download without opening the detail drawer.
async function quickDownload(e, asset) {
  e.stopPropagation()
  if (!asset.blob_url) return
  try {
    const res = await fetch(asset.blob_url)
    if (!res.ok) throw new Error(`Fetch failed (${res.status})`)
    const blob = await res.blob()
    const objUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = objUrl
    a.download = asset.filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(objUrl)
  } catch (err) {
    toast.error('Download failed', { description: err?.message })
  }
}

async function quickCopyLink(e, asset) {
  e.stopPropagation()
  if (!asset.blob_url) return
  try {
    await navigator.clipboard.writeText(asset.blob_url)
    toast.success('Link copied')
  } catch {
    toast.error('Could not copy link')
  }
}

// Individual grid cell with hover overlay, badges, and checkbox.
function GridCell({ asset, index, isSelected, isFocused, multiSelect, onSelect, buttonRef }) {
  const [hovered, setHovered] = useState(false)
  const navigate = useNavigate()
  const statusMeta = STATUS_LABEL[asset.status] || STATUS_LABEL.raw

  // Usage count from the content_item_ids array stored on the asset row.
  // This is populated server-side when a content piece is linked to a source
  // asset; for new uploads it's null/empty so we show ×0.
  const usageCount = Array.isArray(asset.content_item_ids) ? asset.content_item_ids.length : 0
  const firstStoryId = usageCount > 0 ? asset.content_item_ids[0] : null

  // Clinician initial badge. created_by is a Clerk user ID string.
  // We show "?" when it's a raw Clerk ID because we don't resolve names
  // in the list query; users can hover for the raw ID.
  const createdByInitials = initials(asset.created_by)

  return (
    <button
      ref={buttonRef}
      tabIndex={isFocused ? 0 : -1}
      onFocus={() => {}}
      onClick={(e) => onSelect?.(asset, { index, shiftKey: e.shiftKey, metaKey: e.metaKey || e.ctrlKey })}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      draggable
      onDragStart={(e) => handleDragStart(e, asset)}
      title={`${asset.filename} — click to open, or drag into another browser tab to upload it there`}
      aria-label={`${asset.filename}, ${statusMeta.label.toLowerCase()}`}
      className={`relative rounded-lg overflow-hidden border-2 aspect-square transition-all text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
        isSelected ? 'border-primary' : 'border-transparent hover:border-muted-foreground/30'
      }`}
    >
      <Thumb asset={asset} />

      {/* Status pill — top left */}
      <div className="absolute top-1.5 left-1.5">
        <span className={`text-3xs font-medium px-1.5 py-0.5 rounded ${statusMeta.tone}`}>
          {statusMeta.label}
        </span>
      </div>

      {/* Hover checkbox — top left (overlays status pill when hovered/multiselect) */}
      {(multiSelect || hovered) && (
        <div
          className="absolute top-1.5 left-1.5 z-10"
          onClick={(e) => {
            e.stopPropagation()
            onSelect?.(asset, { index, shiftKey: e.shiftKey, metaKey: e.metaKey || e.ctrlKey })
          }}
        >
          <div
            className={`h-5 w-5 rounded border-2 flex items-center justify-center transition-colors ${
              isSelected
                ? 'bg-primary border-primary'
                : 'bg-white/90 border-white/80 hover:border-primary'
            }`}
          >
            {isSelected && <Check className="h-3 w-3 text-white" />}
          </div>
        </div>
      )}

      {/* Clinician initial badge — bottom left */}
      {asset.created_by && (
        <div className="absolute bottom-6 left-1.5 z-10" title={`Uploaded by: ${asset.created_by}`}>
          <div className="bg-indigo-600 text-white text-3xs font-bold rounded-full w-5 h-5 flex items-center justify-center leading-none">
            {createdByInitials}
          </div>
        </div>
      )}

      {/* Lifecycle / usage badge — bottom right. When the consumer injects a
          _lifecycle marker (Library view), we render a lifecycle-aware chip
          (NEW / ● active / ✓ shipped). Otherwise we fall back to the raw
          usage count so the badge still has meaning in callers that don't
          opt into lifecycle (e.g. asset picker drawers). */}
      <div className="absolute bottom-6 right-1.5 z-10">
        {asset._lifecycle === 'new' && (
          <span className="text-3xs bg-blue-600 text-white px-1.5 py-0.5 rounded-full leading-none">
            NEW
          </span>
        )}
        {asset._lifecycle === 'in_pipeline' && firstStoryId && (
          <button
            className="text-3xs bg-success text-white px-1.5 py-0.5 rounded-full leading-none hover:bg-success/90 transition-colors"
            title={usageCount === 1 ? 'In 1 active post — click to open' : `In ${usageCount} active posts — click to open the first`}
            onClick={(e) => {
              e.stopPropagation()
              navigate(`/stories/${firstStoryId}`)
            }}
          >
            ● {usageCount}
          </button>
        )}
        {asset._lifecycle === 'shipped' && firstStoryId && (
          <button
            className="text-3xs bg-slate-700 text-white px-1.5 py-0.5 rounded-full leading-none hover:bg-slate-600 transition-colors"
            title="Already published — click to open the post"
            onClick={(e) => {
              e.stopPropagation()
              navigate(`/stories/${firstStoryId}`)
            }}
          >
            ✓ shipped
          </button>
        )}
        {!asset._lifecycle && (
          firstStoryId ? (
            <button
              className="text-3xs bg-success text-white px-1.5 py-0.5 rounded-full leading-none hover:bg-success/90 transition-colors"
              title={usageCount === 1 ? 'Used in 1 story — click to open' : `Used in ${usageCount} stories — click to open the first`}
              onClick={(e) => {
                e.stopPropagation()
                navigate(`/stories/${firstStoryId}`)
              }}
            >
              used ×{usageCount}
            </button>
          ) : (
            <span className="text-3xs bg-black/40 text-white/70 px-1.5 py-0.5 rounded-full leading-none">
              ×0
            </span>
          )
        )}
      </div>

      {/* Selected overlay */}
      {isSelected && (
        <div className="absolute inset-0 bg-primary/20 pointer-events-none" />
      )}

      {/* Hover overlay with quick actions */}
      {hovered && !multiSelect && (
        <div className="absolute inset-0 bg-black/40 flex flex-col items-end justify-start p-1.5 gap-1 z-20 pointer-events-none">
          <button
            className="pointer-events-auto h-6 w-6 rounded bg-white/90 flex items-center justify-center hover:bg-white transition-colors"
            title="Download"
            onClick={(e) => quickDownload(e, asset)}
          >
            <Download className="h-3.5 w-3.5 text-slate-700" />
          </button>
          <button
            className="pointer-events-auto h-6 w-6 rounded bg-white/90 flex items-center justify-center hover:bg-white transition-colors"
            title="Copy link"
            onClick={(e) => quickCopyLink(e, asset)}
          >
            <Link2 className="h-3.5 w-3.5 text-slate-700" />
          </button>
        </div>
      )}

      {/* Filename caption */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent text-white text-3xs px-1.5 py-1 leading-tight truncate" title={asset.filename}>
        {asset.filename}
      </div>
    </button>
  )
}

export default function MediaGrid({ assets, selectedId, onSelect, multiSelect = false, selectedIds = [] }) {
  // Hooks must come before the early return below (Rules of Hooks).
  const cols = useColumnCount()
  // Button refs keyed by index so the keyboard navigator can call .focus()
  // on the new target. Array is rebuilt on every render — refs themselves
  // are stable across re-renders for the same index.
  const buttonRefs = useRef([])

  // Roving tabindex: only one item is tab-focusable at a time so a Tab from
  // the search field lands on the selected/first item rather than walking
  // through all N. ArrowKeys move within the grid from there.
  const [focusedIndex, setFocusedIndex] = useState(() => {
    if (!assets?.length) return 0
    if (multiSelect) return selectedIds.length ? assets.findIndex(a => a.id === selectedIds[0]) : 0
    return selectedId ? Math.max(0, assets.findIndex(a => a.id === selectedId)) : 0
  })

  // Keep focusedIndex in bounds when the asset list shrinks (e.g. archive
  // removes the row). Without this, an out-of-range index would orphan focus.
  useEffect(() => {
    if (focusedIndex >= (assets?.length ?? 0)) setFocusedIndex(Math.max(0, (assets?.length ?? 1) - 1))
  }, [assets?.length, focusedIndex])

  // The MediaHub renders its own empty state above us now (with proper coaching
  // and CTAs) — this fallback is just a safety net for any other caller.
  if (!assets?.length) return null

  function focusAt(nextIndex) {
    const clamped = Math.max(0, Math.min(assets.length - 1, nextIndex))
    setFocusedIndex(clamped)
    buttonRefs.current[clamped]?.focus()
  }

  function handleKeyDown(e) {
    // Inside the grid only — child buttons own arrow/Home/End. Enter/Space is
    // native <button> activation, so we don't need to handle it here.
    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault()
        focusAt(focusedIndex + 1)
        return
      case 'ArrowLeft':
        e.preventDefault()
        focusAt(focusedIndex - 1)
        return
      case 'ArrowDown':
        e.preventDefault()
        focusAt(focusedIndex + cols)
        return
      case 'ArrowUp':
        e.preventDefault()
        focusAt(focusedIndex - cols)
        return
      case 'Home':
        e.preventDefault()
        focusAt(0)
        return
      case 'End':
        e.preventDefault()
        focusAt(assets.length - 1)
        return
      default:
        return
    }
  }

  return (
    <div
      role="grid"
      onKeyDown={handleKeyDown}
      className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2"
    >
      {assets.map((a, index) => {
        const isSelected = multiSelect ? selectedIds.includes(a.id) : selectedId === a.id
        const isFocused = index === focusedIndex
        return (
          <GridCell
            key={a.id}
            asset={a}
            index={index}
            isSelected={isSelected}
            isFocused={isFocused}
            multiSelect={multiSelect}
            onSelect={(asset, meta) => {
              if (typeof meta?.index === 'number') setFocusedIndex(meta.index)
              onSelect?.(asset, meta)
            }}
            buttonRef={(el) => { buttonRefs.current[index] = el }}
          />
        )
      })}
    </div>
  )
}

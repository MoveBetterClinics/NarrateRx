import { Video, Image as ImageIcon, Play, Check } from 'lucide-react'

const STATUS_LABEL = {
  raw:      { label: 'Raw',      tone: 'bg-slate-200 text-slate-700' },
  tagged:   { label: 'Tagged',   tone: 'bg-blue-100 text-blue-700' },
  rendered: { label: 'Rendered', tone: 'bg-violet-100 text-violet-700' },
  approved: { label: 'Approved', tone: 'bg-emerald-100 text-emerald-700' },
  archived: { label: 'Archived', tone: 'bg-muted text-muted-foreground' },
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
          <span className="text-[9px] text-slate-400 text-center leading-tight line-clamp-3">{asset.filename}</span>
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
  } catch {}
}

export default function MediaGrid({ assets, selectedId, onSelect, multiSelect = false, selectedIds = [] }) {
  // The MediaHub renders its own empty state above us now (with proper coaching
  // and CTAs) — this fallback is just a safety net for any other caller.
  if (!assets?.length) return null

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
      {assets.map((a, index) => {
        const isSelected = multiSelect ? selectedIds.includes(a.id) : selectedId === a.id
        const statusMeta = STATUS_LABEL[a.status] || STATUS_LABEL.raw
        return (
          <button
            key={a.id}
            onClick={(e) => onSelect?.(a, { index, shiftKey: e.shiftKey, metaKey: e.metaKey || e.ctrlKey })}
            draggable
            onDragStart={(e) => handleDragStart(e, a)}
            title={`${a.filename} — click to open, or drag into another browser tab to upload it there`}
            className={`relative rounded-lg overflow-hidden border-2 aspect-square transition-all text-left ${
              isSelected ? 'border-primary' : 'border-transparent hover:border-muted-foreground/30'
            }`}
          >
            <Thumb asset={a} />

            {/* Status pill */}
            <div className="absolute top-1.5 left-1.5">
              <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${statusMeta.tone}`}>
                {statusMeta.label}
              </span>
            </div>

            {isSelected && (
              <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                <div className="h-7 w-7 rounded-full bg-primary flex items-center justify-center">
                  <Check className="h-4 w-4 text-white" />
                </div>
              </div>
            )}

            {/* Filename caption */}
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent text-white text-[10px] px-1.5 py-1 leading-tight truncate">
              {a.filename}
            </div>
          </button>
        )
      })}
    </div>
  )
}

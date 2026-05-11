import { useState, useEffect, useRef } from 'react'
import { useUser } from '@clerk/clerk-react'
import { Search, X, Loader2, Image, Video, Upload, Check, Play, Library } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { listMedia, uploadMedia } from '@/lib/mediaLib'

// Picker for attaching media to a post. Two tabs:
//   1. Library — the Media Hub (Vercel Blob + media_assets), the canonical home.
//   2. Upload  — fresh upload that lands in the same library.
//
// The previous "Google Drive" tab and its proxy paths were removed when the
// Drive integration was retired (2026-05-08). The one-shot importer that
// moved local Drive-mirror files into the Media Hub has also been removed;
// all migrated files are reachable through the Library tab.

export default function MediaPicker({ onSelect, onClose }) {
  const { user } = useUser()
  const [tab, setTab]         = useState('library')
  const [query, setQuery]     = useState('')
  const [selected, setSelected] = useState(null)
  const [libraryItems, setLibraryItems] = useState([])
  const [libraryLoading, setLibraryLoading] = useState(false)
  const [libraryError, setLibraryError] = useState('')
  const [uploading, setUploading]    = useState(false)
  const [uploadError, setUploadError] = useState('')
  const fileInputRef = useRef(null)
  const debounceRef  = useRef(null)

  async function loadLibrary({ q = '' } = {}) {
    setLibraryLoading(true); setLibraryError('')
    setSelected(null)
    try {
      const rows = await listMedia({ q: q || undefined, limit: 120 })
      setLibraryItems(rows)
    } catch (e) {
      setLibraryError(e.message)
    } finally {
      setLibraryLoading(false)
    }
  }

  useEffect(() => {
    if (tab === 'library') loadLibrary({ q: query })
    // intentionally not depending on `query` — the input handler debounces.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  function handleQueryChange(e) {
    const val = e.target.value
    setQuery(val)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      if (tab === 'library') loadLibrary({ q: val })
    }, 400)
  }

  async function handleUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true); setUploadError('')
    try {
      const blob = await uploadMedia(file, { createdBy: user?.id || null })
      const isVideo = (file.type || blob.contentType || '').startsWith('video')
      onSelect({
        id:           crypto.randomUUID(),
        name:         file.name,
        mimeType:     file.type || blob.contentType,
        kind:         isVideo ? 'video' : 'image',
        type:         isVideo ? 'video' : 'image',
        thumbnailUrl: isVideo ? null : blob.url,
        url:          blob.url,
        size:         file.size,
      })
    } catch (err) {
      setUploadError(err.message || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  function selectLibraryAsset(asset) {
    const isVideo = asset.kind === 'video'
    const url     = asset.rendered_url || asset.blob_url
    onSelect({
      id:           asset.id,
      name:         asset.filename,
      mimeType:     asset.mime_type,
      kind:         isVideo ? 'video' : 'image',
      type:         isVideo ? 'video' : 'image',
      thumbnailUrl: asset.thumbnail_url || (isVideo ? null : url),
      url,
      size:         asset.size_bytes || undefined,
      mediaAssetId: asset.id,
    })
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-background rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <h2 className="font-semibold">Add Media</h2>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>

        {/* Tabs */}
        <div className="flex border-b px-5 shrink-0">
          {[
            { id: 'library', label: 'Library', icon: Library },
            { id: 'upload',  label: 'Upload',  icon: Upload },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 px-3 py-3 text-sm border-b-2 transition-colors -mb-px ${
                tab === id
                  ? 'border-primary text-foreground font-medium'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />{label}
            </button>
          ))}
        </div>

        {tab === 'library' && (
          <>
            {/* Search */}
            <div className="px-5 pt-3 pb-2 border-b shrink-0">
              <div className="relative">
                <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={handleQueryChange}
                  placeholder="Search your media library…"
                  className="pl-8 pr-8 h-8 text-sm"
                />
                {query && (
                  <button
                    onClick={() => { setQuery(''); loadLibrary({ q: '' }) }}
                    className="absolute right-2.5 top-2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Grid */}
            <div className="flex-1 min-h-0 overflow-y-auto px-5 py-3">
              {libraryError ? (
                <div className="text-sm text-destructive bg-destructive/10 rounded-lg p-3 text-center">{libraryError}</div>
              ) : libraryLoading && libraryItems.length === 0 ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : libraryItems.length === 0 ? (
                <div className="text-center py-16 text-muted-foreground text-sm">
                  No media in your library yet. Use the Upload tab or visit the Media page to add some.
                </div>
              ) : (
                <div className="grid grid-cols-4 gap-2">
                  {libraryItems.map((a) => {
                    const isSelected = selected?.id === a.id
                    const previewSrc = a.thumbnail_url || (a.kind === 'photo' ? (a.rendered_url || a.blob_url) : null)
                    return (
                      <button
                        key={a.id}
                        onClick={() => setSelected(isSelected ? null : a)}
                        className={`relative rounded-lg overflow-hidden border-2 aspect-square transition-all ${
                          isSelected ? 'border-primary' : 'border-transparent hover:border-muted-foreground/30'
                        }`}
                      >
                        {a.kind === 'video' ? (
                          <div className="relative h-full w-full">
                            {previewSrc ? (
                              <img src={previewSrc} alt={a.filename} className="w-full h-full object-cover" />
                            ) : (
                              <div className="h-full bg-slate-800 flex flex-col items-center justify-center gap-1 px-1">
                                <Video className="h-6 w-6 text-slate-400 shrink-0" />
                                <span className="text-[9px] text-slate-400 text-center leading-tight line-clamp-3">{a.filename}</span>
                              </div>
                            )}
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                              <div className="h-8 w-8 rounded-full bg-black/55 flex items-center justify-center">
                                <Play className="h-4 w-4 text-white ml-0.5" />
                              </div>
                            </div>
                          </div>
                        ) : previewSrc ? (
                          <img src={previewSrc} alt={a.filename} className="w-full h-full object-cover" />
                        ) : (
                          <div className="h-full bg-muted flex items-center justify-center">
                            <Image className="h-6 w-6 text-muted-foreground" />
                          </div>
                        )}

                        {a.status === 'rendered' || a.status === 'approved' ? (
                          <span className="absolute top-1.5 left-1.5 text-[9px] font-medium px-1.5 py-0.5 rounded bg-violet-100 text-violet-700">
                            {a.status === 'approved' ? 'Approved' : 'Branded'}
                          </span>
                        ) : null}

                        {isSelected && (
                          <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                            <div className="h-7 w-7 rounded-full bg-primary flex items-center justify-center">
                              <Check className="h-4 w-4 text-white" />
                            </div>
                          </div>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t flex items-center justify-between shrink-0">
              <p className="text-xs text-muted-foreground truncate max-w-[55%]">
                {selected ? `Selected: ${selected.filename || selected.name}` : 'Pick a file from your library'}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
                <Button
                  size="sm"
                  onClick={() => selected && selectLibraryAsset(selected)}
                  disabled={!selected}
                >
                  Use This File
                </Button>
              </div>
            </div>
          </>
        )}

        {tab === 'upload' && (
          <div className="flex-1 flex flex-col items-center justify-center p-8 gap-4">
            <div
              onClick={() => !uploading && fileInputRef.current?.click()}
              className={`w-full border-2 border-dashed rounded-xl p-12 text-center transition-colors ${
                uploading
                  ? 'cursor-wait opacity-70'
                  : 'cursor-pointer hover:border-primary/50 hover:bg-accent/20'
              }`}
            >
              {uploading ? (
                <Loader2 className="h-10 w-10 text-muted-foreground/60 mx-auto mb-3 animate-spin" />
              ) : (
                <Upload className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
              )}
              <p className="text-sm font-medium mb-1">
                {uploading ? 'Uploading…' : 'Click to upload a photo or video'}
              </p>
              <p className="text-xs text-muted-foreground">
                {uploading ? 'Saving to your media library' : 'JPG, PNG, HEIC, MP4, MOV — saved to your library and added to this post'}
              </p>
            </div>
            {uploadError && (
              <div className="text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2 max-w-md text-center">
                {uploadError}
              </div>
            )}
            <input ref={fileInputRef} type="file" accept="image/*,video/*" className="hidden" onChange={handleUpload} />
            <Button variant="outline" size="sm" onClick={onClose} disabled={uploading}>Cancel</Button>
          </div>
        )}

      </div>
    </div>
  )
}

import { useState, useEffect, useCallback, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Archive, ArchiveRestore, X, Trash2, Loader2, Plus, Sparkles, AlertTriangle, FilePlus2, Wand2, Link2, Download, Check, Image as ImageIcon, Crop, Expand, Minimize, RotateCw, RotateCcw, FileDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  getMediaAsset,
  updateMediaAsset,
  archiveMediaAsset,
  restoreMediaAsset,
  purgeMediaAsset,
  tagMediaAsset,
  regenerateThumbnail,
  listVariants,
  editMediaAsset,
} from '@/lib/mediaLib'
import { listContentPieces, createContentPiece, segmentMediaAsset } from '@/lib/contentLib'
import { useStaffSummaries } from '@/lib/queries'
import { useUserRole } from '@/lib/useUserRole'
import { toast, runWithToast } from '@/lib/toast'
import ContentBriefDetail from './ContentBriefDetail'
import ClipFinder from './ClipFinder'
import WholeVideoAction from './WholeVideoAction'
import CollectionPicker from './CollectionPicker'
import MediaEditModal from './MediaEditModal'
import MediaVideoPlayer from './MediaVideoPlayer'

const STATUSES = ['raw', 'tagged', 'rendered', 'approved', 'archived']
// Purpose is the primary fork (see MediaUploader for the source of truth).
// Detail drawer lets admins/editors re-classify if an upload landed on the
// wrong purpose — flipping out of 'interview' clears speaker_role server-side
// so the segmenter eligibility check stays honest.
const PURPOSES = [
  { id: 'interview', label: 'Interview' },
  { id: 'broll',     label: 'B-roll' },
  { id: 'photo',     label: 'Photo' },
  { id: 'brand',     label: 'Brand asset' },
]
const SPEAKER_ROLES = [
  { id: 'clinician',     label: 'Clinician' },
  { id: 'admin',         label: 'Admin staff' },
  { id: 'patient_guest', label: 'Patient guest' },
]

// Default purpose for legacy rows or asset types whose backfill we don't
// trust. Videos default to interview (matches migration 024 backfill), photos
// to photo.
function defaultPurposeFor(asset) {
  if (asset.asset_purpose) return asset.asset_purpose
  return asset.kind === 'video' ? 'interview' : 'photo'
}
const PURGE_COOLDOWN_DAYS = 30

function daysSince(iso) {
  if (!iso) return null
  return (Date.now() - new Date(iso).getTime()) / 86_400_000
}

// Signal that the server pipeline finished:
//  - photos: imagePipeline.js PATCHes web_blob_url when sharp resize succeeds
//  - videos: Mux webhook flips transcode_status to 'ready'
// Anything else is still in flight (or never started — legacy rows).
function pipelinePending(a) {
  if (!a) return false
  if (a.kind === 'photo') return !a.web_blob_url
  if (a.kind === 'video') {
    const s = a.transcode_status
    return !s || s === 'pending' || s === 'processing'
  }
  return false
}

// Pull the file extension off the original blob URL pathname so the download
// button can advertise the source format (HEIC, ARW, etc.) accurately.
function originalExt(url) {
  if (!url) return null
  try {
    const path = new URL(url).pathname
    const m = path.match(/\.([a-z0-9]+)$/i)
    return m ? m[1].toUpperCase() : null
  } catch { return null }
}

// Detail/edit drawer for a single media asset.
// `asset` is the row, `onClose` dismisses, `onChange` is called after save/delete.
export default function MediaDetail({ asset, onClose, onChange }) {
  const [tags, setTags]         = useState(asset.tags || [])
  const [tagInput, setTagInput] = useState('')
  const [notes, setNotes]       = useState(asset.notes || '')
  const [altText, setAltText]   = useState(asset.alt_text || '')
  const [patient, setPatient]   = useState(asset.patient_pseudonym || '')
  const [condition, setCondition] = useState(asset.condition || '')
  const [status, setStatus]     = useState(asset.status || 'raw')
  const [assetPurpose, setAssetPurpose] = useState(defaultPurposeFor(asset))
  const [speakerRole, setSpeakerRole] = useState(asset.speaker_role || 'clinician')
  const [staffId, setStaffId] = useState(asset.staff_id || '')
  const [aiTags, setAiTags]     = useState(asset.ai_tags || [])
  const [transcription, setTranscription] = useState(asset.transcription || '')
  const [visualNarrative, setVisualNarrative] = useState(asset.visual_narrative || '')
  const [saving, setSaving]     = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [purging, setPurging]   = useState(false)
  const [purgeConfirm, setPurgeConfirm] = useState('')
  const [showPurge, setShowPurge] = useState(false)
  const [tagging, setTagging]   = useState(false)
  const [thumbing, setThumbing] = useState(false)
  const [segmenting, setSegmenting] = useState(false)
  const [creatingBrief, setCreatingBrief] = useState(false)
  const [error, setError]       = useState('')
  const [linkedBriefs, setLinkedBriefs] = useState([])
  const [openBrief, setOpenBrief] = useState(null)
  const [copied, setCopied] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [variants, setVariants] = useState([])
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [rotatingQuick, setRotatingQuick] = useState(false)
  const [downloadingOriginal, setDownloadingOriginal] = useState(false)

  const { canEdit, canArchive, canRestore, canPurge } = useUserRole()

  // Workspace-scoped staff roster. useStaffSummaries hits
  // /api/db/staff?view=card which resolves workspace from the Clerk
  // token — no client-side workspace filtering needed.
  const { data: staffRows = [] } = useStaffSummaries()
  const staff = Array.isArray(staffRows) ? staffRows : []
  const currentStaff = staff.find((c) => c.id === (asset.staff_id || ''))

  // Track when polling started for this asset, so we can cap at ~60s even if
  // the pipeline silently errored. Resets on asset.id change via the effect
  // below that already reseeds form state.
  const pollStartRef = useRef(Date.now())

  // Poll the row until the pipeline lands. The list view refetches on
  // upload-done, but the detail drawer doesn't see that signal — so without
  // this, opening the drawer immediately after upload shows a stale row
  // (status='raw', broken HEIC preview) until a manual refresh.
  const { data: liveAsset } = useQuery({
    queryKey: ['media-asset', asset.id],
    queryFn: () => getMediaAsset(asset.id),
    initialData: asset,
    refetchInterval: (q) => {
      const row = q.state.data
      if (!pipelinePending(row)) return false
      if (Date.now() - pollStartRef.current > 60_000) return false
      return 2000
    },
    refetchOnWindowFocus: false,
  })

  // Use the freshest copy for rendered URLs / pipeline status. Editable form
  // state stays seeded from the original `asset` prop (see asset.id effect
  // below) so in-progress edits aren't clobbered by a poll round-trip.
  const a = liveAsset || asset
  const isOptimizing = pipelinePending(a)

  // When the pipeline finishes mid-drawer, let the parent list refresh too so
  // the grid thumb stops looking stale. Edge-triggered on the pending→ready
  // transition only.
  const wasOptimizingRef = useRef(isOptimizing)
  useEffect(() => {
    if (wasOptimizingRef.current && !isOptimizing) onChange?.()
    wasOptimizingRef.current = isOptimizing
  }, [isOptimizing, onChange])

  const isArchived  = asset.status === 'archived'
  const archivedAge = daysSince(asset.archived_at)
  const cooldownLeft = archivedAge != null
    ? Math.max(0, Math.ceil(PURGE_COOLDOWN_DAYS - archivedAge))
    : PURGE_COOLDOWN_DAYS
  const purgeReady  = isArchived && asset.archived_at && cooldownLeft === 0 && canPurge

  // Sync local state if a different asset is loaded into the same drawer.
  // Intentional: reseeds ONLY on asset.id change. Listing every asset.* field
  // here would clobber in-progress user edits the moment an autosave round-trip
  // refreshes the upstream object.
  useEffect(() => {
    setTags(asset.tags || [])
    setNotes(asset.notes || '')
    setAltText(asset.alt_text || '')
    setPatient(asset.patient_pseudonym || '')
    setCondition(asset.condition || '')
    setStatus(asset.status || 'raw')
    setAssetPurpose(asset.asset_purpose || (asset.kind === 'video' ? 'interview' : 'photo'))
    setSpeakerRole(asset.speaker_role || 'clinician')
    setStaffId(asset.staff_id || '')
    setAiTags(asset.ai_tags || [])
    setTranscription(asset.transcription || '')
    setVisualNarrative(asset.visual_narrative || '')
    setTagInput('')
    setError('')
    setShowPurge(false)
    setPurgeConfirm('')
    pollStartRef.current = Date.now()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset.id])

  const refreshBriefs = useCallback(async () => {
    try {
      const rows = await listContentPieces({ sourceId: asset.id, limit: 50 })
      setLinkedBriefs(rows)
    } catch { /* empty */ }
  }, [asset.id])

  // Fetch variants whose parent is this asset. Includes only rows the user
  // produced via Edit (variant_label IS NOT NULL is enforced server-side via
  // the list filter — the API returns whatever parent_id matches, so we filter
  // here to keep this strip focused on rotation/crop variants and not other
  // child rows like CapCut return-uploads).
  const refreshVariants = useCallback(async () => {
    if (asset.parent_id) {
      // Variants of a variant don't render their own strip — keep the model flat.
      setVariants([])
      return
    }
    try {
      const rows = await listVariants(asset.id)
      setVariants((rows || []).filter((r) => r.variant_label))
    } catch { /* empty */ }
  }, [asset.id, asset.parent_id])

  useEffect(() => { refreshBriefs() }, [refreshBriefs])
  useEffect(() => { refreshVariants() }, [refreshVariants])

  // 90 CW / 270 CW (= 90 CCW). API constrains to {0, 90, 180, 270}.
  async function handleQuickRotate(degrees) {
    setRotatingQuick(true)
    try {
      await editMediaAsset(asset.id, { rotate: degrees, crop: null, mode: 'replace-master' })
      toast.success('Rotated', { description: 'Original updated in place.' })
      onChange?.()
      refreshVariants()
    } catch (e) {
      toast.error('Rotate failed', { description: e.message })
    } finally {
      setRotatingQuick(false)
    }
  }

  function addTag() {
    const t = tagInput.trim().toLowerCase()
    if (!t || tags.includes(t)) { setTagInput(''); return }
    setTags([...tags, t])
    setTagInput('')
  }
  function removeTag(t)   { setTags(tags.filter((x) => x !== t)) }
  function removeAiTag(t) { setAiTags(aiTags.filter((x) => x !== t)) }
  function promoteAiTag(t) {
    // AI suggestion → committed user tag. Dedupe against existing user tags
    // and drop from the AI suggestion list so it doesn't render twice.
    if (!tags.includes(t)) setTags([...tags, t])
    setAiTags(aiTags.filter((x) => x !== t))
  }

  async function save() {
    setSaving(true); setError('')
    try {
      await updateMediaAsset(asset.id, {
        tags, aiTags, notes, altText, patientPseudonym: patient, condition, status,
        assetPurpose,
        // Server enforces speaker_role=null when purpose != interview, but
        // mirror the rule client-side so the optimistic state stays accurate.
        speakerRole: assetPurpose === 'interview' ? speakerRole : null,
        staffId: staffId || null,
      })
      toast.success('Media details saved')
      onChange?.()
      onClose?.()
    } catch (e) {
      setError(e.message)
      toast.error('Save failed', { description: e.message })
    } finally {
      setSaving(false)
    }
  }

  async function handleTag() {
    setTagging(true); setError('')
    try {
      const updated = await runWithToast(tagMediaAsset(asset.id), {
        loading: asset.kind === 'video'
          ? 'Tagging with AI… (10–60s for video)'
          : 'Tagging with AI…',
        success: 'Tagged with AI',
        error: (e) => ({ message: 'Tagging failed', description: e.message }),
      })
      if (updated) {
        setAiTags(updated.ai_tags || [])
        if (updated.transcription !== undefined) setTranscription(updated.transcription || '')
        if (updated.visual_narrative !== undefined) setVisualNarrative(updated.visual_narrative || '')
        if (updated.status) setStatus(updated.status)
      }
      onChange?.()
    } catch (e) {
      setError(e.message)
    } finally {
      setTagging(false)
    }
  }

  async function handleRegenerateThumbnail() {
    setThumbing(true); setError('')
    try {
      await runWithToast(regenerateThumbnail(asset.id), {
        loading: 'Regenerating thumbnail…',
        success: 'Thumbnail updated',
        error: (e) => ({ message: 'Thumbnail failed', description: e.message }),
      })
      onChange?.()
    } catch (e) {
      setError(e.message)
    } finally {
      setThumbing(false)
    }
  }

  async function handleSegment() {
    setSegmenting(true); setError('')
    try {
      await runWithToast(segmentMediaAsset(asset.id), {
        loading: 'Segmenting… this can take a few minutes',
        success: 'Segmenter finished',
        error: (e) => ({ message: 'Segmenting failed', description: e.message }),
      })
      await refreshBriefs()
      onChange?.()
    } catch (e) {
      setError(e.message)
    } finally {
      setSegmenting(false)
    }
  }

  async function handleNewBrief() {
    setCreatingBrief(true); setError('')
    try {
      const piece = await createContentPiece({
        sourceAssetId: asset.id,
        sourceQuote: '',
        caption: '',
        targetPlatform: '',
      })
      await refreshBriefs()
      onChange?.()
      if (piece?.id) setOpenBrief(piece)
    } catch (e) {
      setError(e.message)
    } finally {
      setCreatingBrief(false)
    }
  }

  async function handleArchive() {
    if (!confirm(`Move "${asset.filename}" to archive? It will be hidden from the library but kept in storage. You can restore it any time.`)) return
    setArchiving(true); setError('')
    try {
      await archiveMediaAsset(asset.id)
      onClose?.()
      onChange?.()
    } catch (e) {
      setError(e.message)
      setArchiving(false)
    }
  }

  async function handleRestore() {
    setRestoring(true); setError('')
    try {
      await restoreMediaAsset(asset.id, asset.ai_tags?.length ? 'tagged' : 'raw')
      onClose?.()
      onChange?.()
    } catch (e) {
      setError(e.message)
      setRestoring(false)
    }
  }

  async function handlePurge() {
    if (purgeConfirm !== asset.filename) {
      setError('Filename does not match — type the exact filename to confirm.')
      return
    }
    setPurging(true); setError('')
    try {
      await purgeMediaAsset(asset.id, purgeConfirm)
      onClose?.()
      onChange?.()
    } catch (e) {
      setError(e.message)
      setPurging(false)
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(a.blob_url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setError('Could not copy link — try selecting the URL manually.')
    }
  }

  // Cross-origin <a download> doesn't reliably trigger a save in browsers, so
  // fetch the blob first and create an object URL. Vercel Blob public URLs are
  // CORS-enabled, so this works without a proxy.
  async function downloadFromUrl(url, filename) {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Fetch failed (${res.status})`)
    const blob = await res.blob()
    const objUrl = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = objUrl
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(objUrl)
  }

  async function downloadAsset() {
    setDownloading(true); setError('')
    try {
      await downloadFromUrl(a.blob_url, a.filename)
    } catch (e) {
      setError(e.message || 'Download failed.')
    } finally {
      setDownloading(false)
    }
  }

  async function downloadOriginal() {
    if (!a.original_blob_url) return
    setDownloadingOriginal(true); setError('')
    try {
      await downloadFromUrl(a.original_blob_url, a.filename)
    } catch (e) {
      setError(e.message || 'Download failed.')
    } finally {
      setDownloadingOriginal(false)
    }
  }

  const hasOriginal = !!a.original_blob_url && a.original_blob_url !== a.blob_url
  const originalLabel = originalExt(a.original_blob_url) || 'original format'

  // Segmenter only runs on interview-purpose video (server enforces the same
  // gate in segmentInterview.js). Disable the button up-front so B-roll /
  // photo / brand drawers don't surface an action that would no-op server-side.
  const canSegment = asset.kind === 'video'
    && assetPurpose === 'interview'
    && (transcription || visualNarrative)

  return (
    <div className={`fixed inset-0 z-50 bg-black/60 flex items-center justify-center ${isFullscreen ? 'p-0' : 'p-4'}`}>
      <div className={`bg-background shadow-2xl w-full flex flex-col ${isFullscreen ? 'w-screen h-screen' : 'rounded-xl max-w-full sm:max-w-3xl max-h-[90vh]'}`}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b shrink-0">
          <h2 className="font-semibold text-sm truncate pr-2" title={asset.filename}>{asset.filename}</h2>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={() => setIsFullscreen(v => !v)} title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
              {isFullscreen ? <Minimize className="h-4 w-4" /> : <Expand className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
          </div>
        </div>

        {showEdit && isFullscreen ? (
          <MediaEditModal
            inline
            asset={asset}
            onClose={() => setShowEdit(false)}
            onSaved={() => { refreshVariants(); onChange?.() }}
          />
        ) : (<>
        <div className="flex-1 overflow-y-auto">
          {/* Player / preview */}
          {a.kind === 'video' ? (
            <MediaVideoPlayer asset={a} />
          ) : (
            <div className="relative bg-black flex items-center justify-center" style={{ minHeight: 240 }}>
              <img
                src={a.blob_url}
                alt={a.alt_text || a.filename}
                className="max-h-[60vh] max-w-full cursor-grab active:cursor-grabbing"
                draggable
                title="Drag this image into another browser tab to upload it there, or use Copy / Download below."
              />
              {isOptimizing && (
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/70 text-white text-2xs">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Optimizing for web…
                </div>
              )}
            </div>
          )}

          {/* Use elsewhere — copy link, download, or drag the preview to
              another browser tab's upload widget. The whole point of Media
              Hub is being the canonical home for media; this row is the
              bridge to tools whose file pickers can't see Vercel Blob. */}
          <div className="px-5 pt-4 -mb-1 flex items-center gap-2 flex-wrap">
            <span className="text-2xs text-muted-foreground mr-1">Use elsewhere:</span>
            <Button
              size="sm"
              variant="outline"
              onClick={copyLink}
              className="h-7 gap-1.5 text-2xs"
              title="Copy the public Vercel Blob URL for this asset"
            >
              {copied
                ? <><Check className="h-3.5 w-3.5 text-green-600" /> Copied</>
                : <><Link2 className="h-3.5 w-3.5" /> Copy link</>}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={downloadAsset}
              disabled={downloading}
              className="h-7 gap-1.5 text-2xs"
              title="Download to your computer with the original filename"
            >
              {downloading
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Download className="h-3.5 w-3.5" />}
              Download
            </Button>
            {hasOriginal && (
              <Button
                size="sm"
                variant="outline"
                onClick={downloadOriginal}
                disabled={downloadingOriginal}
                className="h-7 gap-1.5 text-2xs"
                title="The web variant is recommended for embedding. Use the original only when you need the source format — e.g. archival, re-processing, or pixel-perfect editing."
              >
                {downloadingOriginal
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <FileDown className="h-3.5 w-3.5" />}
                Download original ({originalLabel})
              </Button>
            )}
            {asset.kind === 'video' && canEdit && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleRegenerateThumbnail}
                disabled={thumbing}
                className="h-7 gap-1.5 text-2xs"
                title={asset.thumbnail_url
                  ? 'Re-extract poster frame from this video'
                  : 'Extract a poster frame so this video shows a thumbnail in the grid'}
              >
                {thumbing
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <ImageIcon className="h-3.5 w-3.5" />}
                {asset.thumbnail_url ? 'Redo thumbnail' : 'Make thumbnail'}
              </Button>
            )}
            {canEdit && !asset.parent_id && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleQuickRotate(270)}
                  disabled={rotatingQuick}
                  className="h-7 gap-1.5 text-2xs"
                  title="Rotate 90° counter-clockwise — overwrites the original in place"
                  aria-label="Rotate left 90 degrees"
                >
                  {rotatingQuick
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <RotateCcw className="h-3.5 w-3.5" />}
                  Rotate left
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleQuickRotate(90)}
                  disabled={rotatingQuick}
                  className="h-7 gap-1.5 text-2xs"
                  title="Rotate 90° clockwise — overwrites the original in place"
                  aria-label="Rotate right 90 degrees"
                >
                  {rotatingQuick
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <RotateCw className="h-3.5 w-3.5" />}
                  Rotate right
                </Button>
              </>
            )}
            {canEdit && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => { setIsFullscreen(true); setShowEdit(true) }}
                className="h-7 gap-1.5 text-2xs"
                title="Crop this asset — opens fullscreen crop editor"
              >
                <Crop className="h-3.5 w-3.5" />
                Crop
              </Button>
            )}
            {asset.kind === 'photo' && (
              <span className="text-2xs text-muted-foreground">
                · or drag the preview straight into another browser tab
              </span>
            )}
          </div>

          {/* Variant strip — surfaces rotate/crop derivatives of this source.
              Only rendered for masters (parent_id IS NULL) so we don't try to
              show "variants of a variant" — the model is intentionally flat. */}
          {!asset.parent_id && variants.length > 0 && (
            <div className="px-5 pt-3">
              <div className="text-2xs uppercase tracking-wide font-medium text-muted-foreground mb-1.5">
                Variants ({variants.length})
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {variants.map((v) => {
                  const thumb = v.thumbnail_url || (v.kind === 'video' ? null : v.blob_url)
                  return (
                    <div
                      key={v.id}
                      className="shrink-0 w-28 rounded-md border bg-card overflow-hidden"
                      title={v.variant_label || 'Variant'}
                    >
                      <div className="aspect-square bg-muted flex items-center justify-center overflow-hidden">
                        {thumb
                          ? <img src={thumb} alt={v.variant_label || ''} className="h-full w-full object-cover" />
                          : <ImageIcon className="h-5 w-5 text-muted-foreground" />}
                      </div>
                      <div className="px-2 py-1.5 text-3xs truncate">
                        {v.variant_label || 'Variant'}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div className="p-5 space-y-4">
            {!canEdit && !isArchived && (
              <div className="text-2xs text-muted-foreground bg-muted/40 border border-border rounded-md px-3 py-2">
                View-only — your role can browse the library but cannot edit metadata or archive assets. Ask an admin to change your role in Clerk.
              </div>
            )}

            {/* Status + purpose. Speaker role appears below only when purpose
                is 'interview' — it has no meaning for B-roll, photo, or
                brand-asset rows and surfacing it there confused users. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">Status</label>
                <div className="flex flex-wrap gap-1.5">
                  {STATUSES.map((s) => (
                    <button
                      key={s}
                      onClick={() => setStatus(s)}
                      className={`text-2xs px-2.5 py-1 rounded-full border transition-colors ${
                        status === s ? 'bg-primary text-white border-primary' : 'bg-muted text-muted-foreground border-border hover:border-primary/50'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">Asset purpose</label>
                <div className="flex flex-wrap gap-1.5">
                  {PURPOSES.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setAssetPurpose(p.id)}
                      className={`text-2xs px-2.5 py-1 rounded-full border transition-colors ${
                        assetPurpose === p.id ? 'bg-primary text-white border-primary' : 'bg-muted text-muted-foreground border-border hover:border-primary/50'
                      }`}
                      title={p.id === 'interview'
                        ? 'Spoken-on-camera footage — feeds the editor brief queue'
                        : p.id === 'broll'
                          ? 'Video without spoken narrative — tagged for search, no brief queue'
                          : p.id === 'photo'
                            ? 'Still image of the clinic, team, or moment'
                            : 'Logos, headshots, graphics'}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Attributed staff member — drives the video lower-third, Haiku
                caption persona, practice memory, and voice-phrase weaving.
                Unattributed assets fall back to just the workspace name in
                renders, so flag them prominently. */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Attributed to
                </label>
                {!staffId && (
                  <span
                    className="inline-flex items-center gap-1 text-3xs uppercase tracking-wide font-medium px-2 py-0.5 rounded-full bg-warning/15 text-warning border border-warning/30"
                    title="No staff member attached — video renders fall back to the workspace name and AI captions can't apply this staff member's voice."
                  >
                    <AlertTriangle className="h-3 w-3" />
                    Unattributed
                  </span>
                )}
                {staffId && currentStaff && (
                  <span className="text-2xs text-muted-foreground truncate max-w-[60%]" title={currentStaff.name}>
                    {currentStaff.name}
                  </span>
                )}
              </div>
              <select
                value={staffId}
                onChange={(e) => setStaffId(e.target.value)}
                disabled={!canEdit}
                className="text-sm h-8 px-2 rounded-md border border-border bg-background text-foreground w-full sm:max-w-xs"
              >
                <option value="">(unattributed)</option>
                {staff.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            {assetPurpose === 'interview' && (
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">Who&apos;s speaking?</label>
                <select
                  value={speakerRole}
                  onChange={(e) => setSpeakerRole(e.target.value)}
                  className="text-sm h-8 px-2 rounded-md border border-border bg-background text-foreground w-full sm:max-w-xs"
                >
                  {SPEAKER_ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
              </div>
            )}

            {/* Tags */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-muted-foreground">Tags</label>
                {canEdit && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleTag}
                    disabled={tagging}
                    className="h-7 gap-1.5 text-2xs"
                    title={asset.kind === 'video'
                      ? 'Run AI tagging + transcription + visual narrative (10–60s)'
                      : 'Run AI tagging on this image'}
                  >
                    {tagging
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Sparkles className="h-3.5 w-3.5" />}
                    {aiTags.length ? 'Re-tag with AI' : 'Tag with AI'}
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {tags.map((t) => (
                  <Badge key={t} variant="secondary" className="gap-1 cursor-pointer" onClick={() => removeTag(t)}>
                    {t} <X className="h-3 w-3" />
                  </Badge>
                ))}
                {aiTags.length > 0 && (
                  <span
                    className="self-center inline-flex items-center gap-1 text-3xs uppercase tracking-wide font-medium text-violet-700 dark:text-violet-300 ml-1 mr-0.5"
                    title="AI-generated suggestions — click an existing tag chip to remove, or type below to add your own."
                  >
                    <Sparkles className="h-3 w-3" />
                    AI suggested
                  </span>
                )}
                {aiTags.map((t) => (
                  <Badge
                    key={`ai-${t}`}
                    variant="outline"
                    className="gap-1 border-dashed border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300"
                  >
                    {t}
                    <button
                      type="button"
                      onClick={() => promoteAiTag(t)}
                      title="Add to your tags"
                      className="-mr-0.5 rounded-full p-0.5 hover:bg-violet-200 dark:hover:bg-violet-900 transition-colors"
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeAiTag(t)}
                      title="Dismiss this suggestion"
                      className="-mr-0.5 rounded-full p-0.5 hover:bg-violet-200 dark:hover:bg-violet-900 transition-colors"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }}
                  placeholder="Add tag (e.g. shoulder, post-op)"
                  className="h-8 text-sm"
                />
                <Button size="sm" variant="outline" onClick={addTag} disabled={!tagInput.trim()}>
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* Collections — editorial groupings (campaigns, series, etc.) */}
            <CollectionPicker assetId={asset.id} onChange={() => onChange?.()} />

            {/* Two explicit, opt-in video choices — segment vs keep-whole. */}
            {asset.kind === 'video' && (
              <>
                {/* Multi-clip: turn one long source into several standalone clips */}
                <ClipFinder asset={a} canEdit={canEdit} />
                {/* Keep-whole: render the entire source as one landscape package */}
                <WholeVideoAction asset={a} canEdit={canEdit} />
              </>
            )}

            {/* Edit briefs */}
            {asset.kind === 'video' && (
              <div className="rounded-md border p-3 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <div className="text-xs font-medium flex items-center gap-1.5">
                      <Sparkles className="h-3.5 w-3.5 text-primary" />
                      Edit briefs
                      {linkedBriefs.length > 0 && (
                        <Badge variant="secondary" className="text-3xs">{linkedBriefs.length}</Badge>
                      )}
                    </div>
                    <div className="text-2xs text-muted-foreground">
                      Moments AI surfaced (or you added) for this clip.
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    {canEdit && (
                      <>
                        <Button
                          size="sm" variant="outline" onClick={handleSegment}
                          disabled={segmenting || !canSegment}
                          title={
                            assetPurpose !== 'interview'
                              ? 'Only interview-purpose video feeds the segmenter. Switch purpose to Interview to enable.'
                              : canSegment
                                ? 'Re-run AI segmenter on this source'
                                : 'Tag with AI first to enable'
                          }
                          className="h-7 gap-1.5 text-2xs"
                        >
                          {segmenting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                          {linkedBriefs.length ? 'Re-segment' : 'Segment'}
                        </Button>
                        <Button
                          size="sm" variant="outline" onClick={handleNewBrief}
                          disabled={creatingBrief}
                          className="h-7 gap-1.5 text-2xs"
                        >
                          {creatingBrief ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FilePlus2 className="h-3.5 w-3.5" />}
                          New brief
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                {linkedBriefs.length > 0 && (
                  <ul className="divide-y -mx-3">
                    {linkedBriefs.map((b) => (
                      <li
                        key={b.id}
                        onClick={() => setOpenBrief(b)}
                        className="px-3 py-2 hover:bg-muted/40 cursor-pointer flex items-start gap-2"
                      >
                        <Badge variant="outline" className="text-3xs uppercase shrink-0 mt-0.5">{b.status}</Badge>
                        <div className="min-w-0 flex-1 text-xs">
                          <div className="truncate">
                            {b.target_platform && <span className="text-primary mr-1">[{b.target_platform}]</span>}
                            {b.source_quote ? `"${b.source_quote.slice(0, 80)}${b.source_quote.length > 80 ? '…' : ''}"` : '(no quote)'}
                          </div>
                          <div className="text-muted-foreground truncate">
                            {b.final_caption?.slice(0, 100) || b.ai_caption?.slice(0, 100) || '(no caption)'}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* Patient + condition */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">Patient pseudonym</label>
                <Input value={patient} onChange={(e) => setPatient(e.target.value)} placeholder="e.g. R-23, Bella" className="h-8 text-sm" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">Condition</label>
                <Input value={condition} onChange={(e) => setCondition(e.target.value)} placeholder="e.g. low back, stifle" className="h-8 text-sm" />
              </div>
            </div>

            {/* Alt text — first-class metadata for accessibility + publish
                quality. Screen readers and post composers can use this to
                describe the image; falls back to filename when empty. */}
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                Alt text
                <span className="text-muted-foreground/70 font-normal ml-1">
                  · describes what&apos;s in the image for screen readers + captions
                </span>
              </label>
              <Input
                value={altText}
                onChange={(e) => setAltText(e.target.value)}
                placeholder="e.g. Clinician demonstrating a hip hinge with a patient"
                className="h-8 text-sm"
                maxLength={250}
              />
            </div>

            {/* Notes */}
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">Notes</label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Anything else worth remembering about this clip…" className="text-sm" />
            </div>

            {/* Metadata */}
            <div className="text-2xs text-muted-foreground space-y-0.5">
              <div>Uploaded {new Date(asset.created_at).toLocaleString()}</div>
              {asset.size_bytes && <div>{(asset.size_bytes / (1024 * 1024)).toFixed(1)} MB · {asset.mime_type}</div>}
              {asset.parent_id && <div>Edited from another source clip</div>}
              {visualNarrative && (
                <details className="mt-2">
                  <summary className="cursor-pointer hover:text-foreground">View visual narrative</summary>
                  <p className="mt-1 text-foreground whitespace-pre-wrap">{visualNarrative}</p>
                </details>
              )}
              {transcription && (
                <details className="mt-2">
                  <summary className="cursor-pointer hover:text-foreground">View transcription</summary>
                  <p className="mt-1 text-foreground whitespace-pre-wrap">{transcription}</p>
                </details>
              )}
            </div>

            {error && <div className="text-sm text-destructive">{error}</div>}
          </div>
        </div>

        {/* Archived banner with cooldown + purge controls */}
        {isArchived && (
          <div className="px-5 py-3 border-t bg-warning/10 text-warning text-xs flex items-start gap-2 shrink-0">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <div className="flex-1 space-y-2">
              <div>
                Archived {asset.archived_at ? new Date(asset.archived_at).toLocaleDateString() : ''}.
                {' '}
                {cooldownLeft === 0
                  ? <>Cooldown complete{canPurge ? ' — you can permanently delete this asset.' : ' — only admins can permanently delete.'}</>
                  : <>Permanent delete unlocks in <strong>{cooldownLeft} day{cooldownLeft === 1 ? '' : 's'}</strong>{canPurge ? '.' : ' (admin only).'}</>}
              </div>
              {showPurge && purgeReady && (
                <div className="space-y-1.5">
                  <p className="text-amber-950">Type <code className="bg-amber-100 px-1 rounded">{asset.filename}</code> to permanently delete this file. The blob and database row will be erased and cannot be recovered.</p>
                  <Input
                    value={purgeConfirm}
                    onChange={(e) => setPurgeConfirm(e.target.value)}
                    placeholder={asset.filename}
                    className="h-8 text-sm bg-white"
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t shrink-0">
          <div className="flex gap-2">
            {isArchived ? (
              <>
                {canRestore && (
                  <Button variant="outline" size="sm" onClick={handleRestore} disabled={restoring}>
                    {restoring ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <ArchiveRestore className="h-3.5 w-3.5 mr-1.5" />}
                    Restore
                  </Button>
                )}
                {purgeReady && !showPurge && (
                  <Button variant="ghost" size="sm" onClick={() => setShowPurge(true)} className="text-destructive hover:text-destructive">
                    <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                    Permanently delete
                  </Button>
                )}
                {purgeReady && showPurge && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handlePurge}
                    disabled={purging || purgeConfirm !== asset.filename}
                  >
                    {purging && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                    Confirm permanent delete
                  </Button>
                )}
              </>
            ) : (
              canArchive && (
                <Button variant="ghost" size="sm" onClick={handleArchive} disabled={archiving} className="text-destructive hover:text-destructive">
                  {archiving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Archive className="h-3.5 w-3.5 mr-1.5" />}
                  Move to archive
                </Button>
              )
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>{canEdit && !isArchived ? 'Cancel' : 'Close'}</Button>
            {!isArchived && canEdit && (
              <Button size="sm" onClick={save} disabled={saving}>
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                Save
              </Button>
            )}
          </div>
        </div>
        </>)}
      </div>

      {openBrief && (
        <ContentBriefDetail
          brief={openBrief}
          onClose={() => setOpenBrief(null)}
          onChange={() => { refreshBriefs(); onChange?.() }}
        />
      )}

      {showEdit && !isFullscreen && (
        <MediaEditModal
          asset={asset}
          onClose={() => setShowEdit(false)}
          onSaved={() => { refreshVariants(); onChange?.() }}
        />
      )}
    </div>
  )
}

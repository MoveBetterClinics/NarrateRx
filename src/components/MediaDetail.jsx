import { useState, useEffect, useCallback } from 'react'
import { Archive, ArchiveRestore, X, Trash2, Loader2, Plus, Sparkles, AlertTriangle, FilePlus2, Wand2, Link2, Download, Check, Image as ImageIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  updateMediaAsset,
  archiveMediaAsset,
  restoreMediaAsset,
  purgeMediaAsset,
  tagMediaAsset,
  regenerateThumbnail,
} from '@/lib/mediaLib'
import { listContentPieces, createContentPiece, segmentMediaAsset } from '@/lib/contentLib'
import { useUserRole } from '@/lib/useUserRole'
import ContentBriefDetail from './ContentBriefDetail'
import CollectionPicker from './CollectionPicker'

const STATUSES = ['raw', 'tagged', 'rendered', 'approved', 'archived']
const SPEAKER_ROLES = [
  { id: 'clinician',     label: 'Clinician' },
  { id: 'admin',         label: 'Admin staff' },
  { id: 'patient_guest', label: 'Patient guest' },
]
const PURGE_COOLDOWN_DAYS = 30

function daysSince(iso) {
  if (!iso) return null
  return (Date.now() - new Date(iso).getTime()) / 86_400_000
}

// Detail/edit drawer for a single media asset.
// `asset` is the row, `onClose` dismisses, `onChange` is called after save/delete.
export default function MediaDetail({ asset, onClose, onChange }) {
  const [tags, setTags]         = useState(asset.tags || [])
  const [tagInput, setTagInput] = useState('')
  const [notes, setNotes]       = useState(asset.notes || '')
  const [patient, setPatient]   = useState(asset.patient_pseudonym || '')
  const [condition, setCondition] = useState(asset.condition || '')
  const [status, setStatus]     = useState(asset.status || 'raw')
  const [speakerRole, setSpeakerRole] = useState(asset.speaker_role || 'clinician')
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

  const { canEdit, canArchive, canRestore, canPurge } = useUserRole()

  const isArchived  = asset.status === 'archived'
  const archivedAge = daysSince(asset.archived_at)
  const cooldownLeft = archivedAge != null
    ? Math.max(0, Math.ceil(PURGE_COOLDOWN_DAYS - archivedAge))
    : PURGE_COOLDOWN_DAYS
  const purgeReady  = isArchived && asset.archived_at && cooldownLeft === 0 && canPurge

  // Sync local state if a different asset is loaded into the same drawer.
  useEffect(() => {
    setTags(asset.tags || [])
    setNotes(asset.notes || '')
    setPatient(asset.patient_pseudonym || '')
    setCondition(asset.condition || '')
    setStatus(asset.status || 'raw')
    setSpeakerRole(asset.speaker_role || 'clinician')
    setAiTags(asset.ai_tags || [])
    setTranscription(asset.transcription || '')
    setVisualNarrative(asset.visual_narrative || '')
    setTagInput('')
    setError('')
    setShowPurge(false)
    setPurgeConfirm('')
  }, [asset.id])

  const refreshBriefs = useCallback(async () => {
    try {
      const rows = await listContentPieces({ sourceId: asset.id, limit: 50 })
      setLinkedBriefs(rows)
    } catch {}
  }, [asset.id])

  useEffect(() => { refreshBriefs() }, [refreshBriefs])

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
        tags, aiTags, notes, patientPseudonym: patient, condition, status, speakerRole,
      })
      onChange?.()
      onClose?.()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleTag() {
    setTagging(true); setError('')
    try {
      const updated = await tagMediaAsset(asset.id)
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
      await regenerateThumbnail(asset.id)
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
      await segmentMediaAsset(asset.id)
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
      onChange?.()
      onClose?.()
    } catch (e) {
      setError(e.message)
      setArchiving(false)
    }
  }

  async function handleRestore() {
    setRestoring(true); setError('')
    try {
      await restoreMediaAsset(asset.id, asset.ai_tags?.length ? 'tagged' : 'raw')
      onChange?.()
      onClose?.()
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
      onChange?.()
      onClose?.()
    } catch (e) {
      setError(e.message)
      setPurging(false)
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(asset.blob_url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (e) {
      setError('Could not copy link — try selecting the URL manually.')
    }
  }

  // Cross-origin <a download> doesn't reliably trigger a save in browsers, so
  // fetch the blob first and create an object URL. Vercel Blob public URLs are
  // CORS-enabled, so this works without a proxy.
  async function downloadAsset() {
    setDownloading(true); setError('')
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
    } catch (e) {
      setError(e.message || 'Download failed.')
    } finally {
      setDownloading(false)
    }
  }

  const canSegment = asset.kind === 'video' && (transcription || visualNarrative)

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-background rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b shrink-0">
          <h2 className="font-semibold text-sm truncate pr-2">{asset.filename}</h2>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Player / preview */}
          <div className="bg-black flex items-center justify-center" style={{ minHeight: 240 }}>
            {asset.kind === 'video' ? (
              <video src={asset.blob_url} controls className="max-h-[60vh] max-w-full" />
            ) : (
              <img
                src={asset.blob_url}
                alt={asset.filename}
                className="max-h-[60vh] max-w-full cursor-grab active:cursor-grabbing"
                draggable
                title="Drag this image into another browser tab to upload it there, or use Copy / Download below."
              />
            )}
          </div>

          {/* Use elsewhere — copy link, download, or drag the preview to
              another browser tab's upload widget. The whole point of Media
              Hub is being the canonical home for media; this row is the
              bridge to tools whose file pickers can't see Vercel Blob. */}
          <div className="px-5 pt-4 -mb-1 flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-muted-foreground mr-1">Use elsewhere:</span>
            <Button
              size="sm"
              variant="outline"
              onClick={copyLink}
              className="h-7 gap-1.5 text-[11px]"
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
              className="h-7 gap-1.5 text-[11px]"
              title="Download to your computer with the original filename"
            >
              {downloading
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Download className="h-3.5 w-3.5" />}
              Download
            </Button>
            {asset.kind === 'video' && canEdit && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleRegenerateThumbnail}
                disabled={thumbing}
                className="h-7 gap-1.5 text-[11px]"
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
            {asset.kind === 'photo' && (
              <span className="text-[11px] text-muted-foreground">
                · or drag the preview straight into another browser tab
              </span>
            )}
          </div>

          <div className="p-5 space-y-4">
            {!canEdit && !isArchived && (
              <div className="text-[11px] text-muted-foreground bg-muted/40 border border-border rounded-md px-3 py-2">
                View-only — your role can browse the library but cannot edit metadata or archive assets. Ask an admin to change your role in Clerk.
              </div>
            )}

            {/* Status + speaker role */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">Status</label>
                <div className="flex flex-wrap gap-1.5">
                  {STATUSES.map((s) => (
                    <button
                      key={s}
                      onClick={() => setStatus(s)}
                      className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                        status === s ? 'bg-primary text-white border-primary' : 'bg-muted text-muted-foreground border-border hover:border-primary/50'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">Who's speaking?</label>
                <select
                  value={speakerRole}
                  onChange={(e) => setSpeakerRole(e.target.value)}
                  className="text-sm h-8 px-2 rounded-md border border-border bg-background text-foreground w-full"
                >
                  {SPEAKER_ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
              </div>
            </div>

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
                    className="h-7 gap-1.5 text-[11px]"
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
                    className="self-center inline-flex items-center gap-1 text-[10px] uppercase tracking-wide font-medium text-violet-700 dark:text-violet-300 ml-1 mr-0.5"
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

            {/* Edit briefs */}
            {asset.kind === 'video' && (
              <div className="rounded-md border p-3 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <div className="text-xs font-medium flex items-center gap-1.5">
                      <Sparkles className="h-3.5 w-3.5 text-primary" />
                      Edit briefs
                      {linkedBriefs.length > 0 && (
                        <Badge variant="secondary" className="text-[10px]">{linkedBriefs.length}</Badge>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      Moments AI surfaced (or you added) for this clip.
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    {canEdit && (
                      <>
                        <Button
                          size="sm" variant="outline" onClick={handleSegment}
                          disabled={segmenting || !canSegment}
                          title={canSegment ? 'Re-run AI segmenter on this source' : 'Tag with AI first to enable'}
                          className="h-7 gap-1.5 text-[11px]"
                        >
                          {segmenting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                          {linkedBriefs.length ? 'Re-segment' : 'Segment'}
                        </Button>
                        <Button
                          size="sm" variant="outline" onClick={handleNewBrief}
                          disabled={creatingBrief}
                          className="h-7 gap-1.5 text-[11px]"
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
                        <Badge variant="outline" className="text-[10px] uppercase shrink-0 mt-0.5">{b.status}</Badge>
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

            {/* Notes */}
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">Notes</label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Anything else worth remembering about this clip…" className="text-sm" />
            </div>

            {/* Metadata */}
            <div className="text-[11px] text-muted-foreground space-y-0.5">
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
          <div className="px-5 py-3 border-t bg-amber-50 text-amber-900 text-xs flex items-start gap-2 shrink-0">
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
      </div>

      {openBrief && (
        <ContentBriefDetail
          brief={openBrief}
          onClose={() => setOpenBrief(null)}
          onChange={() => { refreshBriefs(); onChange?.() }}
        />
      )}
    </div>
  )
}

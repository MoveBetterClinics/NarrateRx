import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useUser } from '@clerk/clerk-react'
import { X, Loader2, Sparkles, Upload as UploadIcon, Check, Trash2, AlertTriangle, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { updateContentPiece, deleteContentPiece } from '@/lib/contentLib'
import { uploadMedia, getMediaAsset } from '@/lib/mediaLib'
import { dispatchBrief, BUFFER_DISPATCH_PLATFORMS } from '@/lib/publish'
import { queryKeys } from '@/lib/queries'

// Target platform options. The Buffer-dispatchable subset is what the publish
// workbench can actually push to; non-Buffer values (reels/feed/story/shorts/
// newsletter) are kept here so historic briefs still render their target.
const PLATFORMS = [
  'instagram', 'facebook', 'linkedin', 'twitter', 'threads',
  'tiktok', 'youtube_short', 'pinterest', 'bluesky', 'mastodon',
  'gbp',
  'newsletter',
]

// Edit-brief detail modal. Renders a single content_piece with edit fields,
// the source clip preview, and the actions: accept, reject, mark in-progress,
// upload finished file (return-upload), publish (later), delete.
//
// `brief` is the current content_pieces row, `onClose` dismisses, `onChange`
// is fired after any state change so the parent list refreshes.
export default function ContentBriefDetail({ brief, onClose, onChange }) {
  const qc = useQueryClient()
  const { user } = useUser()
  const [source, setSource] = useState(null)
  const [final, setFinal]   = useState(null)
  const [caption, setCaption]     = useState(brief.final_caption ?? brief.ai_caption ?? '')
  const [hashtags, setHashtags]   = useState(joinTags(brief.final_hashtags ?? brief.ai_hashtags))
  const [ctaText, setCtaText]     = useState(brief.final_cta_text ?? brief.ai_cta_text ?? '')
  const [ctaUrl, setCtaUrl]       = useState(brief.final_cta_url ?? '')
  const [platform, setPlatform]   = useState(brief.target_platform ?? brief.ai_suggested_platform ?? '')
  const [notes, setNotes]         = useState(brief.notes ?? '')
  const [saving, setSaving]       = useState(false)
  const [saved, setSaved]         = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError]         = useState('')
  const [publishing, setPublishing] = useState(false)
  const [publishMode, setPublishMode] = useState('now')   // 'now' | 'schedule'
  const [scheduledAt, setScheduledAt] = useState('')
  const fileRef                   = useRef(null)

  useEffect(() => {
    setCaption(brief.final_caption ?? brief.ai_caption ?? '')
    setHashtags(joinTags(brief.final_hashtags ?? brief.ai_hashtags))
    setCtaText(brief.final_cta_text ?? brief.ai_cta_text ?? '')
    setCtaUrl(brief.final_cta_url ?? '')
    setPlatform(brief.target_platform ?? brief.ai_suggested_platform ?? '')
    setNotes(brief.notes ?? '')
    setError('')
  }, [brief.id])

  // Hydrate the source media row + final asset (if any) for preview.
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        if (brief.source_asset_id) {
          const s = await getMediaAsset(brief.source_asset_id)
          if (alive) setSource(s)
        }
        if (brief.final_asset_id) {
          const f = await getMediaAsset(brief.final_asset_id)
          if (alive) setFinal(f)
        }
      } catch { /* empty */ }
    })()
    return () => { alive = false }
  }, [brief.id])

  async function patch(body) {
    setSaving(true); setError(''); setSaved(false)
    try {
      await updateContentPiece(brief.id, body)
      onChange?.()
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function saveDraft() {
    return patch({
      finalCaption: caption,
      finalHashtags: splitTags(hashtags),
      finalCtaText: ctaText,
      finalCtaUrl: ctaUrl,
      targetPlatform: platform || null,
      notes,
    })
  }

  async function accept()       { await saveDraft(); await patch({ status: 'accepted' }) }
  async function reject()       { const r = prompt('Why reject? (optional)'); await patch({ status: 'rejected', rejectedReason: r || null }) }
  async function inProgress()   { await saveDraft(); await patch({ status: 'in_progress' }) }
  async function archive()      { await patch({ status: 'archived' }) }
  async function remove() {
    if (!confirm('Delete this brief? This cannot be undone.')) return
    setSaving(true); setError('')
    try {
      await deleteContentPiece(brief.id)
      onChange?.()
      onClose?.()
    } catch (e) {
      setError(e.message)
      setSaving(false)
    }
  }

  // Compose the post body the dispatcher will send. Same shape ReviewPost emits.
  function composedContent() {
    const parts = []
    if (caption.trim()) parts.push(caption.trim())
    const tags = splitTags(hashtags)
    if (tags.length) parts.push(tags.join(' '))
    if (ctaText.trim()) parts.push(ctaUrl.trim() ? `${ctaText.trim()} ${ctaUrl.trim()}` : ctaText.trim())
    return parts.join('\n\n')
  }

  async function handlePublish() {
    if (!platform) { setError('Pick a target platform first'); return }
    if (!BUFFER_DISPATCH_PLATFORMS.includes(platform)) {
      setError(`Platform "${platform}" isn't wired for direct dispatch yet. Save the brief and publish manually.`)
      return
    }
    const asset = final || source
    if (!asset?.blob_url) { setError('Upload a final file (or use the source clip) before dispatching'); return }
    if (publishMode === 'schedule' && !scheduledAt) { setError('Pick a schedule time'); return }

    setPublishing(true); setError('')
    try {
      await saveDraft()
      const effectiveScheduledAt = publishMode === 'schedule' ? new Date(scheduledAt).toISOString() : null
      const { item } = await dispatchBrief({
        brief: { ...brief, target_platform: platform },
        asset,
        composedContent: composedContent(),
        scheduledAt: effectiveScheduledAt,
        userId: user?.primaryEmailAddress?.emailAddress,
      })
      await updateContentPiece(brief.id, {
        status: 'published',
        publishedTargetId: item.id,
      })
      qc.invalidateQueries({ queryKey: queryKeys.contentItems.all })
      onChange?.()
    } catch (e) {
      setError(`Publish failed: ${e.message}`)
    } finally {
      setPublishing(false)
    }
  }

  async function handleReturnUpload(fileList) {
    const file = fileList?.[0]
    if (!file) return
    setUploading(true); setError('')
    try {
      // saveDraft first so the contractor's caption edits don't get lost.
      await saveDraft()
      await uploadMedia(file, {
        parentId: brief.source_asset_id,
        contentPieceId: brief.id,
      })
      // Server marks brief 'returned' + sets final_asset_id; refresh.
      onChange?.()
    } catch (e) {
      setError(e.message)
    } finally {
      setUploading(false)
    }
  }

  const sourceUrl = source?.blob_url
  const finalUrl  = final?.blob_url
  const showPatientWarning = !!source?.patient_pseudonym || source?.speaker_role === 'patient_guest'

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-background rounded-xl shadow-2xl w-full max-w-full sm:max-w-3xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Sparkles className="h-4 w-4 text-primary shrink-0" />
            <h2 className="font-semibold text-sm truncate">
              Edit brief — {source?.filename ?? brief.source_asset_id?.slice(0, 8)}
            </h2>
            <Badge variant="outline" className="text-[10px] uppercase">{brief.status}</Badge>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="p-5 space-y-4">
            {showPatientWarning && (
              <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-amber-900 dark:text-amber-200">Patient consent required</p>
                  <p className="text-amber-800 dark:text-amber-300/80 mt-0.5">
                    This source involves a patient ({source?.patient_pseudonym || 'patient guest'}). Verify written or recorded consent before publishing anything derived from this clip.
                  </p>
                </div>
              </div>
            )}

            {/* Source preview + AI-surfaced quote */}
            {sourceUrl && (
              <div className="bg-black rounded-md overflow-hidden">
                {source.kind === 'video' ? (
                  <video src={sourceUrl} controls className="w-full max-h-[40vh]" />
                ) : (
                  <img src={sourceUrl} alt="source" className="w-full max-h-[40vh] object-contain" loading="lazy" decoding="async" />
                )}
              </div>
            )}

            {brief.source_quote && (
              <div className="rounded-md border bg-muted/40 p-3">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Source quote</div>
                <p className="text-sm whitespace-pre-wrap">{brief.source_quote}</p>
              </div>
            )}

            {brief.ai_reasoning && (
              <p className="text-xs text-muted-foreground italic">"{brief.ai_reasoning}"</p>
            )}

            {/* Editable fields */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">Target platform</label>
                <select
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value)}
                  className="text-sm h-8 px-2 rounded-md border border-border bg-background text-foreground w-full"
                >
                  <option value="">— choose —</option>
                  {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">CTA text</label>
                <Input value={ctaText} onChange={(e) => setCtaText(e.target.value)} className="h-8 text-sm" placeholder="e.g. Book at MoveBetter.co" />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">Caption</label>
              <Textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={4} className="text-sm" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">Hashtags</label>
                <Input value={hashtags} onChange={(e) => setHashtags(e.target.value)} className="h-8 text-sm" placeholder="#MoveBetter #LowBack" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">CTA URL (optional)</label>
                <Input value={ctaUrl} onChange={(e) => setCtaUrl(e.target.value)} className="h-8 text-sm" placeholder="https://…" />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">Notes</label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="text-sm" placeholder="Anything for the editor…" />
            </div>

            {/* Finished file return + preview */}
            <div className="rounded-md border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-medium">Finished edit</div>
                  <div className="text-[11px] text-muted-foreground">Upload the file Philip exported from CapCut. It lands in the library tied back to the source.</div>
                </div>
                <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}>
                  {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <UploadIcon className="h-3.5 w-3.5 mr-1.5" />}
                  Upload final
                </Button>
                <input ref={fileRef} type="file" accept="image/*,video/*" className="hidden" onChange={(e) => handleReturnUpload(e.target.files)} />
              </div>
              {finalUrl && (
                <div className="bg-black rounded-md overflow-hidden">
                  {final?.kind === 'video' ? (
                    <video src={finalUrl} controls className="w-full max-h-[30vh]" />
                  ) : (
                    <img src={finalUrl} alt="finished" className="w-full max-h-[30vh] object-contain" loading="lazy" decoding="async" />
                  )}
                </div>
              )}
            </div>

            {/* Publish workbench — visible once a target platform is set and we
                have a clip to attach. Routes through api/publish/buffer.js so
                this surface stays in sync with ReviewPost's dispatch path. */}
            {brief.status !== 'published' && (
              <div className="rounded-md border p-3 space-y-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <div className="text-xs font-medium">Publish</div>
                    <div className="text-[11px] text-muted-foreground">
                      Dispatches via Buffer using this workspace's credentials. The finished file (or source clip) is attached as the post media.
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setPublishMode('now')}
                      className={`text-[11px] px-2.5 py-1 rounded-full border ${publishMode === 'now' ? 'bg-primary text-white border-primary' : 'bg-muted text-muted-foreground border-border'}`}
                    >Now</button>
                    <button
                      onClick={() => setPublishMode('schedule')}
                      className={`text-[11px] px-2.5 py-1 rounded-full border ${publishMode === 'schedule' ? 'bg-primary text-white border-primary' : 'bg-muted text-muted-foreground border-border'}`}
                    >Schedule</button>
                  </div>
                </div>
                {publishMode === 'schedule' && (
                  <Input
                    type="datetime-local"
                    value={scheduledAt}
                    onChange={(e) => setScheduledAt(e.target.value)}
                    className="h-8 text-sm w-fit"
                  />
                )}
                <div className="flex items-center justify-end">
                  <Button
                    size="sm"
                    onClick={handlePublish}
                    disabled={publishing || saving || !platform}
                  >
                    {publishing
                      ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Publishing</>
                      : <><Send className="h-3.5 w-3.5 mr-1.5" />{publishMode === 'schedule' ? 'Schedule' : 'Publish now'}</>}
                  </Button>
                </div>
              </div>
            )}

            {error && <div className="text-sm text-destructive">{error}</div>}
          </div>
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-t shrink-0">
          <Button variant="ghost" size="sm" onClick={remove} disabled={saving} className="text-destructive hover:text-destructive">
            <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete
          </Button>
          <div className="flex flex-wrap gap-2 justify-end">
            {brief.status !== 'rejected' && brief.status !== 'archived' && (
              <Button size="sm" variant="ghost" onClick={reject} disabled={saving}>Reject</Button>
            )}
            {brief.status === 'suggested' && (
              <Button size="sm" variant="outline" onClick={accept} disabled={saving}>
                <Check className="h-3.5 w-3.5 mr-1.5" /> Accept
              </Button>
            )}
            {(brief.status === 'accepted') && (
              <Button size="sm" variant="outline" onClick={inProgress} disabled={saving}>Mark in progress</Button>
            )}
            {brief.status === 'returned' && (
              <Button size="sm" variant="outline" onClick={archive} disabled={saving}>Archive</Button>
            )}
            <Button size="sm" onClick={saveDraft} disabled={saving}>
              {saving
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Save</>
                : saved
                  ? <><Check className="h-3.5 w-3.5 mr-1.5" />Saved</>
                  : 'Save'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function joinTags(arr) {
  if (!Array.isArray(arr)) return ''
  return arr.join(' ')
}
function splitTags(str) {
  return String(str || '')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 12)
}

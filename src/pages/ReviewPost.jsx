import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useUser } from '@clerk/clerk-react'
import {
  ArrowLeft, Send, CalendarDays, CheckCircle2, Loader2, Copy, Check,
  AlertCircle, Image, Trash2, ExternalLink, Eye, Pencil,
  ChevronLeft, ChevronRight, Play, RefreshCw, RotateCcw, ThumbsUp,
} from 'lucide-react'
import PostPreview from '@/components/PostPreview'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { fetchContentItem, fetchContentItems, updateContentItem, publishAndTrack } from '@/lib/publish'
import { fetchInterview } from '@/lib/api'
import { generateContent } from '@/lib/claude'
import { toast } from '@/lib/toast'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { useSaveShortcut } from '@/lib/useSaveShortcut'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/queries'
import { getBlogPostSystemPrompt, getSocialBatchSystemPrompt, getVideoScriptBatchSystemPrompt, getMarketingBatchSystemPrompt, getExemplarsBlock } from '@/lib/prompts'
import { fetchTopExemplars } from '@/lib/exemplars'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { applyLocationOverlay } from '@/lib/locationOverlay'
import { PLATFORM_META, STATUS_META } from './ContentHub'
import MediaPicker from '@/components/MediaPicker'
import { formatDate, formatRelativeDate } from '@/lib/utils'

// All distribution surfaces route through Buffer as of 2026-05-11. GBP is
// special only in that it carries a per-location selection (`locationIds`).
const BUFFER_PLATFORMS  = [
  'instagram', 'facebook', 'linkedin', 'pinterest',
  'tiktok', 'youtube_short', 'twitter', 'threads', 'bluesky', 'mastodon',
  'gbp',
]
// Media-required platforms — visual-first networks where a post without an
// image/video can't be published (or will look broken in feed).
const NEEDS_MEDIA       = ['instagram', 'facebook', 'gbp', 'pinterest', 'tiktok', 'youtube_short']

// Platform-specific preferred posting days (0=Sun…6=Sat) and hours (local time)
const PLATFORM_SCHEDULE_PREFS = {
  instagram:    { days: [2, 3, 4, 5],    hours: [11, 14, 18] },
  facebook:     { days: [2, 3, 4],       hours: [12, 15] },
  linkedin:     { days: [2, 3, 4],       hours: [8, 10] },
  blog:         { days: [1, 2, 3],       hours: [8, 10] },
  email:        { days: [2, 4],          hours: [10, 11] },
  youtube:      { days: [5, 6],          hours: [17, 19] },
  tiktok:       { days: [2, 3, 5],       hours: [19, 20] },
  gbp:          { days: [1, 2, 3, 4, 5], hours: [9, 10] },
  google_ads:   { days: [1, 2, 3],       hours: [9] },
  instagram_ads:{ days: [1, 2, 3],       hours: [9] },
  landing_page: { days: [1, 2, 3],       hours: [9] },
}

function suggestScheduleTime(platform, scheduledItems) {
  const { days, hours } = PLATFORM_SCHEDULE_PREFS[platform] || { days: [1, 2, 3, 4, 5], hours: [9, 14] }
  const busy = scheduledItems.map((i) => new Date(i.scheduled_at).getTime()).filter(Boolean)
  const MIN_GAP_MS = 2 * 60 * 60 * 1000 // no two posts within 2 hours of each other
  const now = new Date()

  for (let d = 1; d <= 60; d++) {
    const candidate = new Date(now)
    candidate.setDate(candidate.getDate() + d)
    if (!days.includes(candidate.getDay())) continue
    for (const h of hours) {
      candidate.setHours(h, 0, 0, 0)
      if (candidate <= now) continue
      const conflict = busy.some((t) => Math.abs(t - candidate.getTime()) < MIN_GAP_MS)
      if (!conflict) return new Date(candidate)
    }
  }
  return null
}

export default function ReviewPost() {
  useDocumentTitle('Review post')
  const { itemId }   = useParams()
  const navigate     = useNavigate()
  const { user }     = useUser()
  const workspace    = useWorkspace()
  const qc           = useQueryClient()

  // Centralize the cache-invalidation hook so every updateContentItem
  // call site in this component picks up the same cross-component
  // refresh — ContentHub list, ContentCalendar month grid, and the
  // detail cache all stay in sync after saves/edits/regenerates.
  function invalidateContentCaches(updated) {
    if (updated?.id) qc.setQueryData(queryKeys.contentItems.detail(updated.id), updated)
    qc.invalidateQueries({ queryKey: queryKeys.contentItems.all })
  }

  const [item, setItem]               = useState(null)
  const [content, setContent]         = useState('')
  const [loading, setLoading]         = useState(true)
  const [saving, setSaving]           = useState(false)
  const [saveStatus, setSaveStatus]   = useState('') // '' | 'saving' | 'saved' | 'error'
  const autoSaveTimer                 = useRef(null)
  const isFirstLoad                   = useRef(true)
  const [publishing, setPublishing]     = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [copied, setCopied]             = useState(false)
  const [error, setError]               = useState('')
  const [success, setSuccess]           = useState('')
  const [showPicker, setShowPicker]       = useState(false)
  const [showPreview, setShowPreview]     = useState(false)
  const [scheduledAt, setScheduledAt]         = useState('')
  const [scheduleSuggestion, setScheduleSuggestion] = useState(null) // Date | null
  const [scheduleIsCustom, setScheduleIsCustom]     = useState(false)
  const [publishMode, setPublishMode]               = useState('schedule') // 'schedule' | 'now'
  const [gbpLocations, setGbpLocations]   = useState([])
  const [selectedLocs, setSelectedLocs]   = useState([])

  // Auto-save 2 seconds after user stops typing
  useEffect(() => {
    if (isFirstLoad.current) return // skip on initial load
    if (!item || item.status === 'published') return

    clearTimeout(autoSaveTimer.current)
    setSaveStatus('saving')
    autoSaveTimer.current = setTimeout(async () => {
      try {
        const updated = await updateContentItem(itemId, { content })
        invalidateContentCaches(updated)
        setSaveStatus('saved')
        setTimeout(() => setSaveStatus(''), 2000)
      } catch (e) {
        // Autosave failure used to be a silent catch — user could lose
        // minutes of edits with no idea anything was wrong. Surface it.
        setSaveStatus('error')
        toast.error('Autosave failed', {
          description: e?.message || 'Your latest edits were not saved. Check your connection and try again.',
        })
      }
    }, 2000)

    return () => clearTimeout(autoSaveTimer.current)
  }, [content])

  // ⌘S flushes the autosave debounce immediately — saves what's currently
  // typed without waiting the 2s. Useful when the user wants confirmation
  // that a fresh edit is persisted before navigating away. Skips when the
  // item is published (no edits possible) or no item is loaded yet.
  useSaveShortcut(async () => {
    if (!item || item.status === 'published') return
    clearTimeout(autoSaveTimer.current)
    setSaveStatus('saving')
    try {
      const updated = await updateContentItem(itemId, { content })
      invalidateContentCaches(updated)
      setSaveStatus('saved')
      toast.success('Saved')
      setTimeout(() => setSaveStatus(''), 2000)
    } catch (e) {
      setSaveStatus('error')
      toast.error('Save failed', { description: e?.message || 'Try again.' })
    }
  }, { disabled: !item || item?.status === 'published' })

  useEffect(() => {
    let cancelled = false
    fetchContentItem(itemId)
      .then((i) => {
        if (cancelled) return
        setItem(i)
        setContent(i?.content || '')
        if (i?.scheduled_at) {
          setScheduledAt(i.scheduled_at.slice(0, 16))
          setScheduleIsCustom(true)
        }
        isFirstLoad.current = false
        if (i?.status === 'draft') {
          updateContentItem(itemId, { status: 'in_review' })
            .then((updated) => { if (!cancelled) { setItem(updated); invalidateContentCaches(updated) } })
            .catch(() => {})
        }
        // GBP location picker is hydrated from workspace.locations in a
        // separate effect that waits for workspace to load — the picker now
        // shows workspace_locations rows (UUIDs), not Google location IDs.
      })
      .catch(() => { if (!cancelled) { toast.error('Could not load post — returning to Content Hub.'); navigate('/hub') } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [itemId])

  // Auto-suggest a schedule time based on what's already queued
  // Hydrate the GBP location picker from workspace.locations once both the
  // content item and the workspace are loaded. Selection holds workspace_locations
  // row UUIDs; the buffer publish endpoint resolves those to Buffer GBP profile
  // IDs via gbp_location_id. Only locations with a Buffer channel ID are
  // selectable — without one there's nowhere to send the post.
  useEffect(() => {
    if (!item || item.platform !== 'gbp') return
    const eligible = (workspace?.locations || []).filter(
      (l) => l.status !== 'archived' && l.gbp_location_id,
    )
    setGbpLocations(eligible)
    const eligibleIds = eligible.map((l) => l.id)
    const saved = Array.isArray(item.target_locations)
      ? item.target_locations.filter((id) => eligibleIds.includes(id))
      : null
    // If the item is bound to a single workspace_location with a Buffer
    // channel ID, default the picker to just that one. Otherwise default to
    // every eligible location ("post everywhere").
    const itemBound = item.location_id && eligibleIds.includes(item.location_id)
      ? [item.location_id]
      : null
    setSelectedLocs(saved && saved.length ? saved : (itemBound || eligibleIds))
  }, [item?.id, item?.platform, workspace?.locations])

  useEffect(() => {
    if (!item || item.scheduled_at) return
    fetchContentItems({ status: 'scheduled', limit: 100 })
      .then((scheduled) => {
        const suggestion = suggestScheduleTime(item.platform, scheduled)
        if (suggestion) {
          setScheduleSuggestion(suggestion)
          setScheduledAt(suggestion.toISOString().slice(0, 16))
        }
      })
      .catch(() => {})
  }, [item?.id, item?.platform])

  async function save(patch = {}) {
    setSaving(true)
    setError('')
    try {
      const updated = await updateContentItem(itemId, { content, ...patch })
      setItem(updated)
      invalidateContentCaches(updated)
      return updated
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function approve() {
    const updated = await save({ status: 'approved', reviewedBy: user?.primaryEmailAddress?.emailAddress })
    if (updated) setSuccess('Approved! Ready to schedule or publish.')
  }

  async function unapprove() {
    const updated = await save({ status: 'in_review' })
    if (updated) setSuccess('Approval removed. Back in review.')
  }

  async function handlePublish() {
    if (!item) return
    setPublishing(true)
    setError('')
    setSuccess('')
    try {
      // Save latest content first
      await save({ status: 'approved' })
      const effectiveScheduledAt = publishMode === 'schedule' ? (scheduledAt || null) : null
      const latest = { ...item, content, scheduledAt: effectiveScheduledAt, mediaUrls: item.media_urls || [], locationIds: item.platform === 'gbp' ? selectedLocs : undefined }
      await publishAndTrack(latest, user?.primaryEmailAddress?.emailAddress)
      setSuccess(effectiveScheduledAt ? 'Scheduled! Redirecting to Content Hub…' : 'Published! Redirecting to Content Hub…')
      setTimeout(() => navigate('/hub'), 2000)
    } catch (e) {
      setError(`Publish failed: ${e.message}`)
    } finally {
      setPublishing(false)
    }
  }

  // ── Regenerate ────────────────────────────────────────────────────────────────
  function extractSection(text, startMarker, endMarker) {
    if (!startMarker) return text.trim()
    const si = text.indexOf(startMarker)
    if (si === -1) return text.trim()
    const after = text.slice(si + startMarker.length)
    if (!endMarker) return after.trim()
    const ei = after.indexOf(endMarker)
    return ei === -1 ? after.trim() : after.slice(0, ei).trim()
  }

  const PLATFORM_MARKERS = {
    blog:         [null,                    null],
    instagram:    ['---INSTAGRAM---',       '---FACEBOOK---'],
    facebook:     ['---FACEBOOK---',        '---GBP POST---'],
    gbp:          ['---GBP POST---',        '---LINKEDIN---'],
    linkedin:     ['---LINKEDIN---',        null],
    youtube:      ['---YOUTUBE SCRIPT---',  '---TIKTOK SCRIPT---'],
    tiktok:       ['---TIKTOK SCRIPT---',   null],
    email:        ['---EMAIL NEWSLETTER---','---LANDING PAGE---'],
    landing_page: ['---LANDING PAGE---',    '---GOOGLE ADS---'],
    google_ads:   ['---GOOGLE ADS---',      '---INSTAGRAM ADS---'],
    instagram_ads:['---INSTAGRAM ADS---',   null],
  }

  async function regenerate() {
    if (!item) return
    // Stash the pre-regenerate body so the toast can offer one-click undo.
    // Skip stashing if the content is empty (nothing meaningful to restore)
    // or hasn't changed from the last AI generation.
    const prevContent = item.content || ''
    setRegenerating(true)
    setError('')
    setSuccess('')
    try {
      const interview = await fetchInterview(item.interview_id)
      const { messages, outputs, tone } = interview
      const voiceMode     = interview.voice_mode || 'practice'
      const prototypeId   = interview.prototype_id || null
      const clinicianName = item.clinician_name
      const condition     = item.topic
      const platform      = item.platform

      let systemPrompt, inputMessages
      const blogPost = outputs?.blogPost || ''

      // Use the location attached to this content item (or fall back to the
      // interview's location) so regenerated copy targets the same site as the
      // original generation.
      const locationId = item.location_id || interview.location_id || null
      const itemLocation = (workspace?.locations || []).find(l => l.id === locationId)
      const ws = applyLocationOverlay(workspace, itemLocation)

      if (platform === 'blog') {
        systemPrompt  = getBlogPostSystemPrompt(ws, clinicianName, condition, tone, voiceMode, prototypeId)
        inputMessages = messages?.length ? messages : [{ role: 'user', content: 'Please write the blog post.' }]
      } else {
        if (!blogPost) throw new Error('The blog post for this interview must be generated first before regenerating other content.')
        inputMessages = [{ role: 'user', content: blogPost }]
        if (['instagram', 'facebook', 'gbp', 'linkedin'].includes(platform)) {
          systemPrompt = getSocialBatchSystemPrompt(ws, clinicianName, condition, '', tone, voiceMode, prototypeId)
        } else if (['youtube', 'tiktok'].includes(platform)) {
          systemPrompt = getVideoScriptBatchSystemPrompt(ws, clinicianName, condition, '', tone, voiceMode, prototypeId)
        } else {
          systemPrompt = getMarketingBatchSystemPrompt(ws, clinicianName, condition, '', tone, prototypeId)
        }
      }

      // Append "performed well" exemplars (Tier 1 feedback loop). Only kicks
      // in once editors have thumbs-upped a few posts for this platform; the
      // helper returns an empty string when the pool is empty so this is a
      // no-op until the signal exists.
      const exemplars = await fetchTopExemplars({ platform })
      systemPrompt = systemPrompt + getExemplarsBlock(exemplars)

      const generated = await generateContent(
        inputMessages,
        systemPrompt,
        platform === 'blog' ? { model: 'claude-opus-4-7' } : {},
      )
      if (!generated) throw new Error('No content returned from generation.')

      const [startMarker, endMarker] = PLATFORM_MARKERS[platform] || [null, null]
      const newContent = extractSection(generated, startMarker, endMarker)
      if (!newContent) throw new Error('Could not parse content from the generated output.')

      const updated = await updateContentItem(itemId, { content: newContent, status: 'in_review', updatedAt: new Date().toISOString() })
      setItem(updated)
      setContent(newContent)
      setShowPreview(false)
      invalidateContentCaches(updated)
      setSuccess('Content regenerated!')
      setTimeout(() => setSuccess(''), 3000)

      // Offer one-click revert if the user didn't want the new version.
      // The toast persists for 12s — long enough to read the new copy and
      // decide. Restoring writes the stashed text back via the same
      // updateContentItem path and refreshes local state.
      if (prevContent && prevContent !== newContent) {
        toast.success('Content regenerated', {
          duration: 12_000,
          action: {
            label: 'Undo',
            onClick: async () => {
              try {
                const reverted = await updateContentItem(itemId, {
                  content: prevContent,
                  updatedAt: new Date().toISOString(),
                })
                setItem(reverted)
                setContent(prevContent)
                invalidateContentCaches(reverted)
                toast.success('Restored previous version')
              } catch (e) {
                toast.error('Could not undo', { description: e.message })
              }
            },
          },
        })
      }
    } catch (e) {
      setError(`Regenerate failed: ${e.message}`)
    } finally {
      setRegenerating(false)
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 3000)
  }

  async function removeMedia(index) {
    const urls = [...(item.media_urls || [])]
    urls.splice(index, 1)
    const updated = await updateContentItem(itemId, { mediaUrls: urls })
    setItem(updated)
    invalidateContentCaches(updated)
  }

  async function reorderMedia(fromIndex, toIndex) {
    const urls = [...(item.media_urls || [])]
    const [moved] = urls.splice(fromIndex, 1)
    urls.splice(toIndex, 0, moved)
    const updated = await updateContentItem(itemId, { mediaUrls: urls })
    setItem(updated)
    invalidateContentCaches(updated)
  }

  async function addMedia(file) {
    const urls = [...(item.media_urls || []), file]
    const updated = await updateContentItem(itemId, { mediaUrls: urls })
    setItem(updated)
    invalidateContentCaches(updated)
    setShowPicker(false)
  }

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
  if (!item)   return null

  const pm = PLATFORM_META[item.platform] || PLATFORM_META.blog
  const sm = STATUS_META[item.status]     || STATUS_META.draft
  const Icon = pm.icon
  const needsMedia      = NEEDS_MEDIA.includes(item.platform)
  const hasMedia        = (item.media_urls || []).length > 0
  const usesBuffer      = BUFFER_PLATFORMS.includes(item.platform)
  const isPublished     = item.status === 'published'

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/hub"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg ${pm.bg} shrink-0`}>
          <Icon className={`h-4 w-4 ${pm.color} shrink-0`} />
          <span className={`text-xs font-medium ${pm.color}`}>{pm.label}</span>
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="font-semibold">{item.topic}</h1>
            <Badge className={`text-xs ${sm.color} border-0`}>{sm.label}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">{pm.label} · {item.clinician_name} · {formatDate(item.created_at)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: editor / preview */}
        <div className="lg:col-span-2 space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium">Content</label>
                {saveStatus === 'saving' && <span className="text-xs text-muted-foreground">↑ Saving…</span>}
                {saveStatus === 'saved'  && <span className="text-xs text-green-600">✓ Saved</span>}
                {saveStatus === 'error'  && <span className="text-xs text-destructive">⚠ Not saved — check your connection</span>}
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant={showPreview ? 'ghost' : 'secondary'}
                  size="sm"
                  onClick={() => setShowPreview(false)}
                  className="gap-1.5"
                >
                  <Pencil className="h-3.5 w-3.5" />Edit
                </Button>
                <Button
                  variant={showPreview ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => setShowPreview(true)}
                  className="gap-1.5"
                >
                  <Eye className="h-3.5 w-3.5" />Preview
                </Button>
                {!showPreview && (
                  <Button variant="ghost" size="sm" onClick={handleCopy} className="ml-1">
                    {copied ? <><Check className="h-3.5 w-3.5 mr-1.5 text-green-600" />Copied</> : <><Copy className="h-3.5 w-3.5 mr-1.5" />Copy</>}
                  </Button>
                )}
              </div>
            </div>

            {showPreview ? (
              <div className="min-h-[400px] rounded-xl border bg-slate-50 p-4 overflow-auto">
                <PostPreview platform={item.platform} content={content} mediaUrls={item.media_urls || []} />
              </div>
            ) : (
              <>
                <Textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={18}
                  className="font-mono text-sm resize-none"
                  disabled={isPublished}
                />
                <p className="text-xs text-muted-foreground mt-1.5">{content.length} characters · {content.split(/\s+/).filter(Boolean).length} words</p>
              </>
            )}
          </div>

          {/* Media */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium">
                  {item.platform === 'email' ? 'Hero Photo' : 'Media'}
                </label>
                {needsMedia && !hasMedia && (
                  <Badge className="text-xs bg-amber-100 text-amber-700 border-0">Required for {pm.label}</Badge>
                )}
                {item.platform === 'email' && (
                  <Badge className="text-xs bg-slate-100 text-slate-500 border-0">Optional</Badge>
                )}
              </div>
              {!isPublished && (
                <Button variant="outline" size="sm" onClick={() => setShowPicker(true)}>
                  <Image className="h-3.5 w-3.5 mr-1.5" />
                  {item.platform === 'email' ? 'Add Hero Photo' : 'Add Media'}
                </Button>
              )}
            </div>

            {(item.media_urls || []).length === 0 ? (
              <div
                onClick={() => !isPublished && setShowPicker(true)}
                className={`border-2 border-dashed rounded-lg p-8 text-center ${!isPublished ? 'cursor-pointer hover:border-primary/50 hover:bg-accent/30' : ''} transition-colors`}
              >
                <Image className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">
                  {isPublished
                    ? 'No media attached'
                    : item.platform === 'email'
                      ? 'Add a header photo for this newsletter — skip for text-only sends like clinic updates'
                      : 'Click to add photos or videos from your Media library or upload your own'}
                </p>
              </div>
            ) : (
              <div className="flex gap-3 overflow-x-auto pb-2">
                {item.media_urls.map((m, i) => {
                  const total = item.media_urls.length
                  const imgSrc = m.url || m.thumbnailUrl || null
                  return (
                    <div key={i} className="relative group shrink-0 w-32 rounded-lg overflow-hidden border bg-muted" style={{ aspectRatio: '1' }}>
                      {/* Thumbnail */}
                      {m.type === 'video' ? (
                        <div className="absolute inset-0 bg-slate-800 flex flex-col items-center justify-center gap-1 px-1">
                          {imgSrc && <img src={imgSrc} alt={m.name} className="absolute inset-0 w-full h-full object-cover opacity-50" onError={(e) => { e.target.style.display='none' }} />}
                          <div className="relative z-10 flex flex-col items-center gap-1">
                            <Play className="h-6 w-6 text-white" />
                            <span className="text-[9px] text-white/70 text-center line-clamp-2 px-1">{m.name}</span>
                          </div>
                        </div>
                      ) : (
                        <img src={imgSrc} alt={m.name} className="absolute inset-0 w-full h-full object-cover" />
                      )}

                      {/* Position badge */}
                      <div className="absolute top-1 left-1 h-5 w-5 rounded-full bg-black/60 text-white text-[10px] font-bold flex items-center justify-center">
                        {i + 1}
                      </div>

                      {/* Reorder + delete controls — visible on hover */}
                      {!isPublished && (
                        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between px-1 py-1 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => reorderMedia(i, i - 1)}
                            disabled={i === 0}
                            className="h-6 w-6 rounded bg-black/50 text-white flex items-center justify-center disabled:opacity-30 hover:bg-black/80 transition-colors"
                            title="Move left"
                          >
                            <ChevronLeft className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => removeMedia(i)}
                            className="h-6 w-6 rounded bg-red-600/80 text-white flex items-center justify-center hover:bg-red-600 transition-colors"
                            title="Remove"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                          <button
                            onClick={() => reorderMedia(i, i + 1)}
                            disabled={i === total - 1}
                            className="h-6 w-6 rounded bg-black/50 text-white flex items-center justify-center disabled:opacity-30 hover:bg-black/80 transition-colors"
                            title="Move right"
                          >
                            <ChevronRight className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}

                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right: actions */}
        <div className="space-y-4">
          {/* Status actions */}
          {/* Regenerate */}
          {!isPublished && (
            <div className="rounded-xl border p-4 space-y-2">
              <p className="text-sm font-medium">Regenerate content</p>
              <p className="text-xs text-muted-foreground">Re-runs AI generation for this platform using the original interview.</p>
              {item.updated_at && new Date(item.updated_at) - new Date(item.created_at) > 60_000 ? (
                <div className="flex items-center gap-1.5 text-xs text-green-700 bg-green-50 rounded-md px-2.5 py-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                  Regenerated {formatRelativeDate(item.updated_at)}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Original AI output — not yet regenerated.</p>
              )}
              <Button
                variant="outline" size="sm" className="w-full"
                onClick={regenerate}
                disabled={regenerating}
              >
                {regenerating
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                }
                {regenerating ? 'Regenerating…' : 'Regenerate'}
              </Button>
            </div>
          )}

          {!isPublished && (
            <div className="rounded-xl border p-4 space-y-3">
              <p className="text-sm font-medium">Publish this post</p>

              {/* Mode toggle: Schedule vs. Publish now */}
              <div className="grid grid-cols-2 rounded-md border p-0.5 bg-muted/40 text-xs font-medium">
                <button
                  type="button"
                  onClick={() => setPublishMode('schedule')}
                  className={`flex items-center justify-center gap-1.5 py-1.5 rounded-sm transition-colors ${
                    publishMode === 'schedule'
                      ? 'bg-background shadow-sm text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <CalendarDays className="h-3.5 w-3.5" />
                  Schedule
                </button>
                <button
                  type="button"
                  onClick={() => setPublishMode('now')}
                  className={`flex items-center justify-center gap-1.5 py-1.5 rounded-sm transition-colors ${
                    publishMode === 'now'
                      ? 'bg-background shadow-sm text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Send className="h-3.5 w-3.5" />
                  Publish now
                </button>
              </div>

              {/* Schedule picker */}
              {publishMode === 'schedule' && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs text-muted-foreground">Schedule for</label>
                    {scheduleSuggestion && (
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                        scheduleIsCustom
                          ? 'bg-slate-100 text-slate-500'
                          : 'bg-violet-100 text-violet-700'
                      }`}>
                        {scheduleIsCustom ? 'Custom' : '✦ Auto-suggested'}
                      </span>
                    )}
                  </div>
                  <input
                    type="datetime-local"
                    value={scheduledAt}
                    onChange={(e) => { setScheduledAt(e.target.value); setScheduleIsCustom(true) }}
                    min={new Date().toISOString().slice(0, 16)}
                    className="w-full text-xs border rounded-md px-2.5 py-2 bg-background"
                  />
                  {scheduleSuggestion && !scheduleIsCustom && (
                    <p className="text-xs text-muted-foreground">Spread across your current queue.</p>
                  )}
                  {scheduleSuggestion && scheduleIsCustom && (
                    <button
                      type="button"
                      onClick={() => { setScheduledAt(scheduleSuggestion.toISOString().slice(0, 16)); setScheduleIsCustom(false) }}
                      className="text-xs text-primary hover:underline"
                    >
                      Reset to suggested time
                    </button>
                  )}
                </div>
              )}

              <Separator />

              {/* Approve / Remove approval */}
              {item.status === 'draft' || item.status === 'in_review' ? (
                <Button variant="outline" size="sm" className="w-full border-blue-200 text-blue-700 hover:bg-blue-50" onClick={approve} disabled={saving}>
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />Approve
                </Button>
              ) : item.status === 'approved' ? (
                <Button variant="outline" size="sm" className="w-full border-amber-200 text-amber-700 hover:bg-amber-50" onClick={unapprove} disabled={saving}>
                  <RotateCcw className="h-3.5 w-3.5 mr-1.5" />Remove approval
                </Button>
              ) : null}

              {/* GBP location picker — only locations with a Buffer GBP channel ID are listed. */}
              {item.platform === 'gbp' && gbpLocations.length === 0 && (
                <p className="text-xs text-amber-600">
                  No location has a Buffer GBP channel ID yet. Open
                  <Link to="/settings/workspace" className="underline ml-1">Workspace Settings → Locations</Link>
                  and paste the Buffer profile ID for each Google Business listing.
                </p>
              )}
              {item.platform === 'gbp' && gbpLocations.length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Post to locations</label>
                  <div className="space-y-1">
                    {gbpLocations.map((loc) => (
                      <label key={loc.id} className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedLocs.includes(loc.id)}
                          onChange={(e) => setSelectedLocs((prev) =>
                            e.target.checked ? [...prev, loc.id] : prev.filter((id) => id !== loc.id)
                          )}
                          className="rounded"
                        />
                        {loc.label || loc.city || loc.id}
                        {loc.city && loc.region ? <span className="text-muted-foreground"> · {loc.city}, {loc.region}</span> : null}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Publish */}
              <Button
                size="sm"
                className="w-full"
                onClick={handlePublish}
                disabled={publishing || (needsMedia && !hasMedia) || (item.platform === 'gbp' && selectedLocs.length === 0)}
              >
                {publishing
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  : publishMode === 'schedule'
                    ? <CalendarDays className="h-3.5 w-3.5 mr-1.5" />
                    : <Send className="h-3.5 w-3.5 mr-1.5" />
                }
                {publishing
                  ? 'Publishing…'
                  : publishMode === 'schedule'
                    ? 'Schedule Post'
                    : 'Publish Now'}
              </Button>

              {needsMedia && !hasMedia && (
                <p className="text-xs text-amber-600 text-center">Add a photo or video to publish to {pm.label}</p>
              )}

              {item.platform === 'gbp' && selectedLocs.length === 0 && (
                <p className="text-xs text-amber-600 text-center">Select at least one location to publish to Google Business</p>
              )}

              {/* Platform note */}
              <p className="text-xs text-muted-foreground text-center">
                {usesBuffer
                  ? `Published via Buffer → ${pm.label}`
                  : 'Copy and paste into your CMS'}
              </p>
            </div>
          )}

          {isPublished && (item.buffer_update_id || item.resolved_url) && (
            <EngagementPanel itemId={itemId} platform={item.platform} />
          )}

          {isPublished && (
            <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-center space-y-2">
              <CheckCircle2 className="h-8 w-8 text-green-600 mx-auto" />
              <p className="text-sm font-medium text-green-800">Published</p>
              {item.published_at && <p className="text-xs text-green-700">{formatDate(item.published_at)}</p>}
              {item.platform_post_id && <p className="text-xs text-muted-foreground font-mono">{item.platform_post_id}</p>}

              <Button
                variant={item.performed_well ? 'default' : 'outline'}
                size="sm"
                className={`mt-2 ${item.performed_well ? 'bg-green-600 hover:bg-green-700' : ''}`}
                onClick={async () => {
                  const next = !item.performed_well
                  const updated = await updateContentItem(itemId, { performedWell: next })
                  qc.setQueryData(queryKeys.contentItems.detail(itemId), updated)
                  qc.invalidateQueries({ queryKey: queryKeys.contentItems.all })
                  toast.success(next ? 'Marked as performed well — will be used as AI exemplar' : 'Unmarked')
                }}
              >
                <ThumbsUp className={`h-4 w-4 mr-1.5 ${item.performed_well ? 'fill-current' : ''}`} />
                {item.performed_well ? 'Performed well' : 'Mark as performed well'}
              </Button>
              <p className="text-[11px] text-green-700/80 leading-snug px-2">
                Flagged posts become style references the AI uses when generating future {item.platform} content.
              </p>
            </div>
          )}

          {/* Feedback */}
          {error && (
            <div className="flex items-start gap-2 text-xs text-destructive bg-destructive/10 rounded-lg p-3">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />{error}
            </div>
          )}
          {success && (
            <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50 rounded-lg p-3">
              <CheckCircle2 className="h-4 w-4 shrink-0" />{success}
            </div>
          )}

          {/* Interview link */}
          <div className="rounded-lg bg-muted p-3 space-y-1">
            <p className="text-xs font-medium">Source interview</p>
            <Link
              to={`/output/${item.clinician_id}/${item.interview_id}`}
              className="text-xs text-primary hover:underline flex items-center gap-1"
            >
              View all outputs <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        </div>
      </div>

      {/* Media picker modal */}
      {showPicker && (
        <MediaPicker
          onSelect={addMedia}
          onClose={() => setShowPicker(false)}
          topic={item.topic}
        />
      )}
    </div>
  )
}

// Engagement panel — surfaces the latest engagement_snapshots row for this
// content_item. Two sources, two shapes:
//
//   Buffer (Tier 2): stats.statistics is a flat { reach, clicks, likes, ... }
//                    object. Manual refresh hits /api/engagement/refresh.
//
//   GA4 (Tier 3):    stats is { pageviews, engaged_sessions, engagement_time }.
//                    No manual refresh — the daily cron pulls these (interactive
//                    refresh would require a per-call GA4 API round-trip whose
//                    cost isn't justified for one-off editor curiosity).
function EngagementPanel({ itemId, platform: _platform }) {
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [snapshot, setSnapshot] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`/api/engagement/latest?contentItemId=${encodeURIComponent(itemId)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (!cancelled) setSnapshot(data?.snapshot || null) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [itemId])

  async function onRefresh() {
    setRefreshing(true)
    setErr(null)
    try {
      const r = await fetch('/api/engagement/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentItemId: itemId }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data?.error || `Refresh failed (${r.status})`)
      setSnapshot(data.snapshot)
      toast.success('Engagement refreshed')
    } catch (e) {
      setErr(e?.message || 'Refresh failed')
    } finally {
      setRefreshing(false)
    }
  }

  const source = snapshot?.source
  const isGA4  = source === 'ga4'

  // Normalise the per-source shape into [{label, value}] tiles.
  let tiles = []
  if (isGA4) {
    const s = snapshot?.stats || {}
    tiles = [
      { label: 'pageviews',        value: s.pageviews },
      { label: 'engaged sessions', value: s.engaged_sessions },
      { label: 'engagement time',  value: formatGA4Duration(s.engagement_time) },
    ].filter((t) => typeof t.value === 'number' || (typeof t.value === 'string' && t.value !== '0s'))
  } else {
    const stats = snapshot?.stats?.statistics || {}
    tiles = Object.entries(stats)
      .filter(([, v]) => typeof v === 'number')
      .map(([k, v]) => ({ label: k.replace(/_/g, ' '), value: v }))
  }
  const hasAnyStat = tiles.some((t) => (typeof t.value === 'number' ? t.value > 0 : Boolean(t.value)))

  return (
    <div className="rounded-xl border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium">Engagement</p>
        {!isGA4 && (
          <Button size="sm" variant="outline" onClick={onRefresh} disabled={refreshing}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        )}
      </div>

      {loading && <p className="text-xs text-muted-foreground">Loading…</p>}

      {!loading && !snapshot && (
        <p className="text-xs text-muted-foreground">
          No engagement data yet. {isGA4
            ? 'GA4 numbers refresh automatically every night.'
            : <>Click <span className="font-medium">Refresh</span> to pull the latest stats from Buffer.</>}
        </p>
      )}

      {!loading && snapshot && !hasAnyStat && (
        <p className="text-xs text-muted-foreground">
          {isGA4
            ? 'GA4 reports no traffic to this URL yet — give it a few days for indexing and analytics ingestion.'
            : 'Buffer reports no engagement on this post yet — give it a day or two and refresh again.'}
        </p>
      )}

      {!loading && snapshot && hasAnyStat && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-md bg-muted/40 px-2.5 py-1.5">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{t.label}</p>
              <p className="text-sm font-semibold tabular-nums">{t.value}</p>
            </div>
          ))}
        </div>
      )}

      {snapshot?.fetched_at && (
        <p className="text-[11px] text-muted-foreground">
          Last pulled {formatDate(snapshot.fetched_at)} · source: {source}
        </p>
      )}

      {err && (
        <p className="text-xs text-destructive">{err}</p>
      )}
    </div>
  )
}

// GA4 returns userEngagementDuration as total seconds across all sessions.
// Render it as a human-readable string so the tile is glanceable instead of
// a five-digit number that no editor will translate in their head.
function formatGA4Duration(totalSeconds) {
  const s = Number(totalSeconds)
  if (!Number.isFinite(s) || s <= 0) return '0s'
  if (s < 60) return `${Math.round(s)}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const rem = m % 60
  return rem ? `${h}h ${rem}m` : `${h}h`
}

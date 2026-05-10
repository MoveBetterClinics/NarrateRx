import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useUser } from '@clerk/clerk-react'
import {
  ArrowLeft, Send, CalendarDays, CheckCircle2, Loader2, Copy, Check,
  AlertCircle, Image, Trash2, ExternalLink, Eye, Pencil,
  ChevronLeft, ChevronRight, Play, Video, RefreshCw, RotateCcw,
} from 'lucide-react'
import PostPreview from '@/components/PostPreview'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { fetchContentItem, fetchContentItems, updateContentItem, publishAndTrack, fetchGBPLocations } from '@/lib/publish'
import { fetchInterview } from '@/lib/api'
import { getBlogPostSystemPrompt, getSocialBatchSystemPrompt, getVideoScriptBatchSystemPrompt, getMarketingBatchSystemPrompt } from '@/lib/prompts'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { applyLocationOverlay } from '@/lib/locationOverlay'
import { PLATFORM_META, STATUS_META } from './ContentHub'
import MediaPicker from '@/components/MediaPicker'
import { formatDate, formatRelativeDate } from '@/lib/utils'

const DIRECT_PLATFORMS  = ['facebook', 'gbp']
const BUFFER_PLATFORMS  = ['instagram', 'linkedin', 'pinterest']
const NEEDS_MEDIA       = ['instagram', 'facebook', 'gbp']

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
  const { itemId }   = useParams()
  const navigate     = useNavigate()
  const { user }     = useUser()
  const workspace    = useWorkspace()

  const [item, setItem]               = useState(null)
  const [content, setContent]         = useState('')
  const [loading, setLoading]         = useState(true)
  const [saving, setSaving]           = useState(false)
  const [saveStatus, setSaveStatus]   = useState('') // '' | 'saving' | 'saved'
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
        await updateContentItem(itemId, { content })
        setSaveStatus('saved')
        setTimeout(() => setSaveStatus(''), 2000)
      } catch {
        setSaveStatus('')
      }
    }, 2000)

    return () => clearTimeout(autoSaveTimer.current)
  }, [content])

  useEffect(() => {
    fetchContentItem(itemId)
      .then((i) => {
        setItem(i)
        setContent(i?.content || '')
        if (i?.scheduled_at) {
          setScheduledAt(i.scheduled_at.slice(0, 16))
          setScheduleIsCustom(true)
        }
        setTimeout(() => { isFirstLoad.current = false }, 100)
        if (i?.status === 'draft') {
          updateContentItem(itemId, { status: 'in_review' })
            .then((updated) => setItem(updated))
            .catch(() => {})
        }
        if (i?.platform === 'gbp') {
          fetchGBPLocations()
            .then(({ locations }) => {
              setGbpLocations(locations)
              const allIds = locations.map((l) => l.id)
              // If the row already has a saved selection, restore it (filtered
              // against currently-configured locations). NULL = "all locations".
              const saved = Array.isArray(i.target_locations) ? i.target_locations.filter((id) => allIds.includes(id)) : null
              // If this content item is bound to a single workspace_location
              // and that location has a gbp_location_id, default the picker to
              // just that one — the multi-location workflow.
              const wsLoc = i.location_id
                ? (workspace?.locations || []).find((l) => l.id === i.location_id)
                : null
              const wsGbpId = wsLoc?.gbp_location_id
              const defaultFromWsLoc = wsGbpId && allIds.includes(wsGbpId) ? [wsGbpId] : null
              setSelectedLocs(
                saved && saved.length
                  ? saved
                  : (defaultFromWsLoc || allIds)
              )
            })
            .catch(() => {})
        }
      })
      .catch(() => navigate('/hub'))
      .finally(() => setLoading(false))
  }, [itemId])

  // Auto-suggest a schedule time based on what's already queued
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
      setSuccess(effectiveScheduledAt ? 'Scheduled successfully!' : 'Published successfully!')
      setTimeout(() => navigate('/hub'), 1500)
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

      const res = await fetch('/api/generate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          messages: inputMessages,
          systemPrompt,
          ...(platform === 'blog' ? { model: 'claude-opus-4-7' } : {}),
        }),
      })
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        throw new Error(errBody.error || `Generation failed (${res.status})`)
      }
      const data = await res.json()
      const generated = data.content?.[0]?.text || ''
      if (!generated) throw new Error(data.error || 'No content returned from generation.')

      const [startMarker, endMarker] = PLATFORM_MARKERS[platform] || [null, null]
      const newContent = extractSection(generated, startMarker, endMarker)
      if (!newContent) throw new Error('Could not parse content from the generated output.')

      const updated = await updateContentItem(itemId, { content: newContent, status: 'in_review', updatedAt: new Date().toISOString() })
      setItem(updated)
      setContent(newContent)
      setSuccess('Content regenerated!')
      setTimeout(() => setSuccess(''), 3000)
    } catch (e) {
      setError(`Regenerate failed: ${e.message}`)
    } finally {
      setRegenerating(false)
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function removeMedia(index) {
    const urls = [...(item.media_urls || [])]
    urls.splice(index, 1)
    const updated = await updateContentItem(itemId, { mediaUrls: urls })
    setItem(updated)
  }

  async function reorderMedia(fromIndex, toIndex) {
    const urls = [...(item.media_urls || [])]
    const [moved] = urls.splice(fromIndex, 1)
    urls.splice(toIndex, 0, moved)
    const updated = await updateContentItem(itemId, { mediaUrls: urls })
    setItem(updated)
  }

  async function addMedia(file) {
    const urls = [...(item.media_urls || []), file]
    const updated = await updateContentItem(itemId, { mediaUrls: urls })
    setItem(updated)
    setShowPicker(false)
  }

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
  if (!item)   return null

  const pm = PLATFORM_META[item.platform] || PLATFORM_META.blog
  const sm = STATUS_META[item.status]     || STATUS_META.draft
  const Icon = pm.icon
  const needsMedia      = NEEDS_MEDIA.includes(item.platform)
  const hasMedia        = (item.media_urls || []).length > 0
  const canPublishDirect = DIRECT_PLATFORMS.includes(item.platform)
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

              {/* GBP location picker */}
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
                        {loc.name}
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

              {/* Platform note */}
              <p className="text-xs text-muted-foreground text-center">
                {canPublishDirect
                  ? `Posts directly to your ${pm.label} page`
                  : usesBuffer
                    ? `Published via Buffer → ${pm.label}`
                    : 'Copy and paste into your CMS'}
              </p>
            </div>
          )}

          {isPublished && (
            <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-center space-y-2">
              <CheckCircle2 className="h-8 w-8 text-green-600 mx-auto" />
              <p className="text-sm font-medium text-green-800">Published</p>
              {item.published_at && <p className="text-xs text-green-700">{formatDate(item.published_at)}</p>}
              {item.platform_post_id && <p className="text-xs text-muted-foreground font-mono">{item.platform_post_id}</p>}
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

import { useState, useRef, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Scissors, Loader2, AlertCircle, ShieldAlert, ChevronLeft,
  Play, Pause, Film, BookOpen, Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { useAppMutation } from '@/lib/useAppMutation'
import { apiFetch } from '@/lib/api'
import { getMediaAsset } from '@/lib/mediaLib'
import { toast } from '@/lib/toast'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

// Platforms available for "As a post" output
const POST_PLATFORMS = [
  { id: 'instagram', label: 'Instagram' },
  { id: 'linkedin',  label: 'LinkedIn' },
  { id: 'facebook',  label: 'Facebook' },
  { id: 'tiktok',    label: 'TikTok' },
  { id: 'youtube',   label: 'YouTube' },
  { id: 'gbp',       label: 'Google Business' },
]

// Default render channel for "As a post" — one clip per session in Phase 1.
const DEFAULT_CHANNEL = 'instagram_reel'

function formatTime(sec) {
  if (!isFinite(sec)) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function SlateClipEditor() {
  useDocumentTitle('Clip Editor · Slate')
  const { assetId } = useParams()
  const navigate = useNavigate()
  const ws = useWorkspace()

  // --- Source asset ---
  const { data: asset, isLoading, error } = useQuery({
    queryKey: ['media-asset', assetId],
    queryFn: () => getMediaAsset(assetId),
    enabled: !!assetId,
    retry: 1,
  })

  // --- Video playback ---
  const videoRef = useRef(null)
  const [playing, setPlaying] = useState(false)
  const [videoDuration, setVideoDuration] = useState(0)

  function togglePlay() {
    const v = videoRef.current
    if (!v) return
    if (playing) { v.pause() } else { v.play() }
  }

  // --- Trim state ---
  const [startSec, setStartSec] = useState(0)
  const [durationSec, setDurationSec] = useState(60)  // default 60s max

  useEffect(() => {
    if (videoDuration > 0) {
      setDurationSec(Math.min(videoDuration, 60))
    }
  }, [videoDuration])

  const endSec = Math.min(startSec + durationSec, videoDuration || Infinity)

  // --- Caption text ---
  const [captionText, setCaptionText] = useState('')

  // --- Platform selection for "As a post" ---
  const [platform, setPlatform] = useState('instagram')

  // --- Render state (shared before both outputs) ---
  const [rendering, setRendering] = useState(false)
  const [renderedBlobUrl, setRenderedBlobUrl] = useState(null)
  const [renderDims, setRenderDims] = useState({ width: null, height: null, sizeBytes: null })

  async function renderClip() {
    setRendering(true)
    setRenderedBlobUrl(null)
    try {
      const result = await apiFetch('/api/editorial/render-clip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assetId,
          captionText,
          channels: [DEFAULT_CHANNEL],
          startSec,
          durationSec,
          subtitles: true,
        }),
      })
      const render = result?.renders?.[0]
      if (!render?.blobUrl) {
        toast.error('Render returned no output. Check the server logs.')
        return null
      }
      setRenderedBlobUrl(render.blobUrl)
      setRenderDims({ width: render.width, height: render.height, sizeBytes: render.sizeBytes })
      return render
    } catch (e) {
      toast.error(e?.message || 'Render failed.')
      return null
    } finally {
      setRendering(false)
    }
  }

  // --- "As a post" mutation ---
  const asPostMutation = useAppMutation({
    mutationFn: async () => {
      let blobUrl = renderedBlobUrl
      if (!blobUrl) {
        const render = await renderClip()
        if (!render) throw new Error('Render failed — cannot create post.')
        blobUrl = render.blobUrl
      }
      return apiFetch('/api/editorial/clip-to-post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId, renderedBlobUrl: blobUrl, captionText, platform }),
      })
    },
    onSuccess: (data) => {
      const id = data?.contentItemId
      if (id) {
        toast('Draft created — opening in Storyboard.')
        navigate(`/storyboard/${id}`)
      } else {
        toast.error('Post created but no ID returned.')
      }
    },
  })

  // --- "Library b-roll" mutation ---
  const brollMutation = useAppMutation({
    mutationFn: async () => {
      let blobUrl = renderedBlobUrl
      let dims = renderDims
      if (!blobUrl) {
        const render = await renderClip()
        if (!render) throw new Error('Render failed — cannot save b-roll.')
        blobUrl = render.blobUrl
        dims = { width: render.width || null, height: render.height || null, sizeBytes: render.sizeBytes || null }
      }
      return apiFetch('/api/editorial/clip-to-broll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assetId,
          renderedBlobUrl: blobUrl,
          width: dims.width,
          height: dims.height,
          sizeBytes: dims.sizeBytes,
          captionText,
        }),
      })
    },
    onSuccess: () => {
      toast('Saved to Library — the clip will appear in Suggested media shortly.')
      navigate('/slate')
    },
  })

  const busy = rendering || asPostMutation.isPending || brollMutation.isPending

  // Consent check
  const consentBlocked = asset?.consent_status === 'pending' || asset?.consent_status === 'revoked'

  if (!ws?.video_pipeline_enabled) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
        <Film className="h-10 w-10 text-muted-foreground" />
        <p className="font-semibold text-lg">Slate is not enabled for this workspace</p>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error || !asset) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
        <AlertCircle className="h-8 w-8 text-destructive" />
        <p className="text-sm text-destructive font-medium">Could not load asset</p>
        <Button size="sm" variant="outline" onClick={() => navigate('/slate')}>Back to Slate</Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate('/slate')} className="gap-1.5">
          <ChevronLeft className="h-4 w-4" />
          Slate
        </Button>
        <div className="h-4 w-px bg-border" />
        <div className="flex items-center gap-2">
          <Scissors className="h-4 w-4 text-muted-foreground" />
          <h1 className="text-lg font-bold truncate">{asset.filename || 'Clip editor'}</h1>
        </div>
      </div>

      {/* Consent blocking state */}
      {consentBlocked && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <ShieldAlert className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-amber-900 text-sm">Consent {asset.consent_status}</p>
            <p className="text-xs text-amber-800 mt-1">
              This source asset is awaiting consent. Resolve the consent status in the Library
              before cutting clips from it.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="mt-2 border-amber-300 text-amber-900 hover:bg-amber-100"
              onClick={() => navigate(`/library?asset=${assetId}`)}
            >
              Go to Library
            </Button>
          </div>
        </div>
      )}

      {/* Video preview */}
      <div className="rounded-xl overflow-hidden bg-black aspect-video relative">
        {asset.blob_url ? (
          <>
            <video
              ref={videoRef}
              src={asset.blob_url}
              className="w-full h-full object-contain"
              onLoadedMetadata={(e) => setVideoDuration(e.target.duration)}
              onTimeUpdate={() => {}}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
              playsInline
            />
            <button
              type="button"
              onClick={togglePlay}
              className="absolute inset-0 flex items-center justify-center group"
              aria-label={playing ? 'Pause' : 'Play'}
            >
              <div className={`rounded-full bg-black/50 p-4 transition-opacity ${playing ? 'opacity-0 group-hover:opacity-100' : 'opacity-100'}`}>
                {playing
                  ? <Pause className="h-8 w-8 text-white" />
                  : <Play  className="h-8 w-8 text-white" />
                }
              </div>
            </button>
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            No video URL
          </div>
        )}
      </div>

      {/* Trim controls */}
      <div className="flex flex-col gap-3 rounded-xl border border-border p-4">
        <p className="text-sm font-semibold">Trim clip</p>

        <div className="flex items-center gap-3">
          <label className="text-xs text-muted-foreground w-16 shrink-0">Start</label>
          <input
            type="range"
            min={0}
            max={Math.max(0, videoDuration - 1)}
            step={0.5}
            value={startSec}
            onChange={(e) => {
              const v = Number(e.target.value)
              setStartSec(v)
              if (v + durationSec > videoDuration) {
                setDurationSec(Math.max(1, videoDuration - v))
              }
              if (videoRef.current) videoRef.current.currentTime = v
            }}
            className="flex-1 accent-primary"
            disabled={videoDuration === 0}
          />
          <span className="text-xs font-mono w-12 text-right">{formatTime(startSec)}</span>
        </div>

        <div className="flex items-center gap-3">
          <label className="text-xs text-muted-foreground w-16 shrink-0">Duration</label>
          <input
            type="range"
            min={1}
            max={Math.min(60, Math.max(1, videoDuration - startSec))}
            step={0.5}
            value={durationSec}
            onChange={(e) => setDurationSec(Number(e.target.value))}
            className="flex-1 accent-primary"
            disabled={videoDuration === 0}
          />
          <span className="text-xs font-mono w-12 text-right">{formatTime(durationSec)}</span>
        </div>

        <p className="text-xs text-muted-foreground">
          Clip: {formatTime(startSec)} → {formatTime(endSec)} ({formatTime(durationSec)})
        </p>
      </div>

      {/* Caption band text */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-semibold">Caption band</label>
        <Textarea
          value={captionText}
          onChange={(e) => {
            setCaptionText(e.target.value)
            setRenderedBlobUrl(null)  // invalidate prior render when caption changes
          }}
          placeholder="Text overlaid on the clip…"
          rows={3}
          maxLength={500}
          className="resize-none"
        />
        <p className="text-xs text-muted-foreground text-right">{captionText.length}/500</p>
      </div>

      {/* Output buttons */}
      <div className="flex flex-col gap-3">
        <p className="text-sm font-semibold">Send to…</p>

        {/* Platform picker for "As a post" */}
        <div className="flex flex-wrap gap-2">
          {POST_PLATFORMS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPlatform(p.id)}
              className={`text-xs px-3 py-1.5 rounded-full font-medium border transition-colors ${
                platform === p.id
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-border text-muted-foreground hover:border-primary/40'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="flex gap-3 flex-wrap">
          {/* As a post */}
          <Button
            className="flex-1 min-w-40 bg-orange-500 hover:bg-orange-600 text-white font-semibold shadow gap-2"
            onClick={() => asPostMutation.mutate()}
            disabled={busy || consentBlocked}
          >
            {asPostMutation.isPending || (rendering && !brollMutation.isPending) ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> {rendering ? 'Rendering…' : 'Creating draft…'}</>
            ) : (
              <><Film className="h-4 w-4" /> As a post</>
            )}
          </Button>

          {/* Library b-roll */}
          <Button
            variant="outline"
            className="flex-1 min-w-40 font-semibold gap-2"
            onClick={() => brollMutation.mutate()}
            disabled={busy || consentBlocked}
          >
            {brollMutation.isPending || (rendering && !asPostMutation.isPending) ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> {rendering ? 'Rendering…' : 'Saving…'}</>
            ) : (
              <><BookOpen className="h-4 w-4" /> Library b-roll</>
            )}
          </Button>
        </div>

        {/* Phase 2 — Auto-suggest slot (disabled) */}
        <Button
          variant="ghost"
          className="w-full gap-2 text-muted-foreground border border-dashed border-muted-foreground/30 opacity-50 cursor-not-allowed"
          disabled
        >
          <Sparkles className="h-4 w-4" />
          Auto-suggest a post
          <span className="ml-1 text-2xs bg-muted px-1.5 py-0.5 rounded font-medium">Coming soon</span>
        </Button>
      </div>
    </div>
  )
}

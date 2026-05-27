import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Loader2, Search, Sparkles, Download, ImageIcon, Package } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { toast } from '@/lib/toast'
import { useAppMutation } from '@/lib/useAppMutation'
import { apiFetch } from '@/lib/api'

// Phase 2 internal test page for the editorial pipeline.
// Two modes:
//  • Manual: Search clips → pick one → caption → render (validates each step)
//  • Auto:   Type topic → Generate Package (one call: clip-pull + caption + render)
//
// Not part of the public Story Director UI (that's Phase 3). This is an
// internal surface for validating the Day 6-8 pipeline end-to-end
// without curl gymnastics.

const PHOTO_CHANNELS = [
  { id: 'linkedin_feed',        label: 'LinkedIn (1:1)',      defaultOn: true  },
  { id: 'instagram_reel_still', label: 'IG Reel still (9:16)', defaultOn: true  },
  { id: 'blog_hero',            label: 'Blog hero (16:9)',    defaultOn: true  },
  { id: 'instagram_feed',       label: 'IG feed (1:1)',       defaultOn: false },
  { id: 'facebook_feed',        label: 'Facebook (4:5)',      defaultOn: false },
  { id: 'tiktok_still',         label: 'TikTok still (9:16)', defaultOn: false },
]

const VIDEO_CHANNELS = [
  { id: 'linkedin_video',  label: 'LinkedIn video (1:1)',   defaultOn: true  },
  { id: 'instagram_reel',  label: 'IG Reel (9:16)',         defaultOn: true  },
  { id: 'blog_hero_video', label: 'Blog hero video (16:9)', defaultOn: true  },
  { id: 'tiktok',          label: 'TikTok (9:16)',          defaultOn: false },
  { id: 'youtube_short',   label: 'YouTube Short (9:16)',   defaultOn: false },
  { id: 'facebook_video',  label: 'Facebook video (4:5)',   defaultOn: false },
]

function similarityBadge(sim) {
  const pct = Math.round(sim * 100)
  const color =
    pct >= 80 ? 'bg-green-100 text-green-800' :
    pct >= 65 ? 'bg-yellow-100 text-yellow-800' :
                'bg-zinc-100 text-zinc-700'
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${color}`}>
      {pct}%
    </span>
  )
}

export default function EditorialTest() {
  useDocumentTitle('Editorial Test')

  const [query, setQuery] = useState('')
  const [k, setK] = useState(8)
  const [clips, setClips] = useState([])
  const [selectedClip, setSelectedClip] = useState(null)
  const [captionText, setCaptionText] = useState('')
  const [channelOn, setChannelOn] = useState(
    () => Object.fromEntries(PHOTO_CHANNELS.map((c) => [c.id, c.defaultOn])),
  )
  const [renders, setRenders] = useState([])
  const [autoPackage, setAutoPackage] = useState(null)  // result of generate-package

  // Channel list depends on selected clip kind (photo vs video)
  const activeChannels = selectedClip?.kind === 'video' ? VIDEO_CHANNELS : PHOTO_CHANNELS
  const selectedChannels = activeChannels.filter((c) => channelOn[c.id]).map((c) => c.id)

  // Reset channel toggles when a new clip is selected (in case kind changes photo↔video)
  const handleSelectClip = (clip) => {
    const list = clip.kind === 'video' ? VIDEO_CHANNELS : PHOTO_CHANNELS
    setChannelOn(Object.fromEntries(list.map((c) => [c.id, c.defaultOn])))
    setSelectedClip(clip)
    setRenders([])
  }

  const searchMutation = useAppMutation({
    mutationFn: () =>
      apiFetch('/api/editorial/pull-clips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim(), k }),
      }),
    onSuccess: (data) => {
      setClips(data?.clips || [])
      setSelectedClip(null)
      setRenders([])
      if (!data?.clips?.length) {
        toast('No matching clips. Try a broader topic.')
      }
    },
    onError: (err) => {
      toast.error(err?.message || 'Search failed')
    },
  })

  const renderMutation = useAppMutation({
    mutationFn: () =>
      apiFetch('/api/editorial/render-clip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assetId: selectedClip.assetId,
          captionText: captionText.trim(),
          channels: selectedChannels,
        }),
      }),
    onSuccess: (data) => {
      setRenders(data?.renders || [])
      if (data?.errors?.length) {
        toast.error(`${data.errors.length} channel(s) failed — see browser console`)
        console.error('Render errors:', data.errors)
      } else {
        toast(`Rendered ${data?.renders?.length || 0} channel(s)`)
      }
    },
    onError: (err) => {
      toast.error(err?.message || 'Render failed')
    },
  })

  const packageMutation = useAppMutation({
    mutationFn: () =>
      apiFetch('/api/editorial/generate-package', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: query.trim() }),
      }),
    onSuccess: (data) => {
      setAutoPackage(data)
      if (data?.errors?.length) {
        toast.error(`Package generated with ${data.errors.length} render error(s)`)
        console.error('Package errors:', data.errors)
      } else {
        toast(`Package ready — ${data?.renders?.length || 0} channels rendered`)
      }
    },
    onError: (err) => {
      toast.error(err?.message || 'Package generation failed')
    },
  })

  const onSearch = (e) => {
    e?.preventDefault?.()
    if (!query.trim()) return
    searchMutation.mutate()
  }

  const onRender = () => {
    if (!selectedClip) return
    if (selectedChannels.length === 0) {
      toast.error('Select at least one channel')
      return
    }
    renderMutation.mutate()
  }

  const onGeneratePackage = () => {
    if (!query.trim()) {
      toast.error('Enter a topic first')
      return
    }
    setAutoPackage(null)
    packageMutation.mutate()
  }

  return (
    <div className="container mx-auto max-w-6xl px-4 py-8">
      <Link to="/" className="inline-flex items-center text-sm text-zinc-600 hover:text-zinc-900 mb-4">
        <ArrowLeft className="w-4 h-4 mr-1" /> Back
      </Link>

      <h1 className="text-2xl font-semibold mb-1">Editorial pipeline test</h1>
      <p className="text-sm text-zinc-600 mb-6">
        Internal dev surface for Phase 2. Search visual memory → pick a clip → see brand-rendered output across channels.
      </p>

      {/* ── Section 1: Search ──────────────────────────────────────────────── */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <form onSubmit={onSearch} className="space-y-4">
            <div>
              <Label htmlFor="query">Topic / prompt</Label>
              <Input
                id="query"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder='e.g. "spinal manipulation technique" or "hands-on care"'
                autoFocus
              />
            </div>
            <div className="flex items-end gap-3">
              <div>
                <Label htmlFor="k">K</Label>
                <Input
                  id="k"
                  type="number"
                  min={1}
                  max={20}
                  value={k}
                  onChange={(e) => setK(Math.min(20, Math.max(1, parseInt(e.target.value, 10) || 1)))}
                  className="w-20"
                />
              </div>
              <Button
                type="submit"
                variant="outline"
                disabled={searchMutation.isPending || !query.trim()}
              >
                {searchMutation.isPending
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Searching</>
                  : <><Search className="w-4 h-4 mr-2" /> Search clips</>}
              </Button>
              <Button
                type="button"
                onClick={onGeneratePackage}
                disabled={packageMutation.isPending || !query.trim()}
                className="ml-auto"
              >
                {packageMutation.isPending
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating…</>
                  : <><Package className="w-4 h-4 mr-2" /> Generate Package</>}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* ── Auto-Package result ──────────────────────────────────────────────── */}
      {autoPackage && (
        <Card className="mb-6 border-primary/40">
          <CardContent className="pt-6 space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Package className="w-4 h-4 text-primary" />
              <span>Package generated — {autoPackage.renders?.length || 0} channel(s)</span>
              <span className="text-zinc-400">•</span>
              <span className="text-zinc-600 font-normal truncate">{autoPackage.clip?.filename}</span>
              <span className="text-zinc-400">•</span>
              <span className="text-zinc-500 font-normal">{Math.round((autoPackage.elapsedMs || 0) / 1000)}s</span>
            </div>
            {autoPackage.captionText && (
              <p className="text-sm text-zinc-700 italic">&ldquo;{autoPackage.captionText}&rdquo;</p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {(autoPackage.renders || []).map((r) => {
                const allChannels = [...PHOTO_CHANNELS, ...VIDEO_CHANNELS]
                const chLabel = allChannels.find((c) => c.id === r.channel)?.label || r.channel
                const isVideoRender = r.blobUrl?.endsWith('.mp4')
                return (
                  <div key={r.channel} className="rounded-lg border border-zinc-200 overflow-hidden">
                    {isVideoRender ? (
                      <video src={r.blobUrl} controls className="w-full bg-zinc-900" preload="metadata" />
                    ) : (
                      <img src={r.blobUrl} alt={chLabel} className="w-full bg-zinc-100" loading="lazy" />
                    )}
                    <div className="p-3 flex items-center justify-between">
                      <div>
                        <div className="text-sm font-medium">{chLabel}</div>
                        <div className="text-xs text-zinc-500">
                          {r.width}×{r.height} · {Math.round(r.sizeBytes / 1024)}KB
                          {r.hadSubtitles && <span className="ml-2 text-green-600">+ captions</span>}
                        </div>
                      </div>
                      <a href={r.blobUrl} download target="_blank" rel="noreferrer"
                        className="inline-flex items-center text-sm text-primary hover:underline">
                        <Download className="w-4 h-4 mr-1" /> Save
                      </a>
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Section 2: Results ─────────────────────────────────────────────── */}
      {clips.length > 0 && (
        <div className="mb-6">
          <h2 className="text-lg font-medium mb-3">
            Top {clips.length} clips for &ldquo;{searchMutation.variables ? query : ''}&rdquo;
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {clips.map((clip) => {
              const isSel = selectedClip?.chunkId === clip.chunkId
              const thumb = clip.thumbnailUrl || clip.blobUrl
              return (
                <button
                  key={clip.chunkId}
                  type="button"
                  onClick={() => handleSelectClip(clip)}
                  className={`text-left rounded-lg border-2 overflow-hidden transition ${
                    isSel
                      ? 'border-primary ring-2 ring-primary/30'
                      : 'border-zinc-200 hover:border-zinc-400'
                  }`}
                >
                  {thumb ? (
                    <img
                      src={thumb}
                      alt={clip.filename || 'clip thumbnail'}
                      className="w-full aspect-square object-cover bg-zinc-100"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full aspect-square bg-zinc-100 flex items-center justify-center text-zinc-400">
                      <ImageIcon className="w-12 h-12" />
                    </div>
                  )}
                  <div className="p-3">
                    <div className="flex items-center justify-between mb-1">
                      {similarityBadge(clip.similarity)}
                      <span className="text-xs text-zinc-500 uppercase tracking-wide">{clip.kind}</span>
                    </div>
                    <div className="text-sm font-medium truncate" title={clip.filename}>{clip.filename}</div>
                    {clip.visualNarrative && (
                      <div className="text-xs text-zinc-600 line-clamp-2 mt-1">{clip.visualNarrative}</div>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Section 3: Render ──────────────────────────────────────────────── */}
      {selectedClip && (
        <Card className="mb-6">
          <CardContent className="pt-6 space-y-4">
            <div className="flex items-center gap-2 text-sm">
              <Sparkles className="w-4 h-4 text-primary" />
              <span className="text-zinc-700">Render</span>
              <span className="text-zinc-400">•</span>
              <span className="font-medium">{selectedClip.filename}</span>
              <span className="text-zinc-400">•</span>
              {similarityBadge(selectedClip.similarity)}
            </div>

            <div>
              <Label htmlFor="caption">Caption text</Label>
              <Textarea
                id="caption"
                value={captionText}
                onChange={(e) => setCaptionText(e.target.value)}
                rows={3}
                placeholder='e.g. "When stress accumulates faster than your body can keep up with..."'
              />
              <p className="text-xs text-zinc-500 mt-1">Wraps to 3 lines max in the caption band.</p>
            </div>

            <div>
              <Label>Channels
                <span className="ml-2 text-xs font-normal text-zinc-400">
                  ({selectedClip?.kind === 'video' ? 'video outputs' : 'photo outputs'})
                </span>
              </Label>
              <div className="flex flex-wrap gap-2 mt-1.5">
                {activeChannels.map((ch) => (
                  <label key={ch.id} className="inline-flex items-center gap-2 text-sm cursor-pointer rounded border border-zinc-200 px-3 py-1.5 hover:border-zinc-400 transition">
                    <input
                      type="checkbox"
                      checked={!!channelOn[ch.id]}
                      onChange={() => setChannelOn((prev) => ({ ...prev, [ch.id]: !prev[ch.id] }))}
                    />
                    {ch.label}
                  </label>
                ))}
              </div>
            </div>

            <Button
              onClick={onRender}
              disabled={renderMutation.isPending || selectedChannels.length === 0}
            >
              {renderMutation.isPending
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Rendering</>
                : <><Sparkles className="w-4 h-4 mr-2" /> Render {selectedChannels.length} channel{selectedChannels.length === 1 ? '' : 's'}</>}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── Section 4: Rendered output ─────────────────────────────────────── */}
      {renders.length > 0 && (
        <div>
          <h2 className="text-lg font-medium mb-3">Rendered output</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {renders.map((r) => {
              const allChannels = [...PHOTO_CHANNELS, ...VIDEO_CHANNELS]
              const chLabel = allChannels.find((c) => c.id === r.channel)?.label || r.channel
              const isVideoRender = r.blobUrl?.endsWith('.mp4')
              return (
                <div key={r.channel} className="rounded-lg border border-zinc-200 overflow-hidden">
                  {isVideoRender ? (
                    <video
                      src={r.blobUrl}
                      controls
                      className="w-full bg-zinc-900"
                      preload="metadata"
                    />
                  ) : (
                    <img
                      src={r.blobUrl}
                      alt={`${r.channel} render`}
                      className="w-full bg-zinc-100"
                      loading="lazy"
                    />
                  )}
                  <div className="p-3 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium">{chLabel}</div>
                      <div className="text-xs text-zinc-500">
                        {r.width}×{r.height} · {Math.round(r.sizeBytes / 1024)}KB
                        {r.hadSubtitles && <span className="ml-2 text-green-600">+ captions</span>}
                      </div>
                    </div>
                    <a
                      href={r.blobUrl}
                      download
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center text-sm text-primary hover:underline"
                    >
                      <Download className="w-4 h-4 mr-1" /> Save
                    </a>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

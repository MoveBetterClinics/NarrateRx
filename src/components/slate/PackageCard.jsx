import { useState } from 'react'
import { Loader2, CheckCircle2, XCircle, Sparkles, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'

const CHANNEL_LABEL = {
  linkedin_feed:         'LI',
  linkedin_video:        'LI',
  instagram_reel_still:  'IG',
  instagram_reel:        'IG',
  instagram_feed:        'IG',
  blog_hero:             'Blog',
  blog_hero_video:       'Blog',
  tiktok_still:          'TT',
  tiktok:                'TT',
  youtube_short:         'YT',
  facebook_feed:         'FB',
  facebook_video:        'FB',
  gbp_post:              'GBP',
}

function ChannelChip({ channel }) {
  return (
    <span className="inline-flex items-center justify-center rounded-md bg-white/90 text-3xs font-bold text-zinc-800 w-[26px] h-[22px] shadow-sm">
      {CHANNEL_LABEL[channel] || channel.slice(0, 2).toUpperCase()}
    </span>
  )
}

function SimilarityBadge({ similarity }) {
  const pct = Math.round((similarity || 0) * 100)
  const color =
    pct >= 80 ? 'bg-emerald-500/80' :
    pct >= 65 ? 'bg-amber-500/80' :
                'bg-zinc-500/70'
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-3xs font-bold text-white ${color} backdrop-blur-sm`}>
      <Sparkles className="h-2.5 w-2.5" />
      {pct}%
    </span>
  )
}

/**
 * @param {{ pkg: object, clinicianName?: string, onApprove: fn, onSkip: fn }}
 */
export default function PackageCard({ pkg, clinicianName, onApprove, onSkip }) {
  const [approving, setApproving] = useState(false)

  const isGenerating = pkg.status === 'generating' || pkg.status === 'pending'
  const isFailed     = pkg.status === 'failed'
  const renders      = Array.isArray(pkg.renders) ? pkg.renders : []
  const previewRender = renders[0]
  const isVideo = previewRender?.blobUrl?.endsWith('.mp4')

  async function handleApprove() {
    setApproving(true)
    try {
      await onApprove(pkg)
    } finally {
      setApproving(false)
    }
  }

  return (
    <article className="flex flex-col rounded-xl border border-border bg-card overflow-hidden shadow-sm hover:shadow-md transition-shadow">
      {/* Thumbnail */}
      <div className="relative aspect-[4/5] bg-muted overflow-hidden">
        {isGenerating ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-zinc-900/80 text-white">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="text-xs font-medium">Generating…</span>
          </div>
        ) : isFailed ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-destructive/10 text-destructive">
            <XCircle className="h-6 w-6" />
            <span className="text-xs font-medium">Render failed</span>
          </div>
        ) : previewRender ? (
          <>
            {isVideo ? (
              <video
                src={previewRender.blobUrl}
                className="absolute inset-0 w-full h-full object-cover"
                muted
                playsInline
                preload="metadata"
              />
            ) : (
              <img
                src={previewRender.blobUrl}
                alt={pkg.topic}
                className="absolute inset-0 w-full h-full object-cover"
                loading="lazy"
              />
            )}
            {isVideo && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="bg-black/50 rounded-full p-2">
                  <Play className="h-5 w-5 text-white fill-white" />
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-muted text-muted-foreground text-xs">
            No preview
          </div>
        )}

        {/* Badges overlay */}
        {!isGenerating && !isFailed && (
          <>
            <div className="absolute top-2 left-2">
              <SimilarityBadge similarity={pkg.similarity} />
            </div>
            {renders.length > 0 && (
              <div className="absolute bottom-2 right-2 flex gap-1 flex-wrap justify-end">
                {(pkg.channels || []).slice(0, 4).map((ch) => (
                  <ChannelChip key={ch} channel={ch} />
                ))}
                {(pkg.channels || []).length > 4 && (
                  <span className="text-3xs text-white font-bold">+{pkg.channels.length - 4}</span>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Body */}
      <div className="flex flex-col gap-1.5 p-3 flex-1">
        <h3 className="text-sm font-semibold leading-snug line-clamp-2">{pkg.topic}</h3>
        <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
          {pkg.caption_text}
        </p>
        {(clinicianName || renders.length > 0) && (
          <p className="text-2xs text-muted-foreground mt-0.5">
            {clinicianName && <span>{clinicianName}</span>}
            {clinicianName && renders.length > 0 && <span className="mx-1 opacity-50">·</span>}
            {renders.length > 0 && <span>{renders.length} channel{renders.length !== 1 ? 's' : ''}</span>}
          </p>
        )}
      </div>

      {/* Actions */}
      {!isGenerating && !isFailed && (
        <div className="flex gap-1.5 p-2.5 border-t border-border bg-muted/30">
          <Button
            size="sm"
            variant="outline"
            className="flex-1 text-xs h-8"
            onClick={() => onSkip?.(pkg)}
          >
            Skip
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="flex-1 text-xs h-8"
            disabled
          >
            Edit
          </Button>
          <Button
            size="sm"
            className="flex-1 text-xs h-8 bg-emerald-600 hover:bg-emerald-700 text-white"
            onClick={handleApprove}
            disabled={approving}
          >
            {approving ? <Loader2 className="h-3 w-3 animate-spin" /> : (
              <><CheckCircle2 className="h-3 w-3 mr-1" />Approve</>
            )}
          </Button>
        </div>
      )}

      {isFailed && pkg.error_message && (
        <div className="px-3 pb-3">
          <p className="text-3xs text-destructive truncate">{pkg.error_message}</p>
        </div>
      )}
    </article>
  )
}

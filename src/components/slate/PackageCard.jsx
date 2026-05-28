import { useState } from 'react'
import { Loader2, CheckCircle2, XCircle, Sparkles, Play, Pencil, RefreshCw, AlertTriangle, Clock, ShieldAlert, Mic, Brain, Target } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { apiFetch } from '@/lib/api'
import { toast } from '@/lib/toast'
import ConsentControls from './ConsentControls'

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

function VoiceFidelityBadge({ score, breakdown }) {
  if (score == null) return null
  const rounded = Math.round(Number(score) * 10) / 10
  const color =
    rounded >= 7 ? 'bg-emerald-500/80' :
    rounded >= 5.5 ? 'bg-amber-500/80' :
                     'bg-destructive/80'
  const redFlag = breakdown?.red_flag && breakdown.red_flag !== 'none' ? breakdown.red_flag : null
  const title = [
    `Voice fidelity: ${rounded}/10`,
    breakdown?.voice_fidelity   != null ? `  voice fidelity:   ${breakdown.voice_fidelity}` : '',
    breakdown?.clinical_texture != null ? `  clinical texture: ${breakdown.clinical_texture}` : '',
    breakdown?.specificity      != null ? `  specificity:      ${breakdown.specificity}` : '',
    breakdown?.brand_fit        != null ? `  brand fit:        ${breakdown.brand_fit}` : '',
    breakdown?.redundancy       != null ? `  redundancy (inv): ${breakdown.redundancy}` : '',
    redFlag ? `\nRed flag: ${redFlag}` : '',
  ].filter(Boolean).join('\n')
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-3xs font-bold text-white ${color} backdrop-blur-sm`}
      title={title}
    >
      <Mic className="h-2.5 w-2.5" />
      {rounded.toFixed(1)}
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

function CampaignChip({ campaign }) {
  const styleClass = {
    promotional:  'bg-amber-50 text-amber-800 border-amber-200',
    relationship: 'bg-purple-50 text-purple-800 border-purple-200',
    clinical:     'bg-sky-50 text-sky-800 border-sky-200',
  }[campaign.content_style] || 'bg-muted text-muted-foreground border-border'
  const eventInfo = (() => {
    if (!campaign.event_at) return null
    const days = Math.round((new Date(campaign.event_at).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
    if (days < 0) return null
    if (days === 0) return 'today'
    if (days === 1) return 'tomorrow'
    if (days <= 60) return `in ${days}d`
    return null
  })()
  return (
    <span className={`self-start inline-flex items-center gap-1 text-3xs font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${styleClass}`}>
      <Target className="h-2.5 w-2.5" />
      {campaign.name}
      {eventInfo && <span className="opacity-70 font-semibold normal-case">· {eventInfo}</span>}
    </span>
  )
}

function TriageBadge({ reason }) {
  const config = {
    'Render failed':           { icon: XCircle,        cls: 'bg-destructive/10 text-destructive border-destructive/30' },
    'Low confidence':          { icon: AlertTriangle,  cls: 'bg-amber-50 text-amber-800 border-amber-200' },
    'Stale — needs decision':  { icon: Clock,          cls: 'bg-sky-50 text-sky-800 border-sky-200' },
  }[reason] || { icon: AlertTriangle, cls: 'bg-muted text-muted-foreground border-border' }
  const Icon = config.icon
  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1.5 border-b text-2xs font-semibold ${config.cls}`}>
      <Icon className="h-3 w-3 shrink-0" />
      <span>{reason}</span>
    </div>
  )
}

/**
 * @param {{ pkg: object, clinicianName?: string, triageReason?: string|null, onApprove: fn, onSkip: fn, onUpdate: fn }}
 * onUpdate(updatedPkg) — called when caption or renders change so parent can refresh.
 * triageReason — optional badge text shown above the thumbnail (e.g. "Low confidence").
 */
export default function PackageCard({ pkg, clinicianName, triageReason, onApprove, onSkip, onUpdate }) {
  const [approving, setApproving]           = useState(false)
  const [editing, setEditing]               = useState(false)
  const [caption, setCaption]               = useState(pkg.caption_text || '')
  const [saving, setSaving]                 = useState(false)
  const [rerendering, setRerendering]       = useState(false)
  const [refreshingContext, setRefreshingContext] = useState(false)

  const isGenerating = pkg.status === 'generating' || pkg.status === 'pending'
  const isFailed     = pkg.status === 'failed'
  const renders      = Array.isArray(pkg.renders) ? pkg.renders : []
  const previewRender = renders[0]
  const isVideo = previewRender?.blobUrl?.endsWith('.mp4')
  const captionChanged = caption.trim() !== (pkg.caption_text || '').trim()
  const consentStatus = pkg.source_asset?.consent_status || 'not_required'
  const consentBlocks = consentStatus === 'pending' || consentStatus === 'revoked'

  function handleEditOpen() {
    setCaption(pkg.caption_text || '')
    setEditing(true)
  }

  function handleEditCancel() {
    setCaption(pkg.caption_text || '')
    setEditing(false)
  }

  async function handleSaveCaptionOnly() {
    if (!captionChanged) { setEditing(false); return }
    setSaving(true)
    try {
      const result = await apiFetch(`/api/editorial/packages/${pkg.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ captionText: caption }),
      })
      onUpdate?.({ ...pkg, caption_text: caption, ...result?.package })
      setEditing(false)
      toast('Caption saved. Renders still show old caption — use Re-render to update visuals.')
    } catch (err) {
      toast.error(err?.message || 'Failed to save caption.')
    } finally {
      setSaving(false)
    }
  }

  async function handleRerender() {
    setRerendering(true)
    try {
      const result = await apiFetch('/api/editorial/rerender-package', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          packageId: pkg.id,
          captionText: captionChanged ? caption : undefined,
        }),
      })
      onUpdate?.({ ...pkg, ...result?.package, caption_text: result?.captionText ?? pkg.caption_text, renders: result?.renders ?? pkg.renders })
      setEditing(false)
      toast('Re-rendered successfully.')
    } catch (err) {
      toast.error(err?.message || 'Re-render failed.')
    } finally {
      setRerendering(false)
    }
  }

  async function handleApprove() {
    setApproving(true)
    try {
      await onApprove(pkg)
    } finally {
      setApproving(false)
    }
  }

  async function handleRefreshContext() {
    setRefreshingContext(true)
    try {
      const result = await apiFetch('/api/editorial/refresh-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageId: pkg.id }),
      })
      onUpdate?.({ ...pkg, rag_context: result?.ragContext })
      toast('Prior thinking refreshed.')
    } catch (err) {
      toast.error(err?.message || 'Failed to refresh context.')
    } finally {
      setRefreshingContext(false)
    }
  }

  // While re-rendering, treat card as generating
  const showGenerating = isGenerating || rerendering

  return (
    <article className="flex flex-col rounded-xl border border-border bg-card overflow-hidden shadow-sm hover:shadow-md transition-shadow">
      {/* Triage badge (only present when shown in Triage view) */}
      {triageReason && <TriageBadge reason={triageReason} />}
      {/* Thumbnail */}
      <div className="relative aspect-[4/5] bg-muted overflow-hidden">
        {showGenerating ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-zinc-900/80 text-white">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="text-xs font-medium">
              {rerendering ? 'Re-rendering…' : 'Generating…'}
            </span>
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
        {!showGenerating && !isFailed && (
          <>
            <div className="absolute top-2 left-2 flex gap-1 flex-wrap">
              <SimilarityBadge similarity={pkg.similarity} />
              <VoiceFidelityBadge
                score={pkg.voice_fidelity_score}
                breakdown={pkg.voice_fidelity_breakdown}
              />
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

      {/* Body — normal view or edit mode */}
      {editing ? (
        <div className="flex flex-col gap-2.5 p-3">
          <p className="text-2xs font-semibold text-muted-foreground uppercase tracking-wide">Edit caption</p>
          <Textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            rows={4}
            maxLength={1000}
            className="text-xs resize-none"
            autoFocus
          />
          <p className="text-3xs text-muted-foreground">{caption.length}/1000</p>
          <div className="flex gap-1.5 flex-wrap">
            <Button
              size="sm"
              variant="ghost"
              className="text-xs h-8 px-2.5"
              onClick={handleEditCancel}
              disabled={saving || rerendering}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-xs h-8"
              onClick={handleSaveCaptionOnly}
              disabled={saving || rerendering}
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
              Save caption
            </Button>
            <Button
              size="sm"
              className="text-xs h-8 flex-1"
              onClick={handleRerender}
              disabled={saving || rerendering}
            >
              {rerendering ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : (
                <RefreshCw className="h-3 w-3 mr-1" />
              )}
              {captionChanged ? 'Save & Re-render' : 'Re-render'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5 p-3 flex-1">
          {pkg.campaign && <CampaignChip campaign={pkg.campaign} />}
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
      )}

      {/* RAG context strip — shown when fusion ran and package is complete */}
      {!editing && !showGenerating && !isFailed && pkg.rag_context?.retrieved_at && (
        <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-t border-border bg-muted/20">
          <span className="text-3xs text-muted-foreground truncate">
            Context {new Date(pkg.rag_context.retrieved_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            {pkg.rag_context.practice_chunks?.length > 0 && (
              <> · {pkg.rag_context.practice_chunks.length} prior chunk{pkg.rag_context.practice_chunks.length !== 1 ? 's' : ''}</>
            )}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-3xs shrink-0"
            onClick={handleRefreshContext}
            disabled={refreshingContext}
            title="Re-run RAG retrieval to incorporate new interviews and content"
          >
            {refreshingContext
              ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
              : <Brain className="h-2.5 w-2.5 mr-1" />}
            {refreshingContext ? '' : 'Re-read prior thinking'}
          </Button>
        </div>
      )}

      {/* Consent controls — shown when actions row is visible. */}
      {!editing && !showGenerating && !isFailed && pkg.source_asset_id && (
        <ConsentControls
          sourceAssetId={pkg.source_asset_id}
          consentStatus={consentStatus}
          onUpdate={() => onUpdate?.(pkg)}
        />
      )}

      {/* Actions — hidden while editing or generating */}
      {!editing && !showGenerating && !isFailed && (
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
            onClick={handleEditOpen}
          >
            <Pencil className="h-3 w-3 mr-1" />
            Edit
          </Button>
          <Button
            size="sm"
            className="flex-1 text-xs h-8 bg-emerald-600 hover:bg-emerald-700 text-white disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed"
            onClick={handleApprove}
            disabled={approving || consentBlocks}
            title={consentBlocks
              ? (consentStatus === 'pending'
                  ? 'Mark consent obtained (or not required) before approving'
                  : 'Consent revoked — cannot approve')
              : undefined}
          >
            {approving ? <Loader2 className="h-3 w-3 animate-spin" /> : consentBlocks ? (
              <><ShieldAlert className="h-3 w-3 mr-1" />Blocked</>
            ) : (
              <><CheckCircle2 className="h-3 w-3 mr-1" />Approve</>
            )}
          </Button>
        </div>
      )}

      {isFailed && (
        <>
          {pkg.error_message && (
            <div className="px-3 py-2 bg-destructive/5">
              <p className="text-3xs text-destructive line-clamp-2" title={pkg.error_message}>
                {pkg.error_message}
              </p>
            </div>
          )}
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
              className="flex-1 text-xs h-8"
              onClick={handleRerender}
              disabled={rerendering}
            >
              {rerendering ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
              Retry render
            </Button>
          </div>
        </>
      )}
    </article>
  )
}

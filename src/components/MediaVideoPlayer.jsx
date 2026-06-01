// MediaVideoPlayer — single component that picks the right playback shape
// for a media_assets row:
//
//   transcode_status='ready' + mux_playback_id  → <mux-player>
//                                                  (signed playback fetches
//                                                  a short-lived JWT first)
//   transcode_status in ('pending','processing')→ "Transcoding…" placeholder
//   transcode_status='errored'                  → error banner + raw blob_url
//                                                  fallback player (so the
//                                                  user can still see what
//                                                  they uploaded)
//   transcode_status='skipped' / null / legacy  → <video src={blob_url}>
//
// The <mux-player> web component is loaded from the Mux CDN exactly once
// per page lifetime. Skipping the npm package keeps the React bundle slim
// — the component costs ~0 bytes in the bundle even on photo-only views.

import { useEffect, useRef, useState } from 'react'
import { Loader2, AlertCircle } from 'lucide-react'

// jsdelivr without the `/+esm` suffix on @mux/mux-player serves the
// package's `main` field, which is a CJS bundle. Loading that with
// `type="module"` parses CJS as ESM and blows up with a stray "window is
// not defined" (the CJS shim references `window` from a non-browser path).
// Mux's official embed snippet uses a plain `<script src=...>` against
// this URL — which serves the UMD/browser build. Mirror that exactly.
const MUX_PLAYER_CDN = 'https://cdn.jsdelivr.net/npm/@mux/mux-player'

let muxPlayerLoading = null
function ensureMuxPlayerLoaded() {
  if (typeof window === 'undefined') return Promise.resolve()
  if (window.customElements?.get('mux-player')) return Promise.resolve()
  if (muxPlayerLoading) return muxPlayerLoading
  muxPlayerLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = MUX_PLAYER_CDN
    s.defer = true
    s.onload = () => resolve()
    s.onerror = () => {
      muxPlayerLoading = null
      reject(new Error('mux-player script failed to load'))
    }
    document.head.appendChild(s)
  })
  return muxPlayerLoading
}

// Fetch a fresh signed-playback token for a media_assets row. Returns the
// token string + the unix-ms when it expires so the caller can refresh
// before the player needs it.
async function fetchPlaybackToken(assetId) {
  const tokenFn = typeof window !== 'undefined'
    ? await window.Clerk?.session?.getToken?.()
    : null
  const res = await fetch(`/api/media/playback-token?id=${encodeURIComponent(assetId)}`, {
    headers: tokenFn ? { Authorization: `Bearer ${tokenFn}` } : undefined,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`playback-token ${res.status}: ${text.slice(0, 200)}`)
  }
  return res.json()
}

function MuxPlayer({ asset, playbackToken }) {
  const ref = useRef(null)

  // Mux's web component reads attributes; we set them imperatively because
  // React's prop-to-attribute coercion is unreliable for custom elements.
  useEffect(() => {
    if (!ref.current) return
    ref.current.setAttribute('playback-id', asset.mux_playback_id)
    ref.current.setAttribute('stream-type', 'on-demand')
    if (asset.filename) ref.current.setAttribute('metadata-video-title', asset.filename)
    if (playbackToken) ref.current.setAttribute('playback-token', playbackToken)
    else ref.current.removeAttribute('playback-token')
  }, [asset.mux_playback_id, asset.filename, playbackToken])

  // Derive the display aspect ratio so the player box matches the video's
  // shape. Prefer numeric dimensions (set from the Mux webhook, which knows
  // the rotation-applied display size); fall back to the "W:H" string.
  const ar = asset.width && asset.height
    ? `${asset.width} / ${asset.height}`
    : (typeof asset.aspect_ratio === 'string' && asset.aspect_ratio.includes(':')
        ? asset.aspect_ratio.replace(':', ' / ')
        : null)

  // Numeric aspect ratio (W/H) used to cap width so the element box is
  // exactly the right shape for the video. Setting both width:100% and
  // max-height without capping width causes mux-player to render a box that's
  // wider than the video at max-height, and the player fills the oversized box
  // by cropping rather than letterboxing. The fix:
  //   max-width = calc(MAX_HEIGHT_VH * arNum)
  // so the element is never wider than what the video fills at full height.
  // When the container is narrower than max-width, width:100% kicks in and the
  // video is proportionally shorter — both dimensions fit without any cropping.
  const arNum = asset.width && asset.height
    ? asset.width / asset.height
    : ar
      ? (() => { const p = ar.split(' / '); return parseFloat(p[0]) / parseFloat(p[1]) })()
      : 16 / 9

  const MAX_HEIGHT = '55vh'

  return (
    <mux-player
      ref={ref}
      style={{
        display: 'block',
        width: '100%',
        ...(ar ? { aspectRatio: ar } : {}),
        maxHeight: MAX_HEIGHT,
        maxWidth: `calc(${MAX_HEIGHT} * ${arNum.toFixed(6)})`,
        margin: '0 auto',
      }}
    />
  )
}

export default function MediaVideoPlayer({ asset, className = '' }) {
  const status = asset?.transcode_status
  const hasMux = !!asset?.mux_playback_id
  const wantsMux = hasMux && status === 'ready'

  const [tokenState, setTokenState] = useState({ token: null, error: null, loading: false })
  const [muxReady, setMuxReady] = useState(false)

  useEffect(() => {
    if (!wantsMux) return
    let cancelled = false
    ensureMuxPlayerLoaded()
      .then(() => { if (!cancelled) setMuxReady(true) })
      .catch((e) => { if (!cancelled) setTokenState({ token: null, error: e.message, loading: false }) })
    return () => { cancelled = true }
  }, [wantsMux])

  useEffect(() => {
    if (!wantsMux) return
    // Public playback policy → no token required. Detect that by trying to
    // fetch a token; if the server returns 503 'signed_playback_unavailable'
    // OR the workspace policy is 'public', the player still plays without
    // one. We over-fetch defensively — playback-token is rate-limited but
    // cheap, and getting it wrong leaves the player on a black frame.
    let cancelled = false
    setTokenState({ token: null, error: null, loading: true })
    fetchPlaybackToken(asset.id)
      .then((data) => { if (!cancelled) setTokenState({ token: data.token, error: null, loading: false }) })
      .catch((e) => {
        if (cancelled) return
        // For 'public' workspaces, the endpoint returns 503 and the player
        // is happy without a token. Surface non-503 errors as a warning so
        // the user knows playback is degraded.
        if (/503/.test(e.message)) {
          setTokenState({ token: null, error: null, loading: false })
        } else {
          setTokenState({ token: null, error: e.message, loading: false })
        }
      })
    return () => { cancelled = true }
  }, [wantsMux, asset.id])

  if (!asset) return null

  const baseClass = `bg-black flex items-center justify-center ${className}`

  // Transcode placeholder — covers 'pending' and 'processing'. Users see
  // an animated "Transcoding…" pill instead of a broken video frame.
  if (status === 'pending' || status === 'processing') {
    return (
      <div className={baseClass} style={{ minHeight: 240 }}>
        <div className="flex items-center gap-2 text-white/80 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Transcoding for cross-browser playback… (usually under 2 minutes)
        </div>
      </div>
    )
  }

  // Errored or legacy fall through to a plain <video> tag against the
  // original blob_url — at minimum the uploader can confirm what they sent.
  if (status === 'errored' || !wantsMux) {
    return (
      <div className={baseClass} style={{ minHeight: 240 }}>
        {status === 'errored' && (
          <div className="absolute top-2 left-2 right-2 flex items-start gap-1.5 rounded bg-black/60 px-2 py-1 text-2xs text-warning">
            <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
            Transcode failed — playing original. Some browsers may not play this file.
          </div>
        )}
        <video src={asset.blob_url} controls className="max-h-[60vh] max-w-full" />
      </div>
    )
  }

  // Ready + we got the token (or it isn't required): mount <mux-player>.
  if (tokenState.error) {
    return (
      <div className={baseClass} style={{ minHeight: 240 }}>
        <div className="text-warning text-sm flex items-center gap-2">
          <AlertCircle className="h-4 w-4" />
          Couldn&apos;t load playback token: {tokenState.error}
        </div>
      </div>
    )
  }
  if (!muxReady || tokenState.loading) {
    return (
      <div className={baseClass} style={{ minHeight: 240 }}>
        <Loader2 className="h-4 w-4 animate-spin text-white/80" />
      </div>
    )
  }
  return (
    <div className={`${baseClass} w-full overflow-hidden`}>
      <MuxPlayer asset={asset} playbackToken={tokenState.token} />
    </div>
  )
}

// Mux client — thin wrapper around the three Mux API surfaces we use:
//
//   createAsset({ inputUrl, playbackPolicy, passthrough })
//     POST https://api.mux.com/video/v1/assets
//     Returns { id, playback_id } so the caller can persist them on the
//     media_assets row.
//
//   verifyWebhookSignature(rawBody, header, secret)
//     Validates the `Mux-Signature` header on inbound webhooks.
//     Spec: https://docs.mux.com/guides/listen-for-webhooks#verify-webhook-signatures
//
//   mintPlaybackToken({ playbackId, expiresInSec })
//     Signs an RS256 JWT for signed-playback URLs.
//     Spec: https://docs.mux.com/guides/secure-video-playback#3-create-a-json-web-token-jwt
//
// All Mux-shaped errors flow through as Error(messsage) — callers either log
// and stamp the row's notes column (upload completion path) or surface a
// 502/500 (synchronous JWT mint path). No silent failures: the only way to
// see a hanging "Transcoding…" pill in the UI is a missing video.asset.ready
// webhook, which is a Mux/network problem this module can't paper over.

import { createHmac, createSign, timingSafeEqual } from 'node:crypto'

const MUX_API_BASE = 'https://api.mux.com'

function requireEnv(name) {
  const v = process.env[name]
  if (!v) throw new Error(`${name} is not set on this deployment`)
  return v
}

function basicAuthHeader() {
  const tokenId     = requireEnv('MUX_TOKEN_ID')
  const tokenSecret = requireEnv('MUX_TOKEN_SECRET')
  return 'Basic ' + Buffer.from(`${tokenId}:${tokenSecret}`).toString('base64')
}

// Create a Mux Asset from a URL Mux can fetch (typically a Vercel Blob
// public URL). `passthrough` is round-tripped on every Mux webhook event so
// we can resolve the media_assets row without a secondary lookup. We use
// the asset id as the passthrough — short, unique, and the webhook handler
// is workspace-scope-blind anyway (Mux events are platform-to-server and
// the row's workspace_id is the canonical scope).
//
// playbackPolicy: 'signed' (default) | 'public'.
export async function createAsset({ inputUrl, playbackPolicy = 'signed', passthrough }) {
  if (!inputUrl) throw new Error('createAsset: inputUrl required')
  if (!['signed', 'public'].includes(playbackPolicy)) {
    throw new Error(`createAsset: invalid playbackPolicy ${playbackPolicy}`)
  }

  const body = {
    input: [{ url: inputUrl }],
    playback_policy: [playbackPolicy],
    // mp4_support: 'none' keeps storage cost down — HLS is enough for the
    // <mux-player> path. Bump to 'standard' later if/when we need direct
    // mp4 download URLs for non-browser consumers.
    mp4_support: 'none',
    encoding_tier: 'smart',
    // Without this, Mux defaults to 1080p and silently downscales 4K source —
    // iPhones often shoot 4K, so a clean capture would still play back soft.
    // '2160p' preserves up to 4K; Mux only encodes renditions up to the actual
    // source resolution, so this costs nothing extra for ≤1080p uploads.
    max_resolution_tier: '2160p',
  }
  if (passthrough) body.passthrough = String(passthrough)

  const res = await fetch(`${MUX_API_BASE}/video/v1/assets`, {
    method:  'POST',
    headers: {
      Authorization:  basicAuthHeader(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const text = await res.text()
  if (!res.ok) {
    throw new Error(`Mux createAsset ${res.status}: ${text.slice(0, 400)}`)
  }
  let json
  try { json = JSON.parse(text) }
  catch { throw new Error(`Mux createAsset returned non-JSON body: ${text.slice(0, 200)}`) }

  const asset = json?.data
  if (!asset?.id) throw new Error('Mux createAsset response missing data.id')
  const playback = asset.playback_ids?.[0]?.id || null

  return { assetId: asset.id, playbackId: playback }
}

// Fetch a Mux Asset by id. Used by the webhook to recover display dimensions
// when the `video.asset.ready` event payload omits `data.tracks` (Mux often
// does — 14 of 16 ready videos had null width/height before this was added).
// Returns { width, height, aspectRatio } in DISPLAY orientation (rotation
// already applied), with nulls when the asset has no decodable video track.
export async function getAssetDimensions(assetId) {
  if (!assetId) throw new Error('getAssetDimensions: assetId required')
  const res = await fetch(`${MUX_API_BASE}/video/v1/assets/${encodeURIComponent(assetId)}`, {
    headers: { Authorization: basicAuthHeader() },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Mux getAsset ${res.status}: ${text.slice(0, 300)}`)
  let json
  try { json = JSON.parse(text) }
  catch { throw new Error(`Mux getAsset returned non-JSON body: ${text.slice(0, 200)}`) }
  const data = json?.data
  const videoTrack = Array.isArray(data?.tracks)
    ? data.tracks.find((t) => t?.type === 'video')
    : null
  return {
    width:  videoTrack?.max_width  || null,
    height: videoTrack?.max_height || null,
    aspectRatio: typeof data?.aspect_ratio === 'string' ? data.aspect_ratio : null,
  }
}

// Verify the Mux-Signature header on an inbound webhook. The header looks
// like: `t=1492774577,v1=<hex sha256 hmac>`. We HMAC the concatenation of
// `${t}.${rawBody}` with the webhook signing secret and constant-time
// compare against v1.
//
// Per Mux docs: also check the timestamp is within a ~5 minute window so
// replay attacks of valid-but-old payloads can't update state.
export function verifyWebhookSignature(rawBody, header, secret, { toleranceSec = 300 } = {}) {
  if (!header || !secret || !rawBody) return false
  const parts = String(header).split(',').reduce((acc, kv) => {
    const [k, v] = kv.split('=')
    if (k && v) acc[k.trim()] = v.trim()
    return acc
  }, {})
  const ts  = parts.t
  const sig = parts.v1
  if (!ts || !sig) return false

  const tsNum = Number(ts)
  if (!Number.isFinite(tsNum)) return false
  const ageSec = Math.abs(Date.now() / 1000 - tsNum)
  if (ageSec > toleranceSec) return false

  const expected = createHmac('sha256', secret)
    .update(`${ts}.${rawBody}`, 'utf8')
    .digest('hex')

  if (expected.length !== sig.length) return false
  try {
    return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(sig, 'utf8'))
  } catch {
    return false
  }
}

// Mint a Mux signed-playback JWT (RS256). Mux's spec:
//   header  : { alg: 'RS256', typ: 'JWT', kid: <signing-key-id> }
//   payload : { sub: <playback_id>, aud: 'v', exp: <unix-seconds> }
//   signature: RSA-SHA256 over `${b64(header)}.${b64(payload)}`
//
// We sign with Node's built-in `crypto.createSign` to avoid adding a JWT
// library dependency — the format is small enough that hand-rolling is
// safer than introducing a bundle bloat surface for one call site.
//
// MUX_SIGNING_KEY is the base64-encoded RSA private key from the Mux
// dashboard. We decode it once at sign time. MUX_SIGNING_KEY_ID is the
// public id of that key pair.
function base64UrlEncode(input) {
  const b = Buffer.isBuffer(input) ? input : Buffer.from(input)
  return b.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}

export function mintPlaybackToken({ playbackId, expiresInSec = 300, audience = 'v' }) {
  if (!playbackId) throw new Error('mintPlaybackToken: playbackId required')

  const keyId    = requireEnv('MUX_SIGNING_KEY_ID')
  const keyB64   = requireEnv('MUX_SIGNING_KEY')
  // Mux issues the signing key as base64; decode once. Accept PEM-formatted
  // keys too, in case a future deploy pastes it raw.
  const keyPem = keyB64.includes('-----BEGIN')
    ? keyB64
    : Buffer.from(keyB64, 'base64').toString('utf8')

  const nowSec = Math.floor(Date.now() / 1000)
  const header  = { alg: 'RS256', typ: 'JWT', kid: keyId }
  const payload = { sub: playbackId, aud: audience, exp: nowSec + expiresInSec, iat: nowSec }

  const signingInput =
    base64UrlEncode(JSON.stringify(header)) + '.' +
    base64UrlEncode(JSON.stringify(payload))

  const signer = createSign('RSA-SHA256')
  signer.update(signingInput)
  signer.end()
  const sig = signer.sign(keyPem)

  return `${signingInput}.${base64UrlEncode(sig)}`
}

// Convenience: returns true iff the deployment has the env vars to create
// Mux assets. Lets the upload handler skip Mux without throwing on a fresh
// Vercel project that hasn't had the keys pasted yet.
export function muxConfigured() {
  return !!(process.env.MUX_TOKEN_ID && process.env.MUX_TOKEN_SECRET)
}

// Same for signed playback — separate because a tenant can run with public
// playback only and skip the signing-key env vars entirely.
export function muxSignedConfigured() {
  return !!(process.env.MUX_SIGNING_KEY_ID && process.env.MUX_SIGNING_KEY)
}

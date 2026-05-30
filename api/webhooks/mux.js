// Mux webhook receiver. Mux POSTs JSON events when an asset finishes
// transcoding (or errors out); we flip media_assets.transcode_status to
// 'ready' / 'errored' so the UI can stop showing the placeholder.
//
// Events we care about:
//   video.asset.ready     — playback ID is now playable
//   video.asset.errored   — transcode failed; details in data.errors[0]
//   video.asset.deleted   — emitted on asset deletion; we don't currently
//                           initiate Mux deletes, so this is a no-op.
//
// Auth: Mux signs every webhook body with HMAC-SHA256 keyed by the webhook
// signing secret. We MUST verify before touching the DB — webhook URLs are
// public and a forged payload could mark an asset 'ready' before transcode
// actually finishes, leaving the player serving a broken stream.
//
// Note: Vercel's Node runtime auto-parses req.body for application/json.
// HMAC verification needs the EXACT raw bytes Mux signed, so we read
// req.body as the parsed object and re-stringify with JSON.stringify. Mux
// uses compact JSON without whitespace, which JSON.stringify produces by
// default — matches the signed payload byte-for-byte in normal cases. If
// Vercel ever changes its parsing behavior, the signature check will start
// failing and we'll see 401s in the dashboard before any state is mutated.

export const config = { runtime: 'nodejs' }

import { verifyWebhookSignature } from '../_lib/muxClient.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
      ...init.headers,
    },
  })
}

// Read the raw body as a string. Vercel already JSON-parsed req.body on
// Node; re-stringify (compact) to reconstruct the signed bytes. If Mux
// pretty-printed the payload (they don't, but defensively), an alternative
// path could pass `bodyParser: false` in the function config and read the
// stream — leave as a follow-up if signature failures start showing up
// without a Mux dashboard change.
function readRawBody(req) {
  if (typeof req.body === 'string') return req.body
  if (req.body && typeof req.body === 'object') return JSON.stringify(req.body)
  return ''
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed', message: 'POST only' })
  }

  const secret = process.env.MUX_WEBHOOK_SECRET
  if (!secret) {
    console.error('[mux/webhook] MUX_WEBHOOK_SECRET not set; rejecting all events')
    return res.status(500).json({ error: 'misconfigured', message: 'Webhook secret not configured' })
  }

  const rawBody = readRawBody(req)
  const signature = req.headers['mux-signature'] || req.headers['Mux-Signature']
  if (!verifyWebhookSignature(rawBody, signature, secret)) {
    return res.status(401).json({ error: 'invalid_signature' })
  }

  const event = req.body
  const type      = event?.type
  const assetId   = event?.data?.id
  const errors    = event?.data?.errors
  const passthrough = event?.data?.passthrough

  if (!type || !assetId) {
    console.warn('[mux/webhook] received event with no type or asset id; ignoring')
    return res.status(200).json({ received: true })
  }

  const tag = `[mux/webhook type=${type} asset=${assetId}]`

  // We key the row lookup on either the asset id or the passthrough we set
  // at create time (which is the media_assets row id). Passthrough is the
  // more reliable join because Mux occasionally re-issues asset ids during
  // certain failure-and-retry flows, but normally either works.
  // PostgREST filter syntax: comma-separated `or=(...)` allows either to
  // match. Workspace scoping is implicit — service_role bypasses RLS and
  // the unique asset id is workspace-blind anyway.
  const filterByAsset = `mux_asset_id=eq.${encodeURIComponent(assetId)}`
  const filterByPass  = passthrough ? `id=eq.${encodeURIComponent(passthrough)}` : null

  async function patchByAssetOrPassthrough(patch) {
    // Try asset_id first (set by our create call). Fall back to passthrough
    // if zero rows updated — covers the edge case where the create call's
    // PATCH lost a race with the ready webhook (Mux is fast).
    let r = await sb(`media_assets?${filterByAsset}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(patch),
    })
    if (!r.ok) {
      console.error(tag, 'asset_id PATCH failed:', r.status, await r.text())
      return false
    }
    const rows = await r.json().catch(() => [])
    if (rows.length > 0) return true

    if (!filterByPass) return false
    r = await sb(`media_assets?${filterByPass}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ ...patch, mux_asset_id: assetId }),
    })
    if (!r.ok) {
      console.error(tag, 'passthrough PATCH failed:', r.status, await r.text())
      return false
    }
    return true
  }

  if (type === 'video.asset.ready') {
    const playbackId = event?.data?.playback_ids?.[0]?.id || null
    const durationS  = event?.data?.duration
    const patch = { transcode_status: 'ready' }
    if (playbackId) patch.mux_playback_id = playbackId
    if (typeof durationS === 'number') patch.duration_s = durationS
    await patchByAssetOrPassthrough(patch)
    return res.status(200).json({ received: true })
  }

  if (type === 'video.asset.errored') {
    const reason = Array.isArray(errors) && errors[0]
      ? (errors[0].messages?.join('; ') || errors[0].type || 'unknown')
      : 'unknown'
    console.error(`[mux/webhook] transcode errored for asset ${assetId}: ${reason}`)
    await patchByAssetOrPassthrough({ transcode_status: 'errored' })
    return res.status(200).json({ received: true })
  }

  // Unhandled event types — Mux fires a wide set (video.asset.created,
  // .updated, .static_renditions.ready, etc.). Acknowledge so Mux doesn't
  // retry the delivery; log so we can decide if a future event becomes
  // load-bearing.
  console.info(tag, 'unhandled event; ack only')
  return res.status(200).json({ received: true })
}

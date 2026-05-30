// POST /api/editorial/render-longform-worker
//
// Internal continuation endpoint for the chunked keep-whole long-form render.
// Each pass of the engine (longformEngine.runChunkPass) renders a bounded batch
// of pieces, then POSTs here to continue on a FRESH function instance with a new
// 300s budget. This handler is also the target the cron safety-net hits to
// resume a stalled chain.
//
// It schedules the next pass via waitUntil and returns 202 immediately, so the
// caller's continuation fetch resolves fast and the previous (ending) instance
// hands the baton cleanly. The pass itself runs off the request path.
//
// Auth: Bearer CRON_SECRET (same shared secret as the cron handlers). This is a
// service-role, no-user-token path — never call it from the browser.
//
// Body: { packageId: string }
// Responses: 202 { ok: true } | 400 | 401 | 503

export const config = { runtime: 'nodejs', maxDuration: 300 }

import { waitUntil } from '@vercel/functions'
import { runChunkPass } from '../_lib/longformEngine.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return res.status(503).json({ error: 'CRON_SECRET not configured' })
  if (req.headers?.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'unauthorized' })
  }

  const body = req.body || {}
  const packageId = body.packageId ? String(body.packageId) : ''
  if (!packageId) return res.status(400).json({ error: 'packageId_required' })

  // Origin for the engine's own continuation POST. Node runtime: req.headers is
  // a plain lowercased object.
  const proto = req.headers['x-forwarded-proto'] || 'https'
  const host = req.headers.host
  const baseUrl = host ? `${proto}://${host}` : null

  waitUntil(runChunkPass({ packageId, baseUrl }))

  return res.status(202).json({ ok: true })
}

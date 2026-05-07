import { tagById } from '../_lib/tagAsset.js'

// Manual AI auto-tagging endpoint. POST { id } → vision + transcription via
// the Vercel AI Gateway. The shared logic lives in _lib/tagAsset.js so
// upload.js can call it directly via waitUntil without an HTTP roundtrip.
//
// Runs on Node (Fluid Compute) — same constraint as the rest of the media
// routes.

export const config = { maxDuration: 120 }

const ok  = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
const err = (msg, status = 400)  => new Response(JSON.stringify({ error: msg }), { status, headers: { 'Content-Type': 'application/json' } })

export default async function handler(req) {
  if (req.method !== 'POST') return err('Method not allowed', 405)

  let body
  try { body = await req.json() } catch { return err('Invalid JSON body') }
  const id = body?.id
  if (!id) return err('Missing id')

  try {
    const row = await tagById(id)
    return ok(row)
  } catch (e) {
    const msg = e?.message || 'Tagging failed'
    const status = msg === 'Not found' ? 404 : 500
    return err(msg, status)
  }
}

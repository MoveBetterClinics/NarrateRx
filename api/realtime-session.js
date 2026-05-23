// POST /api/realtime-session
//
// Mints a short-lived ephemeral OpenAI Realtime client secret that the browser
// uses to open a direct WebRTC connection to OpenAI's GA Realtime API
// (https://api.openai.com/v1/realtime/calls). Keeping the long-lived
// OPENAI_API_KEY off the wire is the whole point — the browser only ever sees
// a token that expires in ~10 minutes.
//
// Flow:
//   1. Browser: POST /api/realtime-session  (this handler)
//   2. Handler: POST https://api.openai.com/v1/realtime/client_secrets
//                with the workspace's interview system instructions
//   3. Handler: returns { clientSecret, expiresAt, model } to the browser
//   4. Browser: opens WebRTC to /v1/realtime/calls using clientSecret
//
// Spike notes (Sat May 23): the `instructions` field below is a placeholder.
// Sunday wires getInterviewSystemPrompt() through with the same args
// InterviewSession.jsx uses today (tone / voice mode / audience / voice
// phrases / cross-staff context).
//
// Runtime: Node (Clerk + Supabase REST helpers are Node-only).

export const config = {
  runtime: 'nodejs',
  maxDuration: 30,
}

import { requireRole } from './_lib/auth.js'
import { workspaceContext } from './_lib/workspaceContext.js'
import { enforceLimit } from './_lib/ratelimit.js'

const OPENAI_KEY = process.env.OPENAI_API_KEY

// GA model as of Aug 2025. Older preview names (gpt-4o-realtime-preview-*) are
// still accepted but gpt-realtime is the recommended default.
const REALTIME_MODEL = 'gpt-realtime'

// Default voice. ElevenLabs voice cloning enters in Phase 5 Feature #3 — for
// now, alloy is OpenAI's standard balanced voice.
const REALTIME_VOICE = 'alloy'

// Ephemeral token TTL. OpenAI caps at 10 min for client_secrets bound to a
// session. We pass the max so a long call doesn't need re-minting mid-stream.
const TOKEN_TTL_SEC = 600

// Placeholder instructions for the Sat spike — proves voice round-trip works
// end-to-end. Sunday replaces this with getInterviewSystemPrompt(...) so the
// realtime model gets the same persona/tone/audience context the chat
// interview already uses.
const SPIKE_INSTRUCTIONS = [
  'You are Bernard, a warm content facilitator at a movement clinic.',
  'Greet the clinician briefly by name if they introduce themselves, then ask one open question about a patient they recently treated.',
  'Stay conversational — short reactions ("got it", "yeah"), then the next question. No clinical jargon, no flattery.',
  'When the clinician says they want to wrap up, end with a brief thank-you.',
].join(' ')

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // ── Tenant resolution + auth ────────────────────────────────────────────
  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })

  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  // The `ai` bucket is shared with chat-style interview streaming; realtime
  // sessions are far more expensive (~$5 / 15-min vs cents per chat exchange),
  // but the bucket cap is on session *creation*, not in-call activity, so the
  // same limit is the right shape. A per-workspace daily minute cap is Sun/Mon
  // work (separate from this rate limit).
  if (!(await enforceLimit(req, res, 'ai'))) return

  if (!OPENAI_KEY) {
    console.error('[realtime-session] OPENAI_API_KEY is not set — refusing to mint')
    return res.status(500).json({
      error: 'Realtime voice is not configured on this deployment. Set OPENAI_API_KEY.',
    })
  }

  // ── Mint ephemeral client_secret ────────────────────────────────────────
  const sessionConfig = {
    type: 'realtime',
    model: REALTIME_MODEL,
    instructions: SPIKE_INSTRUCTIONS,
    // Voice + audio modalities. The GA API defaults output_modalities to
    // ['audio'] (audio + transcript); we leave it implicit.
    audio: {
      output: { voice: REALTIME_VOICE },
      // Enable Whisper transcription of the user's microphone audio. Without
      // this, the data channel only carries assistant-side transcript events,
      // not user-side ones — which means we can't persist the user turns to
      // interviews.messages on Sunday. Setting it here avoids a session.update
      // round-trip on connect.
      input: {
        transcription: { model: 'whisper-1' },
      },
    },
  }

  let openaiRes
  try {
    openaiRes = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_KEY}`,
        'Content-Type': 'application/json',
        // Bind the ephemeral to this user so OpenAI usage/abuse reports can
        // attribute back to a NarrateRx identity.
        'OpenAI-Safety-Identifier': `narraterx:${ws.slug}:${auth.userId}`,
      },
      body: JSON.stringify({
        expires_after: { anchor: 'created_at', seconds: TOKEN_TTL_SEC },
        session: sessionConfig,
      }),
    })
  } catch (e) {
    console.error(`[realtime-session] network error minting for ws=${ws.slug}: ${e?.message}`)
    return res.status(502).json({ error: 'Realtime mint failed (network)' })
  }

  if (!openaiRes.ok) {
    const body = await openaiRes.text().catch(() => '')
    console.error(`[realtime-session] mint failed ${openaiRes.status} ws=${ws.slug}: ${body.slice(0, 300)}`)
    return res.status(502).json({
      error: `Realtime mint failed (${openaiRes.status})`,
    })
  }

  const data = await openaiRes.json().catch(() => null)
  // The GA response shape is { value, expires_at, session: {...} }. `value` is
  // the short-lived bearer the browser uses against /v1/realtime/calls.
  const clientSecret = data?.value
  const expiresAt    = data?.expires_at ?? null
  if (!clientSecret) {
    console.error(`[realtime-session] mint succeeded but no client_secret in response ws=${ws.slug}`)
    return res.status(502).json({ error: 'Realtime mint returned no token' })
  }

  return res.status(200).json({
    clientSecret,
    expiresAt,
    model: REALTIME_MODEL,
  })
}

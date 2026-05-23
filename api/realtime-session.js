// POST /api/realtime-session
//
// Mints a short-lived ephemeral OpenAI Realtime client secret that the browser
// uses to open a direct WebRTC connection to OpenAI's GA Realtime API
// (https://api.openai.com/v1/realtime/calls). Keeping the long-lived
// OPENAI_API_KEY off the wire is the whole point — the browser only ever sees
// a token that expires within minutes.
//
// Flow:
//   1. Browser creates the interview row via createInterview() and gets back
//      an interviewId.
//   2. Browser: POST /api/realtime-session  { interviewId }
//   3. This handler verifies the workspace has realtime_voice_enabled=true,
//      auth + tenant ownership, and that the interview belongs to the active
//      workspace. Then it POSTs OpenAI's /v1/realtime/client_secrets with the
//      Bernard voice + Whisper input transcription enabled.
//   4. Returns { clientSecret, expiresAt, model } to the browser.
//   5. The full system prompt is sent BY THE BROWSER via a session.update
//      data-channel event once the WebRTC connection is established — this
//      gets `getInterviewSystemPrompt(workspace, clinician, topic, …)`
//      identical to what InterviewSession.jsx uses today. Doing it from the
//      browser keeps the prompt-building logic in one place (src/lib/prompts)
//      and avoids a server-side replica.
//
// Runtime: Node (Clerk + Supabase REST helpers are Node-only).

export const config = {
  runtime: 'nodejs',
  maxDuration: 30,
}

import { requireRole } from './_lib/auth.js'
import { workspaceContext } from './_lib/workspaceContext.js'
import { enforceLimit } from './_lib/ratelimit.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const OPENAI_KEY   = process.env.OPENAI_API_KEY

// GA model as of Aug 2025. Older preview names (gpt-4o-realtime-preview-*)
// are still accepted but gpt-realtime is the recommended default.
const REALTIME_MODEL = 'gpt-realtime'

// Bernard's voice. The chat interview uses an ElevenLabs voice that the
// Realtime API can't reproduce — true clone is Phase 5 Feature #3. For now we
// pick `ballad` from OpenAI's built-in set: British male, softer-spoken,
// closer to "thoughtful senior colleague over coffee" than the American
// voices (alloy/ash/echo) feel.
const REALTIME_VOICE = 'ballad'

// Ephemeral token TTL. OpenAI caps client_secret lifetime to 10 min so a
// dropped session needs a fresh mint. We pass the max so a long call doesn't
// re-mint mid-stream.
const TOKEN_TTL_SEC = 600

// Bootstrap instructions. These are intentionally generic — the FULL system
// prompt arrives from the browser via session.update once the data channel
// opens, which lets us reuse `getInterviewSystemPrompt()` exactly as the
// chat-interview path does. This bootstrap just keeps the model from blurting
// nonsense if the user starts talking before session.update lands.
const BOOTSTRAP_INSTRUCTIONS = [
  'Wait silently for the session to be configured before speaking.',
  'Once configured, you will receive detailed instructions about a clinical interview to conduct.',
].join(' ')

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // ── Tenant resolution + auth ────────────────────────────────────────────
  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })

  // Feature flag gate — only workspaces with realtime_voice_enabled=true can
  // mint a realtime session. Default false means external tenants don't get
  // the $5/call surprise until they're explicitly onboarded to the feature.
  if (!ws.realtime_voice_enabled) {
    return res.status(403).json({
      error: 'Realtime voice is not enabled for this workspace.',
    })
  }

  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  if (!(await enforceLimit(req, res, 'ai'))) return

  if (!OPENAI_KEY) {
    console.error('[realtime-session] OPENAI_API_KEY is not set — refusing to mint')
    return res.status(500).json({
      error: 'Realtime voice is not configured on this deployment.',
    })
  }

  // ── Verify the interview belongs to this workspace ──────────────────────
  // Defence-in-depth: the browser sends an interviewId it just created. We
  // confirm it's in the same workspace before minting — keeps a hostile
  // client from spending a different tenant's budget. Forgetting this check
  // is exactly the kind of bug the tenant-isolation audit memory exists for.
  const body = req.body || {}
  const interviewId = typeof body.interviewId === 'string' ? body.interviewId : null
  if (!interviewId) {
    return res.status(400).json({ error: 'interviewId is required' })
  }

  const ivRes = await sb(
    `interviews?id=eq.${encodeURIComponent(interviewId)}&workspace_id=eq.${ws.id}&select=id,topic&limit=1`,
  )
  if (!ivRes.ok) {
    console.error(`[realtime-session] interview lookup failed ${ivRes.status} ws=${ws.slug}`)
    return res.status(500).json({ error: 'Could not verify interview ownership' })
  }
  const rows = await ivRes.json().catch(() => [])
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(404).json({ error: 'Interview not found in this workspace' })
  }

  // ── Mint ephemeral client_secret ────────────────────────────────────────
  const sessionConfig = {
    type: 'realtime',
    model: REALTIME_MODEL,
    instructions: BOOTSTRAP_INSTRUCTIONS,
    audio: {
      output: { voice: REALTIME_VOICE },
      input: {
        // Streaming transcription. whisper-1 (our first pick) only emits a
        // single end-of-turn .completed event — no live partial deltas — so
        // the user couldn't see their words appear while speaking. Switched
        // to gpt-4o-mini-transcribe which streams .delta events every
        // ~200-500ms during the utterance. Cheaper than gpt-4o-transcribe,
        // good enough accuracy for interview-grade transcripts.
        transcription: { model: 'gpt-4o-mini-transcribe' },
        // Turn-detection — third revision after smokes #2 and #3.
        //
        // The breakthrough learning from smoke #3: Whisper hallucinates on
        // silence + ambient noise. With `create_response: true` (default), the
        // model auto-generates a reply on every turn-end — including turn-ends
        // VAD declared on ambient noise that wasn't actually user speech. So
        // Bernard ended up "responding" to hallucinated Welsh phrases and
        // talking to himself.
        //
        // Fix: `create_response: false`. The model never auto-replies. The
        // CLIENT decides when to fire `response.create` — only after we see a
        // genuine user utterance (length-of-speech ≥ 500ms tracked from
        // `input_audio_buffer.speech_started` / `speech_stopped`).
        //
        // threshold bumped 0.5 → 0.6 (slightly less sensitive to ambient).
        // silence_duration_ms stays 1200 (rides out mid-sentence thinking).
        //
        // interrupt_response stays true so when the user starts speaking
        // mid-Bernard, his in-flight response is cancelled — that's the right
        // duplex behavior.
        turn_detection: {
          type: 'server_vad',
          threshold: 0.6,
          prefix_padding_ms:   300,
          silence_duration_ms: 1200,
          create_response:     false,
          interrupt_response:  true,
        },
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
    const errBody = await openaiRes.text().catch(() => '')
    console.error(`[realtime-session] mint failed ${openaiRes.status} ws=${ws.slug} iv=${interviewId}: ${errBody.slice(0, 300)}`)
    return res.status(502).json({
      error: `Realtime mint failed (${openaiRes.status})`,
    })
  }

  const data = await openaiRes.json().catch(() => null)
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
    voice: REALTIME_VOICE,
  })
}

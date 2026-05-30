import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useUser } from '@clerk/react'
import { ArrowLeft, Phone, PhoneOff, Mic, MicOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { useWorkspace } from '@/lib/WorkspaceContext'
import {
  apiFetch,
  createInterview,
  getOrCreateStaff,
  updateInterview,
  fetchSimilarInterviews,
  fetchStaffMember,
} from '@/lib/api'
import { getInterviewSystemPrompt } from '@/lib/prompts'

const COMPLETE_TOKEN = 'INTERVIEW_COMPLETE'

/**
 * Realtime-mode patience addendum. The chat interview's system prompt
 * encourages brief acknowledgments ("Got it." "Yeah, makes sense.") between
 * the clinician's answers — which works great when typing but is exactly the
 * "impatient interrupter" pattern on a live voice call. We prepend this block
 * to override that behavior for the realtime lane only. Without it, Bernard
 * fills natural thinking pauses with chatter and cuts off mid-thought when
 * the user resumes speaking.
 */
const REALTIME_PATIENCE_ADDENDUM = `REALTIME VOICE MODE — OVERRIDE RULES (apply ABOVE the standard interview guidance):

You are conducting a live voice interview. The rules below SUPERSEDE anything later in this prompt that conflicts.

## NEVER INFER. NEVER SPECULATE. NEVER FILL IN DETAILS.

- DO NOT say what the clinician is seeing, doing, thinking, or finding unless they have said it themselves in this conversation.
- DO NOT say "I'm guessing you're seeing X", "Often you'd find Y", "So you're probably doing Z", "That makes sense because…", or any phrasing that adds your own clinical content.
- You have NO opinions on this topic. You have NO domain knowledge of your own to contribute. You are a curious interviewer pulling the clinician's perspective OUT of them.
- If they said something vague, ask ONE clean follow-up like "Can you walk me through what that looks like?" — do not paraphrase, do not extend, do not guess.
- Reflect their own words back to them when probing. Use their language, not yours.

## SPEAK BRIEFLY. LET SILENCE EXIST.

- Keep every turn to ONE short question or ONE brief acknowledgment + ONE question. Never two questions in a row.
- Do not fill silence. If the clinician pauses, stay quiet — they are thinking. The system will tell you when they're done.
- Do not greet, restart, or check in if you've already greeted once. No "I'm right here", no "take your time", no "go ahead." Just wait.
- If you've just spoken and haven't heard from the clinician, DO NOT speak again. Wait for them.

## ENDING THE INTERVIEW

Only emit INTERVIEW_COMPLETE on its own line when the clinician clearly signals they want to stop (e.g. "I think that covers it", "that's everything", "I'm done"). Do not end the interview on your own.

---

`

/**
 * PhoneCall — real-time duplex voice interview (Phase 5 Feature #1).
 *
 * Two states: a topic-picker "setup" form, then the live call surface. On
 * Start we create an interview row, fetch the same prompt-context InterviewSession
 * uses (past interviews, concepts/agreement/gap blocks, prior session), build the
 * full system prompt client-side, mint an OpenAI ephemeral token, open WebRTC,
 * and push the prompt over the data channel via session.update. Transcript turns
 * persist to interviews.messages (debounced). When the assistant emits
 * [INTERVIEW_COMPLETE], we finalize and hand off to /interview/:staffId/:interviewId
 * which already knows how to auto-generate the blog post on load.
 *
 * Why we keep the prompt-build on the client: getInterviewSystemPrompt lives
 * in src/lib/prompts.js and is the single source of truth for interview prompts.
 * Replicating it server-side would double the surface area for drift. The server
 * only needs the bootstrap "wait for instructions" stub during the mint.
 */
export default function PhoneCall() {
  useDocumentTitle('Live Interview (Beta)')

  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user } = useUser()
  const workspace = useWorkspace()

  /** UI phase: setup | starting | in_call | completing | error */
  const [phase, setPhase] = useState('setup')
  const [errorMsg, setErrorMsg] = useState(null)
  const [connState, setConnState] = useState('idle') // idle | connecting | connected | ending
  const [paused, setPaused] = useState(false)
  /**
   * Live connection-quality reading from RTCPeerConnection.getStats(). null
   * before the first poll completes; thereafter the dot colour reflects the
   * worst-of (packet loss, jitter). The raw numbers feed the tooltip so
   * Michael can debug a flaky call without DevTools.
   * @type {[ { quality: 'green'|'yellow'|'red', lossPct: number, jitterMs: number, rttMs: number|null } | null, Function ]}
   */
  const [quality, setQuality] = useState(null)

  // Form fields
  const [topic, setTopic] = useState(searchParams.get('topic') || '')

  /**
   * Transcript turns as they accumulate during the call. Each entry is one
   * speaker turn; consecutive user STT events (VAD-segmented breaths) merge
   * into the most recent user turn as long as the assistant hasn't responded
   * yet. Assistant deltas accumulate into one turn until response.*.done.
   * @type {{role:'user'|'assistant',content:string,partial?:boolean}[]}
   */
  const [turns, setTurns] = useState([])

  // Refs that live across the call.
  const pcRef          = useRef(null)
  const dcRef          = useRef(null)
  const micStreamRef   = useRef(null)
  const audioElRef     = useRef(null)
  const interviewIdRef = useRef(null)
  const staffIdRef = useRef(null)
  const persistTimerRef = useRef(null)
  const turnsRef       = useRef(/** @type {{role:'user'|'assistant',content:string,partial?:boolean}[]} */ ([]))
  const completedRef   = useRef(false)
  const assistantBufRef = useRef('')
  // Live user-side transcript buffer. The OpenAI Realtime transcription model
  // only emits .delta events AFTER speech_stopped fires (server-side
  // transcription processes the full utterance, then streams the result
  // word-by-word) — so "live typing while talking" requires a parallel
  // client-side STT. We use the browser's SpeechRecognition API in parallel
  // for INTERIM display only, then overwrite with OpenAI's authoritative
  // transcript on .completed. Same dual-source pattern the chat interview
  // uses for interim feedback.
  const userBufRef     = useRef('')
  const recognitionRef = useRef(/** @type {SpeechRecognition | null} */ (null))
  const recognitionRunningRef = useRef(false)
  // True while Bernard's response is in flight. The SR onend auto-restart
  // checks this flag and skips restart when paused, so SR stays cleanly
  // off while Bernard is speaking (preventing it from transcribing his
  // own audio via the mic-echo loop).
  const srPausedRef           = useRef(false)
  // Speech duration tracking: VAD fires speech_started → speech_stopped with
  // timestamps. We use the duration to reject ambient-noise blips (Whisper
  // hallucinates "Diolch yn fawr" / "Thank you" on silence; if the speech
  // duration was < 500ms it was almost certainly noise, not a real utterance,
  // so we suppress both the transcript render AND the response.create.
  const speechStartedAtRef = useRef(/** @type {number | null} */ (null))
  const lastSpeechDurMsRef = useRef(0)
  const greetedRef         = useRef(false) // true once Bernard's first turn finished
  const responseInFlightRef = useRef(false) // true between response.created and response.done
  // Session start timestamp for the daily-cap accounting. Set when the
  // peer connection moves to 'connected', read on hangUp to PATCH
  // realtime_voice_seconds. durationPersistedRef guards against
  // double-PATCH when hangUp() runs both via endCall and the unmount
  // cleanup effect.
  const callStartedAtRef     = useRef(/** @type {number | null} */ (null))
  const durationPersistedRef = useRef(false)
  // Reconnect machinery. Realtime sessions drop on flaky wifi: pc.connectionState
  // flips to 'failed' or 'disconnected'. We re-mint, reopen, and re-prime
  // Bernard with the last 5 turns so he picks up the thread.
  const systemPromptRef        = useRef(/** @type {string | null} */ (null))
  const reconnectAttemptsRef   = useRef(0)
  const reconnectingRef        = useRef(false)
  const reconnectTimerRef      = useRef(/** @type {ReturnType<typeof setTimeout> | null} */ (null))
  const hangingUpRef           = useRef(false)
  const MAX_RECONNECT_ATTEMPTS = 3

  // Keep turnsRef in sync — the persist debounce reads from the ref so it
  // doesn't capture stale state when the event handler closures over it.
  useEffect(() => { turnsRef.current = turns }, [turns])

  // Connection-quality polling. Runs every 2s while the peer connection is
  // connected. Reads inbound-rtp (audio) packet loss + jitter and the
  // selected ICE candidate-pair RTT. Loss is a delta-since-last-poll
  // percentage so a one-time blip doesn't permanently colour the dot red
  // (and a long-lived call doesn't slowly slide into red from a single
  // early loss).
  useEffect(() => {
    if (connState !== 'connected') {
      setQuality(null)
      return undefined
    }
    let prev = { lost: 0, received: 0 }
    let cancelled = false

    async function poll() {
      const pc = pcRef.current
      if (!pc || cancelled) return
      let stats
      try {
        stats = await pc.getStats(null)
      } catch {
        return
      }
      let lost = 0
      let received = 0
      let jitter = 0
      let rtt = null
      stats.forEach((report) => {
        if (report.type === 'inbound-rtp' && (report.kind === 'audio' || report.mediaType === 'audio')) {
          lost     = Number(report.packetsLost) || 0
          received = Number(report.packetsReceived) || 0
          // jitter is reported in seconds per the spec.
          jitter   = (Number(report.jitter) || 0) * 1000
        }
        if (
          report.type === 'candidate-pair' &&
          (report.nominated === true || report.state === 'succeeded') &&
          typeof report.currentRoundTripTime === 'number'
        ) {
          rtt = report.currentRoundTripTime * 1000
        }
      })

      // Delta-window loss percentage. First poll has no baseline → treat
      // the cumulative value as the window (usually near-zero anyway).
      const dLost     = Math.max(0, lost - prev.lost)
      const dReceived = Math.max(0, received - prev.received)
      const denom     = dLost + dReceived
      const lossPct   = denom > 0 ? (dLost / denom) * 100 : 0
      prev = { lost, received }

      let q = 'green'
      if (lossPct > 8 || jitter > 100) q = 'red'
      else if (lossPct > 2 || jitter > 30) q = 'yellow'

      if (!cancelled) {
        setQuality({ quality: q, lossPct, jitterMs: jitter, rttMs: rtt })
      }
    }

    // First poll fires after the interval so the very first reading isn't
    // an artifact of "we just connected, zero packets received yet."
    const handle = setInterval(poll, 2000)
    return () => {
      cancelled = true
      clearInterval(handle)
    }
  }, [connState])

  // Tear down on unmount in case the user navigates away mid-call. hangUp is
  // a stable scope-level helper — listing it would force the effect to re-run
  // every render (defeating its purpose as a one-shot unmount cleanup).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => hangUp(), [])

  // ── Topic suggestions (lightweight, just the workspace's curated list) ──
  const suggestions = useMemo(() => {
    const list = Array.isArray(workspace?.topic_suggestions) ? workspace.topic_suggestions : []
    return list.slice(0, 6).map((s) => (typeof s === 'string' ? s : s?.topic)).filter(Boolean)
  }, [workspace])

  // ────────────────────────────────────────────────────────────────────────
  // Setup → Live call transition
  // ────────────────────────────────────────────────────────────────────────

  async function startCall() {
    if (!topic.trim() || !user) {
      setErrorMsg('Please pick a topic before starting the call.')
      return
    }
    setErrorMsg(null)
    setTurns([])
    turnsRef.current = []
    assistantBufRef.current = ''
    completedRef.current = false
    callStartedAtRef.current = null
    durationPersistedRef.current = false
    reconnectAttemptsRef.current = 0
    reconnectingRef.current = false
    hangingUpRef.current = false
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
    setPhase('starting')

    try {
      // 1. Find or create the clinician row bound to this user. Default to
      //    the user's display name; isSelf=true so subsequent captures reuse
      //    the same clinician (same pattern as NewInterview).
      const displayName =
        user.unsafeMetadata?.display_name ||
        user.fullName ||
        user.primaryEmailAddress?.emailAddress?.split('@')[0] ||
        'Me'
      const clinician = await getOrCreateStaff({
        name: displayName,
        createdById: user.id,
        createdByEmail: user.primaryEmailAddress?.emailAddress,
        userId: user.id,
      })
      staffIdRef.current = clinician.id

      // 2. Create the interview row. capture_mode='realtime_voice' marks it
      //    so analytics can split realtime vs. chat. Tone uses the clinician's
      //    saved default (getOrCreateStaff returns default_tone); falls
      //    back to 'smart' for a brand-new clinician with no preference set.
      const interview = await createInterview({
        staffId: clinician.id,
        topic: topic.trim(),
        ownerEmail: user.primaryEmailAddress?.emailAddress,
        tone: clinician.default_tone || 'smart',
        voiceMode: 'practice',
      })
      // Tag capture_mode separately — createInterview's signature doesn't
      // accept it (designed before the multi-lane Capture Picker existed).
      // A PATCH right after creation is the same shape voice-memo uses.
      await updateInterview(interview.id, { capture_mode: 'realtime_voice' })
      interviewIdRef.current = interview.id

      // 3. In parallel: fetch the prompt-context refs InterviewSession uses
      //    (similar interviews, learned concepts, prior session) so the AI
      //    has the same backstory it would in chat mode. Each individual
      //    fetch failure degrades gracefully — we still start the call.
      const ctxStaffParam = `&staff_id=${encodeURIComponent(clinician.id)}`
      const [pastInterviews, conceptCtx, staffRow] = await Promise.all([
        fetchSimilarInterviews(topic.trim(), interview.id).catch(() => []),
        apiFetch(
          `/api/concepts/context?topic=${encodeURIComponent(topic.trim())}${ctxStaffParam}`,
        ).catch(() => ({})),
        fetchStaffMember(clinician.id).catch(() => null),
      ])

      // Build the prior-session reference exactly the way InterviewSession does.
      let priorSessionContext = null
      const priorInterviews = (staffRow?.interviews || [])
        .filter((iv) => iv.status === 'completed' && iv.id !== interview.id)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      if (priorInterviews.length > 0) {
        const prior = priorInterviews[0]
        const topicWords = topic.trim().toLowerCase().split(/\W+/).filter((w) => w.length > 3)
        const priorWords = (prior.topic || '').toLowerCase().split(/\W+/).filter((w) => w.length > 3)
        if (topicWords.some((w) => priorWords.includes(w))) {
          priorSessionContext = { topic: prior.topic }
        }
      }

      const baseSystemPrompt = getInterviewSystemPrompt(
        workspace,
        clinician.name,
        topic.trim(),
        pastInterviews || [],
        null, // prototypeId — none for realtime spike
        {
          tone: staffRow?.default_tone || clinician.default_tone || 'smart',
          isFirstMessage: true,
          priorSessionContext,
          conceptBlock:   conceptCtx?.block || '',
          agreementBlock: conceptCtx?.agreementBlock || '',
          gapBlock:       conceptCtx?.gapBlock || '',
          // Team-as-talent (Phase 1.5): branch to non-clinical staff prompt when applicable.
          // Default 'clinician' keeps existing behavior byte-identical.
          staffType:      staffRow?.staff_type || clinician?.staff_type || 'clinician',
        },
      )
      // Voice-mode patience override sits ABOVE the standard prompt so the
      // model reads it first and treats it as the dominant rule set.
      const fullPrompt = REALTIME_PATIENCE_ADDENDUM + baseSystemPrompt
      systemPromptRef.current = fullPrompt

      // 4. Mint the realtime ephemeral. The server validates workspace flag
      //    + tenant ownership of interviewId before calling OpenAI.
      const mint = /** @type {{ clientSecret: string, model: string }} */ (
        await apiFetch('/api/realtime-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ interviewId: interview.id }),
        })
      )

      // 5. Open WebRTC and hand off to the in-call surface. The data channel
      //    handler pushes session.update with the full prompt as soon as it
      //    opens — bootstrap instructions on the server tell the model to
      //    stay silent until then so it doesn't blurt nonsense.
      await openRealtimeConnection(mint, fullPrompt)
      setPhase('in_call')
    } catch (e) {
      console.error('[phone-call] start failed', e)
      setErrorMsg(e?.message || 'Could not start the call. Please try again.')
      setPhase('error')
      hangUp()
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // WebRTC plumbing
  // ────────────────────────────────────────────────────────────────────────

  /**
   * @param {{ clientSecret: string, model: string }} mint
   * @param {string} systemPrompt full getInterviewSystemPrompt() result
   * @param {{ resumeTurns?: {role:'user'|'assistant',content:string}[] }} [opts]
   *        Last few turns to replay as conversation context (used on reconnect
   *        so Bernard picks up where the call dropped).
   */
  async function openRealtimeConnection(mint, systemPrompt, opts = {}) {
    const resumeTurns = Array.isArray(opts.resumeTurns) ? opts.resumeTurns : []
    setConnState('connecting')
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    })
    pcRef.current = pc

    pc.ontrack = (event) => {
      const el = audioElRef.current
      if (!el) return
      el.srcObject = event.streams[0]
      el.play().catch((err) => {
        console.warn('[phone-call] audio el play failed:', err?.message)
      })
    }

    pc.onconnectionstatechange = () => {
      const s = pc.connectionState
      if (s === 'connected') {
        setConnState('connected')
        if (callStartedAtRef.current == null) {
          callStartedAtRef.current = Date.now()
        }
        // A successful (re)connection resets the attempt counter so the
        // NEXT drop gets a full 3-attempt budget.
        reconnectAttemptsRef.current = 0
        reconnectingRef.current = false
      }
      if (s === 'failed' || s === 'disconnected') {
        // Don't reconnect when we initiated the teardown.
        if (hangingUpRef.current) return
        scheduleReconnect(s)
      }
    }

    // Mic capture before SDP so the offer advertises sendrecv.
    const micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
    micStreamRef.current = micStream
    for (const track of micStream.getTracks()) pc.addTrack(track, micStream)

    // Kick off the parallel client-side STT for live interim display.
    // Failure is non-fatal — Web Speech is unavailable on Firefox / older
    // Safari, and the UI degrades to "transcript appears after each turn"
    // (still functional, just less immediate).
    startWebSpeechSTT()

    // Data channel — server events arrive here AND we push session.update
    // outbound the moment it opens.
    const dc = pc.createDataChannel('oai-events')
    dcRef.current = dc
    dc.addEventListener('open', () => {
      // Push the real system prompt. The bootstrap on the server told the
      // model to stay silent until configured; this is the configuration.
      const updateEvent = {
        type: 'session.update',
        session: {
          type: 'realtime',
          instructions: systemPrompt,
        },
      }
      try {
        dc.send(JSON.stringify(updateEvent))
      } catch (e) {
        console.error('[phone-call] session.update send failed', e?.message)
      }
      // Resume mode — replay the last few turns as conversation items so
      // Bernard has the immediate context of what was just being discussed
      // before the call dropped. Without this he'd open with a generic
      // greeting and Michael would have to re-orient him.
      if (resumeTurns.length > 0) {
        for (const t of resumeTurns) {
          const isUser = t.role === 'user'
          const item = {
            type: 'conversation.item.create',
            item: {
              type: 'message',
              role: t.role,
              content: [{
                type: isUser ? 'input_text' : 'text',
                text: String(t.content || '').replace(COMPLETE_TOKEN, '').trim(),
              }],
            },
          }
          try { dc.send(JSON.stringify(item)) } catch (e) {
            console.warn('[phone-call] resume conv.item.create failed', e?.message)
          }
        }
      }
      // Trigger the first assistant turn now that instructions are in.
      // Without this prod the model waits for user audio — which is fine, but
      // the system prompt's "open with one warm sentence" instruction expects
      // an assistant-first turn. response.create kicks that off.
      //
      // On resume, this also asks Bernard to take the next turn picking up
      // the thread (his system prompt's "stay in character" rules apply, so
      // he won't restart with a fresh greeting).
      try {
        dc.send(JSON.stringify({ type: 'response.create' }))
      } catch (e) {
        console.error('[phone-call] response.create send failed', e?.message)
      }
    })
    dc.addEventListener('message', (e) => {
      try {
        const evt = JSON.parse(e.data)
        handleRealtimeEvent(evt)
      } catch {
        /* non-JSON — ignore */
      }
    })

    // SDP offer → /v1/realtime/calls with the ephemeral as Bearer.
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)

    const sdpRes = await fetch(
      `https://api.openai.com/v1/realtime/calls?model=${encodeURIComponent(mint.model)}`,
      {
        method: 'POST',
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${mint.clientSecret}`,
          'Content-Type': 'application/sdp',
        },
      },
    )
    if (!sdpRes.ok) {
      const body = await sdpRes.text().catch(() => '')
      throw new Error(`OpenAI Realtime refused the connection (${sdpRes.status}): ${body.slice(0, 200)}`)
    }
    const answerSdp = await sdpRes.text()
    await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp })
  }

  // ────────────────────────────────────────────────────────────────────────
  // Parallel client-side STT (Web Speech API) for live interim feedback
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Run the browser's SpeechRecognition in parallel with the WebRTC stream so
   * the user sees their words appear in real time WHILE they're talking.
   *
   * Why parallel: OpenAI's server-side transcription only emits delta events
   * AFTER input_audio_buffer.speech_stopped fires (verified via debug logs).
   * So WebRTC alone is "transcript appears AFTER you stop talking" — which
   * Michael flagged as making him unsure the call was even hearing him.
   *
   * Web Speech runs locally in the browser, gives true-interim results
   * character by character. We use it for DISPLAY only — OpenAI's
   * authoritative transcript still arrives via the WebRTC data channel and
   * overwrites the partial on .completed. Two transcribers, one source of
   * truth.
   *
   * Caveats:
   *  - Web Speech is unavailable on Firefox + some older Safari. Failure is
   *    silent and non-fatal; UI degrades to OpenAI-only (transcript appears
   *    after each turn, same as the previous build).
   *  - Chrome's continuous mode auto-stops on extended silence; we restart
   *    via the onend handler.
   */
  function startWebSpeechSTT() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) {
      console.info('[phone-call] SpeechRecognition unavailable — interim feedback disabled')
      return
    }
    if (recognitionRef.current) return // already running

    const recognition = new SR()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'

    let finalText = ''
    recognition.onresult = (event) => {
      let interim = ''
      let newFinal = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) {
          newFinal += result[0].transcript
        } else {
          interim += result[0].transcript
        }
      }
      if (newFinal) finalText += newFinal
      const display = (finalText + interim).trim()
      if (!display) return
      // Render as a partial user turn. OpenAI's .completed will overwrite
      // this with its authoritative transcript (which is what we persist).
      userBufRef.current = display
      setTurns((prev) => upsertPartialUser(prev, display))
    }
    recognition.onend = () => {
      // Reset for the next utterance (we keep restarting until hangUp).
      finalText = ''
      // Skip restart when paused — Bernard is speaking and we don't want SR
      // to transcribe his audio via the mic-echo loop. response.done will
      // call startWebSpeechSTT to bring SR back online.
      if (recognitionRunningRef.current && !srPausedRef.current) {
        try { recognition.start() } catch { /* already starting */ }
      }
    }
    recognition.onerror = (e) => {
      // Common: 'no-speech' fires during long silences; 'not-allowed' if
      // mic was revoked. We just log and let onend handle restart.
      console.info('[phone-call] SR error', e?.error || e)
    }

    recognitionRef.current = recognition
    recognitionRunningRef.current = true
    try {
      recognition.start()
    } catch (e) {
      console.warn('[phone-call] SR start failed', e?.message)
      recognitionRef.current = null
      recognitionRunningRef.current = false
    }
  }

  function stopWebSpeechSTT() {
    recognitionRunningRef.current = false
    const r = recognitionRef.current
    recognitionRef.current = null
    if (!r) return
    try { r.onend = null } catch { /* ignore */ }
    try { r.abort() } catch { /* ignore */ }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Realtime event handling
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Decode one event from the oai-events data channel.
   *
   * The GA API renamed the assistant-transcript events from the preview
   * (`response.audio_transcript.*` → `response.output_audio_transcript.*`).
   * We handle both shapes so the page survives further field renames.
   *
   * User-side STT (Whisper) fires `input_audio_transcription.completed` once
   * per VAD-segmented chunk. Consecutive segments before any assistant turn
   * merge into one user turn — saying "Okay let's talk about [pause] post-op
   * shoulders" otherwise renders as two separate lines, which the user saw
   * in the spike smoke and called confusing.
   */
  function handleRealtimeEvent(evt) {
    if (!evt || typeof evt.type !== 'string') return

    // ── Assistant streaming transcript ────────────────────────────────────
    if (
      evt.type === 'response.audio_transcript.delta' ||
      evt.type === 'response.output_audio_transcript.delta'
    ) {
      const delta = String(evt.delta ?? '')
      if (!delta) return
      assistantBufRef.current += delta
      setTurns((prev) => upsertPartialAssistant(prev, assistantBufRef.current))
      return
    }
    if (
      evt.type === 'response.audio_transcript.done' ||
      evt.type === 'response.output_audio_transcript.done'
    ) {
      const finalText = String(
        evt.transcript ?? evt.text ?? assistantBufRef.current,
      ).trim()
      assistantBufRef.current = ''
      if (!finalText) return
      setTurns((prev) => {
        const next = finalizeAssistant(prev, finalText)
        turnsRef.current = next
        return next
      })
      // Completion detection — the model emits INTERVIEW_COMPLETE on a line
      // by itself in its final spoken turn. Same exact token convention as
      // InterviewSession so the downstream completion logic doesn't need a
      // separate code path.
      if (finalText.includes(COMPLETE_TOKEN) && !completedRef.current) {
        completedRef.current = true
        handleInterviewComplete()
      } else {
        schedulePersist()
      }
      return
    }

    // ── VAD speech-window tracking ────────────────────────────────────────
    // We use these to distinguish a real user utterance from ambient-noise
    // blips. server_vad fires speech_started when its threshold gets crossed
    // and speech_stopped on the silence-duration tail. The duration between
    // them is our gate: real speech is usually > 500ms even for short
    // answers; ambient noise that triggers VAD is typically < 300ms.
    if (evt.type === 'input_audio_buffer.speech_started') {
      speechStartedAtRef.current = Date.now()
      // New utterance starting — drop any leftover partial buffer so we
      // don't bleed the previous turn's deltas into this one. Also abort
      // Web Speech so its internal results array resets cleanly for the
      // new utterance (its onend handler will restart it).
      userBufRef.current = ''
      const r = recognitionRef.current
      if (r) {
        try { r.abort() } catch { /* ignore */ }
      }
      return
    }
    if (evt.type === 'input_audio_buffer.speech_stopped') {
      const startedAt = speechStartedAtRef.current
      lastSpeechDurMsRef.current = startedAt ? Date.now() - startedAt : 0
      speechStartedAtRef.current = null
      return
    }

    // ── User-side STT (Whisper) — live partial deltas while speaking ──────
    // Whisper streams .delta events as the user is talking so the transcript
    // updates in real time — matches the interim-results behavior of the
    // chat interview and gives the user immediate feedback that the call IS
    // hearing them. We render these as a partial user turn (italicized
    // muted), then promote-or-drop on .completed.
    if (
      evt.type === 'conversation.item.input_audio_transcription.delta' ||
      evt.type === 'conversation.item.input_audio_transcription.partial'
    ) {
      const delta = String(evt.delta ?? evt.transcript ?? '')
      if (!delta) return
      userBufRef.current += delta
      setTurns((prev) => upsertPartialUser(prev, userBufRef.current))
      return
    }

    // ── User-side STT (Whisper) — final transcript ────────────────────────
    if (evt.type === 'conversation.item.input_audio_transcription.completed') {
      const text = String(evt.transcript ?? '').trim()
      if (!text) return

      // Whisper hallucinates on silence/noise — common artifacts: "Thank you",
      // "Thank you very much", "Diolch yn fawr" (Welsh), ".", "...", "Bye".
      // We reject in two ways:
      //   1. Speech duration < 500ms — VAD declared a turn but the speech was
      //      too short to be real. Suppress AND skip Bernard's response.
      //   2. Known hallucination phrases — short, formulaic, no information
      //      content. Suppress + skip.
      const looksHallucinated = isLikelyWhisperHallucination(text)
      const tooShort = lastSpeechDurMsRef.current > 0 && lastSpeechDurMsRef.current < 500
      userBufRef.current = ''
      if (looksHallucinated || tooShort) {
        if (import.meta.env.DEV) {
          console.info(
            '[phone-call] suppressing likely hallucination',
            { text, durMs: lastSpeechDurMsRef.current, looksHallucinated },
          )
        }
        // Drop any partial we showed while speech was streaming and skip the
        // response trigger — the user saw the partial briefly which is fine,
        // it disappears now that we know it was noise.
        setTurns((prev) => {
          const next = dropPartialUser(prev)
          turnsRef.current = next
          return next
        })
        return
      }

      // Promote the partial to a finalized turn (or merge with the previous
      // finalized user turn if there was no streaming partial, e.g. .delta
      // events weren't emitted for this turn).
      setTurns((prev) => {
        const next = finalizeUser(prev, text)
        turnsRef.current = next
        return next
      })
      schedulePersist()

      // Manual response trigger — server is configured with
      // create_response:false so Bernard never auto-responds. This is the
      // only place we ask him to.
      //
      // Two gates:
      //   - greetedRef: don't fire before Bernard's opening question finishes.
      //     Otherwise an ambient blip during the greeting would queue a
      //     second response that collides with the first.
      //   - responseInFlightRef: don't fire while a response is already
      //     streaming. interrupt_response:true means the model handles
      //     barge-in itself; queueing another response.create here would
      //     produce double-talk.
      if (greetedRef.current && !responseInFlightRef.current) {
        try {
          dcRef.current?.send(JSON.stringify({ type: 'response.create' }))
        } catch (e) {
          console.warn('[phone-call] response.create after user turn failed', e?.message)
        }
      }
      return
    }

    // Track in-flight responses so we don't double-fire response.create.
    // greetedRef flips on the FIRST response.created so an early interrupter
    // (user starts talking during greeting) is still answered correctly.
    if (evt.type === 'response.created') {
      responseInFlightRef.current = true
      greetedRef.current = true
      // Pause Web Speech while Bernard is speaking. Web Speech runs its own
      // audio capture session that doesn't see WebRTC's echo cancellation,
      // so without this it transcribes Bernard's own voice (coming out of
      // the speakers and bouncing into the mic) AS user speech. Smoke #6
      // showed "he sounds like hey thanks for making the time let's Dive
      // Right Here…" — literally what Bernard had just said. srPausedRef
      // blocks the onend auto-restart while Bernard talks; response.done
      // resumes.
      srPausedRef.current = true
      const r = recognitionRef.current
      if (r) {
        try { r.abort() } catch { /* ignore */ }
      }
      return
    }
    if (evt.type === 'response.done' || evt.type === 'response.cancelled') {
      // Tokens are done generating, but Bernard's audio may STILL be playing
      // out of the speaker — we observed up to ~1s of tail audio after
      // response.done. We hold off restarting Web Speech until
      // output_audio_buffer.stopped fires (see below), otherwise SR captures
      // the tail of Bernard's question as "user" speech. Smoke #7 caught
      // exactly that — italic "You:" line containing Bernard's last words.
      responseInFlightRef.current = false
      return
    }
    // Audio playback actually finished — now it's safe to restart SR. This
    // is the correct restart trigger, not response.done.
    if (evt.type === 'output_audio_buffer.stopped') {
      srPausedRef.current = false
      const r = recognitionRef.current
      if (r) {
        try { r.start() } catch { /* already running */ }
      } else {
        startWebSpeechSTT()
      }
      return
    }

    if (evt.type === 'error') {
      const message = evt?.error?.message
      console.error('[phone-call] realtime error', message || evt)
      setErrorMsg(message || 'Realtime API error')
      return
    }

    if (import.meta.env.DEV) console.info('[phone-call] evt', evt.type)
  }

  // ────────────────────────────────────────────────────────────────────────
  // Persistence (debounced PATCH of interviews.messages)
  // ────────────────────────────────────────────────────────────────────────

  /** Snapshot turns to interviews.messages 1.5s after the last event. */
  const schedulePersist = useCallback(() => {
    if (!interviewIdRef.current) return
    clearTimeout(persistTimerRef.current)
    persistTimerRef.current = setTimeout(() => {
      const snapshot = turnsRef.current
        .filter((t) => !t.partial && t.content?.trim())
        .map((t) => ({ role: t.role, content: t.content }))
      if (snapshot.length === 0) return
      updateInterview(interviewIdRef.current, { messages: snapshot }).catch((err) => {
        console.warn('[phone-call] persist failed', err?.status, err?.message)
      })
    }, 1500)
  }, [])

  // ────────────────────────────────────────────────────────────────────────
  // Completion flow — when the assistant emits INTERVIEW_COMPLETE
  // ────────────────────────────────────────────────────────────────────────

  async function handleInterviewComplete() {
    setPhase('completing')
    // Flush any pending persist immediately so the final PATCH is the one
    // InterviewSession sees on load.
    clearTimeout(persistTimerRef.current)
    const snapshot = turnsRef.current
      .filter((t) => !t.partial && t.content?.trim())
      .map((t) => ({ role: t.role, content: t.content }))
    try {
      await updateInterview(interviewIdRef.current, {
        messages: snapshot,
        // Don't set status='completed' here — InterviewSession's auto-gen
        // effect keys off the COMPLETE_TOKEN in the last assistant message
        // and handles status itself once the blog post is generated. Setting
        // status here would race the chat path's logic.
      })
    } catch (e) {
      console.warn('[phone-call] final persist failed', e?.message)
    }
    hangUp()
    // Hand off to InterviewSession. The COMPLETE_TOKEN is already in the
    // assistant's final message (model emitted it), but pass wrap=1 too as
    // a safety net — if the final PATCH above failed, wrap=1 still tells
    // InterviewSession to treat this as a completed realtime call.
    navigate(`/interview/${staffIdRef.current}/${interviewIdRef.current}?from=realtime&wrap=1`)
  }

  // ────────────────────────────────────────────────────────────────────────
  // Controls
  // ────────────────────────────────────────────────────────────────────────

  function togglePause() {
    const stream = micStreamRef.current
    if (!stream) return
    const next = !paused
    for (const t of stream.getAudioTracks()) t.enabled = !next
    setPaused(next)
  }

  // ────────────────────────────────────────────────────────────────────────
  // Reconnect — pc.connectionState went 'failed' or 'disconnected'
  // ────────────────────────────────────────────────────────────────────────

  function scheduleReconnect(triggerState) {
    if (reconnectingRef.current || hangingUpRef.current) return
    reconnectingRef.current = true
    setConnState('reconnecting')
    // 'disconnected' can recover on its own (ICE may re-establish); give it
    // ~2s before tearing down. 'failed' is terminal so go immediately.
    const delay = triggerState === 'disconnected' ? 2000 : 0
    reconnectTimerRef.current = setTimeout(() => {
      // Last check — if ICE healed itself during the wait, abort.
      const pc = pcRef.current
      if (!hangingUpRef.current && pc && pc.connectionState === 'connected') {
        reconnectingRef.current = false
        setConnState('connected')
        return
      }
      attemptReconnect()
    }, delay)
  }

  async function attemptReconnect() {
    if (hangingUpRef.current) { reconnectingRef.current = false; return }
    const ivId = interviewIdRef.current
    const prompt = systemPromptRef.current
    if (!ivId || !prompt) {
      // Nothing to reconnect with — surface a real error.
      setErrorMsg('Connection lost and could not be restored.')
      setPhase('error')
      reconnectingRef.current = false
      return
    }

    reconnectAttemptsRef.current += 1
    const attempt = reconnectAttemptsRef.current
    if (attempt > MAX_RECONNECT_ATTEMPTS) {
      setErrorMsg('Lost the connection and could not get it back. Please start a new call.')
      setPhase('error')
      hangUp()
      return
    }

    // Tear down the broken peer connection BUT keep the audio element +
    // interview/clinician refs + transcript. We're rebuilding the pipe,
    // not the conversation.
    try { dcRef.current?.close() } catch { /* already closed */ }
    try { pcRef.current?.close() } catch { /* already closed */ }
    dcRef.current = null
    pcRef.current = null
    stopWebSpeechSTT()
    if (micStreamRef.current) {
      for (const t of micStreamRef.current.getTracks()) t.stop()
      micStreamRef.current = null
    }

    // Capture the tail of the conversation so Bernard can pick up the thread.
    const finalized = turnsRef.current
      .filter((t) => !t.partial && t.content?.trim())
      .map((t) => ({ role: t.role, content: t.content }))
    const resumeTurns = finalized.slice(-5)

    try {
      const mint = /** @type {{ clientSecret: string, model: string }} */ (
        await apiFetch('/api/realtime-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ interviewId: ivId }),
        })
      )
      await openRealtimeConnection(mint, prompt, { resumeTurns })
      // setConnState('connected') happens via onconnectionstatechange.
    } catch (e) {
      console.warn(`[phone-call] reconnect attempt ${attempt} failed:`, e?.message)
      if (attempt >= MAX_RECONNECT_ATTEMPTS) {
        setErrorMsg(e?.message || 'Could not reconnect.')
        setPhase('error')
        hangUp()
        return
      }
      // Back off and try again. Linear 2s — exponential would push the
      // total reconnect window past the user's patience.
      reconnectTimerRef.current = setTimeout(() => attemptReconnect(), 2000)
    }
  }

  function hangUp() {
    hangingUpRef.current = true
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
    reconnectingRef.current = false
    setConnState('ending')
    clearTimeout(persistTimerRef.current)
    stopWebSpeechSTT()
    try { dcRef.current?.close() } catch { /* already closed */ }
    try { pcRef.current?.close() } catch { /* already closed */ }
    dcRef.current = null
    pcRef.current = null
    if (micStreamRef.current) {
      for (const t of micStreamRef.current.getTracks()) t.stop()
      micStreamRef.current = null
    }
    const el = audioElRef.current
    if (el) {
      el.pause()
      el.srcObject = null
    }
    // Persist actual session duration for daily-cap accounting. Fire-and-
    // forget — if it fails the cap will just under-count today. Guarded so
    // an unmount cleanup running after endCall() doesn't double-PATCH (and
    // overwrite with a slightly later, larger value).
    const startedAt = callStartedAtRef.current
    const ivId = interviewIdRef.current
    if (startedAt && ivId && !durationPersistedRef.current) {
      durationPersistedRef.current = true
      const seconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000))
      updateInterview(ivId, { realtime_voice_seconds: seconds }).catch((err) => {
        console.warn('[phone-call] duration persist failed', err?.status, err?.message)
      })
    }
    setConnState('idle')
    setPaused(false)
  }

  function endCall() {
    // User clicked End — treat as "wrap up & generate." We inject the
    // INTERVIEW_COMPLETE token into the last assistant message (or synthesize
    // one if Bernard never spoke) so InterviewSession's auto-gen effect
    // fires on load and the user lands on a blog-generation screen, NOT the
    // chat-interview resume UI. The first smoke surfaced this: clicking End
    // dropped Michael into what looked like "start typing more here," which
    // wasn't the intent.
    //
    // If the user wants to save without generating, they navigate away with
    // the back arrow — messages are already persisted via the 1.5s debounce.
    if (completedRef.current) return
    setPhase('completing')
    clearTimeout(persistTimerRef.current)

    const snapshot = turnsRef.current
      .filter((t) => !t.partial && t.content?.trim())
      .map((t) => ({ role: t.role, content: t.content }))

    // Find the last assistant turn and append the completion token. If there
    // is no assistant turn yet (call ended VERY early), synthesize one so the
    // downstream "did the AI signal completion?" check has something to match.
    const lastAssistantIdx = (() => {
      for (let i = snapshot.length - 1; i >= 0; i--) {
        if (snapshot[i].role === 'assistant') return i
      }
      return -1
    })()
    if (lastAssistantIdx >= 0) {
      const last = snapshot[lastAssistantIdx]
      if (!last.content.includes(COMPLETE_TOKEN)) {
        snapshot[lastAssistantIdx] = {
          ...last,
          content: `${last.content.trim()}\n\n${COMPLETE_TOKEN}`,
        }
      }
    } else {
      snapshot.push({
        role: 'assistant',
        content: `Thanks for the conversation.\n\n${COMPLETE_TOKEN}`,
      })
    }

    const persistP = snapshot.length
      ? updateInterview(interviewIdRef.current, { messages: snapshot }).catch(() => {})
      : Promise.resolve()
    persistP.finally(() => {
      hangUp()
      if (interviewIdRef.current && staffIdRef.current) {
        // wrap=1 tells InterviewSession the user clicked End — even if the
        // PATCH above failed to persist the COMPLETE_TOKEN, InterviewSession
        // will treat the call as complete and kick off blog generation
        // instead of falling through to chat-resume mode.
        navigate(`/interview/${staffIdRef.current}/${interviewIdRef.current}?from=realtime&wrap=1`)
      } else {
        navigate('/')
      }
    })
  }

  // ────────────────────────────────────────────────────────────────────────
  // Render
  // ────────────────────────────────────────────────────────────────────────

  // Audio element always in DOM so iOS Safari gesture-prime works on Start.
  const audioEl = <audio ref={audioElRef} autoPlay />

  if (phase === 'setup') {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <Header />
        {audioEl}
        <Card>
          <CardContent className="p-6 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="phone-call-topic">What do you want to talk about?</Label>
              <Input
                id="phone-call-topic"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="e.g. Post-op shoulder rehab, runners with chronic plantar fasciitis"
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                Bernard will open the call with a question on this topic. You can wrap up by
                saying something like &ldquo;I think that covers it.&rdquo;
              </p>
            </div>

            {suggestions.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Suggested topics
                </div>
                <div className="flex flex-wrap gap-2">
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setTopic(s)}
                      className="text-xs px-2.5 py-1 rounded-full border hover:border-primary hover:bg-accent/40 transition"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {errorMsg && (
              <div className="text-sm text-destructive">{errorMsg}</div>
            )}

            <div className="flex gap-2">
              <Button
                onClick={startCall}
                disabled={!topic.trim()}
              >
                <Phone className="h-4 w-4 mr-2" />
                Start call
              </Button>
            </div>
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground">
          Beta — continuous voice. Allow microphone access when prompted. Transcript persists
          to Stories the same as a chat interview.
        </p>
      </div>
    )
  }

  if (phase === 'starting') {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <Header />
        {audioEl}
        <Card>
          <CardContent className="p-6">
            <div className="text-sm font-medium">Setting up the call…</div>
            <div className="text-xs text-muted-foreground mt-1">
              Connecting to the realtime voice and warming up Bernard. Should take a few seconds.
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <Header />
        {audioEl}
        <Card>
          <CardContent className="p-6 space-y-3">
            <div className="text-sm font-medium">Couldn’t start the call</div>
            <div className="text-xs text-muted-foreground">{errorMsg}</div>
            <Button onClick={() => setPhase('setup')} variant="outline">Back</Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  // phase === 'in_call' | 'completing'
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Header topic={topic} />
      {audioEl}

      <Card>
        <CardContent className="p-6 space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">
                {phase === 'completing' && 'Wrapping up…'}
                {phase === 'in_call' && connState === 'connecting' && 'Connecting…'}
                {phase === 'in_call' && connState === 'reconnecting' && 'Reconnecting…'}
                {phase === 'in_call' && connState === 'connected' && (paused ? 'Paused' : 'In call')}
                {phase === 'in_call' && connState === 'idle' && 'Ended'}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {phase === 'in_call' && connState === 'connected' && !paused &&
                  'Listening — go ahead and talk. Say "I think that covers it" to wrap up.'}
                {phase === 'in_call' && connState === 'reconnecting' &&
                  `Lost the connection — re-establishing it now (attempt ${reconnectAttemptsRef.current || 1}/${MAX_RECONNECT_ATTEMPTS}). Bernard will pick up where you left off.`}
                {phase === 'in_call' && paused &&
                  'Your mic is paused. Bernard can’t hear you. Tap Resume to keep going.'}
                {phase === 'completing' && 'Saving the conversation and generating your blog post.'}
              </div>
            </div>
            <span
              aria-label={qualityLabel(connState, quality)}
              title={qualityTooltip(connState, quality)}
              className={
                connState === 'connecting' || connState === 'reconnecting'
                  ? 'h-2.5 w-2.5 rounded-full bg-amber-500 animate-pulse'
                : connState === 'connected'
                  ? `h-2.5 w-2.5 rounded-full ${qualityDotColor(quality)}`
                  : 'h-2.5 w-2.5 rounded-full bg-muted-foreground/30'
              }
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {phase === 'in_call' && (
              <>
                <Button onClick={endCall} variant="destructive">
                  <PhoneOff className="h-4 w-4 mr-2" />
                  End call
                </Button>
                <Button onClick={togglePause} variant="outline">
                  {paused ? <Mic className="h-4 w-4 mr-2" /> : <MicOff className="h-4 w-4 mr-2" />}
                  {paused ? 'Resume' : 'Pause'}
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6 space-y-3">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Live transcript</div>
          {turns.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              Bernard will speak first — give him a beat to greet you.
            </div>
          ) : (
            // Reverse-chronological: newest at top, older below. Without this
            // the user can't see the live turn without scrolling — the
            // previous chronological-with-scroll layout buried new content
            // below the card fold during long calls. No internal max-height
            // so the card just grows; the latest line is always at the top
            // of the card at its fixed scroll position.
            <div className="space-y-3">
              {turns.slice().reverse().map((t, i) => (
                <div key={turns.length - 1 - i} className="text-sm leading-relaxed">
                  <span className="font-medium mr-2">{t.role === 'user' ? 'You' : 'Bernard'}:</span>
                  <span className={t.partial ? 'text-muted-foreground' : ''}>
                    {/* Hide the literal INTERVIEW_COMPLETE token from the live view —
                        the model emits it for the completion handler, not for the user. */}
                    {t.content.replace(COMPLETE_TOKEN, '').trim()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Header (shared across phases)
// ────────────────────────────────────────────────────────────────────────────

function Header({ topic }) {
  return (
    <div className="flex items-center gap-3">
      <Button variant="ghost" size="icon" asChild>
        <Link to="/new">
          <ArrowLeft className="h-4 w-4" />
        </Link>
      </Button>
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">
          Live Interview{' '}
          <span className="ml-2 text-3xs font-normal text-muted-foreground align-middle border rounded px-1.5 py-0.5">
            Beta
          </span>
        </h1>
        <p className="text-sm text-muted-foreground truncate">
          {topic ? <>Talking about: <span className="font-medium text-foreground">{topic}</span></>
                 : 'Continuous voice conversation. No press-to-talk — just talk.'}
        </p>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Connection-quality helpers
// ────────────────────────────────────────────────────────────────────────────

function qualityDotColor(quality) {
  if (!quality) return 'bg-emerald-500'
  if (quality.quality === 'red')    return 'bg-red-500'
  if (quality.quality === 'yellow') return 'bg-amber-500'
  return 'bg-emerald-500'
}

function qualityLabel(connState, quality) {
  if (connState === 'connecting')   return 'Connecting'
  if (connState === 'reconnecting') return 'Reconnecting'
  if (connState !== 'connected')    return 'Disconnected'
  if (!quality)                     return 'Connected'
  return `Connection ${quality.quality}`
}

function qualityTooltip(connState, quality) {
  if (connState !== 'connected') return undefined
  if (!quality) return 'Measuring connection…'
  const rtt = quality.rttMs == null ? '—' : `${Math.round(quality.rttMs)}ms`
  return `Loss ${quality.lossPct.toFixed(1)}%  ·  Jitter ${Math.round(quality.jitterMs)}ms  ·  RTT ${rtt}`
}

// ────────────────────────────────────────────────────────────────────────────
// Whisper-hallucination filter
// ────────────────────────────────────────────────────────────────────────────

/**
 * Whisper, the model OpenAI Realtime uses for input transcription, is known
 * to hallucinate plausible-sounding phrases when fed silence or ambient noise.
 * The most common artifacts are sign-off phrases ("Thank you", "Goodbye") and
 * a handful of foreign-language equivalents that show up in Whisper's
 * subtitle training data (especially "Diolch yn fawr" — Welsh for "thank you
 * very much"). These come with no actual user speech, so we reject them at
 * the transcript layer AND skip the Bernard reply trigger.
 *
 * This is paired with the speech-duration gate (< 500ms = noise) in the
 * caller. Both filters together are belt-and-suspenders against the cold-mic
 * cascade we hit on smoke #3.
 */
const HALLUCINATION_PATTERNS = [
  /^\s*\.+\s*$/,                            // just dots
  /^\s*$/,                                  // empty / whitespace
  /^(thank you|thanks|goodbye|bye|bye-bye)[.!\s]*$/i,
  /^thank you( so| very)? much[.!\s]*$/i,
  /^diolch( yn fawr)?[.!\s]*$/i,            // Welsh "thank you (very much)"
  /^merci( beaucoup)?[.!\s]*$/i,            // French
  /^gracias[.!\s]*$/i,                      // Spanish
  /^danke( schön| schoen)?[.!\s]*$/i,       // German
  /^arigato( gozaimasu)?[.!\s]*$/i,         // Japanese
  /^xie xie[.!\s]*$/i,                      // Mandarin
  /^(uh+|um+|hmm+|mm+|mhm+)[.!\s]*$/i,      // filler-only
]

function isLikelyWhisperHallucination(text) {
  const t = String(text || '').trim()
  if (!t) return true
  return HALLUCINATION_PATTERNS.some((re) => re.test(t))
}

// ────────────────────────────────────────────────────────────────────────────
// Transcript helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Append the user text to the current turn list. If the last turn is also a
 * user turn (consecutive VAD segments before any assistant response), merge
 * into it with a space separator. Reads more naturally than line-per-breath.
 *
 * @param {{role:'user'|'assistant',content:string,partial?:boolean}[]} prev
 * @param {string} text
 */
function appendOrMergeUser(prev, text) {
  const last = prev[prev.length - 1]
  if (last && last.role === 'user' && !last.partial) {
    const next = prev.slice(0, -1)
    next.push({ role: 'user', content: `${last.content} ${text}`.trim() })
    return next
  }
  return [...prev, { role: 'user', content: text }]
}

/**
 * Replace or insert the in-progress user turn (delta accumulation, partial=true).
 * Mirror of upsertPartialAssistant but for the user side. Live deltas from
 * Whisper get accumulated into one partial row that updates word-by-word.
 *
 * @param {{role:'user'|'assistant',content:string,partial?:boolean}[]} prev
 * @param {string} buffered
 */
function upsertPartialUser(prev, buffered) {
  const last = prev[prev.length - 1]
  if (last && last.role === 'user' && last.partial) {
    const next = prev.slice(0, -1)
    next.push({ role: 'user', content: buffered, partial: true })
    return next
  }
  return [...prev, { role: 'user', content: buffered, partial: true }]
}

/**
 * Promote a partial user turn to finalized. If for some reason there was no
 * partial (Whisper didn't emit deltas this turn), fall back to merging /
 * appending against the previous finalized turn — keeps behaviour consistent
 * with the no-deltas path.
 *
 * @param {{role:'user'|'assistant',content:string,partial?:boolean}[]} prev
 * @param {string} finalText
 */
function finalizeUser(prev, finalText) {
  const last = prev[prev.length - 1]
  if (last && last.role === 'user' && last.partial) {
    const next = prev.slice(0, -1)
    next.push({ role: 'user', content: finalText })
    return next
  }
  return appendOrMergeUser(prev, finalText)
}

/**
 * Drop the in-progress partial user turn (used when the .completed event was
 * filtered out as a hallucination — we showed the partial while speech was
 * streaming but now know it shouldn't stay in the transcript).
 *
 * @param {{role:'user'|'assistant',content:string,partial?:boolean}[]} prev
 */
function dropPartialUser(prev) {
  const last = prev[prev.length - 1]
  if (last && last.role === 'user' && last.partial) return prev.slice(0, -1)
  return prev
}

/**
 * Replace or insert the in-progress assistant turn (delta accumulation).
 *
 * @param {{role:'user'|'assistant',content:string,partial?:boolean}[]} prev
 * @param {string} buffered
 */
function upsertPartialAssistant(prev, buffered) {
  // Look for an existing assistant partial anywhere in the list, not just at
  // the end. A user partial can occasionally slip in between assistant deltas
  // (e.g. early interruption barge-in) — without this, the next assistant
  // delta would create a duplicate assistant turn below the user partial.
  // Smoke #6 saw the same Bernard sentence rendered 3-4 times because of
  // this. Updating in place keeps a single assistant turn.
  for (let i = prev.length - 1; i >= 0; i--) {
    if (prev[i].role === 'assistant' && prev[i].partial) {
      const next = prev.slice()
      next[i] = { role: 'assistant', content: buffered, partial: true }
      return next
    }
    // Stop scanning past the most recent finalized assistant turn — anything
    // older belongs to a prior round and shouldn't get updated.
    if (prev[i].role === 'assistant' && !prev[i].partial) break
  }
  return [...prev, { role: 'assistant', content: buffered, partial: true }]
}

/**
 * Promote the in-progress assistant turn to a finalized one. If for some
 * reason no partial exists, just append.
 *
 * @param {{role:'user'|'assistant',content:string,partial?:boolean}[]} prev
 * @param {string} finalText
 */
function finalizeAssistant(prev, finalText) {
  // Same defensive scan as upsertPartialAssistant — promote whichever
  // assistant partial exists, regardless of position.
  for (let i = prev.length - 1; i >= 0; i--) {
    if (prev[i].role === 'assistant' && prev[i].partial) {
      const next = prev.slice()
      next[i] = { role: 'assistant', content: finalText }
      return next
    }
    if (prev[i].role === 'assistant' && !prev[i].partial) break
  }
  return [...prev, { role: 'assistant', content: finalText }]
}

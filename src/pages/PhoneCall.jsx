import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Phone, PhoneOff, Mic, MicOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { apiFetch } from '@/lib/api'

/**
 * PhoneCall — spike page for the OpenAI Realtime API (Phase 5 Feature #1).
 *
 * The goal of this page on Saturday's spike is the smallest thing that proves
 * the WebRTC pipe works: get an ephemeral token from /api/realtime-session,
 * open a WebRTC connection to OpenAI, hear the model talk back, see the live
 * transcript on both sides. No persistence, no completion detection, no
 * Move Better system prompt — that's Sunday.
 *
 * The connection follows OpenAI's documented WebRTC flow:
 *   1. Get an ephemeral client_secret from our own /api/realtime-session.
 *   2. Open an RTCPeerConnection.
 *   3. Add the user's microphone track (getUserMedia).
 *   4. Open a data channel named "oai-events" — server events arrive here.
 *   5. Create an SDP offer, setLocalDescription, POST the SDP to OpenAI's
 *      /v1/realtime/calls endpoint with the ephemeral as a Bearer token.
 *   6. setRemoteDescription with the SDP answer returned by OpenAI.
 *   7. Server audio arrives on a remote track — pipe it into an <audio>
 *      element that's already in the DOM (gesture-primed on Start Call so
 *      iOS Safari doesn't gag — see memory/feedback_ios_audio_element_per_element_unlock.md).
 *
 * Once that round-trips, Sunday's work is purely additive:
 *   - Real system prompt via session.update on data-channel open
 *   - Debounced PATCH of transcript turns to interviews.messages
 *   - INTERVIEW_COMPLETE token detection → existing completion path
 */
export default function PhoneCall() {
  useDocumentTitle('Phone Call (Beta)')

  /** UI status: idle | connecting | connected | ending | error */
  const [status, setStatus] = useState('idle')
  const [errorMsg, setErrorMsg] = useState(null)
  const [muted, setMuted] = useState(false)

  /** Transcript turns rendered in the live view. Sat spike only — no persist. */
  const [turns, setTurns] = useState(/** @type {{role: 'user' | 'assistant', text: string, partial?: boolean}[]} */ ([]))

  // Refs survive React re-renders across the call lifecycle.
  const pcRef        = useRef(/** @type {RTCPeerConnection | null} */ (null))
  const dcRef        = useRef(/** @type {RTCDataChannel | null} */ (null))
  const micStreamRef = useRef(/** @type {MediaStream | null} */ (null))
  const audioElRef   = useRef(/** @type {HTMLAudioElement | null} */ (null))
  // Accumulators for the in-progress assistant turn — Realtime streams the
  // transcript as deltas, so we buffer until we get a .done event.
  const assistantBufRef = useRef('')

  // Tear everything down on unmount in case the user navigates away mid-call.
  useEffect(() => () => hangUp(), [])

  async function startCall() {
    setErrorMsg(null)
    setTurns([])
    assistantBufRef.current = ''
    setStatus('connecting')

    // 1. Mint ephemeral token from our backend.
    let mint
    try {
      mint = /** @type {{ clientSecret: string, expiresAt: number | null, model: string }} */ (
        await apiFetch('/api/realtime-session', { method: 'POST' })
      )
    } catch (e) {
      setErrorMsg(e?.message || 'Could not start the call. Please try again.')
      setStatus('error')
      return
    }

    // 2. Create the peer connection. STUN is enough for browser-to-OpenAI;
    //    no TURN needed since OpenAI accepts standard WebRTC.
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    })
    pcRef.current = pc

    // 3. Remote audio: when OpenAI sends back the assistant's voice, attach
    //    it to the <audio> element. iOS Safari will only play if the element
    //    was created during a user gesture, which it is — startCall runs in
    //    response to a click. We also primed playback with a one-frame silent
    //    play() below so the element's audio context unlocks.
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
      if (s === 'connected') setStatus('connected')
      if (s === 'failed' || s === 'closed' || s === 'disconnected') {
        if (status !== 'ending') setStatus(s === 'failed' ? 'error' : 'idle')
      }
    }

    // 4. Microphone capture. We add the track BEFORE creating the offer so the
    //    SDP advertises the audio sendrecv direction.
    let micStream
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
    } catch (_e) {
      setErrorMsg('Microphone permission denied. Allow mic access in your browser settings and try again.')
      setStatus('error')
      pc.close()
      pcRef.current = null
      return
    }
    micStreamRef.current = micStream
    for (const track of micStream.getTracks()) pc.addTrack(track, micStream)

    // 5. Data channel for server events (transcripts, session events, errors).
    //    Name MUST be "oai-events" — OpenAI's API matches on that exact name.
    const dc = pc.createDataChannel('oai-events')
    dcRef.current = dc
    dc.addEventListener('message', (e) => {
      try {
        const evt = JSON.parse(e.data)
        handleRealtimeEvent(evt)
      } catch {
        // Non-JSON event — ignore.
      }
    })

    // 6. SDP offer/answer. The offer goes to OpenAI's /v1/realtime/calls with
    //    the ephemeral key. The response body IS the SDP answer (plain text,
    //    not JSON).
    let offer
    try {
      offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
    } catch (e) {
      setErrorMsg(`SDP offer failed: ${e?.message || 'unknown'}`)
      setStatus('error')
      hangUp()
      return
    }

    let sdpRes
    try {
      sdpRes = await fetch(
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
    } catch (e) {
      setErrorMsg(`Could not reach OpenAI Realtime: ${e?.message || 'network error'}`)
      setStatus('error')
      hangUp()
      return
    }

    if (!sdpRes.ok) {
      const body = await sdpRes.text().catch(() => '')
      setErrorMsg(`OpenAI Realtime refused the connection (${sdpRes.status}). ${body.slice(0, 200)}`)
      setStatus('error')
      hangUp()
      return
    }

    const answerSdp = await sdpRes.text()
    try {
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp })
    } catch (e) {
      setErrorMsg(`Could not finalize the connection: ${e?.message || 'unknown'}`)
      setStatus('error')
      hangUp()
      return
    }
    // From here, onconnectionstatechange flips us to 'connected' and ontrack
    // attaches the assistant audio. Server events arrive on the data channel.
  }

  /**
   * Handle one event message from the Realtime data channel.
   *
   * Spike scope — render transcripts only. Sunday adds:
   *   - response.audio_transcript.done → push to interviews.messages buffer
   *   - INTERVIEW_COMPLETE detection → trigger completion path
   *   - session.created → send session.update with the real system prompt
   *
   * @param {{ type?: string, [k: string]: unknown }} evt
   */
  function handleRealtimeEvent(evt) {
    if (!evt || typeof evt.type !== 'string') return
    switch (evt.type) {
      // Assistant streaming transcript — append delta to the in-progress turn.
      case 'response.audio_transcript.delta': {
        const delta = String(evt.delta ?? '')
        assistantBufRef.current += delta
        setTurns((prev) => upsertPartialAssistant(prev, assistantBufRef.current))
        break
      }
      case 'response.audio_transcript.done': {
        const final = String(evt.transcript ?? assistantBufRef.current)
        assistantBufRef.current = ''
        setTurns((prev) => finalizeAssistant(prev, final))
        break
      }
      // User-side STT — only fires when input_audio_transcription is enabled
      // in the session config (see api/realtime-session.js).
      case 'conversation.item.input_audio_transcription.completed': {
        const text = String(evt.transcript ?? '').trim()
        if (text) setTurns((prev) => [...prev, { role: 'user', text }])
        break
      }
      case 'error': {
        const message = /** @type {{ error?: { message?: string } }} */ (evt).error?.message
        console.error('[phone-call] realtime error:', message || evt)
        setErrorMsg(message || 'Realtime API error')
        break
      }
      default:
        // session.created, session.updated, response.created, response.done,
        // input_audio_buffer.speech_started/stopped, etc. — log for debugging
        // while the spike is in development; quiet down for production later.
        if (import.meta.env.DEV) console.info('[phone-call] evt', evt.type)
    }
  }

  function toggleMute() {
    const stream = micStreamRef.current
    if (!stream) return
    const next = !muted
    for (const t of stream.getAudioTracks()) t.enabled = !next
    setMuted(next)
  }

  function hangUp() {
    setStatus('ending')
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
    setStatus('idle')
    setMuted(false)
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const inCall = status === 'connecting' || status === 'connected'

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/new">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Phone Call <span className="ml-2 text-xs font-normal text-muted-foreground align-middle border rounded px-1.5 py-0.5">Beta</span>
          </h1>
          <p className="text-sm text-muted-foreground">
            Continuous voice conversation. No press-to-talk — just talk.
          </p>
        </div>
      </div>

      {/* The audio element lives in the DOM from the very first render so iOS
          Safari sees it inside the click handler that triggers startCall.
          Without that, the play() in pc.ontrack silently no-ops on iOS. */}
      <audio ref={audioElRef} autoPlay />

      <Card>
        <CardContent className="p-6 space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">
                {status === 'idle'       && 'Ready to call'}
                {status === 'connecting' && 'Connecting…'}
                {status === 'connected'  && 'In call'}
                {status === 'ending'     && 'Ending call…'}
                {status === 'error'      && 'Couldn’t connect'}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {status === 'idle' && 'Tap Start to begin. Allow microphone access when prompted.'}
                {status === 'connected' && (muted ? 'You are muted.' : 'Listening — go ahead and talk.')}
                {status === 'error' && errorMsg}
              </div>
            </div>
            <span
              aria-hidden="true"
              className={
                status === 'connected' ? 'h-2.5 w-2.5 rounded-full bg-emerald-500' :
                status === 'connecting' ? 'h-2.5 w-2.5 rounded-full bg-amber-500 animate-pulse' :
                status === 'error' ? 'h-2.5 w-2.5 rounded-full bg-rose-500' :
                'h-2.5 w-2.5 rounded-full bg-muted-foreground/30'
              }
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {!inCall && (
              <Button onClick={startCall} disabled={status === 'connecting'}>
                <Phone className="h-4 w-4 mr-2" />
                Start call
              </Button>
            )}
            {inCall && (
              <>
                <Button onClick={hangUp} variant="destructive">
                  <PhoneOff className="h-4 w-4 mr-2" />
                  End call
                </Button>
                <Button onClick={toggleMute} variant="outline">
                  {muted ? <Mic className="h-4 w-4 mr-2" /> : <MicOff className="h-4 w-4 mr-2" />}
                  {muted ? 'Unmute' : 'Mute'}
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {turns.length > 0 && (
        <Card>
          <CardContent className="p-6 space-y-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Live transcript</div>
            <div className="space-y-3 max-h-[420px] overflow-y-auto">
              {turns.map((t, i) => (
                <div key={i} className="text-sm">
                  <span className="font-medium mr-2">{t.role === 'user' ? 'You' : 'Bernard'}:</span>
                  <span className={t.partial ? 'text-muted-foreground' : ''}>{t.text}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Sat spike disclaimer — Sunday replaces this card with the real
          interview UI (topic, voice mode, completion / blog generation). */}
      <p className="text-xs text-muted-foreground">
        Beta — Saturday spike. Transcripts and persistence land Sunday.
      </p>
    </div>
  )
}

// ── Transcript helpers ──────────────────────────────────────────────────────
// The Realtime API streams assistant text as deltas. We keep one "partial"
// row tagged at the end of the array so the UI updates word-by-word; on .done
// we promote it to a finalized row.

/** @typedef {{ role: 'user' | 'assistant', text: string, partial?: boolean }} Turn */

/**
 * @param {Turn[]} prev
 * @param {string} buffered
 * @returns {Turn[]}
 */
function upsertPartialAssistant(prev, buffered) {
  const last = prev[prev.length - 1]
  if (last && last.role === 'assistant' && last.partial) {
    const next = prev.slice(0, -1)
    next.push({ role: 'assistant', text: buffered, partial: true })
    return next
  }
  return [...prev, { role: 'assistant', text: buffered, partial: true }]
}

/**
 * @param {Turn[]} prev
 * @param {string} final
 * @returns {Turn[]}
 */
function finalizeAssistant(prev, final) {
  const last = prev[prev.length - 1]
  if (last && last.role === 'assistant' && last.partial) {
    const next = prev.slice(0, -1)
    next.push({ role: 'assistant', text: final })
    return next
  }
  return [...prev, { role: 'assistant', text: final }]
}

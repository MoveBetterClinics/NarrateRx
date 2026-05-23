import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useUser } from '@clerk/clerk-react'
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
  getOrCreateClinician,
  updateInterview,
  fetchSimilarInterviews,
  fetchClinician,
} from '@/lib/api'
import { getInterviewSystemPrompt } from '@/lib/prompts'

const COMPLETE_TOKEN = 'INTERVIEW_COMPLETE'

/**
 * PhoneCall — real-time duplex voice interview (Phase 5 Feature #1).
 *
 * Two states: a topic-picker "setup" form, then the live call surface. On
 * Start we create an interview row, fetch the same prompt-context InterviewSession
 * uses (past interviews, concepts/agreement/gap blocks, prior session), build the
 * full system prompt client-side, mint an OpenAI ephemeral token, open WebRTC,
 * and push the prompt over the data channel via session.update. Transcript turns
 * persist to interviews.messages (debounced). When the assistant emits
 * [INTERVIEW_COMPLETE], we finalize and hand off to /interview/:clinicianId/:interviewId
 * which already knows how to auto-generate the blog post on load.
 *
 * Why we keep the prompt-build on the client: getInterviewSystemPrompt lives
 * in src/lib/prompts.js and is the single source of truth for interview prompts.
 * Replicating it server-side would double the surface area for drift. The server
 * only needs the bootstrap "wait for instructions" stub during the mint.
 */
export default function PhoneCall() {
  useDocumentTitle('Phone Call (Beta)')

  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user } = useUser()
  const workspace = useWorkspace()

  /** UI phase: setup | starting | in_call | completing | error */
  const [phase, setPhase] = useState('setup')
  const [errorMsg, setErrorMsg] = useState(null)
  const [connState, setConnState] = useState('idle') // idle | connecting | connected | ending
  const [paused, setPaused] = useState(false)

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
  const clinicianIdRef = useRef(null)
  const persistTimerRef = useRef(null)
  const turnsRef       = useRef(/** @type {{role:'user'|'assistant',content:string,partial?:boolean}[]} */ ([]))
  const completedRef   = useRef(false)
  const assistantBufRef = useRef('')

  // Keep turnsRef in sync — the persist debounce reads from the ref so it
  // doesn't capture stale state when the event handler closures over it.
  useEffect(() => { turnsRef.current = turns }, [turns])

  // Tear down on unmount in case the user navigates away mid-call.
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
      const clinician = await getOrCreateClinician({
        name: displayName,
        createdById: user.id,
        createdByEmail: user.primaryEmailAddress?.emailAddress,
        userId: user.id,
      })
      clinicianIdRef.current = clinician.id

      // 2. Create the interview row. capture_mode='realtime_voice' marks it
      //    so analytics can split realtime vs. chat. Defaults match what
      //    NewInterview ships for a tone='smart' / voice_mode='practice'
      //    interview — the user can refine after completion if they want.
      const interview = await createInterview({
        clinicianId: clinician.id,
        topic: topic.trim(),
        ownerEmail: user.primaryEmailAddress?.emailAddress,
        tone: 'smart',
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
      const ctxClinicianParam = `&clinician_id=${encodeURIComponent(clinician.id)}`
      const [pastInterviews, conceptCtx, clinicianRow] = await Promise.all([
        fetchSimilarInterviews(topic.trim(), interview.id).catch(() => []),
        apiFetch(
          `/api/concepts/context?topic=${encodeURIComponent(topic.trim())}${ctxClinicianParam}`,
        ).catch(() => ({})),
        fetchClinician(clinician.id).catch(() => null),
      ])

      // Build the prior-session reference exactly the way InterviewSession does.
      let priorSessionContext = null
      const priorInterviews = (clinicianRow?.interviews || [])
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

      const fullPrompt = getInterviewSystemPrompt(
        workspace,
        clinician.name,
        topic.trim(),
        pastInterviews || [],
        null, // prototypeId — none for realtime spike
        {
          tone: 'smart',
          isFirstMessage: true,
          priorSessionContext,
          conceptBlock:   conceptCtx?.block || '',
          agreementBlock: conceptCtx?.agreementBlock || '',
          gapBlock:       conceptCtx?.gapBlock || '',
        },
      )

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
   */
  async function openRealtimeConnection(mint, systemPrompt) {
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
      if (s === 'connected') setConnState('connected')
      if (s === 'failed' || s === 'closed' || s === 'disconnected') {
        setConnState((prev) => (prev === 'ending' ? prev : (s === 'failed' ? 'idle' : 'idle')))
      }
    }

    // Mic capture before SDP so the offer advertises sendrecv.
    const micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
    micStreamRef.current = micStream
    for (const track of micStream.getTracks()) pc.addTrack(track, micStream)

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
      // Trigger the first assistant turn now that instructions are in.
      // Without this prod the model waits for user audio — which is fine, but
      // the system prompt's "open with one warm sentence" instruction expects
      // an assistant-first turn. response.create kicks that off.
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

    // ── User-side STT (Whisper, server-side) ──────────────────────────────
    if (evt.type === 'conversation.item.input_audio_transcription.completed') {
      const text = String(evt.transcript ?? '').trim()
      if (!text) return
      setTurns((prev) => {
        const next = appendOrMergeUser(prev, text)
        turnsRef.current = next
        return next
      })
      schedulePersist()
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
    // Hand off to InterviewSession — its auto-gen effect detects the
    // COMPLETE_TOKEN on load and kicks off blog generation.
    navigate(`/interview/${clinicianIdRef.current}/${interviewIdRef.current}?from=realtime`)
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

  function hangUp() {
    setConnState('ending')
    clearTimeout(persistTimerRef.current)
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
    setConnState('idle')
    setPaused(false)
  }

  function endCall() {
    // User clicked End — same flush+navigate path as auto-complete, but
    // without requiring the INTERVIEW_COMPLETE token. The interview row
    // stays status='in_progress' so the user can continue in chat mode
    // from /interview/:cid/:iid if they cut short.
    if (completedRef.current) return
    setPhase('completing')
    clearTimeout(persistTimerRef.current)
    const snapshot = turnsRef.current
      .filter((t) => !t.partial && t.content?.trim())
      .map((t) => ({ role: t.role, content: t.content }))
    const persistP = snapshot.length
      ? updateInterview(interviewIdRef.current, { messages: snapshot }).catch(() => {})
      : Promise.resolve()
    persistP.finally(() => {
      hangUp()
      if (interviewIdRef.current && clinicianIdRef.current) {
        navigate(`/interview/${clinicianIdRef.current}/${interviewIdRef.current}?from=realtime`)
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
                {phase === 'in_call' && connState === 'connected' && (paused ? 'Paused' : 'In call')}
                {phase === 'in_call' && connState === 'idle' && 'Ended'}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {phase === 'in_call' && connState === 'connected' && !paused &&
                  'Listening — go ahead and talk. Say "I think that covers it" to wrap up.'}
                {phase === 'in_call' && paused &&
                  'Your mic is paused. Bernard can’t hear you. Tap Resume to keep going.'}
                {phase === 'completing' && 'Saving the conversation and generating your blog post.'}
              </div>
            </div>
            <span
              aria-hidden="true"
              className={
                connState === 'connected' ? 'h-2.5 w-2.5 rounded-full bg-emerald-500' :
                connState === 'connecting' ? 'h-2.5 w-2.5 rounded-full bg-amber-500 animate-pulse' :
                'h-2.5 w-2.5 rounded-full bg-muted-foreground/30'
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
            <div className="space-y-3 max-h-[520px] overflow-y-auto">
              {turns.map((t, i) => (
                <div key={i} className="text-sm leading-relaxed">
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
          Phone Call{' '}
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
 * Replace or insert the in-progress assistant turn (delta accumulation).
 *
 * @param {{role:'user'|'assistant',content:string,partial?:boolean}[]} prev
 * @param {string} buffered
 */
function upsertPartialAssistant(prev, buffered) {
  const last = prev[prev.length - 1]
  if (last && last.role === 'assistant' && last.partial) {
    const next = prev.slice(0, -1)
    next.push({ role: 'assistant', content: buffered, partial: true })
    return next
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
  const last = prev[prev.length - 1]
  if (last && last.role === 'assistant' && last.partial) {
    const next = prev.slice(0, -1)
    next.push({ role: 'assistant', content: finalText })
    return next
  }
  return [...prev, { role: 'assistant', content: finalText }]
}

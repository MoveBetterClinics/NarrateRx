// One-time onboarding interview the founder runs after the signup wizard
// creates the workspace. P2 deliverable: text-only chat using the
// getOnboardingInterviewSystemPrompt prompt. P2b adds the full voice loop
// (mic + TTS + iOS gesture priming) so the page is the proof-of-concept
// for how NarrateRx actually works.
//
// Founder-only — gated by the API route's requireRole(['admin']) check.
// Workspace-scoped via workspaceContext on the server.

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useUser } from '@clerk/clerk-react'
import {
  Loader2, Send, CheckCircle2, AlertCircle, Sparkles, FlaskConical,
  Mic, MicOff, Volume2, RefreshCw, Keyboard,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { useUserRole } from '@/lib/useUserRole'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { apiFetch } from '@/lib/api'
import { streamMessage } from '@/lib/claude'
import { getOnboardingInterviewSystemPrompt } from '@/lib/prompts'
import MicCheck from '@/components/MicCheck'
import { createTtsPlayer, primeAudioPlayback, onAudioPlaybackFailure } from '@/lib/tts'

const COMPLETE_TOKEN = 'INTERVIEW_COMPLETE'

// Cap consecutive silent SpeechRecognition auto-resumes within a single user
// turn. Without a cap, a stuck mic can spin forever (especially on iOS).
// Matches the value used in InterviewSession.
const RESTART_CAP = 30

// End-of-turn phrases — matched at the end of a final transcript so the user
// can say "done" / "that's all" instead of tapping the mic. Lifted from
// InterviewSession; the same vocabulary works for any voice interview.
const STOP_PHRASES = [
  "that's all",
  "that's it",
  "i'm done",
  "i am done",
  "send it",
  "send that",
  "submit",
  "done",
]

function detectAndStripStopPhrase(transcript) {
  const normalized = transcript.trimEnd().toLowerCase()
  for (const phrase of STOP_PHRASES) {
    if (normalized.endsWith(phrase)) {
      const stripped = transcript.trimEnd()
      const cleaned = stripped.slice(0, stripped.length - phrase.length).trimEnd()
      return cleaned.length > 0 ? cleaned : ''
    }
  }
  return null
}

// Detect and strip the completion marker from a streaming assistant message.
function detectComplete(raw) {
  if (!raw.includes(COMPLETE_TOKEN)) return { text: raw, complete: false }
  const cleaned = raw.replace(new RegExp(`\\s*${COMPLETE_TOKEN}\\s*`, 'g'), '').trim()
  return { text: cleaned, complete: true }
}

export default function OnboardingInterview() {
  useDocumentTitle('Onboarding interview')
  const navigate = useNavigate()
  const workspace = useWorkspace()
  const { user } = useUser()
  const { role } = useUserRole()

  // ── Existing interview state ─────────────────────────────────────────────
  const [interview, setInterview] = useState(null)
  const [messages, setMessages] = useState([])
  const [streaming, setStreaming] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [completed, setCompleted] = useState(false)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [synthesisStatus, setSynthesisStatus] = useState('idle')
  const [synthesisError, setSynthesisError] = useState(null)
  const [synthesisCounts, setSynthesisCounts] = useState(null)
  const [synthesisResult, setSynthesisResult] = useState(null)

  // ── Voice state (new in P2b) ─────────────────────────────────────────────
  // SpeechRecognition feature detection. iOS Safari → false, falls back to
  // typed-answer textarea automatically.
  const hasSpeechRecognition = useMemo(() => (
    typeof window !== 'undefined' &&
    !!(window.SpeechRecognition || window.webkitSpeechRecognition)
  ), [])

  // micCheckPassed gates the chat UI behind the pre-interview audio test
  // (mic permission + TTS speaker check). Only required on a fresh interview;
  // resumed interviews skip it (the user already passed it once).
  const [micCheckPassed, setMicCheckPassed] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [typedAnswer, setTypedAnswer] = useState('')
  const [audioInterrupted, setAudioInterrupted] = useState(false)

  // Voice refs — all the SpeechRecognition machinery for keeping the mic
  // open through thinking pauses. See InterviewSession startListening for
  // the canonical comments.
  const ttsRef = useRef(null)
  const recognitionRef = useRef(null)
  const userAnswerActiveRef = useRef(false)
  const restartCountRef = useRef(0)
  const restartTimerRef = useRef(null)
  const finalTranscriptRef = useRef('')
  const transcriptRef = useRef('')
  const autoListenAbortRetryRef = useRef(0)
  const autoListenRef = useRef(false)
  const messagesRef = useRef([])

  // Bootstrap seed-once guard. Distinct from the kickoff guard below: this
  // is for the GET-or-POST interview row, which must only fire once even on
  // tab refocus / refetch.
  const seededRef = useRef(false)
  // Kickoff guard — prevents the first-message effect from retrying on error.
  const kickedOffRef = useRef(false)
  const scrollRef = useRef(null)
  const founderName = (user?.fullName || user?.firstName || '').trim() || 'there'

  // Dry-run mode — append ?dryRun=1 to the URL. Synthesis runs end-to-end
  // but no writes happen. Used during P5 prompt tuning.
  const [searchParams] = useSearchParams()
  const dryRun = useMemo(() => {
    const v = searchParams.get('dryRun')
    return v === '1' || v === 'true'
  }, [searchParams])

  // Keep messagesRef in sync — handleRestoreAudio reads it inside a non-
  // React callback to find the last assistant message.
  useEffect(() => { messagesRef.current = messages }, [messages])

  // Lazy-create the TTS player. Reusing one instance means iOS gesture
  // priming sticks across all utterances (per the shared-audio-element
  // memory). Don't ever new Audio() per utterance.
  const getTts = useCallback(() => {
    if (!ttsRef.current) ttsRef.current = createTtsPlayer()
    return ttsRef.current
  }, [])

  // ── Bootstrap — fetch existing or create new interview row ───────────────
  useEffect(() => {
    if (!workspace?.id || !user?.id || seededRef.current) return

    let cancelled = false
    ;(async () => {
      try {
        let row = await apiFetch('/api/onboarding/interview')
        if (!row) {
          row = await apiFetch('/api/onboarding/interview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ founderName }),
          })
        }
        if (cancelled) return
        seededRef.current = true
        setInterview(row)
        setMessages(Array.isArray(row?.messages) ? row.messages : [])
        if (row?.status === 'completed' || row?.status === 'synthesized') {
          setCompleted(true)
          // Resumed/completed interviews skip MicCheck — they've already
          // gone through the chat once.
          setMicCheckPassed(true)
        }
        if (row?.status === 'synthesized' && !dryRun) {
          setSynthesisStatus('already')
        }
        // Resumed in-progress interviews also skip MicCheck — the user
        // passed it on their first session and we want to drop them back
        // into the conversation without a re-test.
        if (Array.isArray(row?.messages) && row.messages.length > 0) {
          setMicCheckPassed(true)
        }
      } catch (e) {
        if (!cancelled) setError(e?.message || 'Failed to start interview')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [workspace?.id, user?.id, founderName, dryRun])

  // Auto-scroll to the latest message.
  useEffect(() => {
    if (!scrollRef.current) return
    scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, streamingText])

  // ── Persist messages + status to the server ──────────────────────────────
  const interviewId = interview?.id
  const persist = useCallback(async (next, statusUpdate) => {
    if (!interviewId) return
    try {
      const patch = { messages: next }
      if (statusUpdate) {
        patch.status = statusUpdate
        if (statusUpdate === 'completed') patch.completedAt = new Date().toISOString()
      }
      await apiFetch(`/api/onboarding/interview?id=${encodeURIComponent(interviewId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
    } catch (e) {
      console.error('[OnboardingInterview] persist failed', e)
    }
  }, [interviewId])

  // ── Audio failure subscription ───────────────────────────────────────────
  // Fires on iOS route change, BT disconnect, audio session interruption.
  // We surface a "Restore audio" button instead of letting the interview
  // silently fail to play.
  useEffect(() => {
    const unsubscribe = onAudioPlaybackFailure(() => setAudioInterrupted(true))
    return unsubscribe
  }, [])

  // ── TTS: speak the assistant turn ────────────────────────────────────────
  const speak = useCallback((text) => {
    if (!text) return
    setIsSpeaking(true)
    getTts().speak(text, {
      onStart: () => setIsSpeaking(true),
      onEnd: () => {
        setIsSpeaking(false)
        // Flag to the auto-listen effect that the next render should fire
        // startListening. Effect-based dispatch avoids racing the React
        // state batcher between setIsSpeaking and the effect re-eval.
        autoListenRef.current = true
      },
      onError: () => setIsSpeaking(false),
    })
  }, [getTts])

  // Re-prime + replay the last assistant message after an audio interruption.
  // Must run inside a user gesture (the click on the restore button).
  const handleRestoreAudio = useCallback(() => {
    primeAudioPlayback()
    setAudioInterrupted(false)
    const lastAssistant = [...messagesRef.current].reverse().find((m) => m.role === 'assistant')
    if (lastAssistant && !completed) {
      speak(lastAssistant.content)
    }
  }, [completed, speak])

  // ── Stream the next assistant turn ───────────────────────────────────────
  const runAssistantTurn = useCallback(async (currentMessages, { isFirstMessage }) => {
    if (!workspace) return
    setStreaming(true)
    setStreamingText('')
    setError(null)

    const systemPrompt = getOnboardingInterviewSystemPrompt(workspace, founderName, { isFirstMessage })

    // Claude API / Vercel AI Gateway require >=1 message — system-only
    // requests return AI_InvalidPromptError. Silent starter pattern.
    const streamInput = currentMessages.length === 0
      ? [{ role: 'user', content: 'Please begin the onboarding interview.' }]
      : currentMessages

    let buffer = ''
    try {
      for await (const delta of streamMessage(streamInput, systemPrompt, { model: 'claude-sonnet-4-6', maxOutputTokens: 1024 })) {
        buffer += delta
        const { text } = detectComplete(buffer)
        setStreamingText(text)
      }
    } catch (e) {
      setStreaming(false)
      setError(e?.message || 'Stream failed')
      return
    }

    const { text, complete: hasCompleteMarker } = detectComplete(buffer)
    const finalText = text.trim()
    if (!finalText) {
      setStreaming(false)
      setStreamingText('')
      setError('Empty response from interviewer — try again.')
      return
    }

    const nextMessages = [...currentMessages, { role: 'assistant', content: finalText }]
    setMessages(nextMessages)
    setStreamingText('')
    setStreaming(false)

    if (hasCompleteMarker) {
      setCompleted(true)
      await persist(nextMessages, 'completed')
    } else {
      await persist(nextMessages)
      // Speak the assistant's message after persistence so the audio doesn't
      // start before the message is durable.
      speak(finalText)
    }
  }, [workspace, founderName, persist, speak])

  // ── Kickoff once mic check has passed + interview row loaded ─────────────
  useEffect(() => {
    if (loading || completed || streaming || !interview || !micCheckPassed) return
    if (messages.length > 0) return
    if (kickedOffRef.current) return
    kickedOffRef.current = true
    runAssistantTurn([], { isFirstMessage: true })
  }, [loading, completed, streaming, interview, micCheckPassed, messages.length, runAssistantTurn])

  // ── SpeechRecognition: start / stop ──────────────────────────────────────
  // Plain function (not useCallback) — startListening is recursive via
  // maybeAutoResume, and React Compiler's manual-memoization lint can't
  // verify that. Same pattern as InterviewSession.jsx.
  function startListening({ preserveTranscript = false } = {}) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) return  // iOS Safari → typed-answer fallback handles input
    if (isListening) return

    ttsRef.current?.cancel()
    window.speechSynthesis?.cancel()
    setIsSpeaking(false)

    if (!preserveTranscript) {
      setTranscript('')
      transcriptRef.current = ''
      finalTranscriptRef.current = ''
      restartCountRef.current = 0
      userAnswerActiveRef.current = true
    }

    const recognition = new SR()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'

    recognition.onresult = (event) => {
      let gotFinal = false
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalTranscriptRef.current += event.results[i][0].transcript + ' '
          gotFinal = true
        }
      }
      const interim = event.results[event.results.length - 1].isFinal
        ? ''
        : event.results[event.results.length - 1][0].transcript
      const display = (finalTranscriptRef.current + interim).trim()
      setTranscript(display)
      transcriptRef.current = finalTranscriptRef.current.trim()

      if (gotFinal) {
        const cleaned = detectAndStripStopPhrase(finalTranscriptRef.current)
        if (cleaned !== null) {
          userAnswerActiveRef.current = false
          clearTimeout(restartTimerRef.current)
          finalTranscriptRef.current = cleaned
          transcriptRef.current = cleaned.trim()
          setTranscript(cleaned.trim())
          recognitionRef.current?.stop()
        }
      }
    }

    // Schedule a silent restart so the user can keep their turn through a
    // thinking pause. Returns true if scheduled, false if we've hit the
    // cap or the user is no longer mid-answer.
    function maybeAutoResume(delayMs) {
      if (!userAnswerActiveRef.current) return false
      if (completed || streaming) return false
      if (restartCountRef.current >= RESTART_CAP) {
        userAnswerActiveRef.current = false
        return false
      }
      restartCountRef.current += 1
      clearTimeout(restartTimerRef.current)
      restartTimerRef.current = setTimeout(() => {
        if (userAnswerActiveRef.current && !completed) {
          startListening({ preserveTranscript: true })
        }
      }, delayMs)
      return true
    }

    recognition.onend = () => {
      if (maybeAutoResume(200)) return
      setIsListening(false)
    }

    recognition.onerror = (e) => {
      if (e.error === 'no-speech') {
        if (maybeAutoResume(200)) return
        setIsListening(false)
        return
      }
      // iOS Chrome 'aborted' usually means TTS still holds the audio session.
      // Retry once with a longer delay.
      if (e.error === 'aborted') {
        setIsListening(false)
        if (autoListenAbortRetryRef.current < 1 && !completed && !streaming && !isSpeaking) {
          autoListenAbortRetryRef.current += 1
          setTimeout(() => {
            if (!completed && !isListening) startListening()
          }, 1500)
        }
        return
      }
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        userAnswerActiveRef.current = false
        setIsListening(false)
        setError('Microphone permission was denied. You can type your answer instead.')
        return
      }
      userAnswerActiveRef.current = false
      setIsListening(false)
      setError(`Microphone trouble (${e.error}). Tap mic to retry or type your answer instead.`)
    }

    recognitionRef.current = recognition
    try {
      recognition.start()
      setIsListening(true)
      autoListenAbortRetryRef.current = 0
    } catch {
      setIsListening(false)
    }
  }

  function stopListening() {
    userAnswerActiveRef.current = false
    clearTimeout(restartTimerRef.current)
    recognitionRef.current?.stop()
  }

  // ── submitUserText — shared path for voice (auto on listen-end) + typed ──
  const submitUserText = useCallback(async (rawText) => {
    const text = (rawText || '').trim()
    if (!text || streaming || completed) return

    setTranscript('')
    transcriptRef.current = ''
    setTypedAnswer('')

    const next = [...messages, { role: 'user', content: text }]
    setMessages(next)
    await runAssistantTurn(next, { isFirstMessage: false })
  }, [streaming, completed, messages, runAssistantTurn])

  // Auto-listen after TTS playback ends — 700ms gives iOS time to release
  // the audio session before the mic engine tries to claim it.
  useEffect(() => {
    if (!hasSpeechRecognition) return
    if (!isSpeaking && autoListenRef.current && !streaming && !completed) {
      autoListenRef.current = false
      const timer = setTimeout(() => startListening(), 700)
      return () => clearTimeout(timer)
    }
    // startListening is a stable scope-level function; listing it would
    // re-fire the effect needlessly on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSpeechRecognition, isSpeaking, streaming, completed])

  // Auto-submit when isListening flips false with captured text.
  useEffect(() => {
    if (isListening) return
    if (!transcriptRef.current.trim()) return
    submitUserText(transcriptRef.current)
    // submitUserText is a stable scope-level helper (useCallback with a
    // stable transitive dep chain). Listing it would churn this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isListening])

  // ── Synthesis ────────────────────────────────────────────────────────────
  const runSynthesis = useCallback(async () => {
    if (!interviewId) return
    setSynthesisStatus('running')
    setSynthesisError(null)
    setSynthesisResult(null)
    try {
      const result = await apiFetch('/api/onboarding/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: interviewId, founderName, dryRun }),
      })
      setSynthesisCounts(result?.counts || null)
      if (dryRun && result?.synthesisResult) {
        setSynthesisResult(result.synthesisResult)
      }
      setSynthesisStatus('success')
    } catch (e) {
      console.error('[OnboardingInterview] synthesis failed', e)
      setSynthesisError(e?.message || 'Synthesis failed')
      setSynthesisStatus('error')
    }
  }, [interviewId, founderName, dryRun])

  useEffect(() => {
    if (!completed || !interviewId) return
    if (synthesisStatus !== 'idle') return
    runSynthesis()
  }, [completed, interviewId, synthesisStatus, runSynthesis])

  // Stop any in-flight TTS / mic on unmount.
  useEffect(() => () => {
    ttsRef.current?.cancel()
    window.speechSynthesis?.cancel()
    userAnswerActiveRef.current = false
    clearTimeout(restartTimerRef.current)
    try { recognitionRef.current?.stop() } catch { /* ignore */ }
  }, [])

  // ── Render guards ────────────────────────────────────────────────────────

  if (role && role !== 'admin') {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12">
        <Card>
          <CardContent className="pt-6 text-center space-y-2">
            <AlertCircle className="h-8 w-8 mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              The onboarding interview is only available to workspace admins.
            </p>
            <Button variant="outline" onClick={() => navigate('/')}>Back to Home</Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error && messages.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12">
        <Card>
          <CardContent className="pt-6 text-center space-y-3">
            <AlertCircle className="h-8 w-8 mx-auto text-destructive" />
            <p className="text-sm">{error}</p>
            <Button onClick={() => window.location.reload()}>Try again</Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  // MicCheck gate — pre-interview audio test. Only required for a fresh
  // interview (no messages yet, not completed). Resumed sessions skip it.
  if (!micCheckPassed) {
    return <MicCheck onContinue={() => setMicCheckPassed(true)} />
  }

  // ── Main UI ──────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 flex flex-col" style={{ minHeight: 'calc(100vh - 4rem)' }}>
      {dryRun && (
        <div className="mb-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 flex items-center gap-2 text-sm">
          <FlaskConical className="h-4 w-4 text-warning shrink-0" />
          <span>
            <span className="font-semibold">Dry-run mode.</span>{' '}
            Synthesis will run end-to-end and show you the JSON output, but{' '}
            <span className="font-medium">nothing will be written</span> to your
            workspace, voice phrases, or interview status. Remove
            {' '}<code className="font-mono text-xs">?dryRun=1</code>{' '}from the URL to run for real.
          </span>
        </div>
      )}
      <Card className="mb-4">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" />
            Tell NarrateRx about {workspace?.display_name || 'your practice'}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            About 15 minutes. Once we have your voice, every piece NarrateRx generates from here on will sound like you — not a template.
          </p>
        </CardHeader>
      </Card>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto space-y-4 pb-4 px-1"
        style={{ minHeight: '300px' }}
      >
        {messages.map((m, i) => (
          <MessageBubble key={i} role={m.role} content={m.content} />
        ))}
        {streaming && streamingText && (
          <MessageBubble role="assistant" content={streamingText} streaming />
        )}
        {streaming && !streamingText && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground pl-1">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>{workspace?.interviewer_name || 'Bernard'} is thinking…</span>
          </div>
        )}
      </div>

      {completed ? (
        <SynthesisStateCard
          status={synthesisStatus}
          error={synthesisError}
          counts={synthesisCounts}
          result={synthesisResult}
          dryRun={dryRun}
          onRetry={runSynthesis}
          onHome={() => navigate('/')}
        />
      ) : (
        <>
          {/* Audio-interrupted recovery banner — iOS BT/CarPlay routing changes
              fire this; the click is the user gesture we need to re-prime. */}
          {audioInterrupted && (
            <button
              type="button"
              onClick={handleRestoreAudio}
              className="mb-3 w-full rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-left hover:bg-amber-100 active:bg-amber-100 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
            >
              <div className="flex items-center gap-3">
                <Volume2 className="h-5 w-5 text-amber-700 shrink-0" aria-hidden="true" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-amber-900">Audio interrupted</p>
                  <p className="text-xs text-amber-800">
                    Tap to restore audio and replay the last question. Often happens when headphones or CarPlay change connection.
                  </p>
                </div>
                <RefreshCw className="h-4 w-4 text-amber-700 shrink-0" aria-hidden="true" />
              </div>
            </button>
          )}

          {error && (
            <p className="text-sm text-destructive flex items-center gap-2 mb-2">
              <AlertCircle className="h-4 w-4" /> {error}
            </p>
          )}

          {/* Bottom dock — mic for SpeechRecognition browsers, textarea for
              iOS Safari et al. Same visual surface either way. */}
          {hasSpeechRecognition ? (
            <div className="border-t pt-4 flex flex-col items-center gap-3">
              {transcript && (
                <div
                  aria-live="polite"
                  aria-label="Transcript"
                  className="w-full rounded-xl bg-muted px-4 py-3 text-sm text-foreground/80 italic min-h-[44px]"
                >
                  &quot;{transcript}&quot;
                </div>
              )}
              <p
                role="status"
                aria-live="polite"
                className="text-xs text-muted-foreground h-4"
              >
                {streaming ? '' : isSpeaking ? (
                  <span className="flex items-center gap-1.5">
                    <Volume2 className="h-3 w-3 animate-pulse" aria-hidden="true" /> Speaking…
                  </span>
                ) : isListening ? (
                  <span className="flex items-center gap-1.5 text-red-500">
                    <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" aria-hidden="true" /> Listening — take your time. Say &quot;done&quot; or tap mic to send.
                  </span>
                ) : 'Tap to speak'}
              </p>
              <button
                onClick={isListening ? stopListening : () => startListening()}
                disabled={streaming || isSpeaking}
                aria-label={isListening ? 'Stop recording' : 'Start recording'}
                aria-pressed={isListening}
                className={`h-16 w-16 rounded-full flex items-center justify-center transition-all shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary
                  ${isListening
                    ? 'bg-red-500 text-white scale-110'
                    : 'bg-primary text-primary-foreground hover:opacity-90 active:scale-95'
                  } disabled:opacity-30 disabled:cursor-not-allowed disabled:scale-100`}
              >
                {isListening
                  ? <MicOff className="h-6 w-6" aria-hidden="true" />
                  : <Mic className="h-6 w-6" aria-hidden="true" />
                }
              </button>
            </div>
          ) : (
            <div className="border-t pt-4 flex flex-col gap-2">
              <p
                role="status"
                aria-live="polite"
                className="text-xs text-muted-foreground h-4 flex items-center gap-1.5"
              >
                {streaming ? '' : isSpeaking ? (
                  <><Volume2 className="h-3 w-3 animate-pulse" aria-hidden="true" /> Speaking…</>
                ) : (
                  <><Keyboard className="h-3 w-3" aria-hidden="true" /> Type your answer — voice input isn&rsquo;t supported in this browser</>
                )}
              </p>
              <div className="flex items-end gap-2">
                <Textarea
                  value={typedAnswer}
                  onChange={(e) => setTypedAnswer(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault()
                      if (!streaming && !isSpeaking && typedAnswer.trim()) {
                        submitUserText(typedAnswer)
                      }
                    }
                  }}
                  placeholder="Type your answer… (⌘/Ctrl + Enter to send)"
                  rows={3}
                  disabled={streaming || isSpeaking}
                  className="resize-none"
                />
                <Button
                  onClick={() => submitUserText(typedAnswer)}
                  disabled={streaming || isSpeaking || !typedAnswer.trim()}
                  size="icon"
                  className="h-10 w-10 shrink-0"
                  aria-label="Send"
                >
                  {streaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function MessageBubble({ role, content, streaming = false }) {
  const isUser = role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-foreground'
        }`}
      >
        {content}
        {streaming && <span className="inline-block w-1.5 h-4 ml-0.5 align-middle bg-current opacity-50 animate-pulse" />}
      </div>
    </div>
  )
}

function SynthesisStateCard({ status, error, counts, result, dryRun, onRetry, onHome }) {
  if (status === 'running') {
    return (
      <Card className="border-primary/40 bg-primary/5">
        <CardContent className="pt-6 text-center space-y-3">
          <Loader2 className="h-8 w-8 mx-auto animate-spin text-primary" />
          <div className="space-y-1">
            <p className="font-medium">
              {dryRun ? 'Running dry-run synthesis…' : 'Interview complete — synthesizing your voice…'}
            </p>
            <p className="text-sm text-muted-foreground">
              {dryRun
                ? 'About a minute. The model is producing the synthesis JSON; nothing will be written.'
                : 'About a minute. We’re reading your transcript and writing your workspace’s voice guidance, patient archetype, topic queue, and phrase bank. Hang tight.'}
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (status === 'error') {
    return (
      <Card className="border-destructive/40 bg-destructive/5">
        <CardContent className="pt-6 text-center space-y-3">
          <AlertCircle className="h-8 w-8 mx-auto text-destructive" />
          <div className="space-y-1">
            <p className="font-medium">Synthesis failed.</p>
            <p className="text-sm text-muted-foreground">
              Your transcript is safe — we just couldn&apos;t process it on this attempt. Most failures are transient (rate limit, gateway hiccup); retrying usually works.
            </p>
            {error && <p className="text-xs text-destructive/80 font-mono">{error}</p>}
          </div>
          <div className="flex gap-2 justify-center">
            <Button variant="outline" onClick={onHome}>Back to Home</Button>
            <Button onClick={onRetry}>Try again</Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  // success or already-synthesized
  const isFresh = status === 'success'
  const headline = dryRun
    ? 'Dry-run synthesis complete — nothing was written.'
    : isFresh
      ? 'Done — your workspace now sounds like you.'
      : 'Onboarding interview complete.'
  const subhead = dryRun
    ? 'Review the JSON below. Tune the synthesis prompt if anything looks off, then remove ?dryRun=1 from the URL to run for real.'
    : isFresh
      ? 'From here on, content NarrateRx generates uses the voice, audience, and topic queue from your interview.'
      : 'Your workspace voice was already synthesized. Visit Settings → Voice to review or refine.'
  const verb = dryRun ? 'Would write' : 'Wrote'
  return (
    <Card className={dryRun ? 'border-warning/40 bg-warning/5' : 'border-success/40 bg-success/5'}>
      <CardContent className="pt-6 text-center space-y-3">
        {dryRun
          ? <FlaskConical className="h-8 w-8 mx-auto text-warning" />
          : <CheckCircle2 className="h-8 w-8 mx-auto text-success" />}
        <div className="space-y-1">
          <p className="font-medium">{headline}</p>
          <p className="text-sm text-muted-foreground">{subhead}</p>
          {counts && (
            <p className="text-xs text-muted-foreground pt-1">
              {verb} {counts.voice_phrases} phrase{counts.voice_phrases === 1 ? '' : 's'},
              {' '}{counts.topics} topic seed{counts.topics === 1 ? '' : 's'},
              {' '}{counts.pain_points} prior-provider note{counts.pain_points === 1 ? '' : 's'}
              {counts.has_prototype ? ', and a patient archetype' : ''}.
            </p>
          )}
        </div>
        {dryRun && result && (
          <details className="text-left rounded-md border bg-background p-3 mt-2">
            <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Synthesis result (JSON)
            </summary>
            <pre className="mt-3 max-h-[500px] overflow-auto text-xs leading-relaxed whitespace-pre-wrap font-mono">
              {JSON.stringify(result, null, 2)}
            </pre>
          </details>
        )}
        <div className="flex gap-2 justify-center">
          {dryRun && (
            <Button variant="outline" onClick={onRetry}>Run again</Button>
          )}
          <Button onClick={onHome}>Back to Home</Button>
        </div>
      </CardContent>
    </Card>
  )
}

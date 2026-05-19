import { useEffect, useRef, useState } from 'react'
import { Loader2, Mic, CheckCircle2, MicOff, Volume2, VolumeX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import Icon from '@/components/ui/Icon'
import { primeAudioPlayback } from '@/lib/tts'

/**
 * MicCheck — pre-interview audio gate (Strella pattern, extended).
 *
 * Two phases:
 *   1. Mic check   — getUserMedia + live amplitude meter, confirms input.
 *   2. Speaker check — plays a TTS sample, user confirms they heard it.
 *
 * The speaker check is critical on iOS browsers (Safari + iOS Chrome, both
 * WebKit) where speechSynthesis.speak() only produces audio if invoked inside
 * a user-gesture handler. Catching the failure HERE prevents the user from
 * ending up in the interview with silent TTS.
 *
 * States:
 *   requesting       — getUserMedia pending
 *   mic-active       — mic granted, awaiting "Test speakers" click
 *   speaker-testing  — TTS sample playing
 *   speaker-ok       — user confirmed they heard the sample
 *   speaker-failed   — user didn't hear it, troubleshoot + retry
 *   mic-denied       — permission denied or API absent
 *
 * Props:
 *   onContinue — called when the user is ready to start the interview
 */
export default function MicCheck({ onContinue }) {
  const [status, setStatus] = useState('requesting')
  const [level, setLevel] = useState(0)
  const [hasSpeechSynthesis, setHasSpeechSynthesis] = useState(true)

  const streamRef = useRef(null)
  const audioCtxRef = useRef(null)
  const analyserRef = useRef(null)
  const rafRef = useRef(null)
  const testUtteranceRef = useRef(null)

  useEffect(() => {
    setHasSpeechSynthesis(typeof window !== 'undefined' && !!window.speechSynthesis)
  }, [])

  useEffect(() => {
    let cancelled = false

    async function init() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus('mic-denied')
        return
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        if (cancelled) {
          stream.getTracks().forEach(t => t.stop())
          return
        }
        streamRef.current = stream

        const ctx = new AudioContext()
        audioCtxRef.current = ctx
        const source = ctx.createMediaStreamSource(stream)
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 256
        analyser.smoothingTimeConstant = 0.8
        source.connect(analyser)
        analyserRef.current = analyser

        setStatus('mic-active')

        const buf = new Uint8Array(analyser.frequencyBinCount)
        function tick() {
          analyser.getByteTimeDomainData(buf)
          let sum = 0
          for (let i = 0; i < buf.length; i++) {
            const v = (buf[i] - 128) / 128
            sum += v * v
          }
          const rms = Math.sqrt(sum / buf.length)
          setLevel(Math.min(1, rms * 6))
          rafRef.current = requestAnimationFrame(tick)
        }
        rafRef.current = requestAnimationFrame(tick)
      } catch {
        if (!cancelled) setStatus('mic-denied')
      }
    }

    init()

    return () => {
      cancelled = true
      cancelAnimationFrame(rafRef.current)
      analyserRef.current = null
      audioCtxRef.current?.close().catch(() => {})
      audioCtxRef.current = null
      streamRef.current?.getTracks().forEach(t => t.stop())
      streamRef.current = null
      try { window.speechSynthesis?.cancel() } catch { /* ignore */ }
    }
  }, [])

  // Plays a TTS sample inside a user-gesture handler. This call doubles as
  // the iOS speechSynthesis "primer" — once it succeeds, later speak() calls
  // from async contexts will also play. Must be called synchronously from a
  // click handler; no awaits before synth.speak().
  function handleTestSpeakers() {
    setStatus('speaker-testing')

    // The neural TTS used in the interview plays via <audio> elements, which
    // iOS Safari blocks from programmatic .play() unless an Audio element has
    // already been activated by a user gesture. Prime it here, alongside the
    // synchronous speechSynthesis.speak() below.
    primeAudioPlayback()

    try {
      const synth = window.speechSynthesis
      if (!synth) {
        setStatus('speaker-failed')
        return
      }
      synth.cancel()
      const utterance = new SpeechSynthesisUtterance(
        "Hi, I'm Bernard. If you can hear me clearly, your speakers are working. Tap the button below to continue."
      )
      utterance.rate = 1.0
      utterance.pitch = 1.0
      utterance.volume = 1.0
      utterance.onend = () => {
        // Leave the user in 'speaker-testing' so they can answer the yes/no
        // prompt themselves — we don't auto-advance because some browsers
        // fire onend even if no audio actually came out.
      }
      utterance.onerror = () => {
        setStatus('speaker-failed')
      }
      testUtteranceRef.current = utterance
      synth.speak(utterance)
    } catch {
      setStatus('speaker-failed')
    }
  }

  function handleHeardIt() {
    try { window.speechSynthesis?.cancel() } catch { /* ignore */ }
    setStatus('speaker-ok')
  }

  function handleDidNotHear() {
    try { window.speechSynthesis?.cancel() } catch { /* ignore */ }
    setStatus('speaker-failed')
  }

  function handleRetry() {
    setStatus('mic-active')
  }

  function handleContinue() {
    // Defensive: also prime <audio> here for paths that skip the speaker
    // check entirely (e.g. mic-denied "Continue anyway", or environments
    // without speechSynthesis where the speaker-check button is hidden).
    primeAudioPlayback()

    // Clean up before handing off — interview will open its own mic session
    cancelAnimationFrame(rafRef.current)
    audioCtxRef.current?.close().catch(() => {})
    audioCtxRef.current = null
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    try { window.speechSynthesis?.cancel() } catch { /* ignore */ }
    onContinue()
  }

  // "Continue anyway" path for users without working audio output —
  // typed-answer fallback (PR #650) keeps them functional.
  function handleContinueWithoutAudio() {
    handleContinue()
  }

  const inSpeakerCheck = status === 'speaker-testing' || status === 'speaker-ok' || status === 'speaker-failed'
  const heading = inSpeakerCheck ? 'Speaker check' : 'Audio check'
  const subhead = inSpeakerCheck
    ? "Let's confirm you can hear Bernard before we begin."
    : "Let's confirm your microphone is working before we begin."

  return (
    <div className="max-w-xl mx-auto py-4">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{heading}</h1>
          <p className="text-muted-foreground text-sm mt-1">{subhead}</p>
        </div>

        <div className="rounded-xl border bg-card p-6 flex flex-col items-center gap-5">
          {status === 'requesting' && (
            <>
              <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                <Loader2 className="h-7 w-7 text-primary animate-spin" aria-hidden="true" />
              </div>
              <p className="text-sm text-muted-foreground">Checking your microphone&hellip;</p>
            </>
          )}

          {status === 'mic-active' && (
            <>
              <div className="relative h-16 w-16 flex items-center justify-center">
                <span
                  aria-hidden="true"
                  className="absolute inset-0 rounded-full bg-primary/20 transition-transform duration-100"
                  style={{ transform: `scale(${1 + level * 0.6})`, opacity: 0.5 + level * 0.5 }}
                />
                <div className="h-16 w-16 rounded-full bg-primary flex items-center justify-center z-10">
                  <Mic className="h-7 w-7 text-primary-foreground" aria-hidden="true" />
                </div>
              </div>

              <div
                role="meter"
                aria-label="Microphone level"
                aria-valuenow={Math.round(level * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
                className="w-full h-2 rounded-full bg-muted overflow-hidden"
              >
                <div
                  className="h-full rounded-full bg-primary transition-all duration-75"
                  style={{ width: `${Math.max(4, level * 100)}%` }}
                />
              </div>

              <div className="flex items-center gap-2 text-sm font-medium text-green-600">
                <Icon as={CheckCircle2} size="md" />
                Microphone ready
              </div>

              <p className="text-xs text-muted-foreground text-center">
                Next, we&rsquo;ll check that you can hear Bernard.
              </p>

              {hasSpeechSynthesis ? (
                <Button className="w-full" size="lg" onClick={handleTestSpeakers}>
                  <Icon as={Volume2} size="md" className="mr-2" />
                  Test speakers
                </Button>
              ) : (
                <Button className="w-full" size="lg" onClick={handleContinue}>
                  Start interview
                </Button>
              )}
            </>
          )}

          {status === 'speaker-testing' && (
            <>
              <div className="h-16 w-16 rounded-full bg-primary flex items-center justify-center">
                <Volume2 className="h-7 w-7 text-primary-foreground animate-pulse" aria-hidden="true" />
              </div>
              <div className="text-center space-y-1">
                <p className="text-sm font-medium">Playing a test message&hellip;</p>
                <p className="text-xs text-muted-foreground">
                  Listen for Bernard&rsquo;s voice. Make sure your volume is up and your phone isn&rsquo;t on silent.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 w-full">
                <Button variant="outline" size="lg" onClick={handleDidNotHear}>
                  <Icon as={VolumeX} size="md" className="mr-1.5" />
                  I didn&rsquo;t hear it
                </Button>
                <Button size="lg" onClick={handleHeardIt}>
                  <Icon as={CheckCircle2} size="md" className="mr-1.5" />
                  I heard it
                </Button>
              </div>
              <button
                type="button"
                onClick={handleTestSpeakers}
                className="text-xs text-muted-foreground underline hover:text-foreground"
              >
                Play again
              </button>
            </>
          )}

          {status === 'speaker-ok' && (
            <>
              <div className="h-16 w-16 rounded-full bg-green-500/10 flex items-center justify-center">
                <CheckCircle2 className="h-7 w-7 text-green-600" aria-hidden="true" />
              </div>
              <div className="text-center space-y-1">
                <p className="text-sm font-medium">You&rsquo;re all set.</p>
                <p className="text-xs text-muted-foreground">
                  Mic and speakers are working. Bernard will guide the conversation.
                </p>
              </div>
              <Button className="w-full" size="lg" onClick={handleContinue}>
                <Icon as={Mic} size="md" className="mr-2" />
                Start interview
              </Button>
            </>
          )}

          {status === 'speaker-failed' && (
            <>
              <div className="h-16 w-16 rounded-full bg-amber-500/10 flex items-center justify-center">
                <VolumeX className="h-7 w-7 text-amber-600" aria-hidden="true" />
              </div>
              <div className="text-center space-y-1">
                <p className="text-sm font-medium">No sound?</p>
                <p className="text-xs text-muted-foreground">
                  A few things to check:
                </p>
              </div>
              <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-5 self-start">
                <li>Turn your volume up.</li>
                <li>On iPhone, flip the silent switch off (ring mode).</li>
                <li>Disconnect any Bluetooth headphones you&rsquo;re not using.</li>
                <li>If you&rsquo;re in a tab muted by the browser, unmute it.</li>
              </ul>
              <div className="grid grid-cols-2 gap-2 w-full">
                <Button variant="outline" size="lg" onClick={handleContinueWithoutAudio}>
                  Continue without audio
                </Button>
                <Button size="lg" onClick={handleRetry}>
                  Try again
                </Button>
              </div>
              <p className="text-xs text-muted-foreground text-center">
                If you continue without audio, you can still type your answers — but you won&rsquo;t hear the questions.
              </p>
            </>
          )}

          {status === 'mic-denied' && (
            <>
              <div className="h-16 w-16 rounded-full bg-destructive/10 flex items-center justify-center">
                <MicOff className="h-7 w-7 text-destructive" aria-hidden="true" />
              </div>

              <div className="text-center space-y-1">
                <p className="text-sm font-medium">Microphone access is needed for voice answers.</p>
                <p className="text-sm text-muted-foreground">
                  You can still type your answers instead.
                </p>
              </div>

              <Button variant="outline" className="w-full" size="lg" onClick={handleContinue}>
                Continue anyway
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

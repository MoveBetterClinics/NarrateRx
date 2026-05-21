import { useEffect, useRef, useState } from 'react'
import { Loader2, Mic, CheckCircle2, MicOff, Volume2, VolumeX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import Icon from '@/components/ui/Icon'
import { primeAudioPlayback, createTtsPlayer } from '@/lib/tts'

const SPEAKER_TEST_MESSAGE = "Hi, I'm Bernard. If you can hear me clearly, your speakers are working. Tap the button below to continue."

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
// Number of vertical bars in the rolling waveform. 14 reads as "voice
// activity" without being noisy on small screens.
const WAVEFORM_BARS = 14
// Amplitude (0–1) the user must hit at least once before we consider the
// mic "confirmed working". Calibrated against the rms*6 scaling in the
// audio loop — a normal "hello" lands around 0.4–0.6.
const VOICE_DETECTED_THRESHOLD = 0.18

export default function MicCheck({ onContinue, ttsSettings }) {
  const [status, setStatus] = useState('requesting')
  const [level, setLevel] = useState(0)
  const [waveform, setWaveform] = useState(() => new Array(WAVEFORM_BARS).fill(0))
  const [voiceDetected, setVoiceDetected] = useState(false)
  const [hasSpeechSynthesis, setHasSpeechSynthesis] = useState(true)

  const streamRef = useRef(null)
  const audioCtxRef = useRef(null)
  const analyserRef = useRef(null)
  const rafRef = useRef(null)
  const testUtteranceRef = useRef(null)
  const ttsRef = useRef(null)
  // Roll the waveform on a slower cadence than the rAF tick — pushing on
  // every frame produces a blurred high-frequency shimmer that doesn't read
  // as "speech bars". ~30ms gives a clearly readable rolling animation.
  const lastWaveformPushRef = useRef(0)
  const voiceDetectedRef = useRef(false)
  function getTts() {
    if (!ttsRef.current) ttsRef.current = createTtsPlayer()
    return ttsRef.current
  }

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
        function tick(now) {
          analyser.getByteTimeDomainData(buf)
          let sum = 0
          for (let i = 0; i < buf.length; i++) {
            const v = (buf[i] - 128) / 128
            sum += v * v
          }
          const rms = Math.sqrt(sum / buf.length)
          const norm = Math.min(1, rms * 6)
          setLevel(norm)

          // First time amplitude clears the threshold, lock in "voice
          // detected" so the user can advance. Ref mirror avoids stale
          // closure on the state.
          if (!voiceDetectedRef.current && norm >= VOICE_DETECTED_THRESHOLD) {
            voiceDetectedRef.current = true
            setVoiceDetected(true)
          }

          // Append to waveform on a ~33ms cadence so the bars read as a
          // rolling speech meter rather than a frame-rate shimmer.
          if (!lastWaveformPushRef.current || now - lastWaveformPushRef.current >= 33) {
            lastWaveformPushRef.current = now
            setWaveform((prev) => {
              const next = prev.slice(1)
              next.push(norm)
              return next
            })
          }

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
      ttsRef.current?.cancel()
    }
  }, [])

  // Plays the speaker-check sample. Tries the neural TTS (ElevenLabs via
  // /api/tts) first so the user hears the same voice they'll hear in the
  // interview. Falls back to speechSynthesis if the neural path fails
  // (env var missing, network error, etc.). Either way, the call originates
  // inside a click handler so iOS gesture-activation is satisfied.
  function handleTestSpeakers() {
    setStatus('speaker-testing')

    // Synchronously prime <audio> within the gesture — must happen before any
    // async fetch in the neural-TTS path.
    primeAudioPlayback()

    let usedFallback = false
    function fallbackToSynthesis() {
      if (usedFallback) return
      usedFallback = true
      try {
        const synth = window.speechSynthesis
        if (!synth) { setStatus('speaker-failed'); return }
        synth.cancel()
        const utterance = new SpeechSynthesisUtterance(SPEAKER_TEST_MESSAGE)
        utterance.rate = 1.0
        utterance.pitch = 1.0
        utterance.volume = 1.0
        utterance.onerror = () => setStatus('speaker-failed')
        testUtteranceRef.current = utterance
        synth.speak(utterance)
      } catch {
        setStatus('speaker-failed')
      }
    }

    getTts().speak(SPEAKER_TEST_MESSAGE, {
      voiceId: ttsSettings?.voice_id || undefined,
      speed: typeof ttsSettings?.speed === 'number' ? ttsSettings.speed : undefined,
      onError: () => {
        // createTtsPlayer already falls back internally to speechSynthesis on
        // its own playback errors, so this onError typically only fires when
        // even synthesis is unavailable. Surface that as speaker-failed.
        // Trigger our own fallback to be safe in case the internal fallback
        // path didn't kick in.
        fallbackToSynthesis()
      },
    })
  }

  function handleHeardIt() {
    ttsRef.current?.cancel()
    try { window.speechSynthesis?.cancel() } catch { /* ignore */ }
    setStatus('speaker-ok')
  }

  function handleDidNotHear() {
    ttsRef.current?.cancel()
    try { window.speechSynthesis?.cancel() } catch { /* ignore */ }
    setStatus('speaker-failed')
  }

  function handleRetry() {
    ttsRef.current?.cancel()
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

              {/* Rolling waveform — 14 vertical bars showing recent
                   amplitude. Reads as "voice waves" so the user has
                   unambiguous visual feedback that mic input is reaching
                   the page. */}
              <div
                role="meter"
                aria-label="Microphone level"
                aria-valuenow={Math.round(level * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
                className="w-full h-16 flex items-center justify-center gap-1.5 px-2"
              >
                {waveform.map((amp, i) => {
                  // Floor of ~10% so flat silence still renders thin bars
                  // (vs. invisibly collapsing), and max of ~95% so loud
                  // input doesn't slam against the container edge.
                  const heightPct = Math.max(10, Math.min(95, amp * 110))
                  return (
                    <span
                      key={i}
                      aria-hidden="true"
                      className={`flex-1 rounded-full transition-[height,background-color] duration-75 ${
                        voiceDetected ? 'bg-primary' : 'bg-primary/40'
                      }`}
                      style={{ height: `${heightPct}%`, minHeight: '4px' }}
                    />
                  )
                })}
              </div>

              {voiceDetected ? (
                <>
                  <div className="flex items-center gap-2 text-sm font-medium text-green-600">
                    <Icon as={CheckCircle2} size="md" />
                    Microphone working — we heard you
                  </div>
                  <p className="text-xs text-muted-foreground text-center">
                    Next, we&rsquo;ll check that you can hear Bernard.
                  </p>
                </>
              ) : (
                <>
                  <div className="text-sm font-medium text-foreground text-center">
                    Say something to test your mic
                  </div>
                  <p className="text-xs text-muted-foreground text-center">
                    Try &ldquo;hello&rdquo; &mdash; the bars above should move with your voice.
                  </p>
                </>
              )}

              {hasSpeechSynthesis ? (
                <Button
                  className="w-full"
                  size="lg"
                  onClick={handleTestSpeakers}
                  disabled={!voiceDetected}
                  title={voiceDetected ? undefined : 'Say something first so we can confirm your mic is picking up audio'}
                >
                  <Icon as={Volume2} size="md" className="mr-2" />
                  Test speakers
                </Button>
              ) : (
                <Button
                  className="w-full"
                  size="lg"
                  onClick={handleContinue}
                  disabled={!voiceDetected}
                  title={voiceDetected ? undefined : 'Say something first so we can confirm your mic is picking up audio'}
                >
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
                className="text-xs text-muted-foreground underline hover:text-foreground active:text-foreground py-2 px-3 min-h-[44px]"
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

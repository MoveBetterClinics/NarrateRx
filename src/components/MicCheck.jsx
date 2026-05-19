import { useEffect, useRef, useState } from 'react'
import { Loader2, Mic, CheckCircle2, MicOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import Icon from '@/components/ui/Icon'

/**
 * MicCheck — pre-interview microphone gate (Strella pattern).
 *
 * States:
 *   requesting — getUserMedia pending, spinner shown
 *   active     — mic granted, live amplitude bar + "Start Interview" CTA
 *   error      — permission denied or API absent, graceful "Continue anyway" fallback
 *
 * Props:
 *   onContinue — called when the user clicks "Start Interview" or "Continue anyway"
 */
export default function MicCheck({ onContinue }) {
  const [status, setStatus] = useState('requesting') // 'requesting' | 'active' | 'error'
  const [level, setLevel] = useState(0) // 0–1 normalised amplitude

  const streamRef = useRef(null)
  const audioCtxRef = useRef(null)
  const analyserRef = useRef(null)
  const rafRef = useRef(null)

  useEffect(() => {
    let cancelled = false

    async function init() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus('error')
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

        setStatus('active')

        // Poll amplitude via rAF
        const buf = new Uint8Array(analyser.frequencyBinCount)
        function tick() {
          analyser.getByteTimeDomainData(buf)
          // RMS amplitude, normalised to 0–1
          let sum = 0
          for (let i = 0; i < buf.length; i++) {
            const v = (buf[i] - 128) / 128
            sum += v * v
          }
          const rms = Math.sqrt(sum / buf.length)
          setLevel(Math.min(1, rms * 6)) // scale so normal speech is ~0.4–0.8
          rafRef.current = requestAnimationFrame(tick)
        }
        rafRef.current = requestAnimationFrame(tick)
      } catch {
        if (!cancelled) setStatus('error')
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
    }
  }, [])

  function handleContinue() {
    // iOS Safari requires speechSynthesis.speak() to be invoked from within a
    // user-gesture handler at least once per page; otherwise subsequent calls
    // (made after async work like sendToAI) produce silent failures. Prime it
    // here with a near-silent utterance so the real TTS fires later.
    try {
      const synth = window.speechSynthesis
      if (synth) {
        synth.cancel()
        const primer = new SpeechSynthesisUtterance(' ')
        primer.volume = 0
        synth.speak(primer)
      }
    } catch { /* ignore */ }

    // Clean up before handing off — interview will open its own mic session
    cancelAnimationFrame(rafRef.current)
    audioCtxRef.current?.close().catch(() => {})
    audioCtxRef.current = null
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    onContinue()
  }

  return (
    <div className="max-w-xl mx-auto py-4">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Mic check</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Let&rsquo;s confirm your microphone is working before we begin.
          </p>
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

          {status === 'active' && (
            <>
              <div className="relative h-16 w-16 flex items-center justify-center">
                {/* Ripple ring — scales with live amplitude */}
                <span
                  aria-hidden="true"
                  className="absolute inset-0 rounded-full bg-primary/20 transition-transform duration-100"
                  style={{ transform: `scale(${1 + level * 0.6})`, opacity: 0.5 + level * 0.5 }}
                />
                <div className="h-16 w-16 rounded-full bg-primary flex items-center justify-center z-10">
                  <Mic className="h-7 w-7 text-primary-foreground" aria-hidden="true" />
                </div>
              </div>

              {/* Amplitude bar */}
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
                Speak naturally &mdash; Bernard will guide the conversation.
              </p>

              <Button className="w-full" size="lg" onClick={handleContinue}>
                <Icon as={Mic} size="md" className="mr-2" />
                Start Interview
              </Button>
            </>
          )}

          {status === 'error' && (
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

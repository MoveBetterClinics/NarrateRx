// "Read aloud" button — first real production caller of the F#3 voice clone.
//
// Plays a short audio preview (≤PREVIEW_CHARS) of the supplied text via
// /api/tts. When staffId is passed, the server resolves to that
// clinician's voice clone (if active). Otherwise falls back to the default
// Bernard voice.
//
// Why preview only:
//   - /api/tts caps text at 1200 chars per call (cost guard)
//   - ElevenLabs Starter has 30k chars/mo; a full blog read would burn
//     ~5k chars in one click. Preview = "hear what your draft sounds like
//     in your own voice" without the cost cliff.
//
// Truncation is paragraph-aware so the preview ends on a natural boundary,
// not mid-sentence.

import { useEffect, useRef, useState } from 'react'
import { Loader2, Volume2, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createTtsPlayer, primeAudioPlayback } from '@/lib/tts'

const PREVIEW_CHARS = 1100   // server hard-caps at 1200; leave headroom

function truncateAtBoundary(text, max) {
  const s = String(text || '').trim()
  if (s.length <= max) return s
  const head = s.slice(0, max)
  // Prefer paragraph break, then sentence end, then word boundary.
  const lastPara = head.lastIndexOf('\n\n')
  if (lastPara > max * 0.5) return head.slice(0, lastPara).trim()
  const lastSentence = Math.max(
    head.lastIndexOf('. '),
    head.lastIndexOf('? '),
    head.lastIndexOf('! '),
  )
  if (lastSentence > max * 0.5) return head.slice(0, lastSentence + 1).trim()
  const lastSpace = head.lastIndexOf(' ')
  return (lastSpace > 0 ? head.slice(0, lastSpace) : head).trim() + '…'
}

/**
 * @param {object} props
 * @param {string} props.text          — full piece body; auto-truncated to a preview
 * @param {string=} props.staffId  — resolves to this clinician's clone (F#3)
 * @param {string=} props.label        — button label (default "Read aloud (preview)")
 * @param {string=} props.size         — Button size; default 'sm'
 * @param {string=} props.variant      — Button variant; default 'outline'
 * @param {string=} props.className
 */
export default function ReadAloudButton({
  text,
  staffId,
  label = 'Read aloud (preview)',
  size = 'sm',
  variant = 'outline',
  className,
}) {
  const ttsRef = useRef(null)
  const [state, setState] = useState('idle') // idle | loading | playing

  // Stop on unmount so navigation doesn't leave audio playing.
  useEffect(() => {
    return () => {
      try { ttsRef.current?.cancel?.() } catch { /* noop */ }
    }
  }, [])

  const disabled = !text || !String(text).trim()

  const onClick = () => {
    if (state === 'playing' || state === 'loading') {
      try { ttsRef.current?.cancel?.() } catch { /* noop */ }
      setState('idle')
      return
    }
    if (!ttsRef.current) ttsRef.current = createTtsPlayer()
    // iOS audio-unlock — must run in the click handler. Idempotent across calls.
    primeAudioPlayback()
    const preview = truncateAtBoundary(text, PREVIEW_CHARS)
    setState('loading')
    ttsRef.current.speak(preview, {
      staffId,
      onStart: () => setState('playing'),
      onEnd:   () => setState('idle'),
      onError: () => setState('idle'),
    })
  }

  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      onClick={onClick}
      disabled={disabled}
      className={className}
      title={staffId ? "Hear this in this clinician's voice (if cloned)" : 'Hear this in the default voice'}
    >
      {state === 'loading' ? (
        <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Loading…</>
      ) : state === 'playing' ? (
        <><Square className="h-4 w-4 mr-1" fill="currentColor" /> Stop</>
      ) : (
        <><Volume2 className="h-4 w-4 mr-1" /> {label}</>
      )}
    </Button>
  )
}

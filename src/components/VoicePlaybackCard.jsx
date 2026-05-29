// Per-clinician voice playback preferences. Today the only setting is
// `speed` (ElevenLabs voice_settings.speed, range 0.7–1.2). The data lives
// in clinicians.tts_settings (JSONB), so adding voice_id / model_id later
// only needs a new control here — no migration, no schema change.
//
// Shown only on the owner's own StaffProfile (gated upstream).

import { useEffect, useRef, useState } from 'react'
import { Loader2, Volume2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { usePatchClinician } from '@/lib/queries'
import { createTtsPlayer, primeAudioPlayback } from '@/lib/tts'
import { toast } from '@/lib/toast'

const MIN = 0.7
const MAX = 1.2
const STEP = 0.05
const DEFAULT = 1.0

// Short, voicey sample so the user hears speed differences clearly without
// burning many credits. ~120 chars.
const PREVIEW_TEXT = "Hi, I'm Bernard. This is how I'll sound when I ask you questions. We can take it at whatever pace feels right for you."

function clamp(n) {
  if (!Number.isFinite(n)) return DEFAULT
  return Math.min(MAX, Math.max(MIN, n))
}

function fmt(n) {
  return n.toFixed(2).replace(/\.?0+$/, '') + '×'
}

export default function VoicePlaybackCard({ clinician }) {
  const initial = clamp(Number(clinician?.tts_settings?.speed ?? DEFAULT))
  const [speed, setSpeed] = useState(initial)
  const [playing, setPlaying] = useState(false)
  const ttsRef = useRef(null)
  const patchClinician = usePatchClinician()

  // Reset local state if the underlying clinician swaps (rare on this page,
  // but guards against stale slider values after cache invalidation).
  useEffect(() => {
    setSpeed(clamp(Number(clinician?.tts_settings?.speed ?? DEFAULT)))
  }, [clinician?.id, clinician?.tts_settings?.speed])

  useEffect(() => () => { ttsRef.current?.cancel() }, [])

  function getTts() {
    if (!ttsRef.current) ttsRef.current = createTtsPlayer()
    return ttsRef.current
  }

  function handlePreview() {
    // Same iOS gesture pattern: prime synchronously inside the click handler
    // before any async work.
    primeAudioPlayback()
    setPlaying(true)
    getTts().speak(PREVIEW_TEXT, {
      voiceId: clinician?.tts_settings?.voice_id || undefined,
      speed,
      onEnd: () => setPlaying(false),
      onError: () => setPlaying(false),
    })
  }

  function handleStop() {
    ttsRef.current?.cancel()
    setPlaying(false)
  }

  async function handleSave() {
    const next = { ...(clinician?.tts_settings || {}), speed }
    try {
      await patchClinician.mutateAsync({
        id: clinician.id,
        patch: { tts_settings: next },
        userId: clinician.created_by_id,
      })
      toast.success('Voice pace saved')
    } catch (e) {
      toast.error(e?.message || "Couldn't save voice pace")
    }
  }

  const dirty = Math.abs(speed - initial) > 0.001
  const saving = patchClinician.isPending

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold flex items-center gap-2">
              <Volume2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              Voice pace
            </h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              How fast Bernard speaks during your interviews.
            </p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-semibold tabular-nums">{fmt(speed)}</div>
            <div className="text-xs text-muted-foreground">
              {speed < 0.95 ? 'slower' : speed > 1.05 ? 'faster' : 'default'}
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <input
            type="range"
            min={MIN}
            max={MAX}
            step={STEP}
            value={speed}
            onChange={(e) => setSpeed(clamp(Number(e.target.value)))}
            aria-label="Voice pace"
            className="w-full accent-primary"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Slower (0.7×)</span>
            <span>Default (1.0×)</span>
            <span>Faster (1.2×)</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          {playing ? (
            <Button variant="outline" size="sm" onClick={handleStop}>
              Stop preview
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={handlePreview}>
              <Volume2 className="h-4 w-4 mr-1.5" />
              Preview at {fmt(speed)}
            </Button>
          )}
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!dirty || saving}
          >
            {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            {saving ? 'Saving' : dirty ? 'Save' : 'Saved'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// "Your voice clone" card on the Voice tab of Clinician Profile.
//
// States derived from the clinician row:
//   - has_clone:   eleven_voice_id set + voice_clone_revoked_at IS NULL
//   - had_clone:   voice_clone_revoked_at IS NOT NULL (offers re-clone path)
//   - never_clone: neither — first-time CTA
//
// Owner-only — gated upstream in StaffProfile.

import { Link } from 'react-router-dom'
import { useState } from 'react'
import { Mic, Sparkles, ShieldOff, Loader2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { apiFetch } from '@/lib/api'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from '@/lib/toast'

function fmtDate(iso) {
  if (!iso) return ''
  try { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) }
  catch { return '' }
}

export default function VoiceCloneCard({ clinician }) {
  const queryClient = useQueryClient()
  const [revoking, setRevoking] = useState(false)

  const hasClone = !!clinician?.eleven_voice_id && !clinician?.voice_clone_revoked_at
  const hadClone = !!clinician?.voice_clone_revoked_at && !clinician?.eleven_voice_id
  const consentAt = clinician?.voice_clone_consent_at

  const onRevoke = async () => {
    if (!clinician?.id) return
    if (!confirm('Revoke this voice clone? The voice will be deleted from ElevenLabs and content will stop using it.')) {
      return
    }
    setRevoking(true)
    try {
      await apiFetch('/api/voice-clone/revoke', {
        method: 'POST',
        body: JSON.stringify({ staffId: clinician.id }),
      })
      // Invalidate the clinician cache so the card flips state.
      queryClient.invalidateQueries({ queryKey: ['clinician'] })
      queryClient.invalidateQueries({ queryKey: ['clinician-summaries'] })
      toast.success('Voice clone revoked.')
    } catch (e) {
      toast.error(e?.message || 'Revoke failed.')
    } finally {
      setRevoking(false)
    }
  }

  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        <div className="flex items-start gap-3">
          <div className={`h-10 w-10 rounded-full flex items-center justify-center ${hasClone ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
            {hasClone ? <Sparkles className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-base font-semibold">Your voice clone</div>
            <div className="text-sm text-muted-foreground">
              {hasClone
                ? 'Active. NarrateRx can narrate content in your voice.'
                : hadClone
                ? 'Revoked. You can train a new clone any time.'
                : 'Not trained yet. Read a short passage and NarrateRx can speak in your voice.'}
            </div>
          </div>
        </div>

        {hasClone && consentAt && (
          <div className="text-xs text-muted-foreground pl-13">
            Created {fmtDate(consentAt)}.
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          {hasClone ? (
            <>
              <Button asChild variant="outline" size="sm">
                <Link to="/settings/voice-training">Re-train</Link>
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={onRevoke} disabled={revoking} className="text-red-700 hover:text-red-800 hover:bg-red-50">
                {revoking ? (
                  <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Revoking…</>
                ) : (
                  <><ShieldOff className="h-4 w-4 mr-1" /> Revoke</>
                )}
              </Button>
            </>
          ) : (
            <Button asChild size="sm">
              <Link to="/settings/voice-training">
                <Sparkles className="h-4 w-4 mr-1" />
                {hadClone ? 'Train a new clone' : 'Train my voice'}
              </Link>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

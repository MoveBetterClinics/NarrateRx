import { useState } from 'react'
import { Sparkles, Loader2, AlertCircle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import Icon from '@/components/ui/Icon'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/queries'
import { formatRelativeDate } from '@/lib/utils'
import { apiFetch } from '@/lib/api'

// Voice notes display for a clinician profile. Shows what the AI has learned
// about how this clinician edits AI drafts, and lets them refresh manually.
//
// The notes themselves are computed by /api/staff/refresh-voice-notes,
// which compares ai_original_content vs. content for recent edited drafts.
export default function VoiceNotesPanel({ clinician }) {
  const qc = useQueryClient()
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError]           = useState('')
  const [result, setResult]         = useState(null)

  async function handleRefresh() {
    setRefreshing(true)
    setError('')
    setResult(null)
    try {
      const data = await apiFetch('/api/staff/refresh-voice-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staff_id: clinician.id }),
      })
      setResult(data)
      // Refetch the clinician so the new voice_notes show in the UI
      qc.invalidateQueries({ queryKey: queryKeys.staff.detail(clinician.id) })
    } catch (e) {
      setError(e.message || 'Refresh failed')
    } finally {
      setRefreshing(false)
    }
  }

  const notes        = clinician.voice_notes || ''
  const refreshedAt  = clinician.voice_notes_refreshed_at
  const editsCount   = clinician.voice_notes_edits_analyzed || 0
  const hasNotes     = notes.trim().length > 0
  const everAnalyzed = Boolean(refreshedAt)

  return (
    <div className="rounded-xl border bg-card p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Icon as={Sparkles} size="md" className="text-primary" />
            <h2 className="font-semibold text-base">Voice Memory</h2>
            {everAnalyzed && (
              <Badge variant="outline" className="text-xs px-1.5 py-0 font-normal text-muted-foreground">
                {editsCount} edit{editsCount === 1 ? '' : 's'} analyzed
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            What the AI has learned about how {clinician.name.split(' ')[0]} edits drafts. These patterns are injected into every future prompt to reduce revisions.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={handleRefresh}
          disabled={refreshing}
          className="shrink-0"
        >
          {refreshing ? (
            <><Icon as={Loader2} size="sm" className="mr-1.5 animate-spin" />Analyzing…</>
          ) : (
            <><Icon as={RefreshCw} size="sm" className="mr-1.5" />Refresh</>
          )}
        </Button>
      </div>

      {error && (
        <p className="text-xs text-destructive flex items-center gap-1.5">
          <Icon as={AlertCircle} size="sm" />
          {error}
        </p>
      )}

      {hasNotes ? (
        <div className="rounded-lg bg-muted/40 p-4 border">
          <pre className="text-xs leading-relaxed whitespace-pre-wrap font-sans text-foreground/90">
            {notes}
          </pre>
        </div>
      ) : result?.message ? (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-900">
          {result.message}
        </div>
      ) : everAnalyzed ? (
        <div className="rounded-lg bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
          No clear patterns yet. Edit a few more drafts and click Refresh to try again.
        </div>
      ) : (
        <div className="rounded-lg bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
          {clinician.name.split(' ')[0]} has not built up enough edit history yet. Once a few drafts have been edited and published, click Refresh to distill the patterns.
        </div>
      )}

      {refreshedAt && (
        <p className="text-xs text-muted-foreground">
          Last refreshed {formatRelativeDate(refreshedAt)}
        </p>
      )}
    </div>
  )
}

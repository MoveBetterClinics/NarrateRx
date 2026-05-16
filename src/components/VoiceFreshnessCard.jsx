import { useEffect, useState } from 'react'
import { Mic, Quote } from 'lucide-react'
import { apiFetch } from '@/lib/api'

// Voice-freshness card — Phase C.4.
//
// Renders the structured voice substrate (clinician_voice_phrases) as a
// readable artifact: a one-line stat strip ("trained on N pieces, last updated
// X") plus the top phrases as italic blockquotes. Sits on ClinicianProfile
// under the header, complementing VoiceNotesPanel — voice-notes is the human-
// readable distillation, this card is the literal substrate the AI consults.
//
// Empty state ("No voice profile yet") points at the path to populate: approve
// content for this clinician. Loaded fire-and-forget; never blocks the page.

const TOP_PHRASES = 6

function formatRelative(iso) {
  if (!iso) return null
  const ms = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(ms) || ms < 0) return null
  const days = Math.floor(ms / 86_400_000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7)   return `${days} days ago`
  if (days < 30)  return `${Math.round(days / 7)} week${days < 14 ? '' : 's'} ago`
  if (days < 365) return `${Math.round(days / 30)} month${days < 60 ? '' : 's'} ago`
  return `${Math.round(days / 365)} year${days < 730 ? '' : 's'} ago`
}

export default function VoiceFreshnessCard({ clinicianId, clinicianName }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(false)

  useEffect(() => {
    if (!clinicianId) return
    let cancelled = false
    setLoading(true)
    apiFetch(`/api/clinicians/voice-phrases?clinician_id=${clinicianId}&limit=${TOP_PHRASES}`)
      .then((d) => { if (!cancelled) { setData(d); setLoading(false) } })
      .catch(() => { if (!cancelled) { setError(true); setLoading(false) } })
    return () => { cancelled = true }
  }, [clinicianId])

  if (loading || error) return null  // Quiet — card just doesn't render until ready.

  const total     = data?.total_phrases ?? 0
  const pieces    = data?.pieces_count  ?? 0
  const lastSeen  = formatRelative(data?.last_updated_at)
  const phrases   = data?.phrases ?? []
  const firstName = clinicianName?.split(' ')[0] || 'this clinician'

  // Empty state — table is empty for this clinician.
  if (total === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-3 flex items-start gap-3">
        <Mic className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
        <div className="text-sm">
          <p className="font-medium text-foreground">No voice profile yet</p>
          <p className="text-muted-foreground text-xs mt-0.5">
            Bernard will start learning {firstName}&apos;s voice once approved content lands. Top phrasings appear here automatically.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-indigo-100 bg-indigo-50/40 px-4 py-3 space-y-2.5">
      <div className="flex items-center gap-2">
        <Mic className="h-4 w-4 text-indigo-700 shrink-0" />
        <p className="text-sm font-medium text-indigo-900">
          {firstName}&apos;s voice profile
        </p>
        <span className="text-xs text-indigo-700/80 ml-auto">
          {total} phrase{total === 1 ? '' : 's'} from {pieces} approved piece{pieces === 1 ? '' : 's'}
          {lastSeen ? ` · last grew ${lastSeen}` : ''}
        </span>
      </div>

      <ul className="space-y-1.5">
        {phrases.map((p, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-indigo-950/90">
            <Quote className="h-3 w-3 text-indigo-400 mt-1 shrink-0" aria-hidden="true" />
            <span className="italic leading-snug">{p.phrase}</span>
          </li>
        ))}
      </ul>

      <p className="text-xs text-indigo-700/70 leading-snug pt-1">
        These are sentences {firstName} shipped in approved content. Bernard treats them
        as voice anchors — generated drafts try to echo this phrasing rather than rewrite it.
      </p>
    </div>
  )
}

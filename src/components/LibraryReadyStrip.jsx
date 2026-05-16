import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Send, ChevronRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { useStories } from '@/lib/queries'
import { useUserRole } from '@/lib/useUserRole'
import { PLATFORM_META } from '@/lib/contentMeta'

// Pieces that are clinician-approved and not yet scheduled are the
// publisher's actual inbox — content that needs media + a publish click.
// We surface them at the top of /library so the publisher's first action
// every day is visible without scrolling.
function pickReadyPieces(stories) {
  const out = []
  for (const story of stories ?? []) {
    for (const piece of story?.pieces ?? []) {
      if (piece?.status !== 'approved') continue
      if (piece.scheduled_at || piece.published_at) continue
      out.push({
        id:             piece.id,
        storyId:        story.id,
        platform:       piece.platform,
        clinicianName:  story.clinician_name,
        clinicianId:    story.clinician_id,
        topic:          story.topic,
        provenance:     piece.provenance,
        updatedAt:      piece.updated_at,
      })
    }
  }
  // Most-recently-updated first so the freshest approvals are easiest to spot.
  return out.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
}

function VoiceChip({ provenance }) {
  if (!provenance?.summary) {
    return (
      <span className="inline-flex items-center text-3xs text-muted-foreground">
        voice score pending
      </span>
    )
  }
  const { verbatim_pct = 0, paraphrase_pct = 0 } = provenance.summary
  const ownWords = Math.round(verbatim_pct + paraphrase_pct)
  const tone = ownWords >= 60 ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : ownWords >= 35 ? 'bg-amber-50 text-amber-800 border-amber-200'
              :                  'bg-slate-50 text-slate-700 border-slate-200'
  const icon = ownWords >= 60 ? '✓' : ownWords >= 35 ? '⚠' : '○'
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-3xs font-medium border ${tone}`}>
      {icon} {ownWords}% voice
    </span>
  )
}

/**
 * Strip of approved-but-not-scheduled content pieces. Staff-only; clinicians
 * don't see it (no distribute role). Hidden when empty.
 */
export default function LibraryReadyStrip() {
  const { isStaff } = useUserRole()
  const { data: stories = [] } = useStories()
  const pieces = useMemo(() => pickReadyPieces(stories), [stories])

  if (!isStaff || pieces.length === 0) return null

  return (
    <section className="rounded-xl border border-blue-200 bg-blue-50/40 p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-widest text-blue-700">
          <Send className="h-3.5 w-3.5" />
          Ready to distribute
        </div>
        <Badge variant="secondary" className="bg-blue-100 text-blue-700 text-3xs border-0">
          {pieces.length} {pieces.length === 1 ? 'piece' : 'pieces'} · approved
        </Badge>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
        {pieces.slice(0, 8).map((p) => {
          const pm = PLATFORM_META[p.platform] || { label: p.platform || 'Post', icon: Send, color: 'text-slate-600', bg: 'bg-slate-100' }
          const Icon = pm.icon
          return (
            <Link
              key={p.id}
              to={`/stories/${p.storyId}`}
              className="group flex flex-col gap-2 rounded-lg border border-blue-100 bg-white p-3 hover:border-blue-300 transition-colors"
            >
              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-3xs font-medium w-fit ${pm.bg} ${pm.color}`}>
                <Icon className="h-3 w-3" />
                {pm.label}
              </span>
              <div className="text-xs font-semibold text-foreground truncate">{p.clinicianName || 'Unknown clinician'}</div>
              <div className="text-2xs text-muted-foreground line-clamp-2">{p.topic}</div>
              <VoiceChip provenance={p.provenance} />
              <span className="mt-auto inline-flex items-center justify-end gap-0.5 text-2xs font-medium text-blue-700 group-hover:text-blue-900 transition-colors">
                Attach media <ChevronRight className="h-3 w-3" />
              </span>
            </Link>
          )
        })}
      </div>

      {pieces.length > 8 && (
        <p className="mt-3 text-2xs text-muted-foreground">
          Showing first 8 — see all <Link to="/stories?view=pipeline" className="font-medium text-blue-700 hover:underline">in the pipeline view</Link>.
        </p>
      )}
    </section>
  )
}

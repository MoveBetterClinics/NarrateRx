// ShotListCard — the "shooting director" on the Capture page (V10).
//
// Reads the workspace's coverage gaps (via /api/editorial/shot-list) and shows
// the clinician concrete, voiced capture directives: "Film a 30s clip of you
// explaining X." Tapping a directive drops its intent into the capture note so
// the upload lands tagged with what it's meant to cover — closing the loop
// between distribution demand and capture supply.
//
// Renders nothing while loading, on error, or when there are no gaps (feature
// disabled, no topic_suggestions, or everything's already covered) — so it's a
// pure additive surface that never gets in the way of a quick capture.

import { useQuery } from '@tanstack/react-query'
import { Video, Image as ImageIcon, Trophy, Clapperboard } from 'lucide-react'
import { apiFetch } from '@/lib/api'

const PRIORITY_STYLE = {
  high:   'bg-destructive/10 text-destructive border-destructive/30',
  medium: 'bg-amber-50 text-amber-800 border-amber-200',
  low:    'bg-muted text-muted-foreground border-border',
}

export default function ShotListCard({ onPick }) {
  const { data } = useQuery({
    queryKey: ['shot-list'],
    queryFn: () => apiFetch('/api/editorial/shot-list'),
    refetchOnWindowFocus: false,
    staleTime: 10 * 60_000,  // directives change slowly; keep it cheap
    retry: false,            // 403 feature_disabled shouldn't retry-storm
  })

  const directives = data?.directives || []
  if (directives.length === 0) return null

  return (
    <div className="mb-6 rounded-lg border border-primary/30 bg-primary/5 p-4">
      <div className="flex items-center gap-2 mb-1">
        <Clapperboard className="w-4 h-4 text-primary shrink-0" />
        <h2 className="text-sm font-semibold text-primary">What to capture next</h2>
      </div>
      <p className="text-xs text-primary/70 mb-3">
        Your story slate needs source material on these. Tap one to start with that in mind.
      </p>
      <div className="flex flex-col gap-2">
        {directives.map((d, i) => (
          <button
            key={`${d.topic}-${i}`}
            type="button"
            onClick={() => onPick?.(d)}
            className="flex items-start gap-3 text-left rounded-md border border-border bg-card p-3 hover:border-primary hover:bg-primary/5 transition"
          >
            <span className="shrink-0 mt-0.5 text-primary">
              {d.format === 'photo' ? <ImageIcon className="w-4 h-4" /> : <Video className="w-4 h-4" />}
            </span>
            <span className="flex-1 min-w-0">
              <span className="flex items-center gap-1.5 flex-wrap">
                <span className="text-sm font-medium truncate">{d.title || d.topic}</span>
                {d.priority && (
                  <span className={`text-2xs font-bold px-1.5 py-0.5 rounded-full border ${PRIORITY_STYLE[d.priority] || PRIORITY_STYLE.medium}`}>
                    {d.priority}
                  </span>
                )}
                {d.proven && (
                  <span className="text-2xs font-bold px-1.5 py-0.5 rounded-full border bg-success/10 text-success border-success/30 inline-flex items-center gap-1">
                    <Trophy className="w-3 h-3" /> worked before
                  </span>
                )}
              </span>
              <span className="block text-xs text-muted-foreground mt-1">{d.directive}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

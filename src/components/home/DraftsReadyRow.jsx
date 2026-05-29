import { Link } from 'react-router-dom'
import { Eye, ChevronRight } from 'lucide-react'
import { PLATFORM_META } from '@/lib/contentMeta'

// DraftsReadyRow — the Home page's "do this now" surface, replacing the
// vertical "Awaiting review" task bucket with the horizontal 3-card row
// from the mockup. Each card shows a single piece (interview × platform)
// that's currently in_review, color-coded by platform family and tagged
// with a voice-match % when provenance data is available.
//
// When more than 3 pieces are pending review, the 4th slot collapses into
// a "View all → /stories?stage=review" link so the surface never grows past
// 4 columns.
//
// Auto-hides when nothing is in review — the page just rolls into the
// remaining task buckets below.

const PLATFORM_FAMILY = {
  blog:          { family: 'blog',   label: 'Blog',     pill: 'bg-emerald-50 text-emerald-700' },
  landing_page:  { family: 'blog',   label: 'Landing',  pill: 'bg-emerald-50 text-emerald-700' },
  email:         { family: 'email',  label: 'Email',    pill: 'bg-amber-50 text-amber-700'     },
  instagram:     { family: 'social', label: 'IG',       pill: 'bg-violet-50 text-violet-700'   },
  facebook:      { family: 'social', label: 'FB',       pill: 'bg-violet-50 text-violet-700'   },
  linkedin:      { family: 'social', label: 'LinkedIn', pill: 'bg-violet-50 text-violet-700'   },
  tiktok:        { family: 'social', label: 'TikTok',   pill: 'bg-violet-50 text-violet-700'   },
  youtube:       { family: 'social', label: 'YouTube',  pill: 'bg-violet-50 text-violet-700'   },
  pinterest:     { family: 'social', label: 'Pin',      pill: 'bg-violet-50 text-violet-700'   },
  gbp:           { family: 'local',  label: 'GBP',      pill: 'bg-sky-50 text-sky-700'         },
  twitter:       { family: 'social', label: 'X',        pill: 'bg-violet-50 text-violet-700'   },
}

function platformChip(platform) {
  const meta = PLATFORM_FAMILY[platform] || { label: PLATFORM_META[platform]?.label || platform, pill: 'bg-slate-100 text-slate-700' }
  return meta
}

function voiceMatchFor(piece) {
  const sum = piece?.provenance?.summary
  if (!sum) return null
  const own = (sum.verbatim_pct ?? 0) + (sum.paraphrase_pct ?? 0)
  return own > 0 ? Math.round(own) : null
}

export default function DraftsReadyRow({ stories = [] }) {
  // Flatten stories → pieces, keep only in_review, newest first.
  const pieces = []
  for (const s of stories) {
    for (const p of s.pieces || []) {
      if (p.status !== 'in_review') continue
      pieces.push({
        ...p,
        storyId: s.id,
        topic: s.topic,
        staffName: s.staff_name,
      })
    }
  }
  if (pieces.length === 0) return null

  pieces.sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0))
  const visible = pieces.slice(0, 3)
  const overflow = Math.max(0, pieces.length - visible.length)

  return (
    <div id="review" className="rounded-2xl border border-[#f3d3b5] bg-gradient-to-b from-white to-[#fefaf7] shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-18px_rgba(227,101,37,0.22)]">
      <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100">
        <span
          className="inline-block w-1 h-6 rounded-full shrink-0"
          style={{ background: 'hsl(var(--primary))' }}
          aria-hidden="true"
        />
        <Eye className="h-4 w-4 text-primary" />
        <h2 className="text-lg font-bold tracking-tight flex-1">Drafts ready for review</h2>
        <span className="inline-flex items-center justify-center h-5 min-w-[20px] rounded-full bg-primary text-primary-foreground text-2xs font-bold px-1.5">
          {pieces.length}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 p-4">
        {visible.map((piece) => {
          const chip = platformChip(piece.platform)
          const voice = voiceMatchFor(piece)
          return (
            <Link
              key={piece.id}
              to={`/stories/${piece.storyId}?piece=${piece.id}`}
              className="block rounded-xl border border-border bg-white p-4 transition-all duration-150 hover:-translate-y-0.5 hover:border-[#fde0d2] hover:shadow-[0_8px_20px_-16px_rgba(15,23,42,0.18)] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`inline-flex items-center gap-1 rounded-full text-2xs font-semibold px-2 py-0.5 ${chip.pill}`}>
                  {chip.label}
                </span>
                {voice != null ? (
                  <span
                    className={`text-2xs font-bold ${voice >= 60 ? 'text-emerald-700' : voice >= 35 ? 'text-amber-700' : 'text-slate-500'}`}
                  >
                    {voice}% voice
                  </span>
                ) : null}
              </div>
              <p className="mt-3 text-sm font-semibold leading-snug text-foreground line-clamp-2">{piece.topic}</p>
              {piece.staffName ? (
                <p className="text-2xs text-muted-foreground mt-1 truncate">{piece.staffName}</p>
              ) : null}
              <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                <span className="text-2xs text-muted-foreground">Approve · Edit · Publish</span>
                <span className="text-2xs font-bold text-primary inline-flex items-center gap-0.5">
                  Review <ChevronRight className="h-3 w-3" />
                </span>
              </div>
            </Link>
          )
        })}
      </div>

      {overflow > 0 ? (
        <div className="border-t border-slate-100 px-5 py-3 text-right">
          <Link
            to="/stories?stage=review"
            className="text-sm font-bold text-primary hover:underline underline-offset-2 inline-flex items-center gap-0.5"
          >
            View all {pieces.length} drafts <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      ) : null}
    </div>
  )
}

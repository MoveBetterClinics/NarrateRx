import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ExternalLink, FileText } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { PLATFORM_META, STATUS_META } from '@/lib/contentMeta'

/**
 * AssetsPane — tabbed list of content pieces for a story.
 *
 * Each tab shows platform + status + draft snippet and a link to the
 * full ReviewPost editor. The full editor remains the canonical edit
 * surface; this pane is read-only navigation.
 */
export default function AssetsPane({ story }) {
  const pieces = story?.pieces ?? []
  const [activeIdx, setActiveIdx] = useState(0)

  if (pieces.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
        No content pieces yet. Generate content from the interview to see it here.
      </div>
    )
  }

  const active = pieces[activeIdx] ?? pieces[0]
  const pm = PLATFORM_META[active?.platform] || { label: active?.platform || 'Unknown', icon: FileText, color: 'text-slate-600', bg: 'bg-slate-100' }
  const sm = STATUS_META[active?.status] || { label: active?.status || '—', color: 'bg-slate-100 text-slate-700' }
  const PlatformIcon = pm.icon

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      {/* Tab row */}
      <div className="flex gap-1 px-3 pt-3 pb-0 overflow-x-auto border-b">
        {pieces.map((piece, i) => {
          const meta = PLATFORM_META[piece.platform] || { label: piece.platform, icon: FileText, color: 'text-slate-600', bg: 'bg-slate-100' }
          const Icon = meta.icon
          const isActive = i === activeIdx
          return (
            <button
              key={piece.id}
              type="button"
              onClick={() => setActiveIdx(i)}
              className={`flex items-center gap-1.5 shrink-0 px-3 py-2 text-xs rounded-t border-b-2 transition-colors ${
                isActive
                  ? 'border-primary text-primary font-medium bg-primary/5'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="h-3 w-3" />
              {meta.label}
            </button>
          )
        })}
      </div>

      {/* Active piece body */}
      <div className="p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className={`flex items-center gap-1.5 px-2 py-1 rounded ${pm.bg}`}>
            <PlatformIcon className={`h-3.5 w-3.5 ${pm.color}`} />
            <span className={`text-xs font-medium ${pm.color}`}>{pm.label}</span>
          </div>
          <Badge className={`text-xs border-0 ${sm.color}`}>{sm.label}</Badge>
          {active?.scheduled_at && (
            <span className="text-xs text-muted-foreground">
              Scheduled {new Date(active.scheduled_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric' })}
            </span>
          )}
        </div>

        {active?.content ? (
          <div className="rounded-md border bg-muted/30 p-3 max-h-64 overflow-y-auto">
            <pre className="text-xs leading-relaxed font-mono whitespace-pre-wrap text-foreground/90 break-words">
              {typeof active.content === 'string' ? active.content.slice(0, 600) : JSON.stringify(active.content, null, 2).slice(0, 600)}
              {(typeof active.content === 'string' ? active.content : JSON.stringify(active.content)).length > 600
                ? '\n…'
                : ''}
            </pre>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground italic">No draft content yet.</p>
        )}

        <div className="flex items-center gap-2 pt-1">
          <Link
            to={`/review/${active?.id}`}
            className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline font-medium"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open for editing
          </Link>
        </div>
      </div>
    </div>
  )
}

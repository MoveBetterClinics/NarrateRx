import { Link } from 'react-router-dom'
import { CheckCircle2, RotateCcw, FileText, Clock, ExternalLink, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useContentItems, queryKeys } from '@/lib/queries'
import { useQueryClient } from '@tanstack/react-query'
import { updateContentItem } from '@/lib/publish'
import { createContentItemComment } from '@/lib/api'
import { useUser } from '@clerk/clerk-react'
import { useUserRole } from '@/lib/useUserRole'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { formatRelativeDate } from '@/lib/utils'
import { PLATFORM_META } from './ContentHub'
import { toast } from '@/lib/toast'

// Review queue surface. Lists every content_item currently in_review across
// the workspace so a reviewer can sweep approvals from one place instead of
// opening each post individually. The detail-edit flow still lives at
// /review/:itemId — this page is the inbox.
//
// Non-reviewers see the page but get a read-only view (no Approve / Request
// Changes buttons). Same data shape, gentler affordances.
export default function ReviewQueue() {
  useDocumentTitle('Review queue')
  const { user } = useUser()
  const { canReview } = useUserRole()
  const qc = useQueryClient()
  const { data: items = [], isLoading, error, refetch } = useContentItems({ status: 'in_review' })

  function invalidate() {
    qc.invalidateQueries({ queryKey: queryKeys.contentItems.all })
  }

  async function approve(item) {
    try {
      await updateContentItem(item.id, {
        status: 'approved',
        reviewedBy: user?.primaryEmailAddress?.emailAddress,
        approvedBy: user?.primaryEmailAddress?.emailAddress,
        approvedAt: new Date().toISOString(),
      })
      invalidate()
      toast.success('Approved')
    } catch (e) {
      toast.error('Approve failed', { description: e.message })
    }
  }

  async function requestChanges(item) {
    const note = window.prompt('Describe the changes you want:')
    if (!note?.trim()) return
    try {
      await createContentItemComment(item.id, {
        body: note,
        kind: 'change_request',
        userId: user?.id,
        userEmail: user?.primaryEmailAddress?.emailAddress,
      })
      await updateContentItem(item.id, { status: 'draft' })
      invalidate()
      toast.success('Sent back to draft with your note')
    } catch (e) {
      toast.error('Request changes failed', { description: e.message })
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Clock className="h-5 w-5 text-amber-600" />
          Review queue
        </h1>
        <p className="text-sm text-muted-foreground">
          {canReview
            ? 'Approve or request changes on content waiting for your review.'
            : 'Content currently awaiting reviewer approval.'}
        </p>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 text-muted-foreground animate-spin" />
        </div>
      )}

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          Could not load review queue: {error.message}
          <Button variant="ghost" size="sm" onClick={() => refetch()} className="ml-2">Retry</Button>
        </div>
      )}

      {!isLoading && !error && items.length === 0 && (
        <div className="rounded-xl border bg-card p-10 text-center space-y-2">
          <CheckCircle2 className="h-6 w-6 text-emerald-600 mx-auto" />
          <p className="text-sm font-medium">Nothing waiting for review</p>
          <p className="text-xs text-muted-foreground">When editors send drafts for review, they&apos;ll land here.</p>
        </div>
      )}

      <div className="space-y-2">
        {items.map((item) => {
          const pm = PLATFORM_META[item.platform] || { label: item.platform, icon: FileText, color: 'text-slate-600', bg: 'bg-slate-50' }
          const Icon = pm.icon
          const snippet = (item.content || '').slice(0, 200)
          return (
            <div key={item.id} className="rounded-xl border bg-card p-4 hover:border-primary/30 transition-colors">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md ${pm.bg} shrink-0`}>
                    <Icon className={`h-3.5 w-3.5 ${pm.color}`} />
                    <span className={`text-xs font-medium ${pm.color}`}>{pm.label}</span>
                  </div>
                  <p className="text-sm font-medium truncate">{item.topic}</p>
                  <Badge className="text-xs bg-amber-100 text-amber-700 border-0 shrink-0">In review</Badge>
                </div>
                <span className="text-xs text-muted-foreground shrink-0">{formatRelativeDate(item.updated_at)}</span>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{snippet}</p>
              <div className="flex items-center gap-1.5">
                <Button variant="ghost" size="sm" asChild className="text-xs">
                  <Link to={`/review/${item.id}`}>
                    <ExternalLink className="h-3 w-3 mr-1" />
                    Open
                  </Link>
                </Button>
                {canReview && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs border-blue-200 text-blue-700 hover:bg-blue-50"
                      onClick={() => approve(item)}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />Approve
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs border-amber-200 text-amber-700 hover:bg-amber-50"
                      onClick={() => requestChanges(item)}
                    >
                      <RotateCcw className="h-3.5 w-3.5 mr-1.5" />Request changes
                    </Button>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

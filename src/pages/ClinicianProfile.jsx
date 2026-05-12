import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useUser } from '@clerk/clerk-react'
import { ArrowLeft, Plus, FileText, Clock, Trash2, ChevronRight, MessageSquare, Loader2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Separator } from '@/components/ui/separator'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { useClinician, useDeleteClinician, useDeleteInterview } from '@/lib/queries'
import { getInitials, formatDate, formatRelativeDate } from '@/lib/utils'
import { toast } from '@/lib/toast'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

export default function ClinicianProfile() {
  useDocumentTitle('Clinician')
  const { clinicianId } = useParams()
  const navigate = useNavigate()
  const { user } = useUser()
  const { data: clinician, isLoading: loading, error: loadError } = useClinician(clinicianId)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteError, setDeleteError] = useState('')

  const deleteClinicianMut = useDeleteClinician()
  const deleteInterviewMut = useDeleteInterview()
  const deleting = deleteClinicianMut.isPending || deleteInterviewMut.isPending

  // 404 (no such clinician) or any load failure bounces back to Dashboard,
  // matching the previous explicit refresh()-throws-navigate behavior.
  useEffect(() => {
    if (!loading && (loadError || clinician === null)) {
      navigate('/')
    }
  }, [loading, loadError, clinician, navigate])

  async function handleDeleteInterview(interviewId) {
    setDeleteError('')
    try {
      await deleteInterviewMut.mutateAsync({ id: interviewId, userId: user.id })
      setDeleteTarget(null)
      // Cache invalidation in useDeleteInterview's onSuccess will refetch
      // the clinician detail automatically — no manual refresh() needed.
    } catch (e) {
      setDeleteError(e.message)
    }
  }

  async function handleDeleteClinician() {
    try {
      await deleteClinicianMut.mutateAsync({ id: clinicianId, userId: user.id })
      toast.success(`Deleted ${clinician?.name || 'clinician'}`)
      navigate('/')
    } catch (e) {
      toast.error('Could not delete clinician', { description: e.message })
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 text-muted-foreground animate-spin" />
      </div>
    )
  }

  if (!clinician) return null

  const interviews = clinician.interviews || []
  const completed = interviews.filter((i) => i.status === 'completed')
  const inProgress = interviews.filter((i) => i.status === 'in_progress')
  const isMyClinicianProfile = clinician.created_by_id === user?.id

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link to="/">
          <ArrowLeft className="h-4 w-4 mr-1.5" />
          Dashboard
        </Link>
      </Button>

      <div className="flex items-center gap-5">
        <Avatar className="h-16 w-16 text-xl">
          <AvatarFallback className="bg-primary/10 text-primary font-bold text-lg">
            {getInitials(clinician.name)}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{clinician.name}</h1>
          <p className="text-sm text-muted-foreground">
            Member since {formatDate(clinician.created_at)} · {interviews.length} interview{interviews.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild size="sm">
            <Link to="/new">
              <Plus className="h-4 w-4 mr-1.5" />
              New Interview
            </Link>
          </Button>
          {isMyClinicianProfile && (
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => setDeleteTarget({ type: 'clinician' })}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      <Separator />

      {interviews.length === 0 ? (
        <div className="text-center py-16">
          <MessageSquare className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">No interviews yet for {clinician.name.split(' ')[0]}.</p>
          <Button asChild size="sm" className="mt-4">
            <Link to="/new">Start First Interview</Link>
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          {inProgress.length > 0 && (
            <section>
              <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">In Progress</h2>
              <div className="space-y-2">
                {inProgress.map((interview) => (
                  <InterviewRow
                    key={interview.id}
                    interview={interview}
                    clinicianId={clinicianId}
                    currentUserId={user?.id}
                    onDelete={() => setDeleteTarget({ type: 'interview', id: interview.id })}
                  />
                ))}
              </div>
            </section>
          )}
          {completed.length > 0 && (
            <section>
              <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Completed</h2>
              <div className="space-y-2">
                {completed.map((interview) => (
                  <InterviewRow
                    key={interview.id}
                    interview={interview}
                    clinicianId={clinicianId}
                    currentUserId={user?.id}
                    onDelete={() => setDeleteTarget({ type: 'interview', id: interview.id })}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      <Dialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) { setDeleteTarget(null); setDeleteError('') } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {deleteTarget?.type === 'clinician' ? 'Delete clinician profile?' : 'Delete interview?'}
            </DialogTitle>
            <DialogDescription>
              {deleteTarget?.type === 'clinician'
                ? `This will permanently delete ${clinician.name}'s profile and all their interviews. This cannot be undone.`
                : 'This will permanently delete this interview and all generated content. This cannot be undone.'}
            </DialogDescription>
          </DialogHeader>
          {deleteError && (
            <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2 mx-1">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />{deleteError}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeleteTarget(null); setDeleteError('') }} disabled={deleting}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={deleting}
              onClick={() =>
                deleteTarget?.type === 'clinician'
                  ? handleDeleteClinician()
                  : handleDeleteInterview(deleteTarget.id)
              }
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function InterviewRow({ interview, clinicianId, currentUserId, onDelete }) {
  const isOwner = interview.owner_id === currentUserId
  const isComplete = interview.status === 'completed'
  const href = isComplete
    ? `/output/${clinicianId}/${interview.id}`
    : `/interview/${clinicianId}/${interview.id}`

  return (
    <Card className="hover:shadow-sm transition-shadow">
      <CardContent className="p-4 flex items-center gap-4">
        <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
          {isComplete ? (
            <FileText className="h-4 w-4 text-primary" />
          ) : (
            <Clock className="h-4 w-4 text-amber-500" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm truncate" title={interview.topic}>{interview.topic}</p>
          <p className="text-xs text-muted-foreground">
            {formatRelativeDate(interview.updated_at)}
            {!isOwner && <span className="ml-2 text-muted-foreground/60">· by {interview.owner_email?.split('@')[0]}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge
            variant={isComplete ? 'secondary' : 'outline'}
            className={`text-xs ${!isComplete ? 'border-amber-300 text-amber-700' : ''}`}
          >
            {isComplete ? 'Content ready' : 'In progress'}
          </Badge>
          <Button asChild variant="ghost" size="icon" className="h-8 w-8">
            <Link to={href}>
              <ChevronRight className="h-4 w-4" />
            </Link>
          </Button>
          {isOwner && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              onClick={onDelete}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

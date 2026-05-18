import { useState } from 'react'
import { Link } from 'react-router-dom'
import { PlayCircle, ChevronRight } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { getInitials, formatRelativeDate } from '@/lib/utils'
import { resolveOwnerName } from './helpers'

const RESUME_INITIAL_CAP = 6

// Amber strip of in-progress interviews within the resume window.
// Props:
//   interviews     — array from Dashboard/Home's resumeInterviews memo
//   currentUserId  — Clerk user.id for ownership check
//   clinicians     — workspace clinicians (used to resolve owner_id → name)
export default function ResumeStrip({ interviews, currentUserId, clinicians = [] }) {
  const [showAll, setShowAll] = useState(false)
  const visible = showAll ? interviews : interviews.slice(0, RESUME_INITIAL_CAP)
  const hiddenCount = interviews.length - RESUME_INITIAL_CAP

  if (!interviews || interviews.length === 0) return null

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <PlayCircle className="h-3.5 w-3.5 text-primary" />
        <p className="text-xs font-medium uppercase tracking-wider text-foreground">
          In progress — pick up where you left off
        </p>
        <span className="text-xs text-muted-foreground">{interviews.length} active</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {visible.map((i) => (
          <ResumeCard key={i.id} interview={i} currentUserId={currentUserId} clinicians={clinicians} />
        ))}
      </div>
      {hiddenCount > 0 && !showAll && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="mt-3 text-xs font-medium text-primary hover:underline"
        >
          View all {interviews.length} in-progress interviews →
        </button>
      )}
      {showAll && hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(false)}
          className="mt-3 text-xs font-medium text-muted-foreground hover:text-foreground hover:underline"
        >
          Show fewer
        </button>
      )}
    </div>
  )
}

function ResumeCard({ interview, currentUserId, clinicians }) {
  const isOwner = interview.owner_id === currentUserId
  const href = isOwner
    ? `/interview/${interview.clinicianId}/${interview.id}`
    : `/clinician/${interview.clinicianId}`
  // Owner attribution only renders when (a) we're not the owner and (b)
  // resolveOwnerName produced a real name (clinician.name preferred, then
  // dot-separated email; otherwise null → no suffix).
  const ownerName = !isOwner ? resolveOwnerName(interview, clinicians) : null

  return (
    <Link
      to={href}
      className="block rounded-xl border-2 border-primary/20 bg-primary/5 p-3.5 hover:border-primary/35 hover:bg-primary/10 transition-colors"
    >
      <div className="flex items-center gap-2 mb-1.5">
        <Avatar className="h-6 w-6">
          <AvatarFallback className="bg-primary/10 text-primary text-3xs font-semibold">
            {getInitials(interview.clinicianName)}
          </AvatarFallback>
        </Avatar>
        <p
          className="text-xs font-medium text-foreground/80 truncate"
          title={interview.clinicianName}
        >
          {interview.clinicianName}
        </p>
      </div>
      <p className="text-sm font-semibold text-foreground truncate" title={interview.topic}>
        {interview.topic}
      </p>
      <p className="text-2xs text-muted-foreground mt-0.5">
        Updated {formatRelativeDate(interview.updated_at)}
        {ownerName ? ` · by ${ownerName}` : ''}
      </p>
      <div className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary">
        Resume
        <ChevronRight className="h-3 w-3" />
      </div>
    </Link>
  )
}

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { PlayCircle, ChevronRight } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { getInitials, formatRelativeDate } from '@/lib/utils'
import { formatInterviewerName } from './helpers'

const RESUME_INITIAL_CAP = 6

// Amber strip of in-progress interviews within the resume window.
// Props:
//   interviews     — array from Dashboard/Home's resumeInterviews memo
//   currentUserId  — Clerk user.id for ownership check
export default function ResumeStrip({ interviews, currentUserId }) {
  const [showAll, setShowAll] = useState(false)
  const visible = showAll ? interviews : interviews.slice(0, RESUME_INITIAL_CAP)
  const hiddenCount = interviews.length - RESUME_INITIAL_CAP

  if (!interviews || interviews.length === 0) return null

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <PlayCircle className="h-3.5 w-3.5 text-amber-600" />
        <p className="text-xs font-medium uppercase tracking-wider text-amber-800">
          In progress — pick up where you left off
        </p>
        <span className="text-xs text-muted-foreground">{interviews.length} active</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {visible.map((i) => (
          <ResumeCard key={i.id} interview={i} currentUserId={currentUserId} />
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

function ResumeCard({ interview, currentUserId }) {
  const isOwner = interview.owner_id === currentUserId
  const href = isOwner
    ? `/interview/${interview.clinicianId}/${interview.id}`
    : `/clinician/${interview.clinicianId}`

  return (
    <Link
      to={href}
      className="block rounded-xl border-2 border-amber-200 bg-amber-50/50 p-3.5 hover:border-amber-300 hover:bg-amber-50 transition-colors"
    >
      <div className="flex items-center gap-2 mb-1.5">
        <Avatar className="h-6 w-6">
          <AvatarFallback className="bg-primary/10 text-primary text-[10px] font-semibold">
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
      <p className="text-sm font-semibold text-amber-900 truncate" title={interview.topic}>
        {interview.topic}
      </p>
      <p className="text-[11px] text-amber-700/80 mt-0.5">
        Updated {formatRelativeDate(interview.updated_at)}
        {!isOwner && interview.owner_email
          ? ` · by ${formatInterviewerName(interview.owner_email)}`
          : ''}
      </p>
      <div className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary">
        Resume
        <ChevronRight className="h-3 w-3" />
      </div>
    </Link>
  )
}

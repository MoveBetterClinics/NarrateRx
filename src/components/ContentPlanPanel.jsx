import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, Sparkles, SkipForward, RotateCcw, ExternalLink, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import IconPrim from '@/components/ui/Icon'
import { useContentPlanAtoms, useDraftAtom, useSkipAtom } from '@/lib/queries'
import { ATOM_DEFINITIONS, PLATFORM_UI, SLOT_LABELS, formatSlotDate } from '@/lib/atomPlan'

// ContentPlanPanel renders the full 4-week content plan for an interview.
// Atoms are grouped by platform; each shows its angle, suggested week, and
// current status. "Draft this" calls the AI on demand; "Skip" dismisses it.
export default function ContentPlanPanel({ interviewId, interviewCreatedAt, onSelectPiece }) {
  const { data: atoms = [], isLoading } = useContentPlanAtoms(interviewId)
  const draftMutation  = useDraftAtom()
  const skipMutation   = useSkipAtom()
  const [collapsed, setCollapsed] = useState({})
  const [draftingId, setDraftingId] = useState(null)
  const [errorMap, setErrorMap]   = useState({})

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10">
        <IconPrim as={Loader2} size="lg" className="text-muted-foreground animate-spin" />
      </div>
    )
  }

  if (!atoms.length) return null

  // Group atoms by platform, preserving ATOM_DEFINITIONS order
  const byPlatform = {}
  for (const platform of Object.keys(ATOM_DEFINITIONS)) {
    const platformAtoms = atoms.filter((a) => a.platform === platform)
    if (platformAtoms.length) byPlatform[platform] = platformAtoms
  }

  const isAtomPublished = (a) => a.status === 'drafted' && !!a.content_piece?.published_at
  const isAtomApproved  = (a) => a.status === 'drafted' && !isAtomPublished(a) && a.content_piece?.status === 'approved'
  const totalAtoms     = atoms.length
  const publishedCount = atoms.filter(isAtomPublished).length
  const approvedCount  = atoms.filter(isAtomApproved).length
  const draftedCount   = atoms.filter((a) => a.status === 'drafted' && !isAtomPublished(a) && !isAtomApproved(a)).length
  const skippedCount   = atoms.filter((a) => a.status === 'skipped').length
  const pendingCount   = totalAtoms - publishedCount - approvedCount - draftedCount - skippedCount

  async function handleDraft(atom) {
    setDraftingId(atom.id)
    setErrorMap((prev) => ({ ...prev, [atom.id]: null }))
    try {
      await draftMutation.mutateAsync({ atomId: atom.id, interviewId })
    } catch (e) {
      setErrorMap((prev) => ({ ...prev, [atom.id]: e.message || 'Generation failed' }))
    } finally {
      setDraftingId(null)
    }
  }

  async function handleSkip(atom) {
    await skipMutation.mutateAsync({ atomId: atom.id, status: 'skipped', interviewId })
  }

  async function handleReset(atom) {
    await skipMutation.mutateAsync({ atomId: atom.id, status: 'pending', interviewId })
  }

  function toggleCollapse(platform) {
    setCollapsed((prev) => ({ ...prev, [platform]: !prev[platform] }))
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">Content Plan</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {totalAtoms} atoms across {Object.keys(byPlatform).length} platforms — drafts auto-schedule to the week shown so they trickle out over 4 weeks.
          </p>
        </div>
        <div className="flex gap-2 text-xs text-muted-foreground shrink-0">
          {publishedCount > 0 && <span className="text-blue-700 font-medium">{publishedCount} published</span>}
          {approvedCount > 0 && <span className="text-primary font-medium">{approvedCount} approved</span>}
          {draftedCount > 0 && <span className="text-green-700 font-medium">{draftedCount} drafted</span>}
          {pendingCount > 0 && <span>{pendingCount} pending</span>}
          {skippedCount > 0 && <span className="text-muted-foreground">{skippedCount} skipped</span>}
        </div>
      </div>

      {/* Platform groups */}
      {Object.entries(byPlatform).map(([platform, platformAtoms]) => {
        const ui = PLATFORM_UI[platform]
        if (!ui) return null
        const Icon = ui.icon
        const isCollapsed = collapsed[platform]
        const allDrafted = platformAtoms.every((a) => a.status === 'drafted')
        const allPublished = platformAtoms.every(isAtomPublished)

        return (
          <div key={platform} className={`rounded-xl border ${ui.border} overflow-hidden`}>
            {/* Platform header */}
            <button
              onClick={() => toggleCollapse(platform)}
              className={`w-full flex items-center justify-between px-4 py-3 ${ui.bg} hover:opacity-90 transition-opacity`}
            >
              <div className="flex items-center gap-2">
                <Icon className={`h-4 w-4 ${ui.color}`} />
                <span className={`text-sm font-medium ${ui.color}`}>{ui.label}</span>
                <span className="text-xs text-muted-foreground">
                  {platformAtoms.length} {platformAtoms.length === 1 ? 'post' : 'posts'}
                </span>
                {allDrafted && (
                  <IconPrim as={CheckCircle2} size="sm" className={allPublished ? 'text-blue-600' : 'text-green-600'} />
                )}
              </div>
              {isCollapsed ? (
                <IconPrim as={ChevronDown} size="md" className="text-muted-foreground" />
              ) : (
                <IconPrim as={ChevronUp} size="md" className="text-muted-foreground" />
              )}
            </button>

            {/* Atom rows */}
            {!isCollapsed && (
              <div className="divide-y">
                {platformAtoms.map((atom) => {
                  const isDrafting = draftingId === atom.id
                  const atomError = errorMap[atom.id]
                  const slotLabel = SLOT_LABELS[(atom.slot ?? 1) - 1] ?? `Week ${atom.slot}`
                  const dateHint  = interviewCreatedAt
                    ? formatSlotDate(interviewCreatedAt, atom.slot)
                    : null

                  return (
                    <AtomRow
                      key={atom.id}
                      atom={atom}
                      interviewId={interviewId}
                      slotLabel={slotLabel}
                      dateHint={dateHint}
                      isDrafting={isDrafting}
                      error={atomError}
                      onDraft={() => handleDraft(atom)}
                      onSkip={() => handleSkip(atom)}
                      onReset={() => handleReset(atom)}
                      onSelectPiece={onSelectPiece}
                    />
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function AtomRow({ atom, interviewId, slotLabel, dateHint, isDrafting, error, onDraft, onSkip, onReset, onSelectPiece }) {
  const isSkipped = atom.status === 'skipped'
  const isDrafted = atom.status === 'drafted'
  const publishedAt = atom.content_piece?.published_at
  const pieceStatus = atom.content_piece?.status
  const isPublished = isDrafted && !!publishedAt
  const isApproved  = isDrafted && !isPublished && pieceStatus === 'approved'
  const publishedDateLabel = publishedAt
    ? new Date(publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : null

  return (
    <div className={`px-4 py-3 flex items-start justify-between gap-3 ${isSkipped ? 'opacity-40' : ''}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium">{atom.angle_label}</span>
          <Badge variant="outline" className="text-xs px-1.5 py-0 font-normal text-muted-foreground">
            {slotLabel}{dateHint ? ` · ${dateHint}` : ''}
          </Badge>
          {isPublished ? (
            <Badge className="text-xs bg-blue-100 text-blue-700 border-0 px-1.5 py-0">
              Published{publishedDateLabel ? ` · ${publishedDateLabel}` : ''}
            </Badge>
          ) : isApproved ? (
            <Badge className="text-xs bg-primary/15 text-primary border-0 px-1.5 py-0">
              Approved · add media
            </Badge>
          ) : isDrafted && (
            <Badge className="text-xs bg-green-100 text-green-700 border-0 px-1.5 py-0">
              Drafted · scheduled {dateHint || `Week ${atom.slot}`}
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{atom.angle_description}</p>
        {error && <p className="text-xs text-destructive mt-1">{error}</p>}
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {isDrafted ? (
          onSelectPiece ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => onSelectPiece(atom.content_piece_id)}
            >
              {isPublished ? 'View post' : 'View draft'}
            </Button>
          ) : (
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" asChild>
              <Link
                to={
                  interviewId
                    ? `/stories/${interviewId}${atom.content_piece_id ? `?piece=${atom.content_piece_id}` : ''}`
                    : `/stories/${atom.content_piece_id}`
                }
              >
                {isPublished ? 'View post' : 'View draft'}
                <IconPrim as={ExternalLink} size="xs" />
              </Link>
            </Button>
          )
        ) : isSkipped ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={onReset}
          >
            <IconPrim as={RotateCcw} size="xs" />
            Restore
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              className="h-7 text-xs gap-1"
              disabled={isDrafting}
              onClick={onDraft}
            >
              {isDrafting ? (
                <><IconPrim as={Loader2} size="xs" className="animate-spin" />Drafting…</>
              ) : (
                <><IconPrim as={Sparkles} size="xs" />Draft this</>
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground"
              title="Skip"
              onClick={onSkip}
            >
              <IconPrim as={SkipForward} size="sm" />
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

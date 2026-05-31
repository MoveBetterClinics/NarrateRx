import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, Sparkles, SkipForward, RotateCcw, ExternalLink, CheckCircle2, ChevronDown, ChevronUp, Star, ArrowDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import IconPrim from '@/components/ui/Icon'
import { useContentPlanAtoms, useDraftAtom, useSkipAtom, useKeystoneBlog } from '@/lib/queries'
import { ATOM_DEFINITIONS, PLATFORM_UI, SLOT_LABELS, formatSlotDate } from '@/lib/atomPlan'

// ContentPlanPanel renders the full 4-week content plan for an interview.
// Atoms are grouped by platform; each shows its angle, suggested week, and
// current status. "Draft this" calls the AI on demand; "Skip" dismisses it.
export default function ContentPlanPanel({ interviewId, interviewCreatedAt, onSelectPiece }) {
  const { data: atoms = [], isLoading } = useContentPlanAtoms(interviewId)
  const { data: keystone = null }       = useKeystoneBlog(interviewId)
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

  const isAtomPublished  = (a) => a.status === 'drafted' && !!a.content_piece?.published_at
  const isAtomScheduled  = (a) => a.status === 'drafted' && !isAtomPublished(a) && a.content_piece?.status === 'scheduled'
  const isAtomApproved   = (a) => a.status === 'drafted' && !isAtomPublished(a) && !isAtomScheduled(a) && a.content_piece?.status === 'approved'
  const totalAtoms      = atoms.length
  const publishedCount  = atoms.filter(isAtomPublished).length
  const scheduledCount  = atoms.filter(isAtomScheduled).length
  const approvedCount   = atoms.filter(isAtomApproved).length
  const draftedCount    = atoms.filter((a) => a.status === 'drafted' && !isAtomPublished(a) && !isAtomScheduled(a) && !isAtomApproved(a)).length
  const skippedCount    = atoms.filter((a) => a.status === 'skipped').length
  const pendingCount    = totalAtoms - publishedCount - scheduledCount - approvedCount - draftedCount - skippedCount

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

  const platformDerivedCounts = Object.entries(byPlatform).map(([platform, list]) => ({
    platform,
    label: PLATFORM_UI[platform]?.label ?? platform,
    count: list.length,
  }))

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">Content Plan</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {keystone ? '1 keystone + ' : ''}{totalAtoms} atoms across {Object.keys(byPlatform).length} platforms — drafts auto-schedule to the week shown so they trickle out over 4 weeks.
          </p>
        </div>
        <div className="flex gap-2 text-xs text-muted-foreground shrink-0">
          {publishedCount > 0 && <span className="text-blue-700 font-medium">{publishedCount} published</span>}
          {scheduledCount > 0 && <span className="text-orange-600 font-medium">{scheduledCount} scheduled</span>}
          {approvedCount > 0 && <span className="text-primary font-medium">{approvedCount} approved</span>}
          {draftedCount > 0 && <span className="text-green-700 font-medium">{draftedCount} drafted</span>}
          {pendingCount > 0 && <span>{pendingCount} pending</span>}
          {skippedCount > 0 && <span className="text-muted-foreground">{skippedCount} skipped</span>}
        </div>
      </div>

      {/* Keystone hero — the long-form blog the atoms derive from. */}
      {keystone && (
        <KeystoneHeroCard
          keystone={keystone}
          derivedCounts={platformDerivedCounts}
          interviewId={interviewId}
          onSelectPiece={onSelectPiece}
        />
      )}

      {/* Platform groups */}
      {Object.entries(byPlatform).map(([platform, platformAtoms]) => {
        const ui = PLATFORM_UI[platform]
        if (!ui) return null
        const Icon = ui.icon
        const isCollapsed = collapsed[platform]
        const allDrafted = platformAtoms.every((a) => a.status === 'drafted')
        const allPublished = platformAtoms.every((a) => isAtomPublished(a) || isAtomScheduled(a))

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

function KeystoneHeroCard({ keystone, derivedCounts, interviewId, onSelectPiece }) {
  const isPublished = keystone.status === 'published' && !!keystone.published_at
  const isApproved  = !isPublished && keystone.status === 'approved'
  const publishedDateLabel = keystone.published_at
    ? new Date(keystone.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : null

  const previewText = extractKeystonePreview(keystone.content)
  const hostname    = keystone.resolved_url ? safeHostname(keystone.resolved_url) : null

  const actionLabel = isPublished ? 'View post' : 'View draft'

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 shadow-[0_8px_24px_-12px_rgba(47,95,255,0.25)] overflow-hidden">
      {/* Header band */}
      <div className="px-5 pt-4 pb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <IconPrim as={Star} size="sm" className="text-primary fill-primary" />
          <span className="text-xs font-semibold tracking-wide uppercase text-primary">Keystone</span>
          <span className="text-xs text-muted-foreground">· Long-form source piece</span>
        </div>
        {isPublished ? (
          <Badge className="text-xs bg-blue-100 text-blue-700 border-0 px-1.5 py-0">
            Published{publishedDateLabel ? ` · ${publishedDateLabel}` : ''}
          </Badge>
        ) : isApproved ? (
          <Badge className="text-xs bg-primary/15 text-primary border-0 px-1.5 py-0">
            Approved
          </Badge>
        ) : (
          <Badge className="text-xs bg-green-100 text-green-700 border-0 px-1.5 py-0">
            Drafted
          </Badge>
        )}
      </div>

      {/* Body */}
      <div className="px-5 pb-4 flex items-end justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-semibold leading-snug">{keystone.topic || 'Untitled blog post'}</h3>
          {previewText && (
            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{previewText}</p>
          )}

          {derivedCounts.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className="text-muted-foreground">Derived:</span>
              {derivedCounts.map(({ platform, label, count }) => {
                const ui = PLATFORM_UI[platform]
                return (
                  <span key={platform} className="inline-flex items-center gap-1 text-foreground/80">
                    <span className={`h-1.5 w-1.5 rounded-full ${ui?.dot ?? 'bg-muted-foreground'}`} />
                    {count} {label}
                  </span>
                )
              })}
            </div>
          )}
        </div>

        <div className="flex flex-col items-end gap-1 shrink-0">
          {onSelectPiece ? (
            <Button
              size="sm"
              className="h-8 text-xs gap-1"
              onClick={() => onSelectPiece(keystone.id)}
            >
              {actionLabel}
            </Button>
          ) : (
            <Button size="sm" className="h-8 text-xs gap-1" asChild>
              <Link to={interviewId ? `/stories/${interviewId}?piece=${keystone.id}` : `/stories/${keystone.id}`}>
                {actionLabel}
                <IconPrim as={ExternalLink} size="xs" />
              </Link>
            </Button>
          )}
          {isPublished && hostname && (
            <span className="text-2xs text-muted-foreground">on {hostname}</span>
          )}
        </div>
      </div>

      {/* Connector hint */}
      <div className="px-5 pb-3 -mt-1 flex items-center gap-1.5 text-2xs text-primary/80">
        <IconPrim as={ArrowDown} size="xs" />
        Feeds the atoms below
      </div>
    </div>
  )
}

function extractKeystonePreview(markdown) {
  if (!markdown || typeof markdown !== 'string') return null
  // Strip markdown headings, bold/italic markers, and link syntax for a clean preview.
  const stripped = markdown
    .replace(/^#+\s+.*$/gm, '')           // drop heading lines
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // drop image syntax
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // unwrap [text](url)
    .replace(/[*_`>#]/g, '')              // drop common markdown punctuation
    .replace(/\s+/g, ' ')
    .trim()
  return stripped.slice(0, 260)
}

function safeHostname(url) {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return null }
}

function AtomRow({ atom, interviewId, slotLabel, dateHint, isDrafting, error, onDraft, onSkip, onReset, onSelectPiece }) {
  const isSkipped = atom.status === 'skipped'
  const isDrafted = atom.status === 'drafted'
  const publishedAt  = atom.content_piece?.published_at
  const scheduledAt  = atom.content_piece?.scheduled_at
  const pieceStatus  = atom.content_piece?.status
  const isPublished  = isDrafted && !!publishedAt
  const isScheduled  = isDrafted && !isPublished && pieceStatus === 'scheduled'
  const isApproved   = isDrafted && !isPublished && !isScheduled && pieceStatus === 'approved'
  const publishedDateLabel = publishedAt
    ? new Date(publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : null
  const scheduledDateLabel = scheduledAt
    ? new Date(scheduledAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : dateHint

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
          ) : isScheduled ? (
            <Badge className="text-xs bg-orange-100 text-orange-700 border-0 px-1.5 py-0">
              Scheduled{scheduledDateLabel ? ` · ${scheduledDateLabel}` : ''}
            </Badge>
          ) : isApproved ? (
            <Badge className="text-xs bg-primary/15 text-primary border-0 px-1.5 py-0">
              Approved · add media
            </Badge>
          ) : isDrafted && (
            <Badge className="text-xs bg-green-100 text-green-700 border-0 px-1.5 py-0">
              Drafted · {scheduledAt ? `scheduled ${new Date(scheduledAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : `scheduled ${dateHint || `Week ${atom.slot}`}`}
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
              {isPublished ? 'View post' : isScheduled ? 'View scheduled' : 'View draft'}
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
                {isPublished ? 'View post' : isScheduled ? 'View scheduled' : 'View draft'}
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

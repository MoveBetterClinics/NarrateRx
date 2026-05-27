import { useState, useEffect } from 'react'
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom'
import { useUser } from '@clerk/react'
import {
  Plus, FileText, Clock, Trash2, ChevronRight, MessageSquare, Loader2, AlertCircle,
  Facebook, Instagram, Globe, Mail, BookOpen, TrendingUp, Star,
  Smartphone, Copy, Check, RotateCw, Sparkles,
} from 'lucide-react'
import LoadingState from '@/components/LoadingState'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ClinicianChip } from '@/components/ClinicianChip'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import {
  useClinician, useClinicianSummaries, useDeleteClinician, useDeleteInterview,
  useClinicianRecipes, usePatchClinicianRecipe, useDeleteClinicianRecipe,
  usePatchClinician,
} from '@/lib/queries'
import { resolveOwnerName } from '@/components/home/helpers'
import { resolveAudienceSlot, resolveStoryTypeSlot } from '@/lib/interviewOptionsCatalog'
import { getCleanupLevel } from '@/lib/cleanupLevels'
import VoiceNotesPanel from '@/components/VoiceNotesPanel'
import VoiceFreshnessCard from '@/components/VoiceFreshnessCard'
import VoicePlaybackCard from '@/components/VoicePlaybackCard'
import VoiceCloneCard from '@/components/VoiceCloneCard'
import { DisplayNameCard } from '@/components/DisplayNameCard'
import { ClinicianCampaignCard } from '@/components/ClinicianCampaignCard'
import { formatDate, formatRelativeDate } from '@/lib/utils'
import { toast } from '@/lib/toast'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { useUserRole } from '@/lib/useUserRole'
import { fetchClinicianArc, apiFetch } from '@/lib/api'
import { useAppMutation } from '@/lib/useAppMutation'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { TONES, getVoiceModes } from '@/lib/prompts'

// ── Speed helpers ──────────────────────────────────────────────────────────────

const SPEED_MIN = 0.7
const SPEED_MAX = 1.2
const SPEED_DEFAULT = 1.0

function speedPct(speed) {
  return ((speed - SPEED_MIN) / (SPEED_MAX - SPEED_MIN)) * 100
}

function speedLabel(speed) {
  if (speed < 0.95) return 'Calm'
  if (speed > 1.05) return 'Crisp'
  return 'Default'
}

function fmtSpeed(n) {
  return n.toFixed(2).replace(/\.?0+$/, '') + '×'
}

// Phrase count → strength label
function phraseStrength(total) {
  if (total >= 20) return 'Strong'
  if (total >= 10) return 'Growing'
  if (total > 0) return 'Early'
  return null
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function ClinicianProfile() {
  useDocumentTitle('Clinician')
  const { clinicianId } = useParams()
  const navigate = useNavigate()
  const { user } = useUser()
  const { role } = useUserRole()
  const { data: clinician, isLoading: loading, error: loadError } = useClinician(clinicianId)
  const { data: clinicians = [] } = useClinicianSummaries()

  // Initial tab can be deep-linked via ?tab=voice|settings|activity. Used by
  // /settings/voice-training success path so users land directly on the
  // Voice tab and see their new clone.
  const [searchParams] = useSearchParams()
  const initialTab = (() => {
    const t = searchParams.get('tab')
    return t === 'voice' || t === 'settings' ? t : 'activity'
  })()
  const [activeTab, setActiveTab] = useState(initialTab)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteError, setDeleteError] = useState('')
  const [arc, setArc] = useState(null)
  const [voiceData, setVoiceData] = useState(null)

  const deleteClinicianMut = useDeleteClinician()
  const deleteInterviewMut = useDeleteInterview()
  const deleting = deleteClinicianMut.isPending || deleteInterviewMut.isPending

  useEffect(() => {
    if (!loading && (loadError || clinician === null)) navigate('/')
  }, [loading, loadError, clinician, navigate])

  useEffect(() => {
    if (!clinician) return
    const isOwner = clinician.created_by_id === user?.id
    if (!isOwner && role !== 'admin') return
    fetchClinicianArc(clinicianId, clinician.interviews || [])
      .then(setArc)
      .catch(() => {})
  }, [clinician, clinicianId, user?.id, role])

  // Fetch voice-phrases for the hero ring + phrase preview.
  useEffect(() => {
    if (!clinician?.id) return
    apiFetch(`/api/clinicians/voice-phrases?clinician_id=${clinician.id}&limit=6`)
      .then(setVoiceData)
      .catch(() => {})
  }, [clinician?.id])

  async function handleDeleteInterview(interviewId) {
    setDeleteError('')
    try {
      await deleteInterviewMut.mutateAsync({ id: interviewId })
      setDeleteTarget(null)
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

  if (loading) return <LoadingState />
  if (!clinician) return null

  const interviews = clinician.interviews || []
  const completed = interviews.filter((i) => i.status === 'completed')
  const inProgress = interviews.filter((i) => i.status === 'in_progress')
  const isMyClinicianProfile = clinician.created_by_id === user?.id
  const showArc = isMyClinicianProfile || role === 'admin'

  // Voice hero data
  const speed = clinician?.tts_settings?.speed ?? SPEED_DEFAULT
  const totalPhrases = voiceData?.total_phrases ?? 0
  const topPhrases = voiceData?.phrases ?? []
  const pieceCount = voiceData?.pieces_count ?? 0
  const strength = phraseStrength(totalPhrases)
  const ringPct = Math.min(1, totalPhrases / 25)
  // SVG donut: r=42, circumference = 2π×42 ≈ 263.9
  const CIRC = 263.9
  const ringDash = CIRC * ringPct

  // Escape the outer container's py-8 + px-6 so we control all spacing
  return (
    <div className="-mt-8 -mx-6">

      {/* ── Sticky profile header ──────────────────────────────────── */}
      <div className="sticky top-14 z-30 bg-white border-b border-border">
        <div className="px-6 pt-5 pb-0">

          {/* Identity row */}
          <div className="flex items-center gap-4 mb-3 flex-wrap sm:flex-nowrap">
            <ClinicianChip id={clinician.id} name={clinician.name} size="xl" />
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-bold leading-tight truncate">{clinician.name}</h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                Member since {formatDate(clinician.created_at)}
              </p>
            </div>

            {/* Stat chips — hidden on mobile to keep the header compact */}
            <div className="hidden md:flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-muted/50 border border-border rounded-full text-xs text-muted-foreground">
                <strong className="text-foreground font-semibold">{interviews.length}</strong> interview{interviews.length !== 1 ? 's' : ''}
              </span>
              {arc?.stats?.posts > 0 && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-muted/50 border border-border rounded-full text-xs text-muted-foreground">
                  <strong className="text-foreground font-semibold">{arc.stats.posts}</strong> posts
                </span>
              )}
              {arc?.stats?.streak > 0 && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-orange-50 border border-orange-200 rounded-full text-xs text-orange-700">
                  🔥 <strong className="font-semibold">{arc.stats.streak}-wk</strong> streak
                </span>
              )}
              {inProgress.length > 0 && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-50 border border-emerald-200 rounded-full text-xs text-emerald-700">
                  <strong className="font-semibold">{inProgress.length}</strong> in progress
                </span>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-2 shrink-0">
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

          {/* Tab bar */}
          <div className="flex" role="tablist">
            <ProfileTab active={activeTab === 'activity'} onClick={() => setActiveTab('activity')}>
              Activity
              {inProgress.length > 0 && (
                <span className="ml-1.5 text-3xs font-bold px-1.5 py-px rounded-full bg-primary text-primary-foreground leading-none">
                  {inProgress.length}
                </span>
              )}
            </ProfileTab>

            <ProfileTab active={activeTab === 'voice'} onClick={() => setActiveTab('voice')}>
              {/* Mini ring reflecting voice strength */}
              <svg width="14" height="14" viewBox="0 0 14 14" className="shrink-0 -ml-0.5" aria-hidden>
                <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2" />
                {ringPct > 0 && (
                  <circle
                    cx="7" cy="7" r="5" fill="none"
                    stroke={activeTab === 'voice' ? 'hsl(var(--primary))' : '#c2410c'}
                    strokeWidth="2"
                    strokeDasharray={`${31.4 * ringPct} 31.4`}
                    strokeLinecap="round"
                    transform="rotate(-90 7 7)"
                  />
                )}
              </svg>
              Voice
              {strength && (
                <span className={`ml-1 text-3xs font-semibold px-1.5 py-px rounded-full leading-none ${
                  activeTab === 'voice'
                    ? 'bg-primary/10 text-primary'
                    : 'bg-emerald-100 text-emerald-700'
                }`}>
                  {strength}
                </span>
              )}
            </ProfileTab>

            <ProfileTab active={activeTab === 'settings'} onClick={() => setActiveTab('settings')}>
              Settings
            </ProfileTab>
          </div>
        </div>
      </div>

      {/* ── Activity tab ──────────────────────────────────────────── */}
      {activeTab === 'activity' && (
        <div className="px-6 py-6 space-y-8">
          {interviews.length === 0 ? (
            <div className="text-center py-16">
              <MessageSquare className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground text-sm">No interviews yet for {clinician.name.split(' ')[0]}.</p>
              <Button asChild size="sm" className="mt-4">
                <Link to="/new">Start First Interview</Link>
              </Button>
            </div>
          ) : (
            <>
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
                        clinicians={clinicians}
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
                        clinicians={clinicians}
                        onDelete={() => setDeleteTarget({ type: 'interview', id: interview.id })}
                      />
                    ))}
                  </div>
                </section>
              )}
            </>
          )}

          {/* Published posts from arc */}
          {showArc && arc?.recentPosts?.length > 0 && (
            <section>
              <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Published from this voice</h2>
              <div className="space-y-2">
                {arc.recentPosts.map((post) => (
                  <PublishedPostRow key={post.id} post={post} />
                ))}
              </div>
            </section>
          )}

          {/* Standout quote */}
          {showArc && arc?.standoutQuote && (
            <section>
              <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Standout quote</h2>
              <blockquote className="border-l-4 border-primary pl-4 py-1 space-y-1">
                <p className="text-sm italic text-foreground leading-relaxed">
                  &ldquo;{arc.standoutQuote.text}&rdquo;
                </p>
                <footer className="text-xs text-muted-foreground">
                  — {clinician.name.split(' ')[0]}
                  {arc.standoutQuote.interviewTopic && (
                    <span className="ml-1 text-muted-foreground/60">· {arc.standoutQuote.interviewTopic}</span>
                  )}
                </footer>
              </blockquote>
            </section>
          )}
        </div>
      )}

      {/* ── Voice tab ─────────────────────────────────────────────── */}
      {activeTab === 'voice' && (
        <div>
          {/* Dark hero — full bleed across container */}
          <div
            className="relative overflow-hidden"
            style={{ background: 'linear-gradient(135deg, #1e1a16 0%, #2c1e0f 55%, #1a1510 100%)' }}
          >
            {/* Subtle waveform texture at bottom */}
            <div
              aria-hidden
              className="absolute bottom-0 left-0 right-0 h-10 opacity-[0.12]"
              style={{
                background: 'repeating-linear-gradient(90deg, rgba(194,65,12,.4) 0, rgba(194,65,12,.4) 2px, transparent 2px, transparent 22px)',
                maskImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 300 40'%3E%3Cpath d='M0 28 Q15 6 30 22 Q45 38 60 14 Q75 3 90 26 Q105 40 120 16 Q135 5 150 30 Q165 42 180 18 Q195 6 210 28 Q225 42 240 16 Q255 5 270 30 Q285 44 300 20 L300 40 L0 40Z' fill='white'/%3E%3C/svg%3E\")",
                maskSize: '300px 40px',
                maskRepeat: 'repeat-x',
              }}
            />

            <div className="px-6 py-8">
              {/* Responsive grid: stack on mobile, 3-col on lg */}
              <div className="grid grid-cols-1 md:grid-cols-[130px_1fr] lg:grid-cols-[130px_1fr_1fr] gap-6 lg:gap-8 items-start">

                {/* ── Col 1: Donut ring ── */}
                <div className="flex flex-col items-center gap-3">
                  <svg width="110" height="110" viewBox="0 0 110 110" aria-label={`Voice strength: ${Math.round(ringPct * 100)}%`}>
                    {/* Track */}
                    <circle cx="55" cy="55" r="42" fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="9" />
                    {/* Arc */}
                    {ringPct > 0 && (
                      <circle
                        cx="55" cy="55" r="42" fill="none"
                        stroke="#c2410c" strokeWidth="9"
                        strokeDasharray={`${ringDash} ${CIRC}`}
                        strokeDashoffset="0"
                        strokeLinecap="round"
                        transform="rotate(-90 55 55)"
                      />
                    )}
                    {/* Trailing glow */}
                    {ringPct > 0 && (
                      <circle
                        cx="55" cy="55" r="42" fill="none"
                        stroke="rgba(194,65,12,0.20)" strokeWidth="9"
                        strokeDasharray={`${CIRC - ringDash} ${CIRC}`}
                        strokeDashoffset={`${-ringDash}`}
                        strokeLinecap="round"
                        transform="rotate(-90 55 55)"
                      />
                    )}
                    <text x="55" y="50" textAnchor="middle" fontSize="20" fontWeight="700" fill="white">
                      {Math.round(ringPct * 100)}%
                    </text>
                    <text x="55" y="66" textAnchor="middle" fontSize="9" fill="rgba(255,255,255,0.42)">
                      voice strength
                    </text>
                  </svg>

                  <div className="text-center">
                    {strength ? (
                      <div className="text-base font-semibold text-orange-400">{strength}</div>
                    ) : (
                      <div className="text-sm text-white/30">No phrases yet</div>
                    )}
                    <div className="text-xs text-white/30 mt-0.5">
                      {totalPhrases} phrase{totalPhrases !== 1 ? 's' : ''} · {pieceCount} piece{pieceCount !== 1 ? 's' : ''}
                    </div>
                  </div>
                </div>

                {/* ── Col 2: Pace + memory (owner only) / freshness stats (non-owner) ── */}
                <div className="space-y-5">
                  {isMyClinicianProfile ? (
                    <>
                      {/* Pace readout */}
                      <div>
                        <p className="text-2xs font-semibold uppercase tracking-wider text-white/40 mb-2">Interview pace</p>
                        <div className="flex justify-between items-baseline mb-2">
                          <span className="text-sm text-white/45">Slower</span>
                          <span className="text-lg font-bold text-white">
                            {fmtSpeed(speed)}
                            <span className="ml-1.5 text-sm font-normal text-white/45">{speedLabel(speed)}</span>
                          </span>
                          <span className="text-sm text-white/45">Faster</span>
                        </div>
                        <div className="relative h-[6px] rounded-full" style={{ background: 'rgba(255,255,255,0.12)' }}>
                          <div
                            className="absolute top-0 left-0 h-full rounded-full bg-primary"
                            style={{ width: `${speedPct(speed)}%` }}
                          />
                          <div
                            className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-white ring-2 ring-primary"
                            style={{ left: `calc(${speedPct(speed)}% - 8px)`, boxShadow: '0 1px 4px rgba(0,0,0,.3)' }}
                          />
                        </div>
                        <div className="flex justify-between mt-1.5">
                          <span className="text-3xs text-white/20">0.7×</span>
                          <span className="text-3xs text-white/20">1.0×</span>
                          <span className="text-3xs text-white/20">1.2×</span>
                        </div>
                      </div>

                      {/* Voice memory excerpt */}
                      {clinician.voice_notes ? (
                        <div>
                          <p className="text-2xs font-semibold uppercase tracking-wider text-white/40 mb-2">Voice memory</p>
                          <div
                            className="rounded-lg px-3 py-2.5 text-xs leading-relaxed line-clamp-4 text-white/65"
                            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.09)' }}
                          >
                            {clinician.voice_notes}
                          </div>
                        </div>
                      ) : (
                        <div className="text-xs text-white/30 italic">
                          Voice memory builds as you edit and approve more drafts.
                        </div>
                      )}
                    </>
                  ) : (
                    /* Non-owner: show freshness stats in the middle column */
                    <div className="space-y-3">
                      <p className="text-2xs font-semibold uppercase tracking-wider text-white/40">About this voice</p>
                      <div className="space-y-2 text-sm text-white/70">
                        <p>{totalPhrases} signature phrase{totalPhrases !== 1 ? 's' : ''} extracted</p>
                        <p>From {pieceCount} approved piece{pieceCount !== 1 ? 's' : ''}</p>
                        {voiceData?.last_updated_at && (
                          <p className="text-white/40 text-xs">
                            Updated {new Date(voiceData.last_updated_at).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* ── Col 3: Top phrases ── */}
                <div>
                  <p className="text-2xs font-semibold uppercase tracking-wider text-white/40 mb-2.5">Signature phrases</p>
                  {topPhrases.length === 0 ? (
                    <p className="text-sm text-white/30 italic">
                      Phrases appear as approved content grows.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {topPhrases.map((p, i) => (
                        <div
                          key={i}
                          className="text-sm italic px-3 py-2 rounded-lg leading-snug"
                          style={i < 2
                            ? { background: 'rgba(194,65,12,0.15)', border: '1px solid rgba(194,65,12,0.40)', color: '#fcd9c0' }
                            : { background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.10)', color: 'rgba(255,255,255,0.80)' }
                          }
                        >
                          &ldquo;{p.phrase}&rdquo;
                        </div>
                      ))}
                      <p className="text-3xs text-white/20 pt-1">Highlighted = highest weight in voice model</p>
                    </div>
                  )}
                </div>

              </div>
            </div>
          </div>{/* /dark hero */}

          {/* Light area below hero — existing voice components */}
          <div className="px-6 py-6 space-y-4">
            {isMyClinicianProfile && <VoicePlaybackCard clinician={clinician} />}
            {isMyClinicianProfile && <VoiceCloneCard clinician={clinician} />}
            <VoiceFreshnessCard clinicianId={clinician.id} clinicianName={clinician.name} />
            {isMyClinicianProfile && <VoiceNotesPanel clinician={clinician} />}
          </div>
        </div>
      )}

      {/* ── Settings tab ──────────────────────────────────────────── */}
      {activeTab === 'settings' && (
        <div className="px-6 py-6 space-y-4 max-w-2xl">
          {isMyClinicianProfile && <DisplayNameCard />}
          {(isMyClinicianProfile || role === 'admin') && (
            <DefaultToneCard clinician={clinician} />
          )}
          {(isMyClinicianProfile || role === 'admin') && (
            <CaptureCompanionCard clinician={clinician} />
          )}
          <ClinicianCampaignCard
            clinician={clinician}
            canEdit={isMyClinicianProfile || role === 'admin'}
          />
          {role === 'admin' && <ClinicianRecipeCard clinician={clinician} />}
        </div>
      )}

      {/* ── Delete dialog ─────────────────────────────────────────── */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(o) => { if (!o) { setDeleteTarget(null); setDeleteError('') } }}
      >
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
            <Button
              variant="outline"
              onClick={() => { setDeleteTarget(null); setDeleteError('') }}
              disabled={deleting}
            >
              Cancel
            </Button>
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

// ── Tab button ─────────────────────────────────────────────────────────────────

function ProfileTab({ active, onClick, children }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`flex items-center gap-1.5 px-5 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
        active
          ? 'text-primary border-primary'
          : 'text-muted-foreground border-transparent hover:text-foreground'
      }`}
    >
      {children}
    </button>
  )
}

// ── Channel icon map ─────────────────────────────────────────────────────────

const CHANNEL_ICON = {
  facebook:     <Facebook className="h-3.5 w-3.5" />,
  instagram:    <Instagram className="h-3.5 w-3.5" />,
  gbp:          <Globe className="h-3.5 w-3.5" />,
  email:        <Mail className="h-3.5 w-3.5" />,
  blog:         <BookOpen className="h-3.5 w-3.5" />,
  youtube:      <TrendingUp className="h-3.5 w-3.5" />,
  landing_page: <Globe className="h-3.5 w-3.5" />,
  google_ads:   <Globe className="h-3.5 w-3.5" />,
}

function ChannelBadge({ platform }) {
  const icon = CHANNEL_ICON[platform] ?? <Globe className="h-3.5 w-3.5" />
  return (
    <Badge variant="outline" className="text-xs gap-1 capitalize shrink-0">
      {icon}
      {platform?.replace(/_/g, ' ')}
    </Badge>
  )
}

// ── Published post row ────────────────────────────────────────────────────────

function PublishedPostRow({ post }) {
  const title = post.topic
    || (post.content ? post.content.slice(0, 60) + (post.content.length > 60 ? '…' : '') : 'Untitled post')
  const date = post.published_at || post.created_at

  return (
    <Card className="hover:shadow-sm transition-shadow">
      <CardContent className="p-3 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate" title={title}>{title}</p>
          <p className="text-xs text-muted-foreground">{formatRelativeDate(date)}</p>
        </div>
        <ChannelBadge platform={post.platform} />
        <Button asChild variant="ghost" size="icon" className="h-8 w-8 shrink-0">
          <Link to={post.interview_id ? `/stories/${post.interview_id}` : `/stories/${post.id}`}>
            <ChevronRight className="h-4 w-4" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  )
}

// ── Default tone card ─────────────────────────────────────────────────────────

function DefaultToneCard({ clinician }) {
  const { user } = useUser()
  const patchClinician = usePatchClinician()
  const tones = TONES
  const current = clinician.default_tone || 'smart'
  const [selected, setSelected] = useState(current)
  const [saved, setSaved] = useState(false)

  const isDirty = selected !== current

  async function handleSave() {
    await patchClinician.mutateAsync({ id: clinician.id, patch: { default_tone: selected }, userId: user?.id })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <Card>
      <CardContent className="py-5 space-y-3">
        <div>
          <p className="text-sm font-semibold">Default tone</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Pre-selects this tone whenever you start a new interview, voice memo, or import. Can still be changed per-interview.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {tones.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSelected(t.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm border transition-colors ${
                selected === t.id
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/40'
              }`}
            >
              {t.emoji && <span>{t.emoji}</span>}
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 pt-1">
          <Button
            size="sm"
            disabled={!isDirty || patchClinician.isPending}
            onClick={handleSave}
          >
            {patchClinician.isPending ? (
              <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Saving…</>
            ) : saved ? (
              'Saved ✓'
            ) : (
              'Save preference'
            )}
          </Button>
          {isDirty && !patchClinician.isPending && (
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setSelected(current)}
            >
              Reset
            </button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// ── Capture Companion card ────────────────────────────────────────────────────
//
// Manages the per-clinician Capture Upload Token used by the iOS Capture
// Companion Shortcut. Calls api/capture/token.js (PR #872) — GET reads the
// current state (without revealing the token value), POST generates/rotates
// (returns plaintext ONCE), DELETE revokes.
//
// The PWA /capture page does NOT use this token — it uses Clerk session auth.
// Token only matters for the iOS Shortcut path.

function CaptureCompanionCard({ clinician }) {
  const [tokenState, setTokenState] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [newToken, setNewToken] = useState(null)
  const [copied, setCopied] = useState(false)
  const [featureDisabled, setFeatureDisabled] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    apiFetch(`/api/capture/token?clinicianId=${clinician.id}`)
      .then((data) => {
        if (cancelled) return
        setTokenState(data)
      })
      .catch((e) => {
        if (cancelled) return
        if (e?.status === 403) {
          setFeatureDisabled(true)
        } else {
          setError(e?.message || 'Failed to load token state')
        }
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [clinician.id])

  const generateMutation = useAppMutation({
    mutationFn: () =>
      apiFetch(`/api/capture/token?clinicianId=${clinician.id}`, { method: 'POST' }),
    onSuccess: (data) => {
      setNewToken(data?.token || null)
      setTokenState({
        hasToken: true,
        expiresAt: data?.expiresAt || null,
        lastUsedAt: null,
      })
      setError(null)
    },
    onError: (e) => {
      if (e?.status === 403) setFeatureDisabled(true)
      else setError(e?.message || 'Failed to generate token')
    },
  })

  const revokeMutation = useAppMutation({
    mutationFn: () =>
      apiFetch(`/api/capture/token?clinicianId=${clinician.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setTokenState({ hasToken: false, expiresAt: null, lastUsedAt: null })
      setNewToken(null)
      setError(null)
    },
    onError: (e) => setError(e?.message || 'Failed to revoke token'),
  })

  async function copyToClipboard() {
    if (!newToken) return
    try {
      await navigator.clipboard.writeText(newToken)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Copy failed — long-press to select instead')
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-5">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading Capture Companion…
          </div>
        </CardContent>
      </Card>
    )
  }

  if (featureDisabled) {
    return (
      <Card>
        <CardContent className="py-5 space-y-2">
          <div className="flex items-center gap-2">
            <Smartphone className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm font-semibold">Capture Companion</p>
          </div>
          <p className="text-xs text-muted-foreground">
            Not enabled for this workspace yet. Contact your workspace owner if you want the iOS one-tap upload path.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardContent className="py-5 space-y-3">
        <div>
          <div className="flex items-center gap-2">
            <Smartphone className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm font-semibold">Capture Companion</p>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            One-tap photo + video upload from your iPhone via an iOS Shortcut. Optional — the{' '}
            <Link to="/capture" className="text-primary hover:underline">browser capture page</Link>
            {' '}works for everyone without any setup.
          </p>
        </div>

        {newToken && (
          <div className="rounded-lg border-2 border-amber-300 bg-amber-50 p-3 space-y-2">
            <div className="flex items-start gap-2 text-amber-900">
              <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <div className="text-sm font-medium">Token created — copy it now</div>
            </div>
            <p className="text-xs text-amber-800">
              This is the only time you&apos;ll see the full token. Copy it now and paste into the iOS Shortcut. If you lose it, rotate and start over.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs bg-white border border-amber-200 rounded px-2 py-1.5 font-mono break-all">
                {newToken}
              </code>
              <Button size="sm" variant="outline" onClick={copyToClipboard}>
                {copied
                  ? <><Check className="h-3.5 w-3.5 mr-1" />Copied</>
                  : <><Copy className="h-3.5 w-3.5 mr-1" />Copy</>}
              </Button>
            </div>
            <div className="flex items-center justify-between gap-2 pt-1">
              <a
                href="https://github.com/Move-Better/NarrateRx/blob/main/.claude/runbooks/capture-companion-ios-shortcut.md"
                target="_blank"
                rel="noreferrer"
                className="text-xs text-primary hover:underline"
              >
                iOS Shortcut setup guide →
              </a>
              <Button size="sm" variant="ghost" onClick={() => setNewToken(null)}>
                I&apos;ve saved it
              </Button>
            </div>
          </div>
        )}

        {!newToken && tokenState?.hasToken && (
          <div className="text-sm space-y-1">
            <div className="text-muted-foreground">
              Token active — expires{' '}
              <span className="text-foreground">{tokenState.expiresAt ? new Date(tokenState.expiresAt).toLocaleDateString() : 'unknown'}</span>
            </div>
            <div className="text-muted-foreground">
              Last used:{' '}
              {tokenState.lastUsedAt
                ? <span className="text-foreground">{new Date(tokenState.lastUsedAt).toLocaleString()}</span>
                : <span>never yet (Shortcut not used)</span>}
            </div>
          </div>
        )}
        {!newToken && tokenState && !tokenState.hasToken && (
          <div className="text-sm text-muted-foreground">
            No token. Generate one to set up the iOS Shortcut.
          </div>
        )}

        {error && <div className="text-xs text-destructive">{error}</div>}

        <div className="flex flex-wrap gap-2 pt-1">
          {!tokenState?.hasToken && (
            <Button
              size="sm"
              onClick={() => generateMutation.mutate()}
              disabled={generateMutation.isPending}
            >
              {generateMutation.isPending
                ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Generating…</>
                : <><Sparkles className="h-3.5 w-3.5 mr-1.5" />Generate token</>}
            </Button>
          )}
          {tokenState?.hasToken && !newToken && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => generateMutation.mutate()}
                disabled={generateMutation.isPending}
              >
                {generateMutation.isPending
                  ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Rotating…</>
                  : <><RotateCw className="h-3.5 w-3.5 mr-1.5" />Rotate</>}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => revokeMutation.mutate()}
                disabled={revokeMutation.isPending}
                className="text-destructive hover:text-destructive"
              >
                {revokeMutation.isPending
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : 'Revoke'}
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// ── Clinician recipe card ─────────────────────────────────────────────────────

function ClinicianRecipeCard({ clinician }) {
  const workspace = useWorkspace()
  const { data: recipes = [], isLoading } = useClinicianRecipes(clinician.id)
  const patchMut  = usePatchClinicianRecipe()
  const deleteMut = useDeleteClinicianRecipe()
  const VOICE_MODES = getVoiceModes(workspace)

  async function handleSetDefault(recipe) {
    if (recipe.is_default) return
    try {
      await patchMut.mutateAsync({ id: recipe.id, patch: { is_default: true } })
      toast.success(`"${recipe.name}" is now the default`)
    } catch { /* handled by useAppMutation */ }
  }

  async function handleDelete(recipe) {
    if (!confirm(`Delete recipe "${recipe.name}"?`)) return
    try {
      await deleteMut.mutateAsync({ id: recipe.id })
      toast.success(`Deleted "${recipe.name}"`)
    } catch { /* handled by useAppMutation */ }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div>
        <p className="text-sm font-semibold">Interview recipes</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Saved lever combinations for {clinician.name.split(' ')[0]}. The starred recipe auto-fills the New Interview form.
        </p>
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground italic">Loading…</p>
      ) : recipes.length === 0 ? (
        <div className="rounded-md border border-dashed border-input p-4 text-center">
          <p className="text-sm text-muted-foreground">No recipes saved yet.</p>
          <p className="text-xs text-muted-foreground mt-1">
            Create one from the{' '}
            <Link to="/new" className="text-primary hover:underline">New Interview</Link>
            {' '}page via &ldquo;Save as recipe&rdquo;.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {recipes.map((r) => (
            <RecipeRow
              key={r.id}
              recipe={r}
              workspace={workspace}
              voiceModes={VOICE_MODES}
              onSetDefault={() => handleSetDefault(r)}
              onDelete={() => handleDelete(r)}
              busy={patchMut.isPending || deleteMut.isPending}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function RecipeRow({ recipe, workspace, voiceModes, onSetDefault, onDelete, busy }) {
  const audienceSlot  = resolveAudienceSlot(recipe.audience, workspace?.audience_options)
  const storyTypeSlot = resolveStoryTypeSlot(recipe.story_type, workspace?.story_type_options)
  const voiceModeSlot = voiceModes.find((v) => v.id === recipe.voice_mode)
  const toneSlot      = TONES.find((t) => t.id === recipe.tone)
  const cleanupSlot   = recipe.cleanup_level ? getCleanupLevel(recipe.cleanup_level) : null

  const pills = [audienceSlot, storyTypeSlot, voiceModeSlot, toneSlot, cleanupSlot].filter(Boolean)

  return (
    <div className="rounded-md border border-input p-3 flex items-start gap-3">
      <span className="text-lg shrink-0 mt-0.5">{recipe.emoji || '⭐'}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium truncate">{recipe.name}</p>
          {recipe.is_default && (
            <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500 shrink-0" aria-label="Default recipe" />
          )}
        </div>
        {pills.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1 mt-1.5">
            {pills.map((p, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 text-2xs bg-muted/50 rounded-full px-1.5 py-0.5"
              >
                <span>{p.emoji}</span>
                <span className="text-muted-foreground">{p.label}</span>
              </span>
            ))}
          </div>
        ) : (
          <p className="text-2xs text-muted-foreground italic mt-1">No levers set</p>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {!recipe.is_default && (
          <button
            type="button"
            onClick={onSetDefault}
            disabled={busy}
            title="Make default"
            className="p-1.5 rounded text-muted-foreground hover:text-amber-500 hover:bg-amber-500/10 disabled:opacity-50"
          >
            <Star className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          title="Delete recipe"
          className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-50"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

// ── Interview row ─────────────────────────────────────────────────────────────

function InterviewRow({ interview, clinicianId, currentUserId, clinicians, onDelete }) {
  const isOwner = interview.owner_id === currentUserId
  const isComplete = interview.status === 'completed'
  const ownerName = !isOwner ? resolveOwnerName(interview, clinicians) : null
  const href = isComplete
    ? `/output/${clinicianId}/${interview.id}`
    : `/interview/${clinicianId}/${interview.id}`

  return (
    <Card className="hover:shadow-sm transition-shadow">
      <CardContent className="p-4 flex items-center gap-4">
        <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
          {isComplete
            ? <FileText className="h-4 w-4 text-primary" />
            : <Clock className="h-4 w-4 text-warning" />
          }
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm truncate" title={interview.topic}>{interview.topic}</p>
          <p className="text-xs text-muted-foreground">
            {formatRelativeDate(interview.updated_at)}
            {ownerName && <span className="ml-2 text-muted-foreground/60">· by {ownerName}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge
            variant={isComplete ? 'secondary' : 'outline'}
            className={`text-xs ${!isComplete ? 'border-warning/40 text-warning' : ''}`}
          >
            {isComplete ? 'Content ready' : 'In progress'}
          </Badge>
          <Button asChild variant="ghost" size="icon" className="h-8 w-8">
            <Link to={href}><ChevronRight className="h-4 w-4" /></Link>
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

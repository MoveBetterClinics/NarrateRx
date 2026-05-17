import { useState } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { useUser, useAuth } from '@clerk/clerk-react'
import { ArrowLeft, ArrowRight, Stethoscope, User, Loader2, TrendingUp, Sparkles, Plus, ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { getOrCreateClinician, createInterview } from '@/lib/api'
import { useClinicians } from '@/lib/queries'
import { getSuggestedTopics } from '@/lib/topicSuggestions'
import { TONES, getVoiceModes, getPatientPrototypesUi } from '@/lib/prompts'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { useUnsavedChanges } from '@/lib/useUnsavedChanges'
import { useUserRole } from '@/lib/useUserRole'
import { toast } from '@/lib/toast'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/queries'

export default function NewInterview() {
  useDocumentTitle('New interview')
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user } = useUser()
  const { getToken } = useAuth()
  const qc = useQueryClient()
  const workspace = useWorkspace()
  const { role } = useUserRole()
  const isAdmin = role === 'admin'
  const VOICE_MODES = getVoiceModes(workspace)
  const PATIENT_PROTOTYPES_UI = getPatientPrototypesUi(workspace)
  const [addingSuggestion, setAddingSuggestion] = useState(false)
  const [suggestionAddedFor, setSuggestionAddedFor] = useState('')

  const [clinicianName, setClinicianName] = useState('')
  const [condition, setCondition] = useState(searchParams.get('topic') || '')
  const [step, setStep] = useState(searchParams.get('topic') ? 1 : 1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [tone, setTone] = useState('smart')
  const [voiceMode, setVoiceMode] = useState('practice')
  const [prototype, setPrototype] = useState(null)
  const [locationId, setLocationId] = useState(null)
  const [audience, setAudience] = useState(null)
  const [storyType, setStoryType] = useState(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const audienceOptions = Array.isArray(workspace?.audience_options) ? workspace.audience_options : []
  const storyTypeOptions = Array.isArray(workspace?.story_type_options) ? workspace.story_type_options : []
  const activeLocations = Array.isArray(workspace?.locations)
    ? workspace.locations.filter(l => l.status === 'active')
    : []
  const showLocationPicker = activeLocations.length > 1

  // Warn before tab close / refresh / typed-URL nav when the form has
  // unsaved entries. Suppressed during submission (handleStart sets
  // loading=true, then navigates on success). Initial condition from a
  // ?topic= search param doesn't count as user-entered input.
  const initialTopic = searchParams.get('topic') || ''
  const isDirty =
    !loading &&
    (clinicianName.trim().length > 0 || condition.trim() !== initialTopic)
  useUnsavedChanges(isDirty)
  // Shares cache with Dashboard's useClinicians() — if the user navigated
  // here from Dashboard, the data is already warm and we paint instantly.
  const { data: cliniciansForSuggestions = [], isLoading: cliniciansLoading } = useClinicians()
  const existingTopics = cliniciansForSuggestions.flatMap((c) =>
    (c.interviews || []).map((i) => i.topic),
  )
  // Just-added topics in this session — kept local so the admin "Add to
  // suggestions" affordance can show the chip immediately without waiting
  // for a workspace-context refetch. Merged with the workspace's persisted
  // topic_suggestions when deriving the ranked list.
  const [localAddedSuggestions, setLocalAddedSuggestions] = useState([])
  const suggestions = getSuggestedTopics(
    { ...workspace, topic_suggestions: [
      ...(Array.isArray(workspace?.topic_suggestions) ? workspace.topic_suggestions : []),
      ...localAddedSuggestions,
    ] },
    existingTopics,
  )
  const suggestionsLoading = cliniciansLoading

  function handleNext() {
    if (step === 1 && clinicianName.trim()) setStep(2)
  }

  async function handleStart(selectedCondition) {
    const topic = (selectedCondition ?? condition).trim()
    if (!clinicianName.trim() || !topic || !user) return

    setLoading(true)
    setError('')
    try {
      const clinician = await getOrCreateClinician({
        name: clinicianName.trim(),
        createdById: user.id,
        createdByEmail: user.primaryEmailAddress?.emailAddress,
      })
      const interview = await createInterview({
        clinicianId: clinician.id,
        topic,
        ownerId: user.id,
        ownerEmail: user.primaryEmailAddress?.emailAddress,
        tone,
        voiceMode,
        prototypeId: prototype,
        locationId,
        audience,
        storyType,
        topicBacklogId: searchParams.get('topicBacklogId') || undefined,
      })
      navigate(`/interview/${clinician.id}/${interview.id}`)
    } catch (e) {
      setError(e.message)
      setLoading(false)
    }
  }

  // Split suggestions into sections
  const uncovered = suggestions.filter((s) => s.interviewCount === 0 && s.priority === 'high').slice(0, 8)
  const underrepresented = suggestions.filter((s) => s.interviewCount > 0 && s.interviewCount <= 2).slice(0, 6)
  const allHighPriority = suggestions.filter((s) => s.priority === 'high').slice(0, 12)

  // Geo-aware label for the "popular topics" section — replaces the
  // hardcoded "Popular in the Pacific Northwest" that shipped to every
  // tenant. Falls back to a generic phrase when the workspace has no
  // region_short configured.
  const regionLabel = workspace?.region_short || workspace?.location || ''
  const popularLabel = regionLabel
    ? `Popular in ${regionLabel}:`
    : 'Suggested topics:'

  // Should we offer an "Add to suggestions" affordance? Admin-only, requires
  // a non-empty typed topic that doesn't already match a suggestion. Match
  // is case-insensitive on the topic string itself.
  const trimmedCondition = condition.trim()
  const conditionLc = trimmedCondition.toLowerCase()
  const matchesExistingSuggestion = suggestions.some(
    (s) => String(s.topic || '').toLowerCase() === conditionLc,
  )
  const canAddSuggestion =
    isAdmin && trimmedCondition.length >= 3 && !matchesExistingSuggestion

  async function handleAddSuggestion() {
    if (!canAddSuggestion || addingSuggestion) return
    setAddingSuggestion(true)
    try {
      const existing = Array.isArray(workspace?.topic_suggestions) ? workspace.topic_suggestions : []
      const newRow = {
        topic: trimmedCondition,
        priority: 'medium',
        keywords: [conditionLc],
      }
      const token = await getToken()
      const res = await fetch('/api/workspace/me', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ topic_suggestions: [...existing, newRow] }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Could not save topic')
      }
      toast.success(`Added "${trimmedCondition}" to suggestions`)
      setSuggestionAddedFor(trimmedCondition)
      // Reflect locally for instant feedback…
      setLocalAddedSuggestions((prev) => [...prev, newRow])
      // …and also invalidate the workspace query so the workspace row gets
      // re-fetched with the new persisted topic_suggestions JSONB. Other
      // components (ContentHub topic filter, future re-mounts of this page)
      // pick it up automatically.
      qc.invalidateQueries({ queryKey: queryKeys.workspace.me })
    } catch (e) {
      toast.error('Could not add topic', { description: e.message })
    } finally {
      setAddingSuggestion(false)
    }
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-xl font-bold">New Interview</h1>
          <p className="text-sm text-muted-foreground">Step {step} of 2</p>
        </div>
      </div>

      <div className="flex gap-2">
        <div className={`h-1.5 flex-1 rounded-full transition-colors ${step >= 1 ? 'bg-primary' : 'bg-muted'}`} />
        <div className={`h-1.5 flex-1 rounded-full transition-colors ${step >= 2 ? 'bg-primary' : 'bg-muted'}`} />
      </div>

      {error && (
        <div className="text-sm text-destructive bg-destructive/10 rounded-lg px-4 py-3">{error}</div>
      )}

      {step === 1 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                <User className="h-4 w-4 text-primary" />
              </div>
              <div>
                <CardTitle className="text-base">Who are we interviewing?</CardTitle>
                <CardDescription>Enter the clinician&apos;s full name</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">Clinician Name</Label>
              <Input
                id="name"
                placeholder="e.g. Dr. Michael Quasney"
                value={clinicianName}
                onChange={(e) => setClinicianName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleNext()}
                autoComplete="name"
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                If this clinician has been interviewed before, they&apos;ll be linked to their existing profile.
              </p>
            </div>
            <Button onClick={handleNext} disabled={!clinicianName.trim()} className="w-full">
              Continue
              <ArrowRight className="h-4 w-4 ml-1.5" />
            </Button>
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                <Stethoscope className="h-4 w-4 text-primary" />
              </div>
              <div>
                <CardTitle className="text-base">What are we covering?</CardTitle>
                <CardDescription>Type a topic or pick a suggestion below</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Audience picker — shown when workspace has slots configured */}
            {audienceOptions.length > 0 && (
              <InterviewSlotPicker
                label="Who is this piece for?"
                options={audienceOptions}
                value={audience}
                onChange={setAudience}
              />
            )}

            {/* Story type picker */}
            {storyTypeOptions.length > 0 && (
              <InterviewSlotPicker
                label="What kind of piece?"
                options={storyTypeOptions}
                value={storyType}
                onChange={setStoryType}
              />
            )}

            <div className="space-y-1.5">
              <Label htmlFor="condition">Condition, treatment, or topic</Label>
              <Input
                id="condition"
                placeholder="e.g. Low back pain, IT band rehab, postpartum recovery…"
                value={condition}
                onChange={(e) => {
                  setCondition(e.target.value)
                  if (suggestionAddedFor && e.target.value.trim() !== suggestionAddedFor) {
                    setSuggestionAddedFor('')
                  }
                }}
                onKeyDown={(e) => e.key === 'Enter' && handleStart()}
                autoFocus
              />
              {/* Admin-only affordance: surface "Add this topic to suggestions"
                  when the typed value isn't already a known suggestion. Lets
                  admins seed the workspace's topic library from the place
                  they're already typing, instead of routing through Settings. */}
              {canAddSuggestion && (
                <button
                  type="button"
                  onClick={handleAddSuggestion}
                  disabled={addingSuggestion}
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline disabled:opacity-50 mt-1"
                >
                  {addingSuggestion ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Plus className="h-3 w-3" />
                  )}
                  Add &ldquo;{trimmedCondition}&rdquo; to your workspace&apos;s topic suggestions
                </button>
              )}
              {suggestionAddedFor && suggestionAddedFor === trimmedCondition && (
                <p className="text-xs text-success mt-1 inline-flex items-center gap-1">
                  <Sparkles className="h-3 w-3" />
                  Added — you&apos;ll see it in your suggestions next time.
                </p>
              )}
            </div>

            {suggestionsLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading topic suggestions…
              </div>
            ) : (
              <div className="space-y-4">
                {/* Uncovered high-priority topics */}
                {uncovered.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1.5 mb-2">
                      <TrendingUp className="h-3.5 w-3.5 text-warning" />
                      <p className="text-xs font-medium text-warning">
                        High patient interest — no content yet
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {uncovered.map((s) => (
                        <TopicChip
                          key={s.topic}
                          label={s.topic}
                          count={0}
                          priority={s.priority}
                          onClick={() => handleStart(s.topic)}
                          disabled={loading}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Underrepresented topics */}
                {underrepresented.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1.5 mb-2">
                      <Sparkles className="h-3.5 w-3.5 text-primary" />
                      <p className="text-xs font-medium text-muted-foreground">
                        Could use more perspectives
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {underrepresented.map((s) => (
                        <TopicChip
                          key={s.topic}
                          label={s.topic}
                          count={s.interviewCount}
                          onClick={() => handleStart(s.topic)}
                          disabled={loading}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* All high-priority topics */}
                <div>
                  <p className="text-xs text-muted-foreground mb-2">{popularLabel}</p>
                  <div className="flex flex-wrap gap-2">
                    {allHighPriority.map((s) => (
                      <TopicChip
                        key={s.topic}
                        label={s.topic}
                        count={s.interviewCount}
                        onClick={() => handleStart(s.topic)}
                        disabled={loading}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Adjust settings disclosure */}
            <div>
              <button
                type="button"
                onClick={() => setSettingsOpen((o) => !o)}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {settingsOpen ? (
                  <ChevronUp className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
                {settingsOpen ? 'Hide settings' : 'Adjust settings'}
              </button>

              {settingsOpen && (
                <div className="mt-4 space-y-4 border-t pt-4">
                  {/* Patient prototype selector — only rendered when the workspace has archetypes */}
                  {PATIENT_PROTOTYPES_UI.length > 1 && (
                    <div className="space-y-2">
                      <Label className="text-sm">Patient archetype</Label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {PATIENT_PROTOTYPES_UI.map((p) => (
                          <button
                            key={String(p.id)}
                            type="button"
                            onClick={() => setPrototype(p.id)}
                            className={`flex items-start gap-2 rounded-lg border p-3 text-left transition-all ${
                              prototype === p.id
                                ? 'border-primary bg-primary/5 ring-1 ring-primary'
                                : 'border-input hover:border-primary/40 hover:bg-accent/30'
                            }`}
                          >
                            <span className="text-base shrink-0 mt-0.5">{p.emoji}</span>
                            <div>
                              <p className="text-xs font-semibold leading-tight">{p.label}</p>
                              <p className="text-2xs text-muted-foreground mt-0.5 leading-tight">{p.description}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Voice mode selector */}
                  <div className="space-y-2">
                    <Label className="text-sm">Voice</Label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {VOICE_MODES.map((v) => (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => setVoiceMode(v.id)}
                          className={`flex items-start gap-2 rounded-lg border p-3 text-left transition-all ${
                            voiceMode === v.id
                              ? 'border-primary bg-primary/5 ring-1 ring-primary'
                              : 'border-input hover:border-primary/40 hover:bg-accent/30'
                          }`}
                        >
                          <span className="text-base shrink-0 mt-0.5">{v.emoji}</span>
                          <div>
                            <p className="text-xs font-semibold leading-tight">{v.label}</p>
                            <p className="text-2xs text-muted-foreground mt-0.5 leading-tight">{v.description}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                    {voiceMode === 'personal' && (
                      <p className="text-2xs text-muted-foreground leading-snug">
                        Personal interviews skip ad-style outputs (Instagram Ads, Google Ads, landing page, email newsletter).
                      </p>
                    )}
                  </div>

                  {/* Location selector — only when this workspace has more than one location */}
                  {showLocationPicker && (
                    <div className="space-y-2">
                      <Label className="text-sm">Location</Label>
                      <p className="text-2xs text-muted-foreground leading-snug">
                        Which clinic is this interview for? Affects local hashtags, &ldquo;near me&rdquo; copy,
                        and (for GBP posts) which Google Business Profile receives the post.
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setLocationId(null)}
                          className={`flex items-start gap-2 rounded-lg border p-3 text-left transition-all ${
                            locationId === null
                              ? 'border-primary bg-primary/5 ring-1 ring-primary'
                              : 'border-input hover:border-primary/40 hover:bg-accent/30'
                          }`}
                        >
                          <span className="text-base shrink-0 mt-0.5">🌐</span>
                          <div>
                            <p className="text-xs font-semibold leading-tight">All locations</p>
                            <p className="text-2xs text-muted-foreground mt-0.5 leading-tight">
                              Generic copy that fits every site
                            </p>
                          </div>
                        </button>
                        {activeLocations.map((loc) => (
                          <button
                            key={loc.id}
                            type="button"
                            onClick={() => setLocationId(loc.id)}
                            className={`flex items-start gap-2 rounded-lg border p-3 text-left transition-all ${
                              locationId === loc.id
                                ? 'border-primary bg-primary/5 ring-1 ring-primary'
                                : 'border-input hover:border-primary/40 hover:bg-accent/30'
                            }`}
                          >
                            <span className="text-base shrink-0 mt-0.5">📍</span>
                            <div>
                              <p className="text-xs font-semibold leading-tight">{loc.label || loc.city}</p>
                              <p className="text-2xs text-muted-foreground mt-0.5 leading-tight">
                                {[loc.city, loc.region].filter(Boolean).join(', ')}
                                {loc.location_hashtag ? ` · ${loc.location_hashtag}` : ''}
                              </p>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Tone selector */}
                  <div className="space-y-2">
                    <Label className="text-sm">Content tone</Label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {TONES.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setTone(t.id)}
                          className={`flex items-start gap-2 rounded-lg border p-3 text-left transition-all ${
                            tone === t.id
                              ? 'border-primary bg-primary/5 ring-1 ring-primary'
                              : 'border-input hover:border-primary/40 hover:bg-accent/30'
                          }`}
                        >
                          <span className="text-base shrink-0 mt-0.5">{t.emoji}</span>
                          <div>
                            <p className="text-xs font-semibold leading-tight">{t.label}</p>
                            <p className="text-2xs text-muted-foreground mt-0.5 leading-tight">{t.description}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-2 pt-1">
              <Button variant="outline" onClick={() => setStep(1)} className="flex-1" disabled={loading}>
                <ArrowLeft className="h-4 w-4 mr-1.5" />
                Back
              </Button>
              <Button onClick={() => handleStart()} disabled={!condition.trim() || loading} className="flex-1">
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    Start Interview
                    <ArrowRight className="h-4 w-4 ml-1.5" />
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// Slot picker used for audience and story type on the New Interview form.
// Renders workspace-curated slots as a compact toggle grid. A selected slot
// can be deselected by clicking again (returns to null = "not specified").
function InterviewSlotPicker({ label, options, value, onChange }) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <Label className="text-sm">{label}</Label>
        {value && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-2xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Clear
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {options.map((opt) => (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange(value === opt.key ? null : opt.key)}
            className={`flex items-start gap-2 rounded-lg border p-2.5 text-left transition-all ${
              value === opt.key
                ? 'border-primary bg-primary/5 ring-1 ring-primary'
                : 'border-input hover:border-primary/40 hover:bg-accent/30'
            }`}
          >
            <span className="text-base shrink-0 mt-0.5">{opt.emoji}</span>
            <div className="min-w-0">
              <p className="text-xs font-semibold leading-tight">{opt.label}</p>
              {opt.description && (
                <p className="text-2xs text-muted-foreground mt-0.5 leading-tight">{opt.description}</p>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

function TopicChip({ label, count, priority, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="group flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border border-input hover:bg-primary hover:text-primary-foreground hover:border-primary transition-colors disabled:opacity-50"
    >
      {label}
      {count > 0 && (
        <span className="text-3xs opacity-60 group-hover:opacity-80">
          {count}×
        </span>
      )}
      {count === 0 && priority === 'high' && (
        <span className="text-3xs text-warning group-hover:text-primary-foreground">new</span>
      )}
    </button>
  )
}

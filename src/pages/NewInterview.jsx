import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { useUser, useAuth } from '@clerk/clerk-react'
import {
  ArrowLeft, ArrowRight, Loader2, TrendingUp, Sparkles, Plus,
  ChevronDown, ChevronUp, Star, Check,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { getOrCreateClinician, createInterview } from '@/lib/api'
import { useClinicians, useClinicianRecipes, useCreateClinicianRecipe } from '@/lib/queries'
import { getSuggestedTopics } from '@/lib/topicSuggestions'
import { TONES, getVoiceModes, getPatientPrototypesUi } from '@/lib/prompts'
import { useWorkspace } from '@/lib/WorkspaceContext'
import {
  defaultAudienceSlots, defaultStoryTypeSlots,
  resolveAudienceSlot, resolveStoryTypeSlot,
} from '@/lib/interviewOptionsCatalog'
import { CLEANUP_LEVELS, getCleanupLevel, DEFAULT_CLEANUP_LEVEL } from '@/lib/cleanupLevels'
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

  const preferredName = user?.unsafeMetadata?.display_name || user?.fullName || ''
  const [clinicianName, setClinicianName] = useState(preferredName)
  const [condition, setCondition] = useState(searchParams.get('topic') || '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Lever state — each starts at a sensible default, gets overridden when a
  // recipe is applied or the user opens Tune and edits manually.
  const [tone, setTone] = useState('smart')
  const [voiceMode, setVoiceMode] = useState('practice')
  const [prototype, setPrototype] = useState(null)
  const [locationId, setLocationId] = useState(null)
  const [audience, setAudience] = useState(null)
  const [storyType, setStoryType] = useState(null)
  const [cleanupLevel, setCleanupLevel] = useState(DEFAULT_CLEANUP_LEVEL)

  // Recipe state — selectedRecipeId tracks which saved recipe is "active";
  // null means "ad-hoc settings (no recipe)". Mutates on dropdown change or
  // when a tune-drawer edit drifts from the recipe.
  const [selectedRecipeId, setSelectedRecipeId] = useState(null)
  const [tuneOpen, setTuneOpen] = useState(false)
  const [saveRecipeOpen, setSaveRecipeOpen] = useState(false)
  const [addingSuggestion, setAddingSuggestion] = useState(false)
  const [suggestionAddedFor, setSuggestionAddedFor] = useState('')

  // Pre-fill clinician name from Clerk once it hydrates
  useEffect(() => {
    const name = user?.unsafeMetadata?.display_name || user?.fullName || ''
    if (name && !clinicianName) setClinicianName(name)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.unsafeMetadata?.display_name, user?.fullName])

  // Workspace-curated audience / story type slots, with catalog fallback so
  // even fresh workspaces show pickers.
  const audienceOptions = Array.isArray(workspace?.audience_options) && workspace.audience_options.length > 0
    ? workspace.audience_options
    : defaultAudienceSlots()
  const storyTypeOptions = Array.isArray(workspace?.story_type_options) && workspace.story_type_options.length > 0
    ? workspace.story_type_options
    : defaultStoryTypeSlots()

  const activeLocations = Array.isArray(workspace?.locations)
    ? workspace.locations.filter(l => l.status === 'active')
    : []
  const showLocationPicker = activeLocations.length > 1

  // Resolve typed clinician name → existing clinician row (case-insensitive)
  // so we can fetch their recipes. If they don't exist yet (first interview),
  // recipes stay empty and the UI uses generic defaults.
  const { data: cliniciansForSuggestions = [], isLoading: cliniciansLoading } = useClinicians()
  const resolvedClinician = useMemo(() => {
    const name = clinicianName.trim().toLowerCase()
    if (!name) return null
    return cliniciansForSuggestions.find(
      (c) => c.name.trim().toLowerCase() === name
    )
  }, [cliniciansForSuggestions, clinicianName])

  const { data: recipes = [] } = useClinicianRecipes(resolvedClinician?.id)

  // Apply a recipe to all five levers + clear the "drift from recipe" flag
  // by setting selectedRecipeId. Sticky: levers stay until the user either
  // picks another recipe or edits something in Tune.
  function applyRecipe(recipe) {
    setSelectedRecipeId(recipe.id)
    if (recipe.audience)      setAudience(recipe.audience)
    if (recipe.story_type)    setStoryType(recipe.story_type)
    if (recipe.tone)          setTone(recipe.tone)
    if (recipe.voice_mode)    setVoiceMode(recipe.voice_mode)
    if (recipe.cleanup_level) setCleanupLevel(recipe.cleanup_level)
  }

  // Auto-apply the clinician's default recipe on first recipe load. Bail if
  // the user has already picked one to avoid stomping their choice on a
  // background refetch.
  const [autoAppliedFor, setAutoAppliedFor] = useState(null)
  useEffect(() => {
    if (!resolvedClinician || !recipes.length) return
    if (autoAppliedFor === resolvedClinician.id) return
    const defaultRecipe = recipes.find((r) => r.is_default) || recipes[0]
    if (defaultRecipe) {
      applyRecipe(defaultRecipe)
      setAutoAppliedFor(resolvedClinician.id)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedClinician?.id, recipes.length])

  // When the user edits any lever in Tune, mark the recipe as "drifted" so
  // they can save the new combo as a new recipe.
  function markDrift() {
    if (selectedRecipeId) setSelectedRecipeId(null)
  }

  // Warn before tab close / typed-URL nav when form has unsaved entries.
  const initialTopic = searchParams.get('topic') || ''
  const isDirty =
    !loading &&
    (condition.trim() !== initialTopic)
  useUnsavedChanges(isDirty)

  const existingTopics = cliniciansForSuggestions.flatMap((c) =>
    (c.interviews || []).map((i) => i.topic),
  )
  const [localAddedSuggestions, setLocalAddedSuggestions] = useState([])
  const suggestions = getSuggestedTopics(
    { ...workspace, topic_suggestions: [
      ...(Array.isArray(workspace?.topic_suggestions) ? workspace.topic_suggestions : []),
      ...localAddedSuggestions,
    ] },
    existingTopics,
  )
  const suggestionsLoading = cliniciansLoading

  async function handleStart(selectedCondition) {
    const topic = (selectedCondition ?? condition).trim()
    if (!clinicianName.trim() || !topic || !user) return

    // Self-detection — if the typed clinician name matches the user's
    // display name OR Clerk full name (case-insensitive), bind the
    // clinician row to user.id so renames don't fork the identity.
    const typed = clinicianName.trim().toLowerCase()
    const display = (user?.unsafeMetadata?.display_name || '').trim().toLowerCase()
    const full    = (user?.fullName || '').trim().toLowerCase()
    const isSelf  = !!typed && (typed === display || typed === full)

    setLoading(true)
    setError('')
    try {
      const clinician = await getOrCreateClinician({
        name: clinicianName.trim(),
        createdById: user.id,
        createdByEmail: user.primaryEmailAddress?.emailAddress,
        userId: isSelf ? user.id : undefined,
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
        cleanupLevel,
        topicBacklogId: searchParams.get('topicBacklogId') || undefined,
      })
      navigate(`/interview/${clinician.id}/${interview.id}`)
    } catch (e) {
      setError(e.message)
      setLoading(false)
    }
  }

  const uncovered = suggestions.filter((s) => s.interviewCount === 0 && s.priority === 'high').slice(0, 8)
  const underrepresented = suggestions.filter((s) => s.interviewCount > 0 && s.interviewCount <= 2).slice(0, 6)
  const allHighPriority = suggestions.filter((s) => s.priority === 'high').slice(0, 12)

  const regionLabel = workspace?.region_short || workspace?.location || ''
  const popularLabel = regionLabel ? `Popular in ${regionLabel}:` : 'Suggested topics:'

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
      setLocalAddedSuggestions((prev) => [...prev, newRow])
      qc.invalidateQueries({ queryKey: queryKeys.workspace.me })
    } catch (e) {
      toast.error('Could not add topic', { description: e.message })
    } finally {
      setAddingSuggestion(false)
    }
  }

  // Active levers — for the pill row. Resolves keys to displayable slots
  // (emoji + label) from workspace/catalog/builtin lists.
  const audienceSlot   = resolveAudienceSlot(audience, audienceOptions)
  const storyTypeSlot  = resolveStoryTypeSlot(storyType, storyTypeOptions)
  const voiceModeSlot  = VOICE_MODES.find((v) => v.id === voiceMode)
  const toneSlot       = TONES.find((t) => t.id === tone)
  const cleanupSlot    = getCleanupLevel(cleanupLevel)

  return (
    <div className="max-w-lg mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-xl font-bold">New Interview</h1>
          <p className="text-sm text-muted-foreground">Set up and start in one screen</p>
        </div>
      </div>

      {error && (
        <div className="text-sm text-destructive bg-destructive/10 rounded-lg px-4 py-3">{error}</div>
      )}

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Pre-interview setup</CardTitle>
          <CardDescription>Topic is the only required field.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Clinician */}
          <div className="space-y-1.5">
            <Label htmlFor="clinician">Clinician</Label>
            <Input
              id="clinician"
              placeholder="e.g. Dr. Quasney"
              value={clinicianName}
              onChange={(e) => setClinicianName(e.target.value)}
              autoComplete="name"
            />
          </div>

          {/* Topic */}
          <div className="space-y-1.5">
            <Label htmlFor="condition">
              Topic <span className="text-destructive">*</span>
            </Label>
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
              onKeyDown={(e) => e.key === 'Enter' && condition.trim() && handleStart()}
              autoFocus={!preferredName}
            />
            {canAddSuggestion && (
              <button
                type="button"
                onClick={handleAddSuggestion}
                disabled={addingSuggestion}
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline disabled:opacity-50 mt-1"
              >
                {addingSuggestion ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
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

          {/* Recipe dropdown — only when this clinician has saved recipes */}
          {recipes.length > 0 && (
            <RecipeDropdown
              recipes={recipes}
              selectedId={selectedRecipeId}
              onSelect={(r) => applyRecipe(r)}
            />
          )}

          {/* Active levers pill row + Tune toggle */}
          <ActiveLeversRow
            audienceSlot={audienceSlot}
            storyTypeSlot={storyTypeSlot}
            voiceModeSlot={voiceModeSlot}
            toneSlot={toneSlot}
            cleanupSlot={cleanupSlot}
            tuneOpen={tuneOpen}
            onTuneToggle={() => setTuneOpen((o) => !o)}
            canSaveRecipe={!selectedRecipeId && !!resolvedClinician}
            onSaveRecipe={() => setSaveRecipeOpen(true)}
          />

          {/* Tune drawer — individual lever pickers */}
          {tuneOpen && (
            <div className="space-y-4 border-t pt-4">
              <InterviewSlotPicker
                label="Who is this piece for?"
                options={audienceOptions}
                value={audience}
                onChange={(v) => { setAudience(v); markDrift() }}
              />
              <InterviewSlotPicker
                label="What kind of piece?"
                options={storyTypeOptions}
                value={storyType}
                onChange={(v) => { setStoryType(v); markDrift() }}
              />
              <SimpleSlotPicker
                label="Voice"
                options={VOICE_MODES}
                value={voiceMode}
                onChange={(v) => { setVoiceMode(v); markDrift() }}
                idKey="id"
              />
              <SimpleSlotPicker
                label="Tone"
                options={TONES}
                value={tone}
                onChange={(v) => { setTone(v); markDrift() }}
                idKey="id"
              />
              <SimpleSlotPicker
                label="Transcript cleanup"
                options={CLEANUP_LEVELS}
                value={cleanupLevel}
                onChange={(v) => { setCleanupLevel(v); markDrift() }}
                idKey="id"
              />
              {PATIENT_PROTOTYPES_UI.length > 1 && (
                <SimpleSlotPicker
                  label="Patient archetype"
                  options={PATIENT_PROTOTYPES_UI}
                  value={prototype}
                  onChange={(v) => { setPrototype(v); markDrift() }}
                  idKey="id"
                />
              )}
              {showLocationPicker && (
                <LocationPicker
                  locations={activeLocations}
                  value={locationId}
                  onChange={(v) => { setLocationId(v); markDrift() }}
                />
              )}
            </div>
          )}

          {/* Topic suggestions — collapsed under a heading so they don't
              dominate the page now that the lever section is bigger. */}
          {suggestionsLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-2 border-t pt-4">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading topic suggestions…
            </div>
          ) : (uncovered.length > 0 || underrepresented.length > 0 || allHighPriority.length > 0) && (
            <div className="space-y-3 border-t pt-4">
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

          <Button
            onClick={() => handleStart()}
            disabled={!clinicianName.trim() || !condition.trim() || loading}
            className="w-full"
            size="lg"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                Start interview
                <ArrowRight className="h-4 w-4 ml-1.5" />
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Save current levers as a new recipe */}
      <SaveRecipeDialog
        open={saveRecipeOpen}
        onClose={() => setSaveRecipeOpen(false)}
        clinician={resolvedClinician}
        levers={{ audience, story_type: storyType, tone, voice_mode: voiceMode, cleanup_level: cleanupLevel }}
        existingRecipeCount={recipes.length}
        onSaved={(recipe) => {
          setSaveRecipeOpen(false)
          setSelectedRecipeId(recipe.id)
          toast.success(`Saved recipe "${recipe.name}"`)
        }}
      />
    </div>
  )
}

// ── Recipe dropdown ────────────────────────────────────────────────────────

function RecipeDropdown({ recipes, selectedId, onSelect }) {
  const [open, setOpen] = useState(false)
  const selected = recipes.find((r) => r.id === selectedId)
  const display = selected || { name: 'Custom (no recipe)', emoji: '⚙️' }

  return (
    <div className="space-y-1.5">
      <Label className="text-sm">Recipe</Label>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="w-full flex items-center justify-between gap-2 rounded-lg border border-input bg-background px-3 py-2.5 text-left hover:border-primary/40 transition-colors"
        >
          <span className="inline-flex items-center gap-2 min-w-0">
            <span className="text-base shrink-0">{display.emoji || '⭐'}</span>
            <span className="text-sm font-medium truncate">{display.name}</span>
            {selected?.is_default && (
              <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500 shrink-0" />
            )}
          </span>
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {open && (
          <div className="absolute z-20 mt-1 w-full rounded-lg border border-border bg-white shadow-md py-1">
            {recipes.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => { onSelect(r); setOpen(false) }}
                className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent/30 transition-colors"
              >
                <span className="text-base">{r.emoji || '⭐'}</span>
                <span className="flex-1 truncate">{r.name}</span>
                {r.is_default && (
                  <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500 shrink-0" />
                )}
                {r.id === selectedId && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Active levers pill row ─────────────────────────────────────────────────

function ActiveLeversRow({
  audienceSlot, storyTypeSlot, voiceModeSlot, toneSlot, cleanupSlot,
  tuneOpen, onTuneToggle, canSaveRecipe, onSaveRecipe,
}) {
  const pills = [
    audienceSlot   && { key: 'a', emoji: audienceSlot.emoji,   label: audienceSlot.label },
    storyTypeSlot  && { key: 's', emoji: storyTypeSlot.emoji,  label: storyTypeSlot.label },
    voiceModeSlot  && { key: 'v', emoji: voiceModeSlot.emoji,  label: voiceModeSlot.label },
    toneSlot       && { key: 't', emoji: toneSlot.emoji,       label: toneSlot.label },
    cleanupSlot    && { key: 'c', emoji: cleanupSlot.emoji,    label: cleanupSlot.label },
  ].filter(Boolean)

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {pills.map((p) => (
        <span
          key={p.key}
          className="inline-flex items-center gap-1 text-xs bg-muted/60 text-foreground rounded-full px-2.5 py-1"
        >
          <span className="text-2xs">{p.emoji}</span>
          <span>{p.label}</span>
        </span>
      ))}
      <div className="ml-auto inline-flex items-center gap-2">
        {canSaveRecipe && (
          <button
            type="button"
            onClick={onSaveRecipe}
            className="text-xs text-primary hover:underline"
          >
            Save as recipe
          </button>
        )}
        <button
          type="button"
          onClick={onTuneToggle}
          className="inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Tune
          {tuneOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  )
}

// ── Save recipe dialog ─────────────────────────────────────────────────────

function SaveRecipeDialog({ open, onClose, clinician, levers, existingRecipeCount, onSaved }) {
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('⭐')
  const [isDefault, setIsDefault] = useState(false)
  const createMut = useCreateClinicianRecipe()

  useEffect(() => {
    if (open) {
      setName('')
      setEmoji('⭐')
      // First-ever recipe defaults to is_default=true
      setIsDefault(existingRecipeCount === 0)
    }
  }, [open, existingRecipeCount])

  if (!clinician) return null

  async function handleSave() {
    if (!name.trim()) return
    try {
      const saved = await createMut.mutateAsync({
        clinicianId: clinician.id,
        name: name.trim(),
        emoji: emoji.trim() || '⭐',
        is_default: isDefault,
        audience:      levers.audience      ?? null,
        story_type:    levers.story_type    ?? null,
        tone:          levers.tone          ?? null,
        voice_mode:    levers.voice_mode    ?? null,
        cleanup_level: levers.cleanup_level ?? null,
      })
      onSaved(saved)
    } catch {
      // useAppMutation already surfaces a toast
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save as recipe</DialogTitle>
          <DialogDescription>
            Save the current lever combination so {clinician.name.split(' ')[0]} can re-use it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="recipe-name">Recipe name</Label>
            <Input
              id="recipe-name"
              placeholder="e.g. Patient story for Instagram"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="recipe-emoji">Icon</Label>
            <Input
              id="recipe-emoji"
              value={emoji}
              onChange={(e) => setEmoji(e.target.value)}
              maxLength={4}
              className="w-20"
            />
          </div>
          <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="h-4 w-4"
            />
            Make this the default recipe
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={!name.trim() || createMut.isPending}>
            {createMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save recipe'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Generic slot pickers used in the Tune drawer ───────────────────────────

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

// Used for fixed-id option lists (TONES, VOICE_MODES, CLEANUP_LEVELS, prototypes)
// where the option's identifier lives on a known key (default 'id').
function SimpleSlotPicker({ label, options, value, onChange, idKey = 'id' }) {
  return (
    <div className="space-y-2">
      <Label className="text-sm">{label}</Label>
      <div className="grid grid-cols-2 gap-2">
        {options.map((opt) => (
          <button
            key={String(opt[idKey])}
            type="button"
            onClick={() => onChange(opt[idKey])}
            className={`flex items-start gap-2 rounded-lg border p-2.5 text-left transition-all ${
              value === opt[idKey]
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

function LocationPicker({ locations, value, onChange }) {
  return (
    <div className="space-y-2">
      <Label className="text-sm">Location</Label>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onChange(null)}
          className={`flex items-start gap-2 rounded-lg border p-2.5 text-left transition-all ${
            value === null
              ? 'border-primary bg-primary/5 ring-1 ring-primary'
              : 'border-input hover:border-primary/40 hover:bg-accent/30'
          }`}
        >
          <span className="text-base shrink-0 mt-0.5">🌐</span>
          <div className="min-w-0">
            <p className="text-xs font-semibold leading-tight">All locations</p>
            <p className="text-2xs text-muted-foreground mt-0.5 leading-tight">Generic copy</p>
          </div>
        </button>
        {locations.map((loc) => (
          <button
            key={loc.id}
            type="button"
            onClick={() => onChange(loc.id)}
            className={`flex items-start gap-2 rounded-lg border p-2.5 text-left transition-all ${
              value === loc.id
                ? 'border-primary bg-primary/5 ring-1 ring-primary'
                : 'border-input hover:border-primary/40 hover:bg-accent/30'
            }`}
          >
            <span className="text-base shrink-0 mt-0.5">📍</span>
            <div className="min-w-0">
              <p className="text-xs font-semibold leading-tight">{loc.label || loc.city}</p>
              <p className="text-2xs text-muted-foreground mt-0.5 leading-tight truncate">
                {[loc.city, loc.region].filter(Boolean).join(', ')}
              </p>
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

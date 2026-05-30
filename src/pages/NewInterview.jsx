import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { useUser, useAuth } from '@clerk/react'
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
import { getOrCreateStaff, createInterview } from '@/lib/api'
import { useStaff, useStaffRecipes, useCreateStaffRecipe } from '@/lib/queries'
import { getSuggestedTopics } from '@/lib/topicSuggestions'
import { TONES, getVoiceModes, getPatientPrototypesUi } from '@/lib/prompts'
import { useWorkspace } from '@/lib/WorkspaceContext'
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
  const [staffName, setStaffName] = useState(preferredName)
  const [condition, setCondition] = useState(searchParams.get('topic') || '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Lever state — each starts at a sensible default, gets overridden when a
  // recipe is applied or the user opens Tune and edits manually.
  const [tone, setTone] = useState('smart')
  const [voiceMode, setVoiceMode] = useState('practice')
  const [prototype, setPrototype] = useState(null)
  const [locationId, setLocationId] = useState(null)
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
    if (name && !staffName) setStaffName(name)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.unsafeMetadata?.display_name, user?.fullName])

  const activeLocations = Array.isArray(workspace?.locations)
    ? workspace.locations.filter(l => l.status === 'active')
    : []
  const showLocationPicker = activeLocations.length > 1

  // Resolve typed clinician name → existing clinician row (case-insensitive)
  // so we can fetch their recipes. If they don't exist yet (first interview),
  // recipes stay empty and the UI uses generic defaults.
  const { data: staffForSuggestions = [], isLoading: staffLoading } = useStaff()
  const resolvedStaff = useMemo(() => {
    const name = staffName.trim().toLowerCase()
    if (!name) return null
    return staffForSuggestions.find(
      (c) => c.name.trim().toLowerCase() === name
    )
  }, [staffForSuggestions, staffName])

  const { data: recipes = [], isLoading: recipesLoading } = useStaffRecipes(resolvedStaff?.id)

  // Apply a recipe's levers + clear the "drift from recipe" flag by setting
  // selectedRecipeId. Sticky: levers stay until the user either picks another
  // recipe or edits something in Tune. (audience / story_type were removed in
  // the voice-fidelity overhaul — legacy recipes may still carry them, but we
  // no longer apply them.)
  function applyRecipe(recipe) {
    setSelectedRecipeId(recipe.id)
    if (recipe.tone)          setTone(recipe.tone)
    if (recipe.voice_mode)    setVoiceMode(recipe.voice_mode)
    if (recipe.cleanup_level) setCleanupLevel(recipe.cleanup_level)
  }

  // Auto-apply the clinician's default recipe on first recipe load. When no
  // recipe exists, fall back to the clinician's default_tone preference so
  // the tone picker reflects their saved preference instead of hardcoded 'smart'.
  const [autoAppliedFor, setAutoAppliedFor] = useState(null)
  useEffect(() => {
    if (!resolvedStaff || recipesLoading) return
    if (autoAppliedFor === resolvedStaff.id) return
    const defaultRecipe = recipes.find((r) => r.is_default) || recipes[0]
    if (defaultRecipe) {
      applyRecipe(defaultRecipe)
    } else if (resolvedStaff.default_tone) {
      // No saved recipe — use the clinician's preferred tone
      setTone(resolvedStaff.default_tone)
    }
    setAutoAppliedFor(resolvedStaff.id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedStaff?.id, recipes.length, recipesLoading])

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

  const existingTopics = staffForSuggestions.flatMap((c) =>
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
  const suggestionsLoading = staffLoading

  async function handleStart(selectedCondition) {
    const topic = (selectedCondition ?? condition).trim()
    if (!staffName.trim() || !topic || !user) return

    // Self-detection — if the typed clinician name matches the user's
    // display name OR Clerk full name (case-insensitive), bind the
    // clinician row to user.id so renames don't fork the identity.
    const typed = staffName.trim().toLowerCase()
    const display = (user?.unsafeMetadata?.display_name || '').trim().toLowerCase()
    const full    = (user?.fullName || '').trim().toLowerCase()
    const isSelf  = !!typed && (typed === display || typed === full)

    setLoading(true)
    setError('')
    try {
      const clinician = await getOrCreateStaff({
        name: staffName.trim(),
        createdById: user.id,
        createdByEmail: user.primaryEmailAddress?.emailAddress,
        userId: isSelf ? user.id : undefined,
      })
      const interview = await createInterview({
        staffId: clinician.id,
        topic,
        ownerEmail: user.primaryEmailAddress?.emailAddress,
        tone,
        voiceMode,
        prototypeId: prototype,
        locationId,
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
  // (emoji + label). Voice mode is shown as a prominent picker above, so it's
  // not duplicated in the pill row.
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
          <h1 className="text-2xl font-bold tracking-tight flex items-center">
            <span
              className="inline-block w-1 h-6 rounded-full shrink-0 mr-2.5"
              style={{ background: 'hsl(var(--primary))' }}
              aria-hidden="true"
            />
            New Interview
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Set up and start in one screen</p>
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
            <Label htmlFor="clinician">Staff member</Label>
            <Input
              id="clinician"
              placeholder="e.g. Dr. Quasney"
              value={staffName}
              onChange={(e) => setStaffName(e.target.value)}
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

          {/* Whose voice — the one lane decision that shapes every output.
              Always visible (not buried in Tune): "We" (clinic) vs "I"
              (personal). Set once here at interview start. */}
          <div className="space-y-1.5">
            <Label className="text-sm">Whose voice is this interview in?</Label>
            <SimpleSlotPicker
              label=""
              options={VOICE_MODES}
              value={voiceMode}
              onChange={(v) => { setVoiceMode(v); markDrift() }}
              idKey="id"
            />
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
            toneSlot={toneSlot}
            cleanupSlot={cleanupSlot}
            tuneOpen={tuneOpen}
            onTuneToggle={() => setTuneOpen((o) => {
              const next = !o
              if (next) {
                setTimeout(() => {
                  document.querySelector('[data-tune-section]')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }, 50)
              }
              return next
            })}
            canSaveRecipe={!selectedRecipeId && !!resolvedStaff}
            onSaveRecipe={() => setSaveRecipeOpen(true)}
          />

          {/* Tune drawer — individual lever pickers */}
          {tuneOpen && (
            <div data-tune-section className="space-y-4 border-t pt-4 scroll-mt-20">
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

          {/* Start interview — primary CTA. Placed above the topic
              suggestion list so it stays above the fold; when the user
              picks a suggestion the chip itself triggers the same
              handler. */}
          <Button
            onClick={() => handleStart()}
            disabled={!staffName.trim() || !condition.trim() || loading}
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
        </CardContent>
      </Card>

      {/* Save current levers as a new recipe */}
      <SaveRecipeDialog
        open={saveRecipeOpen}
        onClose={() => setSaveRecipeOpen(false)}
        clinician={resolvedStaff}
        levers={{ tone, voice_mode: voiceMode, cleanup_level: cleanupLevel }}
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
  toneSlot, cleanupSlot,
  tuneOpen, onTuneToggle, canSaveRecipe, onSaveRecipe,
}) {
  const pills = [
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
  const createMut = useCreateStaffRecipe()

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
        staffId: clinician.id,
        name: name.trim(),
        emoji: emoji.trim() || '⭐',
        is_default: isDefault,
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

// Used for fixed-id option lists (TONES, VOICE_MODES, CLEANUP_LEVELS, prototypes)
// where the option's identifier lives on a known key (default 'id'). Pass an
// empty `label` to render without a heading (caller supplies its own).
function SimpleSlotPicker({ label, options, value, onChange, idKey = 'id' }) {
  return (
    <div className="space-y-2">
      {label ? <Label className="text-sm">{label}</Label> : null}
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
      className="group flex items-center gap-1.5 text-xs px-3 py-2 min-h-[36px] rounded-full border border-input hover:bg-primary hover:text-primary-foreground hover:border-primary active:bg-primary/90 active:text-primary-foreground transition-colors disabled:opacity-50"
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

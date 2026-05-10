import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { useUser } from '@clerk/clerk-react'
import { ArrowLeft, ArrowRight, Stethoscope, User, Loader2, TrendingUp, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { getOrCreateClinician, createInterview, fetchClinicians } from '@/lib/api'
import { getSuggestedTopics } from '@brand-overlay/topicSuggestions'
import { TONES, getVoiceModes, PATIENT_PROTOTYPES_UI } from '@/lib/prompts'
import { useWorkspace } from '@/lib/WorkspaceContext'

export default function NewInterview() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user } = useUser()
  const workspace = useWorkspace()
  const VOICE_MODES = getVoiceModes(workspace)

  const [clinicianName, setClinicianName] = useState('')
  const [condition, setCondition] = useState(searchParams.get('topic') || '')
  const [step, setStep] = useState(searchParams.get('topic') ? 1 : 1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [tone, setTone] = useState('smart')
  const [voiceMode, setVoiceMode] = useState('practice')
  const [prototype, setPrototype] = useState(null)
  const [suggestions, setSuggestions] = useState([])
  const [suggestionsLoading, setSuggestionsLoading] = useState(true)

  useEffect(() => {
    fetchClinicians()
      .then((clinicians) => {
        const existingTopics = clinicians.flatMap((c) =>
          (c.interviews || []).map((i) => i.topic)
        )
        setSuggestions(getSuggestedTopics(existingTopics))
      })
      .catch(() => setSuggestions(getSuggestedTopics([])))
      .finally(() => setSuggestionsLoading(false))
  }, [])

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
                <CardDescription>Enter the clinician's full name</CardDescription>
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
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                If this clinician has been interviewed before, they'll be linked to their existing profile.
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
            {/* Patient prototype selector — only rendered when the workspace has archetypes */}
            {PATIENT_PROTOTYPES_UI.length > 1 && (
              <div className="space-y-2">
                <Label className="text-sm">Patient archetype</Label>
                <div className="grid grid-cols-2 gap-2">
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
                        <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">{p.description}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Voice mode selector */}
            <div className="space-y-2">
              <Label className="text-sm">Voice</Label>
              <div className="grid grid-cols-2 gap-2">
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
                      <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">{v.description}</p>
                    </div>
                  </button>
                ))}
              </div>
              {voiceMode === 'personal' && (
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Personal interviews skip ad-style outputs (Instagram Ads, Google Ads, landing page, email newsletter).
                </p>
              )}
            </div>

            {/* Tone selector */}
            <div className="space-y-2">
              <Label className="text-sm">Content tone</Label>
              <div className="grid grid-cols-2 gap-2">
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
                      <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">{t.description}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="condition">Condition, treatment, or topic</Label>
              <Input
                id="condition"
                placeholder="e.g. Low back pain, IT band rehab, postpartum recovery…"
                value={condition}
                onChange={(e) => setCondition(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleStart()}
                autoFocus
              />
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
                      <TrendingUp className="h-3.5 w-3.5 text-amber-500" />
                      <p className="text-xs font-medium text-amber-700">
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
                  <p className="text-xs text-muted-foreground mb-2">Popular in the Pacific Northwest:</p>
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

function TopicChip({ label, count, priority, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="group flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border border-input hover:bg-primary hover:text-primary-foreground hover:border-primary transition-colors disabled:opacity-50"
    >
      {label}
      {count > 0 && (
        <span className="text-[10px] opacity-60 group-hover:opacity-80">
          {count}×
        </span>
      )}
      {count === 0 && priority === 'high' && (
        <span className="text-[10px] text-amber-500 group-hover:text-primary-foreground">new</span>
      )}
    </button>
  )
}

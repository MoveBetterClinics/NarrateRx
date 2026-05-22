import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useUser } from '@clerk/clerk-react'
import { ArrowLeft, Loader2, Sparkles, AlertCircle, Mic, MicOff, Volume2, Mic2, PauseCircle, Quote, X, ArrowLeftRight, CheckCircle2, Circle, Check, RefreshCw, Send, Keyboard } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { apiFetch, fetchSimilarInterviews, fetchClinician, updateInterview, cleanupTranscript, populateContentItemProvenance } from '@/lib/api'
import { extractProvenanceBlock } from '@/lib/provenance'
import { useClinician, useInterview, queryKeys } from '@/lib/queries'
import { useQueryClient } from '@tanstack/react-query'
import { streamMessage } from '@/lib/claude'
import { getInterviewSystemPrompt, getBlogPostSystemPrompt, getMinimalEditSystemPrompt, TONES, getVoiceModes, getPatientPrototypesUi, buildVerbatimBlock } from '@/lib/prompts'
import { resolveAudienceSlot, resolveStoryTypeSlot } from '@/lib/interviewOptionsCatalog'
import { detectEmotionalState, getEmotionPromptInjection } from '@/lib/emotionDetection'
import { getInitials } from '@/lib/utils'
import { workspace } from '@/lib/workspace'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { applyLocationOverlay } from '@/lib/locationOverlay'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { ConfirmDialog } from '@/components/ui/alert-dialog'
import MicCheck from '@/components/MicCheck'
import { createTtsPlayer, primeAudioPlayback, onAudioPlaybackFailure } from '@/lib/tts'
import { useRegisterBusy } from '@/lib/appBusy'

// Concrete noun list for shallow-answer detection (Feature 2)
const CONCRETE_NOUNS = ['patient', 'person', 'name', 'case', 'example', 'time', 'moment', 'client', 'athlete', 'runner', 'worker']

function isShallowAnswer(text) {
  const words = text.trim().split(/\s+/)
  if (words.length >= 15) return false
  const lower = text.toLowerCase()
  return !CONCRETE_NOUNS.some((noun) => lower.includes(noun))
}

// Token format: [CONTRAST][ClinicianlastName] or legacy [CONTRAST]
// Extract the embedded clinician name if present, e.g. [CONTRAST][Sarah] → "Sarah"
function extractContrastName(text) {
  const m = text.match(/\[CONTRAST\]\[([^\]]+)\]/)
  return m ? m[1] : null
}

function stripContrastToken(text) {
  return text.replace(/\[CONTRAST\](\[[^\]]*\])?/g, '').trim()
}

function hasContrastSignal(text) {
  return text.includes('[CONTRAST]')
}

// Token format: [AGREEMENT][ClinicianName] or legacy [AGREEMENT]
// Extract the embedded clinician name if present, e.g. [AGREEMENT][Sarah] → "Sarah"
function extractAgreementName(text) {
  const m = text.match(/\[AGREEMENT\]\[([^\]]+)\]/)
  return m ? m[1] : null
}

function stripAgreementToken(text) { return text.replace(/\[AGREEMENT\](\[[^\]]*\])?/g, '').trim() }
function hasAgreementSignal(text)   { return text.includes('[AGREEMENT]') }

function stripGapToken(text) { return text.replace(/\[GAP\]/g, '').trim() }
function hasGapSignal(text)  { return text.includes('[GAP]') }

const COMPLETE_TOKEN = 'INTERVIEW_COMPLETE'

// Per-interview localStorage key for the messages backup. The DB save can
// fail silently — network blip, expired Clerk token, iOS WebKit dropping the
// PATCH on background — and the only previous safety net was React state in
// memory. A clinician 20 minutes deep who refreshes the tab then sees the AI
// restart at question 1 because the DB row still has `messages: []`. The
// local backup is the rescue: on resume, if the DB has fewer messages than
// the local copy, we restore from local and push it back up.
function lsKey(interviewId) {
  return `narraterx:interview:${interviewId}:messages`
}

function loadLocalMessages(interviewId) {
  if (typeof window === 'undefined' || !interviewId) return null
  try {
    const raw = window.localStorage.getItem(lsKey(interviewId))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed?.messages)) return null
    return parsed
  } catch {
    return null
  }
}

function saveLocalMessages(interviewId, messages) {
  if (typeof window === 'undefined' || !interviewId) return
  try {
    window.localStorage.setItem(lsKey(interviewId), JSON.stringify({
      messages,
      savedAt: new Date().toISOString(),
    }))
  } catch {
    // Quota or private-mode failure — non-fatal
  }
}

function clearLocalMessages(interviewId) {
  if (typeof window === 'undefined' || !interviewId) return
  try { window.localStorage.removeItem(lsKey(interviewId)) } catch { /* ignore */ }
}

// Session-end phrases — matched at end of utterance to signal interview completion.
// "next question" and "move on" are intentionally excluded here: they're opt-out
// signals handled by emotionDetection (→ 'resistant' state) so the AI transitions
// topics gracefully rather than ending the session.
const STOP_PHRASES = [
  "that's all",
  "that's it",
  "i'm done",
  "i am done",
  "send it",
  "send that",
  "submit",
  "done",
]

function detectAndStripStopPhrase(transcript) {
  const normalized = transcript.trimEnd().toLowerCase()
  for (const phrase of STOP_PHRASES) {
    if (normalized.endsWith(phrase)) {
      const stripped = transcript.trimEnd()
      const cleaned = stripped.slice(0, stripped.length - phrase.length).trimEnd()
      return cleaned.length > 0 ? cleaned : ''
    }
  }
  return null
}

export default function InterviewSession() {
  useDocumentTitle('Interview')
  const { clinicianId, interviewId } = useParams()
  const navigate = useNavigate()
  const { user } = useUser()
  // Track the visual viewport height so the interview wrapper shrinks when
  // the iOS keyboard opens. `100dvh` accounts for the address bar but NOT
  // the soft keyboard — without this, the typed-answer dock (and its
  // textarea) end up hidden behind the keyboard on iPhone. Falls back to
  // null on browsers without visualViewport; the CSS calc handles those.
  const [vvHeight, setVvHeight] = useState(null)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) return
    const vv = window.visualViewport
    const update = () => setVvHeight(vv.height)
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    update()
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])

  const runtimeWorkspace = useWorkspace()
  const VOICE_MODES = getVoiceModes(runtimeWorkspace)
  const PATIENT_PROTOTYPES_UI = getPatientPrototypesUi(runtimeWorkspace)

  // Initial fetches go through the shared query cache. Cache hits when the
  // user navigates here from the clinician profile (already warm) or
  // returns to a previously-loaded interview within the gcTime window.
  const qc = useQueryClient()
  const { data: clinicianData } = useClinician(clinicianId)
  const { data: interviewData, isLoading: interviewLoading } = useInterview(interviewId)
  const clinician = clinicianData ?? null
  const [interview, setInterview] = useState(null)
  const loading = interviewLoading || !clinician || !interview
  const [messages, setMessages] = useState([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [interviewComplete, setInterviewComplete] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [generationStyle, setGenerationStyle] = useState('blog_post')
  const [error, setError] = useState('')
  const [isListening, setIsListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  // Typed-answer fallback. SpeechRecognition is unavailable on iOS Safari
  // (and any non-Chromium browser); when absent, the mic UI is replaced by a
  // textarea + Send button. We compute support once at mount so we don't
  // re-detect on every render.
  const hasSpeechRecognition = typeof window !== 'undefined' &&
    !!(window.SpeechRecognition || window.webkitSpeechRecognition)
  const [typedAnswer, setTypedAnswer] = useState('')
  const [isSpeaking, setIsSpeaking] = useState(false)
  // Tell app-wide consumers (e.g. the auto-update modal) not to interrupt
  // the user while a recording/streaming/generation is in flight. A
  // window.location.reload() in the middle of any of these wipes the
  // in-memory transcript before it's saved.
  useRegisterBusy(
    'interview-session',
    isListening || isSpeaking || isStreaming || isGenerating,
  )
  // True after an audio playback failure (iOS route change, BT disconnect,
  // audio-session interruption). Surfaces a "Tap to restore audio" button so
  // the user can re-prime audio inside a fresh user gesture.
  const [audioInterrupted, setAudioInterrupted] = useState(false)
  const [showInstructions, setShowInstructions] = useState(true)
  // micCheckPassed gates the mic check screen shown after the pre-interview
  // instructions but before the AI sends its first question.
  const [micCheckPassed, setMicCheckPassed] = useState(false)
  const [saveStatus, setSaveStatus] = useState('') // '' | 'saving' | 'saved' | 'error'
  // Resume banner: true for 1.5s when returning to a session with saved state
  const [showResumeBanner, setShowResumeBanner] = useState(false)
  // Verbatim-flag UX state. selectionTip = { text, top, left } when the user has
  // selected a chunk of clinician text inside the conversation log that's a
  // valid substring of the user-message transcript; otherwise null.
  const [selectionTip, setSelectionTip] = useState(null)
  const conversationRef = useRef(null)

  const bottomRef = useRef(null)
  const hasStarted = useRef(false)
  const recognitionRef = useRef(null)
  const messagesRef = useRef([])
  const transcriptRef = useRef('')
  const autoListenRef = useRef(false)
  // Track consecutive auto-listen 'aborted' errors so we can retry once with a
  // longer delay (iOS audio session sometimes hasn't released the mic by the
  // 700ms mark after TTS ends) and then bail to "tap to talk" rather than
  // looping forever.
  const autoListenAbortRetryRef = useRef(0)
  // "User is answering right now" — set true on mic-on, false when the user
  // explicitly ends their turn (taps mic, says a stop phrase, interview ends).
  // Used to auto-resume the SpeechRecognition engine through thinking pauses:
  // browsers throw 'no-speech' after a few seconds of silence and end the
  // session, but if the user is still in their answer turn we silently
  // restart the engine so pauses don't cut them off.
  const userAnswerActiveRef = useRef(false)
  // Cap auto-restarts per turn so a stuck mic can't loop forever. With a
  // typical 3-7s no-speech timeout this is ~3 minutes of pure silence —
  // far more thinking time than any answer needs.
  const restartCountRef = useRef(0)
  const RESTART_CAP = 30
  // Stable timer ref so we can cancel pending restarts on stop/cleanup.
  const restartTimerRef = useRef(null)
  const finalTranscriptRef = useRef('')
  const interviewRef = useRef(null)
  const pastInterviewsRef = useRef([])
  // Emotional-state ref: 'weighted' | 'resistant' | null.
  // Set after each user message; reset to null after each AI response completes.
  // State is per-exchange — not persistent across the whole session.
  const emotionStateRef = useRef(null)
  // Track which user-message indexes have already triggered a re-probe
  const reprobedIndexesRef = useRef(new Set())
  // Prior session context for returning clinicians
  const priorSessionContextRef = useRef(null)
  // Neural-TTS player (ElevenLabs) with speechSynthesis fallback. Constructed
  // lazily so SSR / no-window environments don't blow up. See src/lib/tts.js.
  const ttsRef = useRef(null)
  function getTts() {
    if (!ttsRef.current) ttsRef.current = createTtsPlayer()
    return ttsRef.current
  }
  // Learned practice knowledge from concept graph — fetched once at session start
  const conceptBlockRef   = useRef('')
  const agreementBlockRef = useRef('')
  const gapBlockRef       = useRef('')
  // Refs for pause/resume persistence
  const sessionSaveTimerRef = useRef(null)
  const userIdRef = useRef(null)
  const interviewCompleteRef = useRef(false)
  // Seeding guard: messages restoration runs exactly once per interview-id
  // mount. Without this, every React Query background refetch (window focus,
  // network reconnect, post-save invalidation) re-fires the seeding effect
  // with a stale DB row and clobbers in-flight local state — which is how
  // clinicians lost 5–6 saved responses mid-session and got bounced back to
  // question 1.
  const hasSeededRef = useRef(false)
  const seededForIdRef = useRef(null)
  // Reset the guard when the interview id changes so navigating between
  // interviews still re-seeds the new one correctly. This runs synchronously
  // during render — that's intentional: by the time the seeding effect
  // below reads hasSeededRef, the flag must already be cleared for the new id.
  if (seededForIdRef.current !== interviewId) {
    seededForIdRef.current = interviewId
    hasSeededRef.current = false
  }

  function saveMessages(interviewId, patch) {
    // Always mirror to localStorage FIRST so the data survives even if the
    // server PATCH never lands (auth blip, network, iOS WebKit kill).
    if (Array.isArray(patch?.messages)) saveLocalMessages(interviewId, patch.messages)

    setSaveStatus('saving')
    updateInterview(interviewId, patch)
      .then((updated) => {
        // Cross-component invalidation: any view watching this interview
        // (Dashboard's resume list, clinician profile's interview summary)
        // re-fetches on next render rather than staying frozen.
        if (updated?.id) qc.setQueryData(queryKeys.interviews.detail(updated.id), updated)
        qc.invalidateQueries({ queryKey: queryKeys.interviews.all })
        qc.invalidateQueries({ queryKey: queryKeys.clinicians.all })
        setSaveStatus('saved')
        setTimeout(() => setSaveStatus(''), 2000)
      })
      .catch((err) => {
        console.error('[InterviewSession] save failed', err?.status, err?.message)
        setSaveStatus('error')
      })
  }

  useEffect(() => { messagesRef.current = messages }, [messages])
  useEffect(() => { transcriptRef.current = transcript }, [transcript])
  useEffect(() => { interviewRef.current = interview }, [interview])
  useEffect(() => { userIdRef.current = user?.id }, [user?.id])
  useEffect(() => { interviewCompleteRef.current = interviewComplete }, [interviewComplete])

  // Build the session_state payload from the current messages ref.
  // Called both from the debounced effect and from the unload/visibility handlers.
  function buildSessionState(msgs) {
    return {
      messages: msgs,
      paused_at: new Date().toISOString(),
    }
  }

  // Persist session_state immediately — used by unload/visibility handlers.
  // Uses a keepalive fetch with the Clerk bearer token so the request can
  // continue past navigation. sendBeacon was previously used but cannot set
  // an Authorization header, so it would fail server-side auth (server only
  // accepts verified Clerk tokens since the 2026-05-21 audit P0 #4 fix).
  // Localstorage mirroring (saveLocalMessages) is the real safety net if
  // this best-effort flush is dropped.
  async function flushSessionState(msgs) {
    const uid = userIdRef.current
    if (!uid || interviewCompleteRef.current || !msgs.length) return
    const url = `/api/db/interviews?id=${encodeURIComponent(interviewId)}`
    const payload = JSON.stringify({
      session_state: buildSessionState(msgs),
      paused_at: new Date().toISOString(),
    })
    try {
      const token = await window.Clerk?.session?.getToken?.()
      if (!token) return
      await fetch(url, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        credentials: 'include',
        body: payload,
        keepalive: true,
      })
    } catch {
      // Best-effort; localStorage mirror already happened upstream.
    }
  }

  // Debounced auto-save of session_state whenever messages change.
  // Runs 3s after the last message update. Skipped when interview is done
  // (session_state is cleared on completion instead). Also mirrors to
  // localStorage immediately on every messages change as a last-line backup.
  useEffect(() => {
    if (!interviewId || messages.length === 0) return
    // Local backup runs even before any server save and even if user isn't ready.
    saveLocalMessages(interviewId, messages)
    if (!user?.id || interviewComplete) return
    clearTimeout(sessionSaveTimerRef.current)
    sessionSaveTimerRef.current = setTimeout(() => {
      updateInterview(
        interviewId,
        { session_state: buildSessionState(messages), paused_at: new Date().toISOString() },
      ).catch((err) => {
        console.error('[InterviewSession] session_state autosave failed', err?.status, err?.message)
        setSaveStatus('error')
      })
    }, 3000)
    return () => clearTimeout(sessionSaveTimerRef.current)
  }, [messages, interviewComplete, user?.id, interviewId])

  // Immediate flush on tab hide or page unload.
  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === 'hidden') flushSessionState(messagesRef.current)
    }
    function onBeforeUnload() {
      flushSessionState(messagesRef.current)
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [interviewId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Seed local interview state (which we then mutate during conversation)
  // from the cached row. Bounce back to dashboard on a hard 404 — the
  // useInterview hook returns null in that case via the queryFn's contract.
  useEffect(() => {
    if (interviewLoading) return
    if (!interviewData) { navigate('/'); return }
    // Always refresh the interview metadata object (topic, status, outputs,
    // location, owner) — that's safe to track from server. But messages
    // restoration is one-shot per mount, guarded below.
    setInterview(interviewData)
    if (hasSeededRef.current) return
    hasSeededRef.current = true
    setGenerationStyle(interviewData.generation_style || 'blog_post')

    // Resume from session_state if available (paused mid-interview).
    // session_state.messages is the authoritative source when present; it
    // may be ahead of the DB messages column (which only saves on each
    // user turn, not on every AI response). Prefer session_state so the
    // resumed transcript matches exactly what the clinician saw before pausing.
    //
    // The localStorage backup wins over the server when it has MORE messages —
    // that's the signature of saves having failed silently mid-session. When
    // we pick the local copy, push it back up so the server catches up.
    const savedState = interviewData.session_state
    const serverMessages = savedState?.messages ?? interviewData.messages ?? []
    const localBackup = loadLocalMessages(interviewId)
    const localMessages = Array.isArray(localBackup?.messages) ? localBackup.messages : []
    const useLocal = localMessages.length > serverMessages.length
    const restoredMessages = useLocal ? localMessages : serverMessages
    if (useLocal) {
      console.warn(
        '[InterviewSession] Restoring messages from localStorage backup',
        { local: localMessages.length, server: serverMessages.length, interviewId },
      )
      setSaveStatus('recovered')
      // Push the recovered state back to the server so subsequent loads
      // don't need the local backup.
      if (user?.id) {
        saveMessages(
          interviewId,
          {
            messages: restoredMessages,
            session_state: { messages: restoredMessages, paused_at: new Date().toISOString() },
          },
        )
      }
    }
    setMessages(restoredMessages)

    if (restoredMessages.some((m) => m.content?.includes(COMPLETE_TOKEN))) {
      setInterviewComplete(true)
    }
    if (restoredMessages.length > 0) {
      // Resuming an existing interview — skip instructions and mic check
      setShowInstructions(false)
      setMicCheckPassed(true)
      // Show a brief "Resuming…" banner if we're restoring saved state
      if (savedState?.messages?.length) {
        setShowResumeBanner(true)
        setTimeout(() => setShowResumeBanner(false), 1500)
      }
    }

    // These three are AI prompt-context enrichments. Each one failing
    // degrades the AI's history awareness but does not block the interview,
    // so they stay non-fatal. We DO log so prod issues are visible in
    // vercel logs — a previously-silent .catch(() => {}) hid the fact
    // that these can fail at all.
    fetchSimilarInterviews(interviewData.topic, interviewId)
      .then((past) => { pastInterviewsRef.current = past || [] })
      .catch((err) => console.warn('[InterviewSession] fetchSimilarInterviews failed', err?.status, err?.message))

    // Fetch learned practice knowledge for this topic — injected into every
    // system prompt for this session. Fails silently (empty block = graceful noop).
    const clinicianParam = clinicianId ? `&clinician_id=${encodeURIComponent(clinicianId)}` : ''
    fetch(`/api/concepts/context?topic=${encodeURIComponent(interviewData.topic || '')}${clinicianParam}`)
      .then((r) => r.ok ? r.json() : { block: '', agreementBlock: '', gapBlock: '' })
      .then(({ block, agreementBlock, gapBlock }) => {
        conceptBlockRef.current   = block          || ''
        agreementBlockRef.current = agreementBlock || ''
        gapBlockRef.current       = gapBlock       || ''
      })
      .catch((err) => console.warn('[InterviewSession] concepts/context failed', err?.status, err?.message))

    // Feature 5: use clinician data (already fetched) to find prior sessions
    // for returning clinicians. fetchClinician returns interviews with topic+status
    // but not messages — topic alone is enough for the keyword-overlap check and
    // the system prompt reference.
    fetchClinician(clinicianId)
      .then((clinicianRow) => {
        const priorInterviews = (clinicianRow?.interviews || [])
          .filter((iv) => iv.status === 'completed' && iv.id !== interviewId)
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        if (priorInterviews.length === 0) return
        const prior = priorInterviews[0]
        if (!prior.topic) return
        // Simple keyword-overlap check: at least 1 word (>3 chars) in common
        const topicWords = (interviewData.topic || '').toLowerCase().split(/\W+/).filter((w) => w.length > 3)
        const priorWords = prior.topic.toLowerCase().split(/\W+/).filter((w) => w.length > 3)
        const hasOverlap = topicWords.some((w) => priorWords.includes(w))
        if (!hasOverlap) return
        priorSessionContextRef.current = { topic: prior.topic }
      })
      .catch((err) => console.warn('[InterviewSession] prior session fetch failed', err?.status, err?.message))
    // `saveMessages` is a stable scope-level helper; `user.id` doesn't change
    // mid-session (the auth-gated route remounts on user change). Listing
    // them would re-fire this seeding effect and clobber in-progress state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interviewLoading, interviewData, interviewId, navigate, clinicianId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingText])

  useEffect(() => {
    return () => {
      ttsRef.current?.cancel()
      window.speechSynthesis?.cancel()
      userAnswerActiveRef.current = false
      clearTimeout(restartTimerRef.current)
      recognitionRef.current?.abort()
    }
  }, [])

  // Release the mic the moment the interview ends. Without this, the
  // SpeechRecognition session can linger and the browser tab keeps the
  // recording indicator (red dot) lit even though there's nothing to capture.
  useEffect(() => {
    if (!interviewComplete) return
    userAnswerActiveRef.current = false
    clearTimeout(restartTimerRef.current)
    recognitionRef.current?.abort()
  }, [interviewComplete])

  // Subscribe to global audio-playback failures (iOS route change, BT
  // disconnect, audio session interruption). When one fires we surface a
  // recovery button rather than letting the interview proceed silently.
  useEffect(() => {
    const unsubscribe = onAudioPlaybackFailure(() => setAudioInterrupted(true))
    return unsubscribe
  }, [])

  function speak(text) {
    setIsSpeaking(true)
    // Per-clinician TTS preferences live on clinicians.tts_settings (JSONB).
    // Today only `speed` is exposed in the UI; voiceId is reserved for a
    // future per-clinician voice picker. Falls through to env-var defaults
    // server-side when these are undefined.
    const tts = clinician?.tts_settings || {}
    getTts().speak(text, {
      voiceId: tts.voice_id || undefined,
      speed: typeof tts.speed === 'number' ? tts.speed : undefined,
      onStart: () => setIsSpeaking(true),
      onEnd: () => {
        setIsSpeaking(false)
        autoListenRef.current = true
      },
      onError: () => setIsSpeaking(false),
    })
  }

  // Called from inside the user-gesture "Restore audio" click handler.
  // Rebuilds a primed <audio> element and re-speaks the most recent
  // assistant message so the user catches up on what they missed.
  function handleRestoreAudio() {
    primeAudioPlayback()
    setAudioInterrupted(false)
    const lastAssistant = [...messagesRef.current].reverse().find((m) => m.role === 'assistant')
    if (lastAssistant && !interviewComplete) {
      speak(stripGapToken(stripAgreementToken(stripContrastToken(lastAssistant.content))))
    }
  }

  useEffect(() => {
    // Skip auto-listen on browsers without SpeechRecognition (iOS Safari etc.) —
    // the typed-answer fallback UI is shown instead.
    if (!hasSpeechRecognition) return
    if (!isSpeaking && autoListenRef.current && !isStreaming && !interviewComplete) {
      autoListenRef.current = false
      // 700ms gives iOS more time to release the audio session from TTS
      // playback before the mic engine tries to claim it — at 400ms iOS
      // Chrome was throwing 'aborted' regularly.
      const timer = setTimeout(() => startListening(), 700)
      return () => clearTimeout(timer)
    }
    // `startListening` is a stable function defined in this component scope.
    // Including it as a dep would re-fire the effect on every render and is
    // unnecessary — the auto-listen trigger only depends on the three flags.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSpeaking, isStreaming, interviewComplete])

  const sendToAI = useCallback(async (currentMessages) => {
    if (!clinician || !interviewRef.current) return
    setIsStreaming(true)
    setStreamingText('')
    setError('')

    const interviewLocation = (runtimeWorkspace?.locations || []).find(
      l => l.id === interviewRef.current?.location_id
    )
    const overlaidWorkspace = applyLocationOverlay(runtimeWorkspace, interviewLocation)

    // First message = AI introduces itself; subsequent = skip intro
    const isFirstMessage = currentMessages.length === 0 ||
      (currentMessages.length === 1 && currentMessages[0].role === 'user' && currentMessages[0].content === 'Please begin the interview.')

    // Detect shallow previous answer for re-probe instruction
    const userMessages = currentMessages.filter((m) => m.role === 'user')
    const lastUserIdx = userMessages.length - 1
    const lastUserMsg = userMessages[lastUserIdx]
    const shouldReprobe = lastUserMsg &&
      isShallowAnswer(lastUserMsg.content) &&
      !reprobedIndexesRef.current.has(lastUserIdx)
    if (shouldReprobe) reprobedIndexesRef.current.add(lastUserIdx)

    const baseSystemPrompt = getInterviewSystemPrompt(
      overlaidWorkspace,
      clinician.name,
      interviewRef.current.topic,
      pastInterviewsRef.current,
      interviewRef.current?.prototype_id,
      {
        tone: interviewRef.current?.tone || 'smart',
        isFirstMessage,
        shallowReprobe: shouldReprobe,
        priorSessionContext: priorSessionContextRef.current,
        conceptBlock:   conceptBlockRef.current,
        agreementBlock: agreementBlockRef.current,
        gapBlock:       gapBlockRef.current,
        audienceSlot:   resolveAudienceSlot(interviewRef.current?.audience, overlaidWorkspace?.audience_options),
        storyTypeSlot:  resolveStoryTypeSlot(interviewRef.current?.story_type, overlaidWorkspace?.story_type_options),
      }
    )

    // Append per-exchange emotional context if detected, then clear the ref
    // so it doesn't bleed into subsequent turns.
    const emotionInjection = getEmotionPromptInjection(emotionStateRef.current)
    emotionStateRef.current = null
    const systemPrompt = emotionInjection ? baseSystemPrompt + emotionInjection : baseSystemPrompt

    // Strip [CONTRAST] tokens from messages before sending to API
    // (the token is for our UI layer, not for the model to see in history)
    let apiMessages = currentMessages.map((m) => ({
      role: m.role,
      content: m.role === 'assistant' ? stripGapToken(stripAgreementToken(stripContrastToken(m.content))) : m.content,
    }))
    // Cap the history window for interview turns. Full history is kept in state
    // for display; only the last 20 messages (≈ 10 exchanges) go to the API to
    // prevent unbounded payload growth on very long sessions. The system prompt
    // already carries the topic and persona context, so the recent window is
    // sufficient for continuity without risking a 413 or cost runaway.
    if (apiMessages.length > 20) {
      apiMessages = apiMessages.slice(-20)
      // Ensure the trimmed window doesn't open with a user message following
      // an implied assistant turn — if the slice starts on an assistant turn it
      // means we cut right after a user answer, which is fine for the model.
    }
    // Claude API requires at least one message — inject a silent starter for new interviews
    if (apiMessages.length === 0) {
      apiMessages = [{ role: 'user', content: 'Please begin the interview.' }]
    }

    let fullText = ''
    try {
      for await (const chunk of streamMessage(apiMessages, systemPrompt)) {
        fullText += chunk
        setStreamingText(fullText)
      }
    } catch (err) {
      setError(`Error: ${err.message}`)
      setIsStreaming(false)
      return
    }

    const isComplete = fullText.includes(COMPLETE_TOKEN)
    // Strip COMPLETE_TOKEN but preserve [CONTRAST] in stored message for UI detection
    const cleanText = fullText.replace(COMPLETE_TOKEN, '').trim()

    const aiMessage = { role: 'assistant', content: cleanText }
    const updated = [...currentMessages, aiMessage]
    setMessages(updated)

    if (user?.id) {
      const patch = { messages: updated }
      if (isComplete) patch.status = 'in_progress'
      // Clear session_state when the AI signals completion — the interview
      // is done and the resume banner should not appear on next visit.
      if (isComplete) { patch.session_state = null; patch.paused_at = null }
      saveMessages(interviewId, patch)
      // Once the AI declares the interview complete, the local backup has
      // served its purpose. Drop it so a future load doesn't accidentally
      // re-hydrate stale messages.
      if (isComplete) clearLocalMessages(interviewId)
    }

    if (isComplete) setInterviewComplete(true)
    setStreamingText('')
    setIsStreaming(false)

    // Speak the clean version (without probe tokens)
    if (!isComplete) speak(stripGapToken(stripAgreementToken(stripContrastToken(cleanText))))
    // `runtimeWorkspace`, `saveMessages`, and `speak` are stable for the
    // session: workspace switching reloads the page; saveMessages and speak
    // are unmemoized helpers re-created each render. Listing them would
    // defeat useCallback (sendToAI would re-create constantly and re-trigger
    // every effect that depends on it).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinician, interviewId, user?.id])

  useEffect(() => {
    if (!clinician || !interview || hasStarted.current || showInstructions || !micCheckPassed) return
    hasStarted.current = true
    if (messages.length === 0) {
      sendToAI([])
    } else {
      const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant')
      if (lastAssistant && !interviewComplete) speak(lastAssistant.content)
    }
    // Intentional one-shot kickoff effect. hasStarted.current guards against
    // re-entry — listing `messages`, `interviewComplete`, `sendToAI`, or
    // `speak` here would either re-trigger on every message (after the
    // hasStarted guard, harmless but wasteful) or fight the guard pattern.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinician, interview, showInstructions, micCheckPassed])

  function startListening({ preserveTranscript = false } = {}) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) {
      // No-op: the typed-answer fallback UI is rendered instead. Don't set an
      // error — that would push iOS users into a dead-end state.
      return
    }
    if (isListening) return

    ttsRef.current?.cancel()
    window.speechSynthesis?.cancel()
    setIsSpeaking(false)

    // Fresh turn: clear the transcript buffer and reset the restart counter.
    // For an auto-resume restart (browser ended the session during a thinking
    // pause), preserve everything the user has already said.
    if (!preserveTranscript) {
      setTranscript('')
      transcriptRef.current = ''
      finalTranscriptRef.current = ''
      restartCountRef.current = 0
      userAnswerActiveRef.current = true
    }

    const recognition = new SR()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'

    recognition.onresult = (event) => {
      let gotFinal = false
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalTranscriptRef.current += event.results[i][0].transcript + ' '
          gotFinal = true
        }
      }
      const interim = event.results[event.results.length - 1].isFinal
        ? ''
        : event.results[event.results.length - 1][0].transcript
      const display = (finalTranscriptRef.current + interim).trim()
      setTranscript(display)
      transcriptRef.current = finalTranscriptRef.current.trim()

      if (gotFinal) {
        const cleaned = detectAndStripStopPhrase(finalTranscriptRef.current)
        if (cleaned !== null) {
          // Stop phrase detected — end the answer turn so onend doesn't
          // auto-resume after we call stop().
          userAnswerActiveRef.current = false
          clearTimeout(restartTimerRef.current)
          finalTranscriptRef.current = cleaned
          transcriptRef.current = cleaned.trim()
          setTranscript(cleaned.trim())
          recognitionRef.current?.stop()
        }
      }
    }

    // Helper: schedule a silent restart of the recognition engine so the
    // user can keep their turn through a thinking pause. Returns true if a
    // restart was scheduled, false if we've hit the cap or the user is no
    // longer in their answer turn.
    function maybeAutoResume(delayMs) {
      if (!userAnswerActiveRef.current) return false
      if (interviewComplete || isStreaming) return false
      if (restartCountRef.current >= RESTART_CAP) {
        userAnswerActiveRef.current = false
        return false
      }
      restartCountRef.current += 1
      clearTimeout(restartTimerRef.current)
      restartTimerRef.current = setTimeout(() => {
        if (userAnswerActiveRef.current && !interviewComplete) {
          startListening({ preserveTranscript: true })
        }
      }, delayMs)
      return true
    }

    recognition.onend = () => {
      // If the user is still in their answer turn (no stop phrase, no manual
      // stop, no submit), silently restart to ride through a thinking pause.
      // Otherwise let isListening flip false so the submit effect can fire.
      if (maybeAutoResume(200)) return
      setIsListening(false)
    }

    recognition.onerror = (e) => {
      // 'no-speech' is the canonical "user paused too long" signal. Treat
      // it as a thinking pause and resume silently.
      if (e.error === 'no-speech') {
        if (maybeAutoResume(200)) return
        setIsListening(false)
        return
      }

      // 'aborted' on iOS Chrome usually means the audio session is still
      // tied up with TTS playback that just ended. Retry once with a longer
      // delay; this is independent of the answer-turn auto-resume.
      if (e.error === 'aborted') {
        setIsListening(false)
        if (autoListenAbortRetryRef.current < 1 &&
            !interviewComplete && !isStreaming && !isSpeaking) {
          autoListenAbortRetryRef.current += 1
          setTimeout(() => {
            if (!interviewComplete && !isListening) startListening()
          }, 1500)
        }
        return
      }

      // Permission errors — flag explicitly, end the answer turn.
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        userAnswerActiveRef.current = false
        setIsListening(false)
        setError('Microphone permission was denied. You can type your answer instead.')
        return
      }

      // Other errors — non-blocking message, end the answer turn so the
      // user can retry.
      userAnswerActiveRef.current = false
      setIsListening(false)
      setError(`Microphone trouble (${e.error}). Tap mic to retry or type your answer instead.`)
    }

    recognitionRef.current = recognition
    try {
      recognition.start()
      setIsListening(true)
      // Clear retry counter on a clean start — only consecutive aborts count.
      autoListenAbortRetryRef.current = 0
    } catch {
      // start() throws synchronously if the engine is in a bad state (e.g.
      // already started, or audio session locked). Treat as a soft failure
      // and let the user tap mic to try again.
      setIsListening(false)
    }
  }

  function stopListening() {
    // Explicit stop — end the answer turn so onend doesn't auto-resume.
    userAnswerActiveRef.current = false
    clearTimeout(restartTimerRef.current)
    recognitionRef.current?.stop()
  }

  // Shared submit path for both voice (auto-fires when isListening flips
  // false with text captured) and typed-answer (Send button on iOS/non-SR
  // browsers). Extracted so the typed path runs the same emotion-detect +
  // save + sendToAI sequence as voice.
  function submitUserText(rawText) {
    const text = (rawText || '').trim()
    if (!text) return

    setTranscript('')
    transcriptRef.current = ''
    setTypedAnswer('')

    const userMessage = { role: 'user', content: text }
    const updated = [...messagesRef.current, userMessage]
    setMessages(updated)

    const recentUserMessages = updated
      .filter((m) => m.role === 'user')
      .slice(-3)
      .map((m) => m.content)
    emotionStateRef.current = detectEmotionalState(recentUserMessages)

    if (user?.id) {
      saveMessages(interviewId, { messages: updated })
    }

    sendToAI(updated)
  }

  useEffect(() => {
    if (isListening) return
    if (!transcriptRef.current.trim()) return
    submitUserText(transcriptRef.current)
    // `submitUserText` is a stable scope-level helper. `saveMessages` and
    // `user.id` likewise — listing them would re-create the effect on every
    // render and churn downstream consumers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isListening, interviewId, sendToAI])

  // Pause = leave the interview mid-flight. Conversation auto-saves on every
  // user turn, so leaving doesn't actually lose the captured Q&A — but it
  // does drop the user out of an active mic/utterance/stream cycle. Confirm
  // if any of those are live; otherwise leave immediately so the common case
  // (paused for a moment, then leaving) stays one click.
  const [pauseConfirmOpen, setPauseConfirmOpen] = useState(false)

  function leaveInterview() {
    ttsRef.current?.cancel()
    window.speechSynthesis?.cancel()
    userAnswerActiveRef.current = false
    clearTimeout(restartTimerRef.current)
    recognitionRef.current?.abort()
    // Flush session_state immediately before leaving so resume works
    // even if the debounced auto-save hasn't fired yet.
    clearTimeout(sessionSaveTimerRef.current)
    if (user?.id && !interviewComplete && messagesRef.current.length > 0) {
      // Mirror locally before navigating away so a failed pause save can be
      // recovered on next load.
      saveLocalMessages(interviewId, messagesRef.current)
      updateInterview(
        interviewId,
        { session_state: buildSessionState(messagesRef.current), paused_at: new Date().toISOString() },
      ).catch((err) => {
        console.error('[InterviewSession] pause save failed', err?.status, err?.message)
      })
    }
    navigate('/')
  }

  // Verbatim flag helpers. The transcript-substring check guarantees flagged
  // text is something the clinician actually said — selecting an assistant
  // question or a sentence that spans multiple bubbles fails validation and
  // the tip never appears. We intentionally only consider user-role
  // messages so the verbatim guarantee in the prompt is honest.
  function getUserTranscript() {
    return (interview?.messages || [])
      .filter((m) => m.role === 'user')
      .map((m) => m.content || '')
      .join('\n\n')
  }

  function handleSelectionUp() {
    const sel = window.getSelection?.()
    if (!sel || sel.isCollapsed) { setSelectionTip(null); return }
    const text = sel.toString().trim()
    if (text.length < 10) { setSelectionTip(null); return }
    if (!conversationRef.current) return
    // Selection must be entirely inside the conversation log.
    const range = sel.getRangeAt(0)
    if (!conversationRef.current.contains(range.commonAncestorContainer)) {
      setSelectionTip(null); return
    }
    if (!getUserTranscript().includes(text)) { setSelectionTip(null); return }
    const rect = range.getBoundingClientRect()
    const containerRect = conversationRef.current.getBoundingClientRect()
    setSelectionTip({
      text,
      top: rect.top - containerRect.top - 36,
      left: rect.left - containerRect.left + rect.width / 2,
    })
  }

  async function addVerbatimFlag() {
    if (!selectionTip?.text || !interview) return
    const text = selectionTip.text
    const transcript = getUserTranscript()
    const idx = transcript.indexOf(text)
    if (idx === -1) { setSelectionTip(null); return }
    const existing = Array.isArray(interview.verbatim_flags) ? interview.verbatim_flags : []
    if (existing.some((f) => f.text === text)) { setSelectionTip(null); return }
    const next = [
      ...existing,
      {
        id: crypto.randomUUID(),
        text,
        start_offset: idx,
        end_offset: idx + text.length,
        created_at: new Date().toISOString(),
      },
    ]
    setInterview((prev) => prev ? { ...prev, verbatim_flags: next } : prev)
    setSelectionTip(null)
    window.getSelection?.()?.removeAllRanges()
    try {
      await updateInterview(interviewId, { verbatimFlags: next })
    } catch {
      setError('Could not save verbatim flag — try again.')
    }
  }

  async function removeVerbatimFlag(id) {
    if (!interview) return
    const existing = Array.isArray(interview.verbatim_flags) ? interview.verbatim_flags : []
    const next = existing.filter((f) => f.id !== id)
    setInterview((prev) => prev ? { ...prev, verbatim_flags: next } : prev)
    try {
      await updateInterview(interviewId, { verbatimFlags: next })
    } catch {
      setError('Could not remove verbatim flag — try again.')
    }
  }

  function handlePause() {
    const inFlight = isListening || isSpeaking || isStreaming || transcriptRef.current?.trim()
    if (inFlight) {
      setPauseConfirmOpen(true)
      return
    }
    leaveInterview()
  }

  // Live token count surfaced in the "Writing blog post…" card so the user
  // sees forward progress on a 60-120s generation instead of an opaque
  // spinner. Stays in a ref between tokens, snapshotted into React state
  // every flush so the count number updates smoothly without thrashing.
  const blogStreamingTextRef = useRef('')
  const [blogStreamingTokens, setBlogStreamingTokens] = useState(0)

  async function handleGenerateContent() {
    setIsGenerating(true)
    setError('')
    blogStreamingTextRef.current = ''
    setBlogStreamingTokens(0)
    ttsRef.current?.cancel()
    window.speechSynthesis?.cancel()
    // Kick off the transcript cleanup pass in parallel with the blog draft.
    // It writes cleaned_messages on the interview row independently, so
    // failure is non-fatal — the editor falls back to the raw transcript on
    // the Output page. We don't await: the blog generator uses the raw
    // messages by design (cleanup is a verification tool, not a rewrite).
    cleanupTranscript(interviewId).catch((e) => {
      console.warn('[interview] transcript cleanup failed:', e?.message)
    })
    try {
      const apiMessages = messages.map((m) => ({ role: m.role, content: m.content }))
      const tone = interview.tone || 'smart'
      const voiceMode = interview.voice_mode || 'practice'
      const interviewLocation = (runtimeWorkspace?.locations || []).find(l => l.id === interview.location_id)
      const overlaidWorkspace = applyLocationOverlay(runtimeWorkspace, interviewLocation)

      // Stream the blog generation so the user gets live feedback. The
      // server-side /api/stream endpoint already SSEs Anthropic-shaped
      // deltas (see src/lib/claude.js#streamMessage), so we just consume
      // them and accumulate. We update the token counter once every 5
      // chunks to avoid a setState per delta.
      // Persist style change if the user changed it since the interview loaded.
      // If the save fails, log + flip the visible save indicator. The
      // user's selection still drives this generation; the persistence
      // just won't survive a reload, so a recoverable warning is the right
      // posture rather than blocking generation.
      if (generationStyle !== (interview.generation_style || 'blog_post')) {
        updateInterview(interviewId, { generationStyle }).catch((err) => {
          console.error('[InterviewSession] generationStyle save failed', err?.status, err?.message)
          setSaveStatus('error')
        })
      }

      // Top voice phrase anchors (Phase C.2). One light fetch right before
      // generation; falls back to [] on any failure so a flaky endpoint can't
      // block the blog draft.
      let voicePhrases = []
      try {
        const vp = await apiFetch(
          `/api/clinicians/voice-phrases?clinician_id=${clinician.id}&limit=8`
        )
        voicePhrases = Array.isArray(vp?.phrases) ? vp.phrases : []
      } catch (e) {
        console.warn('[interview] voice phrase fetch failed:', e?.message)
      }

      const isMinimal = generationStyle === 'minimal_edits'
      const systemPrompt = isMinimal
        ? getMinimalEditSystemPrompt(clinician.name, voiceMode, clinician.voice_notes || '', voicePhrases)
        : getBlogPostSystemPrompt(
            overlaidWorkspace, clinician.name, interview.topic, tone, voiceMode, interview.prototype_id,
            clinician.voice_notes || '',
            voicePhrases,
            resolveAudienceSlot(interview.audience, overlaidWorkspace?.audience_options),
            resolveStoryTypeSlot(interview.story_type, overlaidWorkspace?.story_type_options),
          ) + buildVerbatimBlock(interview.verbatim_flags)

      const streamMessages = [
        ...apiMessages,
        {
          role: 'user',
          content: isMinimal
            ? 'Please clean up the transcript now using minimal edits only.'
            : 'Please write the blog post now based on our interview.',
        },
      ]

      let chunks = 0
      for await (const delta of streamMessage(streamMessages, systemPrompt, { model: 'claude-opus-4-7', maxOutputTokens: 4096 })) {
        blogStreamingTextRef.current += delta
        chunks += 1
        if (chunks % 5 === 0) setBlogStreamingTokens(chunks)
      }
      setBlogStreamingTokens(chunks)

      // Separate the voice-fidelity provenance trailer from the visible
      // content body. The trailer (if present) is the model's per-paragraph
      // source attribution; the server validates it against the content +
      // transcript and falls back to algorithmic matching if validation fails.
      const { content: blogPost, provenanceJson } = extractProvenanceBlock(blogStreamingTextRef.current)
      if (!blogPost.trim()) throw new Error('No content returned from generation')

      const outputs = { blogPost, generatedAt: new Date().toISOString() }
      // Clear session_state: completed interviews don't need resume capability.
      await updateInterview(interviewId, { outputs, status: 'completed', session_state: null, paused_at: null })
      // The PATCH above triggers a server-side cascade in api/db/interviews.js
      // that creates the content_items rows. Flush caches so ContentHub /
      // Calendar pick those up on next read.
      qc.invalidateQueries({ queryKey: queryKeys.interviews.all })
      qc.invalidateQueries({ queryKey: queryKeys.clinicians.all })
      qc.invalidateQueries({ queryKey: queryKeys.contentItems.all })

      // Fire-and-forget: populate provenance on the new blog content_item.
      // Server validates trailer (if any) against content + transcript and
      // stores either `model_emit_validated` or `algorithmic_fallback`. The
      // UI does not wait for this — it lands within a second or two and
      // shows up on next Story Detail fetch.
      populateContentItemProvenance(interviewId, provenanceJson || '', 'blog').catch((err) => {
        console.warn('[interview] provenance population failed:', err?.message)
      })
      // Generation done — hand the user off to the Story Detail page. The
      // server-side cascade triggered by the PATCH above has created the
      // content_items rows; the invalidated queries make Stories Detail show
      // the new draft on first render.
      navigate(`/stories/${interviewId}`, { replace: true })
    } catch (err) {
      setError(`Failed to generate content: ${err.message}`)
      setIsGenerating(false)
    }
  }

  // Auto-fire generation the moment the interview wraps. The post-interview
  // radio ("Full blog post" vs "Minimal edits") was confusing — both labels
  // weren't parallel and forcing a decision at this moment broke the flow.
  // The user clicks Finish → "Writing your blog post…" card shows → on
  // completion we navigate to /stories/:id. Default style is 'blog_post'; the
  // draft view will host the optional Cleaned-transcript switcher.
  //
  // Guards: only fire when (a) the interview just completed in this session,
  // (b) no outputs exist yet (don't re-generate on revisits), (c) we're not
  // already generating, (d) the viewer owns the interview. autoGenFiredRef
  // pins it to one fire per mount so React's strict-mode double-effect doesn't
  // double-bill us.
  const autoGenFiredRef = useRef(false)
  useEffect(() => {
    if (!interviewComplete) return
    if (autoGenFiredRef.current) return
    if (isGenerating) return
    if (!interview || !clinician || !user?.id) return
    if (interview.outputs?.blogPost) return
    if (user.id !== interview.owner_id) return
    autoGenFiredRef.current = true
    handleGenerateContent()
    // handleGenerateContent is a stable scope-level helper; including it would
    // re-fire the effect every render and double-bill the generation. The
    // guard ref above already pins this to a single invocation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interviewComplete, isGenerating, interview, clinician, user?.id])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 text-muted-foreground animate-spin" />
      </div>
    )
  }

  if (!clinician || !interview) return null

  const isOwner = user?.id === interview.owner_id

  if (showInstructions) {
    return (
      <div className="max-w-xl mx-auto py-4">
        <div className="flex items-center gap-3 mb-6">
          <Button variant="ghost" size="icon" asChild>
            <Link to="/new"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <p className="font-medium text-sm">{clinician.name}</p>
            <p className="text-xs text-muted-foreground">{interview.topic}</p>
          </div>
        </div>

        <div className="space-y-5">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Before we begin</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Two things to know before the interview starts.
            </p>
          </div>

          <div className="space-y-3">
            <InstructionCard
              icon={<Mic2 className="h-5 w-5 text-primary" />}
              title="Speak naturally — the mic works like a conversation"
              body="The interviewer asks one question at a time, read aloud. Tap the microphone button when you're ready to answer, then speak at your normal pace. You can pause and think — it won't cut you off. When you're done with an answer, say 'done' or 'that's all', or tap the mic button again to send it."
            />
            <InstructionCard
              icon={<AlertCircle className="h-5 w-5 text-primary" />}
              title="You control when it ends"
              body="The interviewer will keep asking follow-up questions until you've covered the topic thoroughly — there's no fixed number of questions. When you feel you've said everything useful, just say so ('I think that covers it', 'that's everything', 'let's generate') or click the Finish button at the top. The AI does the rest."
            />
          </div>

          <Button className="w-full" size="lg" onClick={() => setShowInstructions(false)}>
            <Mic className="h-4 w-4 mr-2" />
            I&apos;m ready &mdash; start the interview
          </Button>
        </div>
      </div>
    )
  }

  // Mic check gate: shown after instructions are dismissed but before the AI
  // sends its first question. onContinue flips micCheckPassed → true.
  if (!micCheckPassed) {
    return <MicCheck onContinue={() => setMicCheckPassed(true)} ttsSettings={clinician?.tts_settings} />
  }

  const displayMessages = messages.filter((m) => !m.content?.includes(COMPLETE_TOKEN))
  const firstNameOnly = clinician.name.split(' ')[0]
  // Require at least one back-and-forth before Finish: an opening prompt plus
  // one captured user answer isn't enough material for the AI to write from.
  const userMessageCount = messages.filter((m) => m.role === 'user').length
  const canFinish = userMessageCount >= 2
  const finishHelper = 'Answer at least one question before finishing.'

  const toneObj = TONES.find((t) => t.id === interview.tone) ?? TONES[0]
  const voiceObj = VOICE_MODES.find((v) => v.id === interview.voice_mode) ?? VOICE_MODES[0]
  const prototypeObj = interview.prototype_id
    ? PATIENT_PROTOTYPES_UI.find((p) => p.id === interview.prototype_id)
    : null

  return (
    <div
      className="flex flex-col h-[calc(100dvh-7.5rem)] max-w-2xl mx-auto"
      style={vvHeight ? { height: `calc(${vvHeight}px - 7.5rem)` } : undefined}
    >
      <div className="flex flex-col min-w-0 flex-1">
      <div className="flex items-center gap-3 pb-4 shrink-0">
        <Button variant="ghost" size="icon" asChild>
          <Link to={`/clinician/${clinicianId}`}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <Avatar className="h-8 w-8">
          <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
            {getInitials(clinician.name)}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm leading-none">{clinician.name}</p>
          <p className="text-xs text-muted-foreground mt-0.5 truncate" title={interview.topic}>{interview.topic}</p>
        </div>
        {saveStatus && (
          <span
            className={`text-xs shrink-0 inline-flex items-center gap-1 ${saveStatus === 'error' ? 'text-destructive' : saveStatus === 'recovered' ? 'text-amber-600' : 'text-muted-foreground'}`}
            title={
              saveStatus === 'error'
                ? 'Server save failed — your answers are kept locally. Tap to retry.'
                : saveStatus === 'recovered'
                ? 'Restored from local backup after a save failure. Re-syncing…'
                : ''
            }
          >
            {saveStatus === 'saving'
              ? <><Loader2 className="h-3 w-3 animate-spin" />Saving…</>
              : saveStatus === 'saved'
              ? <><Check className="h-3 w-3" />Saved</>
              : saveStatus === 'recovered'
              ? <><RefreshCw className="h-3 w-3" />Recovered locally</>
              : (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 underline underline-offset-2"
                  onClick={() => {
                    if (user?.id) saveMessages(
                      interviewId,
                      { messages: messagesRef.current, session_state: buildSessionState(messagesRef.current) },
                    )
                  }}
                >
                  <AlertCircle className="h-3 w-3" />
                  Save failed — retry
                </button>
              )}
          </span>
        )}
        {interviewComplete
          ? <Badge variant="secondary" className="text-xs">Interview Complete</Badge>
          : isOwner && (
            // Desktop header keeps the action buttons. On mobile they live
            // in the bottom dock so they're within thumb reach next to the
            // mic — see InterviewDock below.
            <div className="hidden md:flex items-center gap-1 shrink-0">
              <Button
                size="sm"
                onClick={() => setInterviewComplete(true)}
                disabled={!canFinish}
                title={canFinish ? undefined : finishHelper}
                aria-label={canFinish ? 'Finish interview' : finishHelper}
                className="gap-1.5"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Finish
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handlePause}
                title="Save and pause — you can resume later"
                aria-label="Pause interview"
                className="gap-1 text-muted-foreground hover:text-foreground px-2"
              >
                <PauseCircle className="h-4 w-4" />
                <span className="text-xs">Pause</span>
              </Button>
            </div>
          )
        }
      </div>

      <div className="flex items-center gap-1.5 pb-3 -mt-1 shrink-0 flex-wrap">
        <Badge variant="outline" className="hidden sm:inline-flex text-xs gap-1 text-foreground/70">
          {toneObj.emoji} {toneObj.label}
        </Badge>
        <Badge variant="outline" className="hidden sm:inline-flex text-xs gap-1 text-foreground/70">
          {voiceObj.emoji} {voiceObj.label}
        </Badge>
        {prototypeObj && (
          <Badge variant="outline" className="hidden sm:inline-flex text-xs gap-1 text-foreground/70">
            {prototypeObj.emoji} {prototypeObj.label}
          </Badge>
        )}
        {/* Mobile: compact emoji-only summary so the row doesn't eat ~40px of viewport */}
        <span className="sm:hidden text-xs text-muted-foreground" aria-label={`Tone ${toneObj.label}, voice ${voiceObj.label}`}>
          {toneObj.emoji} {voiceObj.emoji}{prototypeObj ? ` ${prototypeObj.emoji}` : ''}
        </span>
        {!interviewComplete && userMessageCount > 0 && (
          <InterviewProgress count={userMessageCount} />
        )}
      </div>

      {showResumeBanner && (
        <div className="mb-2 rounded-lg bg-amber-50 border border-amber-200 px-4 py-2 text-xs text-amber-800 flex items-center gap-2 shrink-0" role="status">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse shrink-0" aria-hidden="true" />
          Resuming your session…
        </div>
      )}

      <div
        ref={conversationRef}
        onMouseUp={handleSelectionUp}
        onTouchEnd={handleSelectionUp}
        className={`flex-1 relative pr-4 -mr-4 overflow-hidden ${isGenerating ? 'hidden' : ''}`}
      >
        {selectionTip && (
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); addVerbatimFlag() }}
            style={{
              top: Math.min(Math.max(0, selectionTip.top), (conversationRef.current?.clientHeight ?? 9999) - 40),
              left: selectionTip.left,
              transform: 'translateX(-50%)',
            }}
            className="absolute z-10 bg-foreground text-background text-xs rounded-md shadow-lg px-2.5 py-1.5 flex items-center gap-1.5 hover:bg-foreground/90"
          >
            <Quote className="h-3 w-3" />
            Use verbatim
          </button>
        )}
        <ScrollArea className="h-full pr-4 -mr-4">
          <div className="space-y-4 pb-4">
          {displayMessages.map((msg, i) => (
            <MessageBubble key={i} message={msg} clinicianName={firstNameOnly} />
          ))}

          {isStreaming && streamingText && (
            <MessageBubble
              message={{ role: 'assistant', content: streamingText }}
              clinicianName={firstNameOnly}
              isStreaming
            />
          )}

          {isStreaming && !streamingText && (
            <div className="flex items-start gap-3">
              <div className="h-8 w-8 rounded-full bg-white border border-border flex items-center justify-center shrink-0 p-1">
                <Loader2 className="h-4 w-4 text-primary animate-spin" />
              </div>
              <div className="bg-muted rounded-2xl rounded-tl-sm px-4 py-3">
                <div className="flex gap-1 items-center h-5">
                  <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:0ms]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:150ms]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:300ms]" />
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-lg p-3">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          {interviewComplete && !isStreaming && (
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-5 py-4 flex flex-col gap-3 mt-2">
              <div className="flex items-center gap-2.5">
                <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" aria-hidden="true" />
                <p className="font-semibold text-sm text-emerald-900">
                  {clinician.name ? `Great conversation, ${clinician.name}.` : 'Great conversation.'}
                </p>
              </div>
              <p className="text-sm text-emerald-800/80 leading-relaxed">
                Your story is being turned into content.
              </p>
              {interview?.outputs?.blogPost && (
                <Button
                  size="sm"
                  className="self-start bg-emerald-700 hover:bg-emerald-800 text-white gap-1.5"
                  onClick={() => navigate(`/stories/${interviewId}`)}
                >
                  See your content →
                </Button>
              )}
            </div>
          )}

          <div ref={bottomRef} />
        </div>
        </ScrollArea>
      </div>

      {Array.isArray(interview.verbatim_flags) && interview.verbatim_flags.length > 0 && (
        <div className="py-2 shrink-0 border-t">
          <p className="text-2xs text-muted-foreground mb-1.5 flex items-center gap-1">
            <Quote className="h-3 w-3" />
            Verbatim — these phrases will appear word-for-word in every draft
          </p>
          <div className="flex flex-wrap gap-1.5">
            {interview.verbatim_flags.map((f) => (
              <span key={f.id} className="inline-flex items-center gap-1 text-xs bg-amber-50 text-amber-900 border border-amber-200 rounded-full pl-2.5 pr-1 py-0.5 max-w-md">
                <span className="truncate italic">{'“'}{f.text}{'”'}</span>
                <button
                  type="button"
                  onClick={() => removeVerbatimFlag(f.id)}
                  aria-label="Remove verbatim flag"
                  className="shrink-0 rounded-full hover:bg-amber-200 p-0.5"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {isGenerating && (
        <div className="flex-1 flex items-center justify-center py-6">
          <div
            className="rounded-xl border bg-muted p-6 max-w-md w-full flex items-start gap-4"
            role="status"
            aria-live="polite"
          >
            <Loader2 className="h-5 w-5 text-primary animate-spin shrink-0 mt-0.5" aria-hidden="true" />
            <div className="flex-1">
              <p className="text-base font-semibold">
                {generationStyle === 'minimal_edits' ? 'Cleaning transcript…' : 'Writing your blog post…'}
                {blogStreamingTokens > 0 && (
                  <span className="ml-1.5 text-sm font-normal text-muted-foreground">
                    ({blogStreamingTokens} words)
                  </span>
                )}
              </p>
              <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                {generationStyle === 'minimal_edits'
                  ? 'Removing filler words while preserving your exact phrasing. We\'ll open the story view when it\'s ready.'
                  : 'Turning your interview into a full blog post. We\'ll open the story view when it\'s ready — social, video, and marketing content will generate on demand from there.'}
              </p>
            </div>
          </div>
        </div>
      )}

      {!interviewComplete && isOwner && audioInterrupted && (
        <div className="pt-3 pb-1 shrink-0">
          <button
            type="button"
            onClick={handleRestoreAudio}
            className="w-full rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-left hover:bg-amber-100 active:bg-amber-100 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
            aria-label="Audio interrupted. Tap to restore audio and replay the last question."
          >
            <div className="flex items-center gap-3">
              <Volume2 className="h-5 w-5 text-amber-700 shrink-0" aria-hidden="true" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-amber-900">Audio interrupted</p>
                <p className="text-xs text-amber-800">
                  Tap to restore audio and replay the last question. Often happens when headphones or CarPlay change connection.
                </p>
              </div>
              <RefreshCw className="h-4 w-4 text-amber-700 shrink-0" aria-hidden="true" />
            </div>
          </button>
        </div>
      )}

      {!interviewComplete && isOwner && hasSpeechRecognition && (
        // Bottom dock — anchors the recording UI to a persistent visual
        // surface on mobile. Pause/Finish flank the mic so the primary
        // actions are all within thumb reach. Desktop keeps the prior
        // column layout (Finish/Pause stay in the top header on md+).
        <div
          className="pt-4 pb-1 shrink-0 flex flex-col items-center gap-3 border-t md:border-t-0 bg-background/95 backdrop-blur md:bg-transparent md:backdrop-blur-none -mx-6 md:mx-0 px-6 md:px-0"
          style={{ paddingBottom: 'max(0.25rem, env(safe-area-inset-bottom))' }}
        >
          {transcript && (
            <div
              aria-live="polite"
              aria-label="Transcript"
              className="w-full rounded-xl bg-muted px-4 py-3 text-sm text-foreground/80 italic min-h-[44px]"
            >
              &quot;{transcript}&quot;
            </div>
          )}

          <p
            role="status"
            aria-live="polite"
            className="text-xs text-muted-foreground h-4"
          >
            {isStreaming ? '' : isSpeaking ? (
              <span className="flex items-center gap-1.5">
                <Volume2 className="h-3 w-3 animate-pulse" aria-hidden="true" /> Speaking…
              </span>
            ) : isListening ? (
              <span className="flex items-center gap-1.5 text-red-500">
                <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" aria-hidden="true" /> Listening — take your time. Say &quot;done&quot; or tap mic to send.
              </span>
            ) : 'Tap to speak'}
          </p>

          <div className="flex items-center justify-between md:justify-center gap-4 w-full md:w-auto">
            {/* Mobile-only Pause — small ghost icon, left of the mic */}
            <Button
              variant="ghost"
              onClick={handlePause}
              aria-label="Pause interview"
              title="Save and pause — you can resume later"
              className="md:hidden h-11 w-11 p-0 text-muted-foreground active:bg-accent/30 shrink-0"
            >
              <PauseCircle className="h-5 w-5" />
            </Button>

            <button
              onClick={isListening ? stopListening : startListening}
              disabled={isStreaming || isGenerating || isSpeaking}
              aria-label={isListening ? 'Stop recording' : 'Start recording'}
              aria-pressed={isListening}
              className={`h-16 w-16 rounded-full flex items-center justify-center transition-all shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary
                ${isListening
                  ? 'bg-red-500 text-white scale-110'
                  : 'bg-primary text-primary-foreground hover:opacity-90 active:scale-95'
                } disabled:opacity-30 disabled:cursor-not-allowed disabled:scale-100`}
            >
              {isListening
                ? <MicOff className="h-6 w-6" aria-hidden="true" />
                : <Mic className="h-6 w-6" aria-hidden="true" />
              }
            </button>

            {/* Mobile-only Finish — labeled button, right of the mic */}
            <Button
              onClick={() => setInterviewComplete(true)}
              disabled={!canFinish}
              title={canFinish ? undefined : finishHelper}
              aria-label={canFinish ? 'Finish interview' : finishHelper}
              className="md:hidden gap-1.5 min-h-[44px] shrink-0"
              size="sm"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Finish
            </Button>
          </div>
        </div>
      )}

      {!interviewComplete && isOwner && !hasSpeechRecognition && (
        // Typed-answer dock — same visual surface as the mic dock so the
        // input region feels anchored to the bottom of the screen on mobile.
        <div
          className="pt-4 pb-1 shrink-0 flex flex-col gap-2 border-t md:border-t-0 bg-background/95 backdrop-blur md:bg-transparent md:backdrop-blur-none -mx-6 md:mx-0 px-6 md:px-0"
          style={{ paddingBottom: 'max(0.25rem, env(safe-area-inset-bottom))' }}
        >
          <p
            role="status"
            aria-live="polite"
            className="text-xs text-muted-foreground h-4 flex items-center gap-1.5"
          >
            {isStreaming ? '' : isSpeaking ? (
              <><Volume2 className="h-3 w-3 animate-pulse" aria-hidden="true" /> Speaking…</>
            ) : (
              <><Keyboard className="h-3 w-3" aria-hidden="true" /> Type your answer — voice input isn&rsquo;t supported in this browser</>
            )}
          </p>
          <div className="flex items-end gap-2">
            <textarea
              value={typedAnswer}
              onChange={(e) => setTypedAnswer(e.target.value)}
              onKeyDown={(e) => {
                // Cmd/Ctrl+Enter sends; plain Enter inserts newline so users
                // can write multi-paragraph answers.
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  if (!isStreaming && !isGenerating && !isSpeaking && typedAnswer.trim()) {
                    submitUserText(typedAnswer)
                  }
                }
              }}
              placeholder="Type your answer here…"
              rows={3}
              disabled={isStreaming || isGenerating || isSpeaking}
              className="flex-1 rounded-xl border bg-background px-3 py-2 text-base md:text-sm resize-none focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
              aria-label="Type your answer"
            />
            <Button
              onClick={() => submitUserText(typedAnswer)}
              disabled={isStreaming || isGenerating || isSpeaking || !typedAnswer.trim()}
              size="lg"
              aria-label="Send answer"
              className="h-[44px] shrink-0"
            >
              <Send className="h-4 w-4 mr-1.5" aria-hidden="true" />
              Send
            </Button>
          </div>
          {/* Mobile-only action row — Pause + Finish live in the dock on
              mobile since the header version is hidden below md. */}
          <div className="md:hidden flex items-center justify-between gap-2 pt-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={handlePause}
              aria-label="Pause interview"
              className="gap-1 text-muted-foreground min-h-[44px]"
            >
              <PauseCircle className="h-4 w-4" />
              <span className="text-xs">Pause</span>
            </Button>
            <Button
              size="sm"
              onClick={() => setInterviewComplete(true)}
              disabled={!canFinish}
              title={canFinish ? undefined : finishHelper}
              aria-label={canFinish ? 'Finish interview' : finishHelper}
              className="gap-1.5 min-h-[44px]"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Finish
            </Button>
          </div>
        </div>
      )}

      {!interviewComplete && !isOwner && (
        <div className="py-3 shrink-0">
          <div className="rounded-xl border bg-muted/50 p-4 text-center">
            <p className="text-sm text-muted-foreground">This interview is in progress. Only the interviewer can continue it.</p>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={pauseConfirmOpen}
        onOpenChange={setPauseConfirmOpen}
        title="Pause this interview?"
        description={
          isListening
            ? "We're still capturing your answer. Pausing now will drop the in-progress utterance. Your session will be saved — resume from the Home page."
            : isSpeaking || isStreaming
              ? "The AI is mid-response. Pausing now will cut it off. Your session will be saved — resume from the Home page."
              : "Pausing now will drop your in-progress utterance. Your session will be saved — resume from the Home page."
        }
        confirmLabel="Pause anyway"
        destructive={false}
        onConfirm={leaveInterview}
      />
      </div>
    </div>
  )
}

// Thin progress chip shown in the meta-badge row. Gives the clinician a
// sense of how far through the interview they are without a hard question
// count (Bernard adapts depth to the answers, so ~6 is an estimate, not a
// gate). Hidden before the first answer and after the interview completes.
const TYPICAL_QUESTION_COUNT = 6
function InterviewProgress({ count }) {
  const pct = Math.min(100, Math.round((count / TYPICAL_QUESTION_COUNT) * 100))
  const label =
    count >= TYPICAL_QUESTION_COUNT
      ? 'Wrapping up'
      : `~${Math.max(1, TYPICAL_QUESTION_COUNT - count)} more`

  return (
    <span className="inline-flex items-center gap-1.5 ml-auto text-3xs text-muted-foreground shrink-0">
      <span className="relative h-1 w-14 rounded-full bg-muted overflow-hidden">
        <span
          className="absolute inset-y-0 left-0 rounded-full bg-indigo-400 transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </span>
      {label}
    </span>
  )
}

function InstructionCard({ icon, title, body }) {
  return (
    <div className="flex gap-4 rounded-xl border bg-card p-4">
      <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
        {icon}
      </div>
      <div>
        <p className="font-semibold text-sm mb-1">{title}</p>
        <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
      </div>
    </div>
  )
}

function MessageBubble({ message, clinicianName, isStreaming }) {
  const runtimeWs = useWorkspace()
  // Prefer the Brand Kit's favicon / mark-only role (canonical), then any
  // legacy workspace.logo.icon, then the static per-deploy fallback.
  const iconUrl = runtimeWs?.brand_kit_roles?.favicon
    ?? runtimeWs?.brand_kit_roles?.mark_only
    ?? runtimeWs?.logo?.icon
    ?? workspace.logo.icon
  const isAI = message.role === 'assistant'
  const isContrast  = isAI && hasContrastSignal(message.content)
  const isAgreement = isAI && hasAgreementSignal(message.content)
  const isGap       = isAI && hasGapSignal(message.content)
  const contrastName  = isContrast  ? extractContrastName(message.content)  : null
  const agreementName = isAgreement ? extractAgreementName(message.content) : null
  const displayContent = isAI
    ? stripGapToken(stripAgreementToken(stripContrastToken(message.content)))
    : message.content
  return (
    <div className={`flex items-start gap-3 ${!isAI ? 'flex-row-reverse' : ''}`}>
      {isAI ? (
        <div className="h-8 w-8 rounded-full bg-white border border-border flex items-center justify-center shrink-0 p-1">
          <img src={iconUrl} alt={runtimeWs?.display_name || workspace.name} className="h-full w-full" />
        </div>
      ) : (
        <div className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center shrink-0 text-xs font-medium">
          {clinicianName[0]}
        </div>
      )}
      <div className="flex flex-col gap-1 max-w-[90%] sm:max-w-[80%]">
        {isContrast && (
          <span className="self-start inline-flex items-center gap-1.5 text-xs font-medium text-contrast-signal bg-contrast-signal/10 border border-contrast-signal/30 rounded-full px-2.5 py-0.5">
            <ArrowLeftRight className="h-3 w-3 shrink-0" aria-hidden="true" />
            {contrastName ? `Different angle than ${contrastName}'s interview` : 'Different angle from this practice'}
          </span>
        )}
        {isAgreement && (
          <span className="self-start inline-flex items-center gap-1.5 text-xs font-medium text-agreement-signal bg-agreement-signal/10 border border-agreement-signal/30 rounded-full px-2.5 py-0.5">
            <Check className="h-3 w-3 shrink-0" aria-hidden="true" />
            {agreementName ? `Aligns with ${agreementName}'s recent interview` : 'Aligns with prior interviews here'}
          </span>
        )}
        {isGap && (
          <span className="self-start inline-flex items-center gap-1.5 text-xs font-medium text-verbatim-accent bg-verbatim-accent/10 border border-verbatim-accent/30 rounded-full px-2.5 py-0.5">
            <Circle className="h-3 w-3 shrink-0" aria-hidden="true" />
            New ground
          </span>
        )}
        <div
          className={`rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
            isAI
              ? 'bg-muted rounded-tl-sm'
              : 'bg-primary text-primary-foreground rounded-tr-sm'
          } ${isStreaming ? 'animate-pulse' : ''}`}
        >
          {displayContent}
        </div>
      </div>
    </div>
  )
}

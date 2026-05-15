import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useUser } from '@clerk/clerk-react'
import { ArrowLeft, Loader2, Sparkles, AlertCircle, Mic, MicOff, Volume2, Mic2, PauseCircle, Quote, X, ArrowLeftRight, CheckCircle2, Copy, Check, FileText, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { fetchSimilarInterviews, fetchClinician, updateInterview, cleanupTranscript } from '@/lib/api'
import { useClinician, useInterview, queryKeys } from '@/lib/queries'
import { useQueryClient } from '@tanstack/react-query'
import { streamMessage } from '@/lib/claude'
import { getInterviewSystemPrompt, getBlogPostSystemPrompt, TONES, getVoiceModes, getPatientPrototypesUi, buildVerbatimBlock } from '@/lib/prompts'
import { detectEmotionalState, getEmotionPromptInjection } from '@/lib/emotionDetection'
import { getInitials } from '@/lib/utils'
import { workspace } from '@/lib/workspace'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { applyLocationOverlay } from '@/lib/locationOverlay'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { ConfirmDialog } from '@/components/ui/alert-dialog'
import MicCheck from '@/components/MicCheck'

// Concrete noun list for shallow-answer detection (Feature 2)
const CONCRETE_NOUNS = ['patient', 'person', 'name', 'case', 'example', 'time', 'moment', 'client', 'athlete', 'runner', 'worker']

function isShallowAnswer(text) {
  const words = text.trim().split(/\s+/)
  if (words.length >= 15) return false
  const lower = text.toLowerCase()
  return !CONCRETE_NOUNS.some((noun) => lower.includes(noun))
}

// Strip [CONTRAST] marker from AI message text before display
function stripContrastToken(text) {
  return text.replace(/\[CONTRAST\]/g, '').trim()
}

// Detect if AI message was a contrast probe (Feature 1)
function hasContrastSignal(text) {
  return text.includes('[CONTRAST]')
}

function stripAgreementToken(text) { return text.replace(/\[AGREEMENT\]/g, '').trim() }
function hasAgreementSignal(text)   { return text.includes('[AGREEMENT]') }

function stripGapToken(text) { return text.replace(/\[GAP\]/g, '').trim() }
function hasGapSignal(text)  { return text.includes('[GAP]') }

const COMPLETE_TOKEN = 'INTERVIEW_COMPLETE'

// Target question range for the step-indicator. The interview prompt covers
// 7 numbered content areas; in practice 5–8 questions is the sweet spot once
// the AI skips areas already answered and adds follow-ups for vague answers.
// Used to set expectations on time commitment without forcing a hard stop.
const QUESTION_TARGET_MIN = 5
const QUESTION_TARGET_MAX = 8

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
  // Detect if the user landed directly on the /output sub-path (e.g. via
  // bookmark or page refresh). If so, auto-open the inline panel once data loads.
  const mountedOnOutputPath = useRef(
    typeof window !== 'undefined' && window.location.pathname.endsWith('/output')
  )
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
  const [error, setError] = useState('')
  const [isListening, setIsListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [isSpeaking, setIsSpeaking] = useState(false)
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
  // Learned practice knowledge from concept graph — fetched once at session start
  const conceptBlockRef   = useRef('')
  const agreementBlockRef = useRef('')
  const gapBlockRef       = useRef('')
  // Refs for pause/resume persistence
  const sessionSaveTimerRef = useRef(null)
  const userIdRef = useRef(null)
  const interviewCompleteRef = useRef(false)

  function saveMessages(interviewId, patch, userId) {
    setSaveStatus('saving')
    updateInterview(interviewId, patch, userId)
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
      .catch(() => setSaveStatus('error'))
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

  // Persist session_state immediately — used by unload/visibility handlers
  // where we can't await a fetch. sendBeacon is fire-and-forget but reliable
  // for short payloads. Falls back to a synchronous keepalive fetch on browsers
  // that don't support sendBeacon with JSON.
  function flushSessionState(msgs) {
    const uid = userIdRef.current
    if (!uid || interviewCompleteRef.current || !msgs.length) return
    const url = `/api/db/interviews?id=${encodeURIComponent(interviewId)}`
    const payload = JSON.stringify({
      session_state: buildSessionState(msgs),
      paused_at: new Date().toISOString(),
    })
    if (typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([payload], { type: 'application/json' })
      navigator.sendBeacon(url + `&_uid=${encodeURIComponent(uid)}`, blob)
    } else {
      fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-user-id': uid },
        body: payload,
        keepalive: true,
      }).catch(() => {})
    }
  }

  // Debounced auto-save of session_state whenever messages change.
  // Runs 3s after the last message update. Skipped when interview is done
  // (session_state is cleared on completion instead).
  useEffect(() => {
    if (!user?.id || interviewComplete || messages.length === 0) return
    clearTimeout(sessionSaveTimerRef.current)
    sessionSaveTimerRef.current = setTimeout(() => {
      updateInterview(
        interviewId,
        { session_state: buildSessionState(messages), paused_at: new Date().toISOString() },
        user.id,
      ).catch(() => {})
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
    setInterview(interviewData)

    // Resume from session_state if available (paused mid-interview).
    // session_state.messages is the authoritative source when present; it
    // may be ahead of the DB messages column (which only saves on each
    // user turn, not on every AI response). Prefer session_state so the
    // resumed transcript matches exactly what the clinician saw before pausing.
    const savedState = interviewData.session_state
    const restoredMessages = savedState?.messages ?? interviewData.messages ?? []
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

    // Auto-open output panel when landing directly on /…/output (e.g. bookmark)
    if (mountedOnOutputPath.current && interviewData.outputs?.blogPost) {
      setOutputData(interviewData.outputs)
      setShowOutput(true)
    }

    fetchSimilarInterviews(interviewData.topic, interviewId)
      .then((past) => { pastInterviewsRef.current = past || [] })
      .catch(() => {})

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
      .catch(() => {})

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
      .catch(() => {})
  }, [interviewLoading, interviewData, interviewId, navigate, clinicianId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingText])

  useEffect(() => {
    return () => {
      window.speechSynthesis?.cancel()
      recognitionRef.current?.abort()
    }
  }, [])

  function getBestVoice() {
    const voices = window.speechSynthesis.getVoices()
    const priority = [
      v => v.name === 'Google US English',
      v => v.name.startsWith('Google') && v.lang.startsWith('en'),
      v => v.name.includes('Samantha') && v.localService,
      v => v.name.includes('Enhanced') && v.lang.startsWith('en'),
      v => v.lang === 'en-US' && v.localService,
      v => v.lang.startsWith('en'),
    ]
    for (const test of priority) {
      const match = voices.find(test)
      if (match) return match
    }
    return null
  }

  function speak(text) {
    if (!window.speechSynthesis) return
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.voice = getBestVoice()
    utterance.rate = 1.1
    utterance.pitch = 1.0
    setIsSpeaking(true)
    utterance.onend = () => {
      setIsSpeaking(false)
      autoListenRef.current = true
    }
    utterance.onerror = () => setIsSpeaking(false)
    window.speechSynthesis.speak(utterance)
  }

  useEffect(() => {
    if (!isSpeaking && autoListenRef.current && !isStreaming && !interviewComplete) {
      autoListenRef.current = false
      const timer = setTimeout(() => startListening(), 400)
      return () => clearTimeout(timer)
    }
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
      saveMessages(interviewId, patch, user.id)
    }

    if (isComplete) setInterviewComplete(true)
    setStreamingText('')
    setIsStreaming(false)

    // Speak the clean version (without probe tokens)
    if (!isComplete) speak(stripGapToken(stripAgreementToken(stripContrastToken(cleanText))))
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
  }, [clinician, interview, showInstructions, micCheckPassed])

  function startListening() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) {
      setError('Speech recognition is not supported. Please use Chrome.')
      return
    }
    if (isListening) return

    window.speechSynthesis?.cancel()
    setIsSpeaking(false)
    setTranscript('')
    transcriptRef.current = ''
    finalTranscriptRef.current = ''

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
          finalTranscriptRef.current = cleaned
          transcriptRef.current = cleaned.trim()
          setTranscript(cleaned.trim())
          recognitionRef.current?.stop()
        }
      }
    }

    recognition.onend = () => setIsListening(false)

    recognition.onerror = (e) => {
      setIsListening(false)
      if (e.error !== 'no-speech') setError(`Microphone error: ${e.error}`)
    }

    recognitionRef.current = recognition
    recognition.start()
    setIsListening(true)
  }

  function stopListening() {
    recognitionRef.current?.stop()
  }

  useEffect(() => {
    if (isListening) return
    const text = transcriptRef.current.trim()
    if (!text) return

    setTranscript('')
    transcriptRef.current = ''

    const userMessage = { role: 'user', content: text }
    const updated = [...messagesRef.current, userMessage]
    setMessages(updated)

    // Detect emotional state from the last 3 user messages before calling AI.
    // The ref is read (and cleared) inside sendToAI so the injection is
    // scoped to this single exchange only.
    const recentUserMessages = updated
      .filter((m) => m.role === 'user')
      .slice(-3)
      .map((m) => m.content)
    emotionStateRef.current = detectEmotionalState(recentUserMessages)

    // Opt-out phrases (RESIST_PHRASES) may appear mid-utterance as well as
    // at the end. If the whole message is just an opt-out phrase and contains
    // no other content, we still send it so the AI's back-off injection works
    // naturally — we don't strip it the way STOP_PHRASES are stripped.

    if (user?.id) {
      saveMessages(interviewId, { messages: updated }, user.id)
    }

    sendToAI(updated)
  }, [isListening, interviewId, sendToAI])

  // Pause = leave the interview mid-flight. Conversation auto-saves on every
  // user turn, so leaving doesn't actually lose the captured Q&A — but it
  // does drop the user out of an active mic/utterance/stream cycle. Confirm
  // if any of those are live; otherwise leave immediately so the common case
  // (paused for a moment, then leaving) stays one click.
  const [pauseConfirmOpen, setPauseConfirmOpen] = useState(false)

  // Inline output panel: slides in from the right when content generation
  // completes so the user sees transcript + output side-by-side without a
  // full page navigation.
  const [showOutput, setShowOutput] = useState(false)
  const [outputData, setOutputData] = useState(null)

  function leaveInterview() {
    window.speechSynthesis?.cancel()
    recognitionRef.current?.abort()
    // Flush session_state immediately before leaving so resume works
    // even if the debounced auto-save hasn't fired yet.
    clearTimeout(sessionSaveTimerRef.current)
    if (user?.id && !interviewComplete && messagesRef.current.length > 0) {
      updateInterview(
        interviewId,
        { session_state: buildSessionState(messagesRef.current), paused_at: new Date().toISOString() },
        user.id,
      ).catch(() => {})
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
      await updateInterview(interviewId, { verbatimFlags: next }, user.id)
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
      await updateInterview(interviewId, { verbatimFlags: next }, user.id)
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
      const streamMessages = [
        ...apiMessages,
        { role: 'user', content: 'Please write the blog post now based on our interview.' },
      ]
      const systemPrompt = getBlogPostSystemPrompt(
        overlaidWorkspace, clinician.name, interview.topic, tone, voiceMode, interview.prototype_id,
        clinician.voice_notes || '',
      ) + buildVerbatimBlock(interview.verbatim_flags)

      let chunks = 0
      for await (const delta of streamMessage(streamMessages, systemPrompt, { model: 'claude-opus-4-7' })) {
        blogStreamingTextRef.current += delta
        chunks += 1
        if (chunks % 5 === 0) setBlogStreamingTokens(chunks)
      }
      setBlogStreamingTokens(chunks)

      const blogPost = blogStreamingTextRef.current
      if (!blogPost.trim()) throw new Error('No content returned from generation')

      const outputs = { blogPost, generatedAt: new Date().toISOString() }
      // Clear session_state: completed interviews don't need resume capability.
      await updateInterview(interviewId, { outputs, status: 'completed', session_state: null, paused_at: null }, user.id)
      // The PATCH above triggers a server-side cascade in api/db/interviews.js
      // that creates the content_items rows. Flush caches so ContentHub /
      // Calendar pick those up on next read.
      qc.invalidateQueries({ queryKey: queryKeys.interviews.all })
      qc.invalidateQueries({ queryKey: queryKeys.clinicians.all })
      qc.invalidateQueries({ queryKey: queryKeys.contentItems.all })
      // Slide the output panel in-place — no full page transition.
      // Update the URL so the user can bookmark/share the output link,
      // but stay on this page with the transcript still visible on the left.
      setOutputData(outputs)
      setShowOutput(true)
      navigate(`/interview/${clinicianId}/${interviewId}/output`, { replace: true })
    } catch (err) {
      setError(`Failed to generate content: ${err.message}`)
      setIsGenerating(false)
    }
  }

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
    return <MicCheck onContinue={() => setMicCheckPassed(true)} />
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
    <div className={`flex h-[calc(100vh-7rem)] ${showOutput ? 'gap-0 overflow-hidden' : 'max-w-2xl mx-auto'}`}>
      {/* ── Left: interview transcript pane ── */}
      <div className={`flex flex-col min-w-0 transition-all duration-300 ease-out ${showOutput ? 'w-1/2 pr-4' : 'flex-1'}`}>
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
          <span className={`text-xs shrink-0 ${saveStatus === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>
            {saveStatus === 'saving' ? '↑ Saving…' : saveStatus === 'saved' ? '✓ Saved' : '⚠ Save failed'}
          </span>
        )}
        {interviewComplete
          ? <Badge variant="secondary" className="text-xs">Interview Complete</Badge>
          : isOwner && (
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setInterviewComplete(true)}
                disabled={!canFinish}
                title={canFinish ? undefined : finishHelper}
                aria-label={canFinish ? 'Finish interview' : finishHelper}
                className="gap-1.5 text-primary border-primary/40 hover:bg-primary/5"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Finish
              </Button>
              <Button variant="outline" size="sm" onClick={handlePause} className="gap-1.5 text-muted-foreground">
                <PauseCircle className="h-3.5 w-3.5" />
                Pause
              </Button>
            </div>
          )
        }
      </div>

      <div className="flex items-center gap-1.5 pb-3 -mt-1 shrink-0">
        <span className="text-[11px] text-muted-foreground">{toneObj.emoji} {toneObj.label}</span>
        <span className="text-[11px] text-muted-foreground/40">·</span>
        <span className="text-[11px] text-muted-foreground">{voiceObj.emoji} {voiceObj.label}</span>
        {prototypeObj && (
          <>
            <span className="text-[11px] text-muted-foreground/40">·</span>
            <span className="text-[11px] text-muted-foreground">{prototypeObj.emoji} {prototypeObj.label}</span>
          </>
        )}
      </div>

      {showResumeBanner && (
        <div className="mb-2 rounded-lg bg-amber-50 border border-amber-200 px-4 py-2 text-xs text-amber-800 flex items-center gap-2 shrink-0" role="status">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse shrink-0" aria-hidden="true" />
          Resuming your session…
        </div>
      )}

      {!interviewComplete && (
        <StepIndicator
          questionsAnswered={userMessageCount}
          assistantAsking={isStreaming || (messages[messages.length - 1]?.role === 'assistant')}
        />
      )}

      <div
        ref={conversationRef}
        onMouseUp={handleSelectionUp}
        onTouchEnd={handleSelectionUp}
        className="flex-1 relative pr-4 -mr-4 overflow-hidden"
      >
        {selectionTip && (
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); addVerbatimFlag() }}
            style={{ top: Math.max(0, selectionTip.top), left: selectionTip.left, transform: 'translateX(-50%)' }}
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
                  {firstNameOnly ? `Great conversation, ${firstNameOnly}.` : 'Great conversation.'}
                </p>
              </div>
              <p className="text-sm text-emerald-800/80 leading-relaxed">
                Your story is being turned into content.
              </p>
              {interview?.outputs?.blogPost && (
                <Button
                  size="sm"
                  className="self-start bg-emerald-700 hover:bg-emerald-800 text-white gap-1.5"
                  onClick={() => {
                    setOutputData(interview.outputs)
                    setShowOutput(true)
                    navigate(`/interview/${clinicianId}/${interviewId}/output`, { replace: true })
                  }}
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
          <p className="text-[11px] text-muted-foreground mb-1.5 flex items-center gap-1">
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

      {interviewComplete && !isGenerating && isOwner && (
        <p className="text-[11px] text-muted-foreground py-1 shrink-0">
          Tip: highlight a sentence above to flag it as verbatim — it will be preserved word-for-word in every draft.
        </p>
      )}

      {interviewComplete && !isGenerating && isOwner && (
        <div className="py-3 shrink-0">
          <div className="rounded-xl border bg-primary/5 border-primary/20 p-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Ready to generate content</p>
              <p className="text-xs text-muted-foreground">Blog post, social media, video scripts, email newsletter, Google Ads, and more.</p>
            </div>
            <Button onClick={handleGenerateContent} size="sm">
              <Sparkles className="h-4 w-4 mr-1.5" />
              Generate
            </Button>
          </div>
        </div>
      )}

      {isGenerating && (
        <div className="py-3 shrink-0">
          <div className="rounded-xl border bg-muted p-4 flex items-center gap-3" role="status" aria-live="polite">
            <Loader2 className="h-4 w-4 text-primary animate-spin shrink-0" aria-hidden="true" />
            <div className="flex-1">
              <p className="text-sm font-medium">
                Writing blog post…
                {blogStreamingTokens > 0 && (
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                    ({blogStreamingTokens} chunks)
                  </span>
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                Turning your interview into a full blog post. Social, video, and marketing content will generate on demand.
              </p>
            </div>
          </div>
        </div>
      )}

      {!interviewComplete && isOwner && (
        <div className="pt-4 pb-1 shrink-0 flex flex-col items-center gap-3">
          {transcript && (
            <div
              aria-live="polite"
              aria-label="Transcript"
              className="w-full rounded-xl bg-muted px-4 py-3 text-sm text-foreground/80 italic min-h-[44px]"
            >
              "{transcript}"
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
                <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" aria-hidden="true" /> Listening — say "done" or tap mic to send
              </span>
            ) : 'Tap to speak'}
          </p>

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
      </div>{/* end left pane */}

      {/* ── Right: inline output panel (slides in on generation complete) ── */}
      <div
        className={`flex-shrink-0 w-1/2 border-l bg-background overflow-hidden transition-transform duration-300 ease-out ${
          showOutput ? 'translate-x-0' : 'translate-x-full hidden'
        }`}
      >
        <InlineOutputPanel
          clinicianId={clinicianId}
          interviewId={interviewId}
          clinician={clinician}
          interview={interview}
          outputs={outputData}
          onViewFull={() => navigate(`/output/${clinicianId}/${interviewId}`)}
        />
      </div>
    </div>
  )
}

// Inline output panel rendered as the right half of the split view after
// content generation completes. Receives already-fetched data as props so
// there's no duplicate network fetch. The full standalone output page at
// /output/:clinicianId/:interviewId is unchanged.
function InlineOutputPanel({ clinicianId, interviewId, clinician, interview, outputs, onViewFull }) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    if (!outputs?.blogPost) return
    navigator.clipboard.writeText(outputs.blogPost)
    setCopied(true)
    setTimeout(() => setCopied(false), 3000)
  }

  if (!outputs) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 text-muted-foreground animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Panel header */}
      <div className="flex items-center justify-between px-5 py-4 border-b bg-muted/30 shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
          <p className="font-semibold text-sm">Content ready</p>
        </div>
        <Button variant="outline" size="sm" onClick={onViewFull} className="gap-1.5 text-xs">
          <ExternalLink className="h-3.5 w-3.5" />
          Full output page
        </Button>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-hidden p-4">
        <Tabs defaultValue="blog" className="h-full flex flex-col">
          <TabsList className="grid grid-cols-1 w-full mb-3 shrink-0">
            <TabsTrigger value="blog" className="gap-1.5 text-xs">
              <FileText className="h-3.5 w-3.5" />
              Blog Post
            </TabsTrigger>
          </TabsList>

          <TabsContent value="blog" className="flex-1 overflow-hidden mt-0">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-muted-foreground">Markdown — copy or open in full editor</p>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={handleCopy} className="text-xs h-7 px-2.5">
                  {copied ? (
                    <><Check className="h-3 w-3 mr-1 text-green-600" />Copied</>
                  ) : (
                    <><Copy className="h-3 w-3 mr-1" />Copy</>
                  )}
                </Button>
              </div>
            </div>
            <ScrollArea className="h-[calc(100%-2rem)]">
              <pre className="text-xs leading-relaxed font-mono whitespace-pre-wrap text-foreground p-1">
                {outputs.blogPost}
              </pre>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </div>

      {/* Footer: link to full output page for social, video, marketing tabs */}
      <div className="px-5 py-3 border-t bg-muted/20 shrink-0">
        <p className="text-xs text-muted-foreground">
          Social, video, and marketing content available on the{' '}
          <button
            type="button"
            onClick={onViewFull}
            className="text-primary underline-offset-2 hover:underline"
          >
            full output page
          </button>
          .
        </p>
      </div>
    </div>
  )
}

function StepIndicator({ questionsAnswered, assistantAsking }) {
  // Question N = whichever question the clinician is currently working on.
  // If the assistant has just asked a new question (and it's not yet answered),
  // the clinician is on question (answered + 1). Otherwise we display the
  // most recent answered question number so the count doesn't jump back.
  const currentQuestion = Math.max(1, questionsAnswered + (assistantAsking ? 1 : 0))
  const progress = Math.min(1, currentQuestion / QUESTION_TARGET_MAX)
  const overflow = currentQuestion > QUESTION_TARGET_MAX

  let caption
  if (overflow) {
    caption = 'Wrap up whenever you feel done.'
  } else {
    caption = `most interviews run ${QUESTION_TARGET_MIN}–${QUESTION_TARGET_MAX} questions`
  }

  return (
    <div className="pb-3 shrink-0" aria-label="Interview progress">
      <div className="flex items-baseline justify-between gap-2 mb-1.5">
        <span className="text-[11px] font-medium text-muted-foreground">
          Question {currentQuestion}
        </span>
        <span className="text-[11px] text-muted-foreground/70">{caption}</span>
      </div>
      <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
        <div
          className="h-full bg-primary/60 transition-all duration-500 ease-out"
          style={{ width: `${progress * 100}%` }}
        />
      </div>
    </div>
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
  const isAI = message.role === 'assistant'
  const isContrast  = isAI && hasContrastSignal(message.content)
  const isAgreement = isAI && hasAgreementSignal(message.content)
  const isGap       = isAI && hasGapSignal(message.content)
  const displayContent = isAI
    ? stripGapToken(stripAgreementToken(stripContrastToken(message.content)))
    : message.content
  return (
    <div className={`flex items-start gap-3 ${!isAI ? 'flex-row-reverse' : ''}`}>
      {isAI ? (
        <div className="h-8 w-8 rounded-full bg-white border border-border flex items-center justify-center shrink-0 p-1">
          <img src={workspace.logo.icon} alt={workspace.name} className="h-full w-full" />
        </div>
      ) : (
        <div className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center shrink-0 text-xs font-medium">
          {clinicianName[0]}
        </div>
      )}
      <div className="flex flex-col gap-1 max-w-[90%] sm:max-w-[80%]">
        {isContrast && (
          <Badge variant="outline" className="self-start flex items-center gap-1 text-[11px] text-muted-foreground border-muted-foreground/30 px-2 py-0.5">
            <ArrowLeftRight className="h-3 w-3" aria-hidden="true" />
            A colleague saw this differently
          </Badge>
        )}
        {isAgreement && (
          <Badge variant="outline" className="self-start flex items-center gap-1 text-[11px] text-emerald-700 border-emerald-200 bg-emerald-50 px-2 py-0.5">
            ≡ Shared perspective at your practice
          </Badge>
        )}
        {isGap && (
          <Badge variant="outline" className="self-start flex items-center gap-1 text-[11px] text-amber-700 border-amber-200 bg-amber-50 px-2 py-0.5">
            ○ Your perspective on this not yet captured
          </Badge>
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

import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useUser } from '@clerk/clerk-react'
import { ArrowLeft, Loader2, Sparkles, AlertCircle, Mic, MicOff, Volume2, Mic2, PauseCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { fetchSimilarInterviews, updateInterview } from '@/lib/api'
import { useClinician, useInterview, queryKeys } from '@/lib/queries'
import { useQueryClient } from '@tanstack/react-query'
import { createContentItems } from '@/lib/publish'
import { streamMessage } from '@/lib/claude'
import { getInterviewSystemPrompt, getBlogPostSystemPrompt, TONES, getVoiceModes, getPatientPrototypesUi } from '@/lib/prompts'
import { getInitials } from '@/lib/utils'
import { workspace } from '@/lib/workspace'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { applyLocationOverlay } from '@/lib/locationOverlay'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { ConfirmDialog } from '@/components/ui/alert-dialog'

const COMPLETE_TOKEN = 'INTERVIEW_COMPLETE'

const STOP_PHRASES = [
  "that's all",
  "that's it",
  "i'm done",
  "i am done",
  "send it",
  "send that",
  "submit",
  "next question",
  "move on",
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
  const [saveStatus, setSaveStatus] = useState('') // '' | 'saving' | 'saved' | 'error'

  const bottomRef = useRef(null)
  const hasStarted = useRef(false)
  const recognitionRef = useRef(null)
  const messagesRef = useRef([])
  const transcriptRef = useRef('')
  const autoListenRef = useRef(false)
  const finalTranscriptRef = useRef('')
  const interviewRef = useRef(null)
  const pastInterviewsRef = useRef([])

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

  // Seed local interview state (which we then mutate during conversation)
  // from the cached row. Bounce back to dashboard on a hard 404 — the
  // useInterview hook returns null in that case via the queryFn's contract.
  useEffect(() => {
    if (interviewLoading) return
    if (!interviewData) { navigate('/'); return }
    setInterview(interviewData)
    setMessages(interviewData.messages || [])
    if ((interviewData.messages || []).some((m) => m.content?.includes(COMPLETE_TOKEN))) {
      setInterviewComplete(true)
    }
    if ((interviewData.messages || []).length > 0) setShowInstructions(false)

    fetchSimilarInterviews(interviewData.topic, interviewId)
      .then((past) => { pastInterviewsRef.current = past || [] })
      .catch(() => {})
  }, [interviewLoading, interviewData, interviewId, navigate])

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
    const systemPrompt = getInterviewSystemPrompt(overlaidWorkspace, clinician.name, interviewRef.current.topic, pastInterviewsRef.current, interviewRef.current?.prototype_id)
    let apiMessages = currentMessages.map((m) => ({ role: m.role, content: m.content }))
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
    const cleanText = fullText.replace(COMPLETE_TOKEN, '').trim()

    const aiMessage = { role: 'assistant', content: cleanText }
    const updated = [...currentMessages, aiMessage]
    setMessages(updated)

    if (user?.id) {
      const patch = { messages: updated }
      if (isComplete) patch.status = 'in_progress'
      saveMessages(interviewId, patch, user.id)
    }

    if (isComplete) setInterviewComplete(true)
    setStreamingText('')
    setIsStreaming(false)

    if (!isComplete) speak(cleanText)
  }, [clinician, interviewId, user?.id])

  useEffect(() => {
    if (!clinician || !interview || hasStarted.current || showInstructions) return
    hasStarted.current = true
    if (messages.length === 0) {
      sendToAI([])
    } else {
      const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant')
      if (lastAssistant && !interviewComplete) speak(lastAssistant.content)
    }
  }, [clinician, interview, showInstructions])

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

  function leaveInterview() {
    window.speechSynthesis?.cancel()
    recognitionRef.current?.abort()
    navigate(`/clinician/${clinicianId}`)
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
      )

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
      await updateInterview(interviewId, { outputs, status: 'completed' }, user.id)
      // Completed interview triggers a server-side cascade that creates
      // content_items rows. Flush both caches so ContentHub / Calendar
      // pick those up on next read.
      qc.invalidateQueries({ queryKey: queryKeys.interviews.all })
      qc.invalidateQueries({ queryKey: queryKeys.clinicians.all })
      qc.invalidateQueries({ queryKey: queryKeys.contentItems.all })
      createContentItems({
        interviewId,
        clinicianId,
        clinicianName: clinician.name,
        topic: interview.topic,
        platform: 'blog',
        content: blogPost,
        status: 'draft',
      }).catch(() => {})
      navigate(`/output/${clinicianId}/${interviewId}`)
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
            I'm ready — start the interview
          </Button>
        </div>
      </div>
    )
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
    <div className="max-w-2xl mx-auto flex flex-col h-[calc(100vh-7rem)]">
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
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{interview.topic}</p>
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

      <ScrollArea className="flex-1 pr-4 -mr-4">
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

          <div ref={bottomRef} />
        </div>
      </ScrollArea>

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
            ? "We're still capturing your answer. Pausing now will drop the in-progress utterance. You can resume from the clinician's page — past Q&A is saved."
            : isSpeaking || isStreaming
              ? "The AI is mid-response. Pausing now will cut it off. Past Q&A is saved — you can resume from the clinician's page."
              : "Pausing now will drop your in-progress utterance. Past Q&A is saved and you can resume from the clinician's page."
        }
        confirmLabel="Pause anyway"
        destructive={false}
        onConfirm={leaveInterview}
      />
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
      <div
        className={`max-w-[90%] sm:max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
          isAI
            ? 'bg-muted rounded-tl-sm'
            : 'bg-primary text-primary-foreground rounded-tr-sm'
        } ${isStreaming ? 'animate-pulse' : ''}`}
      >
        {message.content}
      </div>
    </div>
  )
}

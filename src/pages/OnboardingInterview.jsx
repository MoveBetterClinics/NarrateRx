// One-time onboarding interview the founder runs after the signup wizard
// creates the workspace. P2 deliverable: text-only chat using the
// getOnboardingInterviewSystemPrompt prompt. Voice + mic come in P2b; the
// synthesis call that turns the transcript into workspace/clinician config
// is P3. The Home card that surfaces this page is P4.
//
// Founder-only — gated by the API route's requireRole(['admin']) check.
// Workspace-scoped via workspaceContext on the server.

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useUser } from '@clerk/clerk-react'
import { Loader2, Send, CheckCircle2, AlertCircle, Sparkles, FlaskConical } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { useUserRole } from '@/lib/useUserRole'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { apiFetch } from '@/lib/api'
import { streamMessage } from '@/lib/claude'
import { getOnboardingInterviewSystemPrompt } from '@/lib/prompts'

const COMPLETE_TOKEN = 'INTERVIEW_COMPLETE'

// Detect and strip the completion marker from a streaming assistant message.
// Returns { text, complete } — `text` is the cleaned content (the marker plus
// any surrounding whitespace removed), `complete` is true when the marker was
// present.
function detectComplete(raw) {
  if (!raw.includes(COMPLETE_TOKEN)) return { text: raw, complete: false }
  const cleaned = raw.replace(new RegExp(`\\s*${COMPLETE_TOKEN}\\s*`, 'g'), '').trim()
  return { text: cleaned, complete: true }
}

export default function OnboardingInterview() {
  useDocumentTitle('Onboarding interview')
  const navigate = useNavigate()
  const workspace = useWorkspace()
  const { user } = useUser()
  const { role } = useUserRole()

  const [interview, setInterview] = useState(null)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [completed, setCompleted] = useState(false)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  // 'idle' before completion / when resumed in a synthesized state
  // 'running' while the synth handler is working (~30–60s)
  // 'success' on synthesis finish
  // 'error' on synthesis failure (user can retry from the success card)
  // 'already' when the interview is already synthesized on first load
  const [synthesisStatus, setSynthesisStatus] = useState('idle')
  const [synthesisError, setSynthesisError] = useState(null)
  const [synthesisCounts, setSynthesisCounts] = useState(null)
  const [synthesisResult, setSynthesisResult] = useState(null)  // dry-run only

  // Dry-run mode: append ?dryRun=1 to the URL. Runs synthesis end-to-end and
  // returns the JSON payload for inspection, but performs ZERO writes — no
  // workspace voice update, no voice_phrases, no interview status flip. Used
  // during P5 prompt-tuning so we can iterate without clobbering production
  // workspace data.
  const [searchParams] = useSearchParams()
  const dryRun = useMemo(() => {
    const v = searchParams.get('dryRun')
    return v === '1' || v === 'true'
  }, [searchParams])

  // Seed-once guard — without this, a refetch (e.g. tab refocus) would stomp
  // local message state mid-conversation. Pattern lifted from the React Query
  // seeding lesson in project memory.
  const seededRef = useRef(false)
  const scrollRef = useRef(null)
  const founderName = (user?.fullName || user?.firstName || '').trim() || 'there'

  // Bootstrap: fetch existing interview, or create one. Founders may resume
  // a paused session; if no row exists yet POST to create.
  useEffect(() => {
    if (!workspace?.id || !user?.id || seededRef.current) return

    let cancelled = false
    ;(async () => {
      try {
        let row = await apiFetch('/api/onboarding/interview')
        if (!row) {
          row = await apiFetch('/api/onboarding/interview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ founderName }),
          })
        }
        if (cancelled) return
        seededRef.current = true
        setInterview(row)
        setMessages(Array.isArray(row?.messages) ? row.messages : [])
        if (row?.status === 'completed' || row?.status === 'synthesized') {
          setCompleted(true)
        }
        if (row?.status === 'synthesized' && !dryRun) {
          // Already done — show the finished state without re-running synthesis.
          // Dry-run mode intentionally re-fires so the tester can compare a
          // tuned prompt against a previous run on the same transcript.
          setSynthesisStatus('already')
        }
      } catch (e) {
        if (!cancelled) setError(e?.message || 'Failed to start interview')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => { cancelled = true }
    // dryRun is included so the synthesized-state short-circuit re-evaluates if
    // the user appends ?dryRun=1 mid-session. The seededRef guard inside still
    // prevents the network call from re-firing.
  }, [workspace?.id, user?.id, founderName, dryRun])

  // Auto-scroll to the latest message. Smooth on append; instant on initial
  // load so we don't get a long scroll animation showing the resumed transcript.
  useEffect(() => {
    if (!scrollRef.current) return
    scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, streamingText])

  // Persist messages + status to the server. Fire-and-forget — local state is
  // authoritative for the UI and a failed save just means resume-after-refresh
  // loses the latest turn (a known acceptable risk for v1).
  const interviewId = interview?.id
  const persist = useCallback(async (next, statusUpdate) => {
    if (!interviewId) return
    try {
      const patch = { messages: next }
      if (statusUpdate) {
        patch.status = statusUpdate
        if (statusUpdate === 'completed') patch.completedAt = new Date().toISOString()
      }
      await apiFetch(`/api/onboarding/interview?id=${encodeURIComponent(interviewId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
    } catch (e) {
      console.error('[OnboardingInterview] persist failed', e)
    }
  }, [interviewId])

  // Stream the next assistant turn from /api/stream using the onboarding prompt.
  // Called both for the opener (no user message yet) and after each user reply.
  const runAssistantTurn = useCallback(async (currentMessages, { isFirstMessage }) => {
    if (!workspace) return
    setStreaming(true)
    setStreamingText('')
    setError(null)

    const systemPrompt = getOnboardingInterviewSystemPrompt(workspace, founderName, { isFirstMessage })

    // Claude API (and Vercel AI Gateway) require at least one message — a
    // system-only request returns AI_InvalidPromptError. On the first turn,
    // inject a silent user "please begin" so Bernard's opener has a turn to
    // respond to. Matches the canonical pattern in InterviewSession.jsx.
    // We do NOT add this to the visible transcript — it's a trigger only.
    const streamInput = currentMessages.length === 0
      ? [{ role: 'user', content: 'Please begin the onboarding interview.' }]
      : currentMessages

    let buffer = ''
    let complete = false
    try {
      for await (const delta of streamMessage(streamInput, systemPrompt, { model: 'claude-sonnet-4-6', maxOutputTokens: 1024 })) {
        buffer += delta
        // Cheap mid-stream check — the model usually emits the token at the
        // end, but stripping early keeps the partial UI clean.
        const { text } = detectComplete(buffer)
        setStreamingText(text)
      }
    } catch (e) {
      setStreaming(false)
      setError(e?.message || 'Stream failed')
      return
    }

    const { text, complete: hasCompleteMarker } = detectComplete(buffer)
    complete = hasCompleteMarker
    const finalText = text.trim()
    if (!finalText) {
      setStreaming(false)
      setStreamingText('')
      setError('Empty response from interviewer — try again.')
      return
    }

    const nextMessages = [...currentMessages, { role: 'assistant', content: finalText }]
    setMessages(nextMessages)
    setStreamingText('')
    setStreaming(false)
    if (complete) {
      setCompleted(true)
      await persist(nextMessages, 'completed')
    } else {
      await persist(nextMessages)
    }
  }, [workspace, founderName, persist])

  // Kick off the opener once the interview is loaded with no messages yet.
  // kickedOffRef ensures we only attempt once per page-load — if the stream
  // call fails (e.g. AI_InvalidPromptError, rate limit, network), the error
  // is shown but we don't auto-retry. Without this guard the effect re-fires
  // each render because `streaming` flips back to false on error and
  // `messages.length` stays 0, producing a 10-rps retry storm.
  const kickedOffRef = useRef(false)
  useEffect(() => {
    if (loading || completed || streaming || !interview) return
    if (messages.length > 0) return
    if (kickedOffRef.current) return
    kickedOffRef.current = true
    runAssistantTurn([], { isFirstMessage: true })
  }, [loading, completed, streaming, interview, messages.length, runAssistantTurn])

  // Run synthesis. Extracted as its own callback so the auto-trigger effect
  // and the retry button can both invoke it. `dryRun` is threaded from the
  // URL query — when true, the handler returns the synthesis JSON without
  // writing anything.
  const runSynthesis = useCallback(async () => {
    if (!interviewId) return
    setSynthesisStatus('running')
    setSynthesisError(null)
    setSynthesisResult(null)
    try {
      const result = await apiFetch('/api/onboarding/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: interviewId, founderName, dryRun }),
      })
      setSynthesisCounts(result?.counts || null)
      if (dryRun && result?.synthesisResult) {
        setSynthesisResult(result.synthesisResult)
      }
      setSynthesisStatus('success')
    } catch (e) {
      console.error('[OnboardingInterview] synthesis failed', e)
      setSynthesisError(e?.message || 'Synthesis failed')
      setSynthesisStatus('error')
    }
  }, [interviewId, founderName, dryRun])

  // Auto-trigger synthesis as soon as the interview flips to completed.
  // Idempotency: status==='synthesized' on first load short-circuits to
  // 'already' (set in bootstrap), so we never re-run.
  useEffect(() => {
    if (!completed || !interviewId) return
    if (synthesisStatus !== 'idle') return
    runSynthesis()
  }, [completed, interviewId, synthesisStatus, runSynthesis])

  const handleSend = useCallback(async () => {
    const trimmed = input.trim()
    if (!trimmed || streaming || completed) return
    const next = [...messages, { role: 'user', content: trimmed }]
    setMessages(next)
    setInput('')
    await runAssistantTurn(next, { isFirstMessage: false })
  }, [input, streaming, completed, messages, runAssistantTurn])

  const handleKeyDown = useCallback((e) => {
    // Cmd/Ctrl + Enter sends. Plain Enter inserts a newline — onboarding answers
    // are often multi-paragraph and we'd rather not surprise-submit a half-thought.
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  // ── Render guards ────────────────────────────────────────────────────────

  if (role && role !== 'admin') {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12">
        <Card>
          <CardContent className="pt-6 text-center space-y-2">
            <AlertCircle className="h-8 w-8 mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              The onboarding interview is only available to workspace admins.
            </p>
            <Button variant="outline" onClick={() => navigate('/')}>Back to Home</Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error && messages.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12">
        <Card>
          <CardContent className="pt-6 text-center space-y-3">
            <AlertCircle className="h-8 w-8 mx-auto text-destructive" />
            <p className="text-sm">{error}</p>
            <Button onClick={() => window.location.reload()}>Try again</Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  // ── Main UI ──────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 flex flex-col" style={{ minHeight: 'calc(100vh - 4rem)' }}>
      {dryRun && (
        <div className="mb-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 flex items-center gap-2 text-sm">
          <FlaskConical className="h-4 w-4 text-warning shrink-0" />
          <span>
            <span className="font-semibold">Dry-run mode.</span>{' '}
            Synthesis will run end-to-end and show you the JSON output, but{' '}
            <span className="font-medium">nothing will be written</span> to your
            workspace, voice phrases, or interview status. Remove
            {' '}<code className="font-mono text-xs">?dryRun=1</code>{' '}from the URL to run for real.
          </span>
        </div>
      )}
      <Card className="mb-4">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" />
            Tell NarrateRx about {workspace?.display_name || 'your practice'}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            About 15 minutes. Once we have your voice, every piece NarrateRx generates from here on will sound like you — not a template.
          </p>
        </CardHeader>
      </Card>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto space-y-4 pb-4 px-1"
        style={{ minHeight: '300px' }}
      >
        {messages.map((m, i) => (
          <MessageBubble key={i} role={m.role} content={m.content} />
        ))}
        {streaming && streamingText && (
          <MessageBubble role="assistant" content={streamingText} streaming />
        )}
        {streaming && !streamingText && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground pl-1">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>{workspace?.interviewer_name || 'Bernard'} is thinking…</span>
          </div>
        )}
      </div>

      {completed ? (
        <SynthesisStateCard
          status={synthesisStatus}
          error={synthesisError}
          counts={synthesisCounts}
          result={synthesisResult}
          dryRun={dryRun}
          onRetry={runSynthesis}
          onHome={() => navigate('/')}
        />
      ) : (
        <div className="border-t pt-4 space-y-2">
          {error && (
            <p className="text-sm text-destructive flex items-center gap-2">
              <AlertCircle className="h-4 w-4" /> {error}
            </p>
          )}
          <div className="flex gap-2 items-end">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type your answer… (⌘/Ctrl + Enter to send)"
              rows={3}
              disabled={streaming}
              className="resize-none"
            />
            <Button
              onClick={handleSend}
              disabled={streaming || !input.trim()}
              size="icon"
              className="h-10 w-10 shrink-0"
              aria-label="Send"
            >
              {streaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function SynthesisStateCard({ status, error, counts, result, dryRun, onRetry, onHome }) {
  if (status === 'running') {
    return (
      <Card className="border-primary/40 bg-primary/5">
        <CardContent className="pt-6 text-center space-y-3">
          <Loader2 className="h-8 w-8 mx-auto animate-spin text-primary" />
          <div className="space-y-1">
            <p className="font-medium">
              {dryRun ? 'Running dry-run synthesis…' : 'Interview complete — synthesizing your voice…'}
            </p>
            <p className="text-sm text-muted-foreground">
              {dryRun
                ? 'About a minute. The model is producing the synthesis JSON; nothing will be written.'
                : 'About a minute. We’re reading your transcript and writing your workspace’s voice guidance, patient archetype, topic queue, and phrase bank. Hang tight.'}
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (status === 'error') {
    return (
      <Card className="border-destructive/40 bg-destructive/5">
        <CardContent className="pt-6 text-center space-y-3">
          <AlertCircle className="h-8 w-8 mx-auto text-destructive" />
          <div className="space-y-1">
            <p className="font-medium">Synthesis failed.</p>
            <p className="text-sm text-muted-foreground">
              Your transcript is safe — we just couldn&apos;t process it on this attempt. Most failures are transient (rate limit, gateway hiccup); retrying usually works.
            </p>
            {error && <p className="text-xs text-destructive/80 font-mono">{error}</p>}
          </div>
          <div className="flex gap-2 justify-center">
            <Button variant="outline" onClick={onHome}>Back to Home</Button>
            <Button onClick={onRetry}>Try again</Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  // success or already-synthesized
  const isFresh = status === 'success'
  const headline = dryRun
    ? 'Dry-run synthesis complete — nothing was written.'
    : isFresh
      ? 'Done — your workspace now sounds like you.'
      : 'Onboarding interview complete.'
  const subhead = dryRun
    ? 'Review the JSON below. Tune the synthesis prompt if anything looks off, then remove ?dryRun=1 from the URL to run for real.'
    : isFresh
      ? 'From here on, content NarrateRx generates uses the voice, audience, and topic queue from your interview.'
      : 'Your workspace voice was already synthesized. Visit Settings → Voice to review or refine.'
  const verb = dryRun ? 'Would write' : 'Wrote'
  return (
    <Card className={dryRun ? 'border-warning/40 bg-warning/5' : 'border-success/40 bg-success/5'}>
      <CardContent className="pt-6 text-center space-y-3">
        {dryRun
          ? <FlaskConical className="h-8 w-8 mx-auto text-warning" />
          : <CheckCircle2 className="h-8 w-8 mx-auto text-success" />}
        <div className="space-y-1">
          <p className="font-medium">{headline}</p>
          <p className="text-sm text-muted-foreground">{subhead}</p>
          {counts && (
            <p className="text-xs text-muted-foreground pt-1">
              {verb} {counts.voice_phrases} phrase{counts.voice_phrases === 1 ? '' : 's'},
              {' '}{counts.topics} topic seed{counts.topics === 1 ? '' : 's'},
              {' '}{counts.pain_points} prior-provider note{counts.pain_points === 1 ? '' : 's'}
              {counts.has_prototype ? ', and a patient archetype' : ''}.
            </p>
          )}
        </div>
        {dryRun && result && (
          <details className="text-left rounded-md border bg-background p-3 mt-2">
            <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Synthesis result (JSON)
            </summary>
            <pre className="mt-3 max-h-[500px] overflow-auto text-xs leading-relaxed whitespace-pre-wrap font-mono">
              {JSON.stringify(result, null, 2)}
            </pre>
          </details>
        )}
        <div className="flex gap-2 justify-center">
          {dryRun && (
            <Button variant="outline" onClick={onRetry}>Run again</Button>
          )}
          <Button onClick={onHome}>Back to Home</Button>
        </div>
      </CardContent>
    </Card>
  )
}

function MessageBubble({ role, content, streaming = false }) {
  const isUser = role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-foreground'
        }`}
      >
        {content}
        {streaming && <span className="inline-block w-1.5 h-4 ml-0.5 align-middle bg-current opacity-50 animate-pulse" />}
      </div>
    </div>
  )
}

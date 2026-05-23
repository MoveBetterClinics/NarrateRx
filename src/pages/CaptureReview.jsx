import { useState, useRef, useCallback } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Loader2, Sparkles, AlertCircle, Mic } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { useClinician, useInterview, queryKeys } from '@/lib/queries'
import { updateInterview, populateContentItemProvenance } from '@/lib/api'
import { streamMessage } from '@/lib/claude'
import { extractProvenanceBlock } from '@/lib/provenance'
import { getBlogPostSystemPrompt } from '@/lib/prompts'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { applyLocationOverlay } from '@/lib/locationOverlay'
import { resolveAudienceSlot, resolveStoryTypeSlot } from '@/lib/interviewOptionsCatalog'
import { toast } from '@/lib/toast'

/**
 * CaptureReview — shown after a voice memo upload completes.
 *
 * Displays the Whisper transcript so the clinician can correct any mishearing
 * before generation, then streams the blog post using the same prompt +
 * pipeline as InterviewSession. On completion it PATCHes status='completed'
 * (which triggers content_items creation server-side) and routes to Stories.
 *
 * Route: /capture/:clinicianId/:interviewId/review
 */
export default function CaptureReview() {
  useDocumentTitle('Review transcript')
  const navigate = useNavigate()
  const { clinicianId, interviewId } = useParams()
  const qc = useQueryClient()
  const { workspace: ws } = useWorkspace()

  const { data: interview, isLoading: ivLoading, isError: ivError } = useInterview(interviewId)
  const { data: clinician, isLoading: clLoading } = useClinician(clinicianId)

  // Editable transcript — seeded from the Whisper output on first load.
  const [transcript, setTranscript] = useState(null) // null = not yet seeded
  const [isGenerating, setIsGenerating] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [error, setError] = useState('')
  const genFiredRef = useRef(false)

  // Seed the editable transcript once (not on every re-render).
  if (transcript === null && interview?.messages?.[0]?.content) {
    setTranscript(interview.messages[0].content)
  }

  const generate = useCallback(async () => {
    if (genFiredRef.current || isGenerating) return
    genFiredRef.current = true
    setIsGenerating(true)
    setError('')
    setStreamingText('')

    try {
      // Resolve workspace overlay (location-level overrides, if any).
      const overlaidWorkspace = interview?.location_id
        ? applyLocationOverlay(ws, interview.location_id)
        : ws

      // Voice phrases for this clinician — improves voice fidelity in the
      // generated output. Best-effort; a failure must not block generation.
      let voicePhrases = []
      try {
        const { apiFetch } = await import('@/lib/api')
        const vp = await apiFetch(`/api/clinicians/voice-phrases?clinician_id=${clinicianId}&limit=8`)
        voicePhrases = Array.isArray(vp?.phrases) ? vp.phrases : []
      } catch (e) {
        console.warn('[CaptureReview] voice phrase fetch failed:', e?.message)
      }

      const systemPrompt = getBlogPostSystemPrompt(
        overlaidWorkspace,
        clinician?.name || 'the clinician',
        interview?.topic || 'Voice memo',
        interview?.tone || 'smart',
        interview?.voice_mode || 'personal',
        interview?.prototype_id || null,
        clinician?.voice_notes || '',
        voicePhrases,
        resolveAudienceSlot(interview?.audience, overlaidWorkspace?.audience_options),
        resolveStoryTypeSlot(interview?.story_type, overlaidWorkspace?.story_type_options),
      )

      // The transcript is the sole user message. We append a generation cue
      // so the model knows to produce the blog post (same pattern as
      // InterviewSession's streamMessages).
      const streamMessages = [
        { role: 'user', content: transcript },
        { role: 'user', content: 'Please write the blog post now based on this voice memo.' },
      ]

      let accumulated = ''
      for await (const delta of streamMessage(streamMessages, systemPrompt, {
        model: 'claude-opus-4-7',
        maxOutputTokens: 4096,
      })) {
        accumulated += delta
        setStreamingText(accumulated)
      }

      const { content: blogPost, provenanceJson } = extractProvenanceBlock(accumulated)
      if (!blogPost.trim()) throw new Error('No content returned from generation')

      const outputs = { blogPost, generatedAt: new Date().toISOString() }

      // Update the interview with the (possibly edited) transcript + outputs,
      // then mark completed. The server-side cascade creates content_items rows.
      await updateInterview(interviewId, {
        messages: [{ role: 'user', content: transcript }],
        outputs,
        status: 'completed',
      })

      qc.invalidateQueries({ queryKey: queryKeys.interviews.all })
      qc.invalidateQueries({ queryKey: queryKeys.clinicians.all })
      qc.invalidateQueries({ queryKey: queryKeys.contentItems.all })
      qc.invalidateQueries({ queryKey: queryKeys.stories?.all ?? ['stories'] })

      // Provenance — best-effort, non-blocking.
      populateContentItemProvenance(interviewId, provenanceJson || '', 'blog').catch((e) => {
        console.warn('[CaptureReview] provenance failed:', e?.message)
      })

      toast.success('Content generated — reviewing your story.')
      navigate(`/stories/${interviewId}`, { replace: true })
    } catch (err) {
      genFiredRef.current = false
      setIsGenerating(false)
      setStreamingText('')
      setError(err?.message || 'Generation failed — please try again.')
    }
  }, [transcript, clinician, interview, ws, clinicianId, interviewId, isGenerating, navigate, qc])

  const loading = ivLoading || clLoading

  if (loading) {
    return (
      <div className="max-w-lg mx-auto flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (ivError || !interview) {
    return (
      <div className="max-w-lg mx-auto py-16 text-center space-y-3">
        <AlertCircle className="h-8 w-8 text-destructive mx-auto" />
        <p className="text-sm text-muted-foreground">Could not load the interview — it may have been deleted.</p>
        <Button variant="ghost" asChild><Link to="/">← Home</Link></Button>
      </div>
    )
  }

  // If this interview already has outputs (e.g. user hit back after generation),
  // skip straight to stories rather than letting them re-generate.
  if (interview.status === 'completed' && interview.outputs?.blogPost) {
    navigate(`/stories/${interviewId}`, { replace: true })
    return null
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/new/voice-memo">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Review transcript</h1>
          <p className="text-sm text-muted-foreground">
            Fix any mishearing, then generate.
          </p>
        </div>
      </div>

      {/* Transcript edit */}
      {!isGenerating && (
        <Card>
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Mic className="h-4 w-4 text-muted-foreground" />
              <span>Transcribed from your recording</span>
            </div>
            <Textarea
              value={transcript ?? ''}
              onChange={(e) => setTranscript(e.target.value)}
              rows={10}
              className="resize-y text-sm leading-relaxed"
              placeholder="Transcript will appear here…"
            />
            <p className="text-xs text-muted-foreground">
              Edit anything Whisper got wrong before you generate.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Streaming preview during generation */}
      {isGenerating && streamingText && (
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2 text-sm font-medium mb-3">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span>Writing your blog post…</span>
            </div>
            <div className="text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground max-h-64 overflow-y-auto">
              {streamingText}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Generating with no text yet */}
      {isGenerating && !streamingText && (
        <Card>
          <CardContent className="p-6 flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm font-medium">Generating content…</p>
            <p className="text-xs text-muted-foreground text-center max-w-xs">
              Turning your voice memo into a full blog post. Won&apos;t be long.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Error */}
      {error && (
        <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md p-3">
          {error}
        </div>
      )}

      {/* Generate CTA */}
      {!isGenerating && (
        <Button
          className="w-full"
          size="lg"
          onClick={generate}
          disabled={!transcript?.trim()}
        >
          <Sparkles className="h-4 w-4 mr-2" />
          Generate content
        </Button>
      )}
    </div>
  )
}

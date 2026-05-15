import { ScrollArea } from '@/components/ui/scroll-area'
import TranscriptHighlighter from './TranscriptHighlighter'

/**
 * TranscriptPane — displays the interview transcript for a story.
 *
 * Renders cleaned_messages if available, falls back to messages.
 * Each message is labeled Clinician / Interviewer per its role.
 *
 * Wrapped in TranscriptHighlighter so the user can select any span of text
 * and instantly route it to Social, GBP, or Verbatim Quote formats.
 */
export default function TranscriptPane({ story, isLoadingTranscript = false }) {
  if (!story) return null

  const status = story.status
  if (status && status !== 'completed') {
    return (
      <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
        Interview in progress — transcript will appear here when the session is complete.
      </div>
    )
  }

  // While useStory is hydrating from list-cache placeholder data, the slim
  // shape has no messages yet. Show a skeleton instead of "no transcript".
  if (isLoadingTranscript) {
    return (
      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b bg-muted/30">
          <p className="text-sm font-medium">Transcript</p>
        </div>
        <div className="p-4 space-y-3 animate-pulse">
          <div className="h-3 bg-gray-200 rounded w-3/4" />
          <div className="h-3 bg-gray-200 rounded w-full" />
          <div className="h-3 bg-gray-200 rounded w-5/6" />
          <div className="h-3 bg-gray-200 rounded w-2/3" />
        </div>
      </div>
    )
  }

  const cleaned = Array.isArray(story.cleaned_messages) ? story.cleaned_messages : []
  const original = Array.isArray(story.messages) ? story.messages : []
  const display = (cleaned.length > 0 ? cleaned : original)
    .filter((m) => !String(m.content || '').includes('INTERVIEW_COMPLETE'))

  if (display.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
        No transcript available for this interview.
      </div>
    )
  }

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b bg-muted/30">
        <p className="text-sm font-medium">Transcript</p>
        {cleaned.length > 0 && (
          <p className="text-xs text-muted-foreground mt-0.5">Showing cleaned version</p>
        )}
        <p className="text-xs text-muted-foreground mt-0.5 italic">
          Select any text to route it to a content format
        </p>
      </div>
      <TranscriptHighlighter story={story}>
        <ScrollArea className="h-[520px]">
          <div className="p-4 space-y-3">
            {display.map((m, i) => (
              <div key={i} className="text-xs leading-relaxed">
                <span className={`font-medium ${m.role === 'user' ? 'text-primary' : 'text-muted-foreground'}`}>
                  {m.role === 'user' ? 'Clinician: ' : 'Interviewer: '}
                </span>
                <span className="text-foreground/90">{m.content}</span>
              </div>
            ))}
          </div>
        </ScrollArea>
      </TranscriptHighlighter>
    </div>
  )
}

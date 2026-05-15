import { Download, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Build a filtered, labeled message array from the story object.
 * Mirrors the logic in TranscriptPane: prefers cleaned_messages, falls back
 * to messages, and strips the sentinel INTERVIEW_COMPLETE turn.
 */
function getMessages(story) {
  const cleaned  = Array.isArray(story.cleaned_messages) ? story.cleaned_messages : []
  const original = Array.isArray(story.messages) ? story.messages : []
  return (cleaned.length > 0 ? cleaned : original).filter(
    (m) => !String(m.content || '').includes('INTERVIEW_COMPLETE'),
  )
}

/** Format a Date (or ISO string) to a human-readable string. */
function fmtDate(raw) {
  if (!raw) return 'Unknown date'
  const d = raw instanceof Date ? raw : new Date(raw)
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

/**
 * Render plain-text transcript content.
 * Speaker label: clinician name (or "Clinician") for role===user, "Interviewer" otherwise.
 */
function buildPlainText(story, messages) {
  const clinicianLabel = story.clinician_name || 'Clinician'
  const header = [
    'NarrateRx — Interview Transcript',
    `Clinician: ${story.clinician_name || 'Unknown'}`,
    `Topic:     ${story.topic || 'Untitled'}`,
    `Date:      ${fmtDate(story.created_at)}`,
    '',
    '─'.repeat(60),
    '',
  ].join('\n')

  const body = messages
    .map((m) => {
      const speaker = m.role === 'user' ? clinicianLabel : 'Interviewer'
      return `${speaker}: ${m.content || ''}`
    })
    .join('\n\n')

  return header + body + '\n'
}

/**
 * Render minimal HTML for print-to-PDF.
 * Opens in a new window and auto-triggers window.print() on load.
 */
function buildPrintHtml(story, messages) {
  const clinicianLabel = story.clinician_name || 'Clinician'

  const escape = (s) =>
    String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  const rows = messages
    .map((m) => {
      const speaker = m.role === 'user' ? clinicianLabel : 'Interviewer'
      const cls     = m.role === 'user' ? 'clinician' : 'interviewer'
      return `<div class="msg"><span class="label ${cls}">${escape(speaker)}:</span> ${escape(m.content || '')}</div>`
    })
    .join('\n')

  // The closing </script> tag is split to prevent the JS string from being
  // treated as an end-tag by any outer HTML parser.
  const scriptTag = '<script>window.onload=function(){window.print();}<' + '/script>'

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Transcript — ${escape(story.topic || 'Interview')}</title>
  <style>
    body { font-family: Georgia, serif; max-width: 720px; margin: 40px auto; color: #111; line-height: 1.6; }
    h1   { font-size: 1.25rem; font-weight: 700; margin-bottom: 4px; }
    .meta { font-size: 0.85rem; color: #555; margin-bottom: 24px; }
    hr   { border: none; border-top: 1px solid #ccc; margin: 24px 0; }
    .msg { margin-bottom: 14px; font-size: 0.95rem; }
    .label { font-weight: 600; }
    .label.clinician   { color: #1d4ed8; }
    .label.interviewer { color: #374151; }
    @media print { body { margin: 20px; } }
  </style>
</head>
<body>
  <h1>NarrateRx — Interview Transcript</h1>
  <div class="meta">
    <div>Clinician: ${escape(story.clinician_name || 'Unknown')}</div>
    <div>Topic: ${escape(story.topic || 'Untitled')}</div>
    <div>Date: ${fmtDate(story.created_at)}</div>
  </div>
  <hr />
  ${rows}
  ${scriptTag}
</body>
</html>`
}

/**
 * TranscriptExport — PDF and plain-text download buttons for a story transcript.
 *
 * Both exports are entirely client-side (no server round-trip).
 *   PDF  — opens a formatted page in a new tab and triggers window.print()
 *   TXT  — constructs a Blob and triggers a browser download
 *
 * Both buttons are disabled with a native title tooltip when no transcript
 * is available (interview in progress or no messages recorded yet).
 */
export default function TranscriptExport({ story }) {
  if (!story) return null

  const messages   = getMessages(story)
  const hasContent = messages.length > 0
  const slug       = (story.topic || 'transcript')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

  function handleTxt() {
    if (!hasContent) return
    const text = buildPlainText(story, messages)
    const url  = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
    const a    = document.createElement('a')
    a.href     = url
    a.download = `${slug}-transcript.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  function handlePdf() {
    if (!hasContent) return
    const html = buildPrintHtml(story, messages)
    const win  = window.open('', '_blank')
    if (!win) return
    win.document.write(html)
    win.document.close()
  }

  const disabledTitle = hasContent ? undefined : 'Transcript not yet available'

  return (
    <div className="flex items-center gap-2" title={disabledTitle}>
      <Button
        variant="outline"
        size="sm"
        onClick={handleTxt}
        disabled={!hasContent}
        className="gap-1.5 text-xs"
        title={disabledTitle}
      >
        <Download className="h-3.5 w-3.5" />
        Export .txt
      </Button>

      <Button
        variant="outline"
        size="sm"
        onClick={handlePdf}
        disabled={!hasContent}
        className="gap-1.5 text-xs"
        title={disabledTitle}
      >
        <FileText className="h-3.5 w-3.5" />
        Export PDF
      </Button>
    </div>
  )
}

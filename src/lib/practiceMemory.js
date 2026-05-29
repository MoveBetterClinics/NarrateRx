// Phase 5 Feature 2 — hot-context injection.
// Builds a "YOUR PRIOR THINKING" block from this clinician's own recent
// interviews and approved/published content. Injected into the interview
// system prompt so the model can reference what the clinician has already
// said and build on it (vs. starting cold each session).
//
// PR 1 shipped the bounded, no-embeddings version.
// PR 2 (this) prefers interviews.summary_text when available — a 3–5
// sentence distillation written on completion by interviewSummarizer.js.
// Summaries are ~300–500 chars each vs. ~1k for raw first-N turns, so we
// can lift the per-clinician interview cap from 3 to 6 without inflating
// prompt size. Falls back to raw turns for rows still awaiting summary
// (in-flight summarization, pre-backfill, or summarizer failure).
//
// A later PR replaces the recency-based pick with embedding-based RAG.

const MAX_PRIOR_INTERVIEWS = 6        // doubled from PR 1 — summaries are compact
const TURNS_PER_INTERVIEW = 4         // user turns kept when summary is missing
const MAX_CONTENT_PIECES = 3
const CONTENT_BODY_CHARS = 500        // truncation cap per prior content piece

function stripMarkdown(text) {
  if (!text) return ''
  return String(text)
    .replace(/```[\s\S]*?```/g, '')   // fenced code blocks
    .replace(/`([^`]+)`/g, '$1')      // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')   // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links → text
    .replace(/^#{1,6}\s+/gm, '')      // headings
    .replace(/\*\*([^*]+)\*\*/g, '$1') // bold
    .replace(/\*([^*]+)\*/g, '$1')    // italic
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function truncate(text, max) {
  if (!text) return ''
  const t = String(text).trim()
  if (t.length <= max) return t
  return `${t.slice(0, max).trimEnd()}…`
}

function hasSummary(iv) {
  return typeof iv?.summary_text === 'string' && iv.summary_text.trim().length > 0
}

function hasUsableMessages(iv) {
  return Array.isArray(iv?.messages) && iv.messages.some((m) => m?.role === 'user' && m?.content?.trim())
}

// Select this clinician's most recent completed interviews, excluding the
// one currently in progress. Keeps rows that have EITHER a generated summary
// OR raw messages we can fall back to.
export function pickPriorInterviews(allInterviews, currentInterviewId) {
  if (!Array.isArray(allInterviews) || allInterviews.length === 0) return []
  return allInterviews
    .filter((iv) => iv && iv.status === 'completed' && iv.id !== currentInterviewId)
    .filter((iv) => hasSummary(iv) || hasUsableMessages(iv))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, MAX_PRIOR_INTERVIEWS)
}

// Build the system-prompt block. Returns '' when there's no signal so the
// prompt stays quiet for first-session clinicians.
// Cap per related-snippet text length and the total RAG block size, so a
// noisy retrieval can't blow out the prompt.
const RAG_SNIPPET_CHARS = 500
const RAG_BLOCK_MAX_CHARS = 3000

export function buildOwnHistoryBlock({ staffName, priorInterviews = [], priorContent = [], relatedSnippets = [] }) {
  const hasInterviews = priorInterviews.length > 0
  const hasContent = priorContent.length > 0
  const hasRelated = Array.isArray(relatedSnippets) && relatedSnippets.length > 0
  if (!hasInterviews && !hasContent && !hasRelated) return ''

  const sections = []

  if (hasInterviews) {
    const formatted = priorInterviews.map((iv) => {
      const topic = iv.topic || 'an earlier session'
      // Prefer the generated summary (compact, on-prompt-purpose). Fall back
      // to raw user turns for rows where summarization hasn't run yet.
      if (hasSummary(iv)) {
        return `[YOUR PRIOR INTERVIEW] "${topic}"\n${iv.summary_text.trim()}`
      }
      const turns = (iv.messages || [])
        .filter((m) => m && m.role === 'user' && typeof m.content === 'string')
        .slice(0, TURNS_PER_INTERVIEW)
        .map((m) => `- ${truncate(m.content, 280)}`)
        .join('\n')
      return turns ? `[YOUR PRIOR INTERVIEW] "${topic}"\n${turns}` : ''
    }).filter(Boolean).join('\n\n')
    if (formatted) sections.push(formatted)
  }

  if (hasContent) {
    const formatted = priorContent.slice(0, MAX_CONTENT_PIECES).map((ci) => {
      const topic = ci.topic || 'untitled piece'
      const platform = ci.platform ? ` (${ci.platform})` : ''
      const body = truncate(stripMarkdown(ci.content), CONTENT_BODY_CHARS)
      return body ? `[YOUR APPROVED CONTENT] "${topic}"${platform}\n${body}` : ''
    }).filter(Boolean).join('\n\n')
    if (formatted) sections.push(formatted)
  }

  if (hasRelated) {
    let usedChars = 0
    const lines = []
    for (const s of relatedSnippets) {
      const text = truncate(stripMarkdown(s?.text || ''), RAG_SNIPPET_CHARS)
      if (!text) continue
      const label = s?.source_label || 'Earlier'
      const line = `[RELATED — ${label}]\n${text}`
      if (usedChars + line.length > RAG_BLOCK_MAX_CHARS) break
      lines.push(line)
      usedChars += line.length
    }
    if (lines.length > 0) sections.push(lines.join('\n\n'))
  }

  if (sections.length === 0) return ''

  const directive = `YOUR PRIOR THINKING — content ${staffName} has already produced. The RECENT block is always-on hot context; the RELATED block was retrieved from the full corpus by topic similarity to today's session. Reference it naturally when today's topic connects: "Last time you talked about X — has your thinking evolved?" or "You've written that Y matters — does this story tie back to that?" Don't recap; build on. Never quote these verbatim.`

  return `\n${directive}\n\n${sections.join('\n\n')}\n`
}

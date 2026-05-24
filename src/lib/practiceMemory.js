// Phase 5 Feature 2 — PR 1: hot-context injection.
// Builds a "YOUR PRIOR THINKING" block from this clinician's own recent
// interviews and approved/published content. Injected into the interview
// system prompt so the model can reference what the clinician has already
// said and build on it (vs. starting cold each session).
//
// Scope of this PR: the bounded, no-embeddings version. A later PR adds
// the pgvector RAG layer that retrieves by semantic relevance instead of
// raw recency.

const MAX_PRIOR_INTERVIEWS = 3
const TURNS_PER_INTERVIEW = 4         // user turns kept per prior interview
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

// Select up to 3 of this clinician's most recent completed interviews,
// excluding the one currently in progress. Returns the lightweight shape
// already available from fetchClinician(id).interviews[].
export function pickPriorInterviews(allInterviews, currentInterviewId) {
  if (!Array.isArray(allInterviews) || allInterviews.length === 0) return []
  return allInterviews
    .filter((iv) => iv && iv.status === 'completed' && iv.id !== currentInterviewId)
    .filter((iv) => Array.isArray(iv.messages) && iv.messages.length > 0)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, MAX_PRIOR_INTERVIEWS)
}

// Build the system-prompt block. Returns '' when there's no signal so the
// prompt stays quiet for first-session clinicians.
export function buildOwnHistoryBlock({ clinicianName, priorInterviews = [], priorContent = [] }) {
  const hasInterviews = priorInterviews.length > 0
  const hasContent = priorContent.length > 0
  if (!hasInterviews && !hasContent) return ''

  const sections = []

  if (hasInterviews) {
    const formatted = priorInterviews.map((iv) => {
      const topic = iv.topic || 'an earlier session'
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

  if (sections.length === 0) return ''

  const directive = `YOUR PRIOR THINKING — content ${clinicianName} has already produced. Reference it naturally when today's topic connects: "Last time you talked about X — has your thinking evolved?" or "You've written that Y matters — does this story tie back to that?" Don't recap; build on. Never quote these verbatim.`

  return `\n${directive}\n\n${sections.join('\n\n')}\n`
}

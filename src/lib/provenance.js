// Client-safe pure functions for parsing the <PROVENANCE> trailer that long-
// form generation prompts emit at the end of their stream output. Shared by
// the browser-side streaming consumer (InterviewSession.jsx) and the server-
// side validator (api/_lib/provenanceValidator.js).
//
// The trailer carries paragraph-level source attribution (transcript message
// index + character span) that becomes content_items.provenance.

export const PROVENANCE_TAG_OPEN  = '<PROVENANCE>'
export const PROVENANCE_TAG_CLOSE = '</PROVENANCE>'

/**
 * Split a streamed response body into the visible content and the trailing
 * provenance JSON. Designed to be called once, after the stream ends — the
 * streaming consumer should NOT attempt incremental parsing.
 *
 * Returns:
 *   { content: string, provenanceJson: string | null }
 * where `content` has the tag-bracketed region (and surrounding whitespace)
 * stripped.
 */
export function extractProvenanceBlock(rawStream) {
  if (typeof rawStream !== 'string' || !rawStream) {
    return { content: rawStream || '', provenanceJson: null }
  }
  const openIdx = rawStream.indexOf(PROVENANCE_TAG_OPEN)
  if (openIdx < 0) return { content: rawStream, provenanceJson: null }
  const afterOpen = openIdx + PROVENANCE_TAG_OPEN.length
  const closeIdx = rawStream.indexOf(PROVENANCE_TAG_CLOSE, afterOpen)
  if (closeIdx < 0) {
    // Opening tag with no close — model truncated. Drop trailer entirely;
    // server runs algorithmic fallback when called with empty trailer.
    return { content: rawStream.slice(0, openIdx).trimEnd(), provenanceJson: null }
  }
  const trailer = rawStream.slice(afterOpen, closeIdx).trim()
  const before  = rawStream.slice(0, openIdx).trimEnd()
  const after   = rawStream.slice(closeIdx + PROVENANCE_TAG_CLOSE.length).trim()
  // Stitch any trailing content back in case the model emits the trailer
  // mid-stream (rare). Paragraph-splitting on blank lines downstream still
  // produces the right block count.
  const content = after ? `${before}\n\n${after}` : before
  return { content, provenanceJson: trailer || null }
}

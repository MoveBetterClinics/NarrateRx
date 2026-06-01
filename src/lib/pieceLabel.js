// A short, human label for a content piece — "Sciatica (Zach)" — used in
// breadcrumbs, headers, and anywhere a piece needs to be named so it can be
// referenced in an error report or with a staff member. One source so the name
// is identical everywhere it appears.

function firstHeading(content) {
  if (typeof content !== 'string') return ''
  const m = content.match(/^#{1,6}\s+(.+)$/m)
  return m ? m[1].trim() : ''
}

// The piece's title alone (topic, else first markdown heading, else a fallback).
export function pieceTitle(piece) {
  return piece?.topic || firstHeading(piece?.content) || 'Untitled draft'
}

// Title with the staff member in parens when known: "Sciatica (Zach)".
export function pieceLabel(piece) {
  const title = pieceTitle(piece)
  return piece?.staff_name ? `${title} (${piece.staff_name})` : title
}

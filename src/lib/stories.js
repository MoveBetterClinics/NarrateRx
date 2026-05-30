// Story builder — the load-bearing piece of the IA refactor.
//
// A "story" anchors on an `interviews` row with `content_items` rolled
// up. Three Stories views (Cards / Pipeline / Calendar) and the Story
// Detail page all consume this same shape. Get this wrong here and
// every consumer has to rewrite. Get it right and the consumers stay
// thin.
//
// This file is pure — no fetching, no React, no clock. The hooks that
// drive it (useStories / useStory) land in PR 2 alongside queryKeys.
//
// See .claude/plans/2026-05-13-ia-refactor.md §3 for the canonical
// data-shape contract.

/**
 * Derive the high-level pipeline stage of a story.
 *
 * Rules (first match wins):
 *   1. interview.status !== 'completed'                          → 'capture'
 *   2. pieces is empty                                           → 'drafting'
 *   3. any piece published AND none scheduled/in_review          → 'published'
 *   4. any piece scheduled                                       → 'scheduled'
 *   5. any piece in_review                                       → 'review'
 *   6. otherwise                                                 → 'drafting'
 *
 * @param {{status?: string}} interview
 * @param {Array<{status?: string}>} pieces
 * @returns {'capture'|'drafting'|'review'|'scheduled'|'published'}
 */
export function deriveStoryStage(interview, pieces) {
  if (!interview || interview.status !== 'completed') return 'capture'
  const list = Array.isArray(pieces) ? pieces : []
  if (list.length === 0) return 'drafting'

  let hasPublished = false
  let hasScheduled = false
  let hasInReview = false
  for (const p of list) {
    if (p?.status === 'published') hasPublished = true
    else if (p?.status === 'scheduled') hasScheduled = true
    else if (p?.status === 'in_review') hasInReview = true
  }

  if (hasPublished && !hasScheduled && !hasInReview) return 'published'
  if (hasScheduled) return 'scheduled'
  if (hasInReview) return 'review'
  return 'drafting'
}

/**
 * Summarize a content_items row down to the fields the Stories views
 * actually care about. Keeps the on-the-wire object lean and prevents
 * accidental coupling to fields that change shape (e.g. `content` JSON,
 * `media_urls`).
 */
function summarizePiece(row) {
  return {
    id: row.id,
    platform: row.platform,
    status: row.status,
    scheduled_at: row.scheduled_at ?? null,
    published_at: row.published_at ?? null,
    updated_at: row.updated_at,
    provenance: row.provenance ?? null,
    voice_fidelity_score: row.voice_fidelity_score ?? null,
    voice_audit: row.voice_audit ?? null,
  }
}

const PIECE_STATUS_BUCKETS = ['draft', 'in_review', 'approved', 'scheduled', 'published']

function emptyStatusBuckets() {
  return { draft: 0, in_review: 0, approved: 0, scheduled: 0, published: 0 }
}

function maxTimestamp(values) {
  let max = null
  for (const v of values) {
    if (!v) continue
    if (max === null || v > max) max = v
  }
  return max
}

/**
 * Join staff-with-nested-interviews and content_items into a flat
 * list of Story objects.
 *
 * @param {Array} staff  — output of /api/db/staff (with `interviews[]`)
 * @param {Array} contentItems — output of /api/db/content (workspace-scoped)
 * @returns {Array<Story>}
 *
 * Defense-in-depth: any content_item whose workspace_id doesn't match
 * its parent interview's workspace_id is dropped and logged. Both
 * upstream endpoints already enforce workspace_id filtering — this is a
 * belt-and-suspenders guard, not the primary defense.
 */
export function buildStories(staff, contentItems) {
  const staffList = Array.isArray(staff) ? staff : []
  const itemList = Array.isArray(contentItems) ? contentItems : []

  // Index content_items by interview_id.
  const piecesByInterview = new Map()
  for (const item of itemList) {
    if (!item || !item.interview_id) continue
    const arr = piecesByInterview.get(item.interview_id)
    if (arr) arr.push(item)
    else piecesByInterview.set(item.interview_id, [item])
  }

  const stories = []
  for (const staffMember of staffList) {
    if (!staffMember) continue
    const interviews = Array.isArray(staffMember.interviews) ? staffMember.interviews : []
    for (const interview of interviews) {
      if (!interview || !interview.id) continue

      const allCandidates = piecesByInterview.get(interview.id) || []
      const matched = []
      for (const piece of allCandidates) {
        // Defense in depth: drop cross-workspace rows. Only applies
        // when both rows actually carry workspace_id (some callers
        // omit it from the select clause — we don't synthesize a
        // mismatch in that case).
        if (
          interview.workspace_id &&
          piece.workspace_id &&
          interview.workspace_id !== piece.workspace_id
        ) {

          console.warn(
            '[buildStories] dropping content_item with mismatched workspace_id',
            { item_id: piece.id, interview_id: interview.id },
          )
          continue
        }
        matched.push(piece)
      }

      const pieces = matched.map(summarizePiece)
      const piecesByStatus = emptyStatusBuckets()
      for (const p of pieces) {
        if (PIECE_STATUS_BUCKETS.includes(p.status)) {
          piecesByStatus[p.status] += 1
        }
      }

      const scheduledTimes = pieces
        .map((p) => p.scheduled_at)
        .filter((t) => !!t)
        .sort()
      const nextScheduledAt = scheduledTimes.length > 0 ? scheduledTimes[0] : null

      const pieceUpdates = pieces.map((p) => p.updated_at).filter(Boolean)
      const lastActivityAt = maxTimestamp([interview.updated_at, ...pieceUpdates])

      // Best verbatim quote for Themes contrasting-views display.
      // pull_quote_candidates is an array of { text, score } objects stored
      // by /api/interviews/pull-quotes when the interview completes.
      const pqc = Array.isArray(interview.pull_quote_candidates) ? interview.pull_quote_candidates : []
      const verbatim_snippet = pqc.length > 0
        ? (pqc[0].text || pqc[0].quote || null)
        : null

      stories.push({
        id: interview.id,
        workspace_id: interview.workspace_id || staffMember.workspace_id || null,
        staff_id: staffMember.id,
        staff_name: staffMember.name,
        topic: interview.topic,
        status: interview.status,
        capture_mode: interview.capture_mode || 'interview',
        owner_id: interview.owner_id ?? null,
        owner_email: interview.owner_email ?? null,
        location_id: interview.location_id ?? null,
        prototype_id: interview.prototype_id ?? null,
        campaign_id: interview.campaign_id ?? null,
        campaign_name: interview.campaign?.name ?? null,
        created_at: interview.created_at,
        updated_at: interview.updated_at,
        has_outputs: !!interview.outputs && Object.keys(interview.outputs).length > 0,
        verbatim_snippet,
        pieces,
        pieces_count: pieces.length,
        pieces_by_status: piecesByStatus,
        story_stage: deriveStoryStage(interview, pieces),
        next_scheduled_at: nextScheduledAt,
        last_activity_at: lastActivityAt || interview.updated_at || interview.created_at,
      })
    }
  }

  return stories
}

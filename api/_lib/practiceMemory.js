// Server-side practice-memory fetcher. Wraps Supabase REST calls so any
// generation handler (regenerate, content-plan/draft, split-into-series,
// etc.) can inject the same YOUR PRIOR THINKING block the interview path
// already gets via the client-side helper in src/lib/practiceMemory.js.
//
// The builder itself (pickPriorInterviews, buildOwnHistoryBlock) lives in
// src/lib/practiceMemory.js so client and server produce byte-identical
// blocks — a divergence would mean prompts shift subtly depending on which
// path triggered generation.

import { buildOwnHistoryBlock, pickPriorInterviews } from '../../src/lib/practiceMemory.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey:        SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}

// Mirror src/lib/api.js → fetchClinician shape. Pulls the embedded
// interview list with summary_text so the builder can prefer summaries
// over raw turns.
const INTERVIEW_FIELDS = 'id,topic,status,created_at,messages,summary_text,summary_generated_at'

async function fetchClinicianInterviews(workspaceId, clinicianId) {
  const qs = `clinicians?id=eq.${clinicianId}&workspace_id=eq.${workspaceId}&select=name,interviews(${INTERVIEW_FIELDS})`
  const r = await sb(qs)
  if (!r.ok) {
    console.error(`[practiceMemory] clinician fetch ${r.status} ws=${workspaceId} clinician=${clinicianId}`)
    return null
  }
  const rows = await r.json()
  return rows[0] || null
}

async function fetchRecentApprovedContent(workspaceId, clinicianId, limit = 3) {
  const qs = `content_items?workspace_id=eq.${workspaceId}&clinician_id=eq.${clinicianId}&status=in.(approved,published)&archived_at=is.null&select=id,topic,platform,content&order=created_at.desc&limit=${limit}`
  const r = await sb(qs)
  if (!r.ok) {
    console.error(`[practiceMemory] content fetch ${r.status} ws=${workspaceId} clinician=${clinicianId}`)
    return []
  }
  return await r.json()
}

/**
 * Resolve the YOUR PRIOR THINKING block for a generation prompt.
 * Never throws — always returns a string ('' on failure or no signal).
 *
 * @param {object} args
 * @param {string} args.workspaceId
 * @param {string} args.clinicianId
 * @param {string=} args.excludeInterviewId   — current interview, to exclude from history
 */
export async function resolveOwnHistoryBlock({ workspaceId, clinicianId, excludeInterviewId }) {
  try {
    if (!workspaceId || !clinicianId) return ''
    const [clinicianRow, recentContent] = await Promise.all([
      fetchClinicianInterviews(workspaceId, clinicianId),
      fetchRecentApprovedContent(workspaceId, clinicianId),
    ])
    if (!clinicianRow) return ''
    const priorInterviews = pickPriorInterviews(clinicianRow.interviews || [], excludeInterviewId)
    return buildOwnHistoryBlock({
      clinicianName: clinicianRow.name || 'this clinician',
      priorInterviews,
      priorContent: recentContent,
    })
  } catch (e) {
    console.error(`[practiceMemory] resolveOwnHistoryBlock threw: ${e?.message}`)
    return ''
  }
}

// GET /api/cron/sync-author-corpus
//
// Weekly cron that mirrors Q's completed interviews from the clinical workspace
// (movebetter-people) into the book workspace (qbook) as interview_transcript_full
// chunks — so the Author Mode /write corpus stays current without Q having to
// do anything. Only Q's own interviews (matched by user_id) cross over; other
// clinicians' interviews in movebetter-people never leave that workspace.
//
// Logic:
//   1. Resolve source workspace (movebetter-people) + Q's clinician there
//   2. Resolve target workspace (qbook) + Q's clinician there (same user_id)
//   3. Find all completed interviews in source with message content
//   4. Skip any already indexed in target's practice_memory_chunks
//   5. Index the new ones as interview_transcript_full under target workspace
//
// Exits 200 { synced: N, skipped: N } — never throws so Vercel cron doesn't
// mark the deployment unhealthy on a transient failure.
//
// Auth: Bearer CRON_SECRET (standard pattern — see api/cron/backup-db.js)
// Schedule: see vercel.json ("0 6 * * 0" = 06:00 UTC every Sunday)

export const config = { runtime: 'nodejs', maxDuration: 300 }

const SOURCE_SLUG = 'movebetter-people'
const TARGET_SLUG = 'qbook'

import { indexInterviewTranscriptFull } from '../_lib/practiceMemoryRag.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey:         SUPABASE_KEY,
      Authorization:  `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}

export default async function handler(req, res) {
  // Auth
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return res.status(503).json({ error: 'CRON_SECRET not configured' })
  const auth = req.headers?.authorization || req.headers?.Authorization
  if (auth !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const result = await syncAuthorCorpus({ log: true })
    return res.status(200).json(result)
  } catch (e) {
    console.error('[cron/sync-author-corpus] threw:', e?.message)
    return res.status(200).json({ error: e?.message, synced: 0, skipped: 0 })
  }
}

export async function syncAuthorCorpus({ log = false, dryRun = false } = {}) {
  const emit = log ? console.info : () => {}

  // ── Resolve workspaces ─────────────────────────────────────────────────
  const wsRes = await sb(`workspaces?slug=in.(${SOURCE_SLUG},${TARGET_SLUG})&select=id,slug`)
  if (!wsRes.ok) throw new Error(`workspaces fetch ${wsRes.status}`)
  const workspaces = await wsRes.json()
  const srcWs  = workspaces.find((w) => w.slug === SOURCE_SLUG)
  const tgtWs  = workspaces.find((w) => w.slug === TARGET_SLUG)

  if (!srcWs) throw new Error(`Source workspace not found: ${SOURCE_SLUG}`)
  if (!tgtWs) {
    emit(`[sync-author-corpus] Target workspace "${TARGET_SLUG}" does not exist yet — skipping`)
    return { synced: 0, skipped: 0, note: 'qbook workspace not yet created' }
  }

  // ── Resolve Q's clinician in each workspace (matched by user_id) ───────
  const srcClRes = await sb(
    `staff?workspace_id=eq.${srcWs.id}&user_id=not.is.null&select=id,name,user_id&order=created_at.asc&limit=1`
  )
  if (!srcClRes.ok) throw new Error(`source clinician fetch ${srcClRes.status}`)
  const [srcStaff] = await srcClRes.json()
  if (!srcStaff) throw new Error(`No Self-clinician in ${SOURCE_SLUG}`)

  // Find matching clinician in target by the same user_id
  const tgtClRes = await sb(
    `staff?workspace_id=eq.${tgtWs.id}&user_id=eq.${srcStaff.user_id}&select=id&limit=1`
  )
  if (!tgtClRes.ok) throw new Error(`target clinician fetch ${tgtClRes.status}`)
  const [tgtStaff] = await tgtClRes.json()
  if (!tgtStaff) {
    emit(`[sync-author-corpus] Q's clinician not found in "${TARGET_SLUG}" — complete onboarding first`)
    return { synced: 0, skipped: 0, note: 'qbook clinician not found — finish workspace setup' }
  }

  emit(`[sync-author-corpus] ${srcStaff.name}: ${srcWs.slug} (${srcStaff.id}) → ${tgtWs.slug} (${tgtStaff.id})`)

  // ── Fetch completed interviews in source ───────────────────────────────
  const ivRes = await sb(
    `interviews?workspace_id=eq.${srcWs.id}&staff_id=eq.${srcStaff.id}` +
    `&status=eq.completed&select=id,staff_id,topic,messages,cleaned_messages,created_at` +
    `&order=created_at.desc`
  )
  if (!ivRes.ok) throw new Error(`interviews fetch ${ivRes.status}`)
  const interviews = await ivRes.json()

  const withContent = interviews.filter((iv) => {
    const cleaned = Array.isArray(iv.cleaned_messages) ? iv.cleaned_messages : []
    const raw     = Array.isArray(iv.messages)         ? iv.messages         : []
    return cleaned.length > 0 || raw.length > 0
  })
  emit(`[sync-author-corpus] source interviews with content: ${withContent.length}`)
  if (withContent.length === 0) return { synced: 0, skipped: 0 }

  // ── Find which are already indexed in target ───────────────────────────
  const sourceIds = withContent.map((iv) => iv.id)
  // PostgREST IN filter: source_id=in.(id1,id2,...)
  const alreadyRes = await sb(
    `practice_memory_chunks?workspace_id=eq.${tgtWs.id}` +
    `&source_type=eq.interview_transcript_full` +
    `&source_id=in.(${sourceIds.join(',')})` +
    `&select=source_id`
  )
  const alreadyRows   = alreadyRes.ok ? await alreadyRes.json() : []
  const alreadyIndexed = new Set(alreadyRows.map((r) => r.source_id))

  const toIndex = withContent.filter((iv) => !alreadyIndexed.has(iv.id))
  emit(`[sync-author-corpus] new to index: ${toIndex.length}, already indexed: ${alreadyIndexed.size}`)

  if (toIndex.length === 0) return { synced: 0, skipped: withContent.length }
  if (dryRun) return { synced: 0, skipped: withContent.length, dryRun: true, wouldIndex: toIndex.length }

  // ── Index new interviews into target workspace ─────────────────────────
  let synced = 0
  for (const iv of toIndex) {
    await indexInterviewTranscriptFull({
      workspaceId:     tgtWs.id,          // ← target workspace, not source
      staffId:     tgtStaff.id,   // ← target clinician record
      interviewId:     iv.id,             // source_id stays the original interview id
      messages:        iv.messages,
      cleanedMessages: iv.cleaned_messages,
      topic:           iv.topic,
      createdAt:       iv.created_at,
    })
    synced++
    emit(`[sync-author-corpus] indexed ${synced}/${toIndex.length}: ${iv.topic || iv.id}`)
  }

  emit(`[sync-author-corpus] done — synced=${synced} skipped=${alreadyIndexed.size}`)
  return { synced, skipped: alreadyIndexed.size }
}

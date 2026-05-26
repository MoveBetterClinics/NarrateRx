// GET /api/cron/regenerate-stale-books
//
// Daily cron that auto-regenerates any workspace_books rows where
// stale_at IS NOT NULL — i.e. workspaces whose source material has changed
// since the last regen. The stale flag is set fire-and-forget from ingest
// paths (api/_lib/bookStale.js); this cron is the consumer.
//
// Time budget: Vercel Node functions cap at 300s. A single Opus synthesis
// can take 60–180s on a large workspace, so we cap processing at the first
// N stale workspaces per run and stop early if we approach the timeout.
// Anything skipped this run is still stale and will be retried the next
// night.
//
// Auth: Bearer CRON_SECRET (matches the pattern in backup-db.js / refresh-
// engagement.js / sync-author-corpus.js).
// Schedule: see vercel.json — "0 7 * * *" = 07:00 UTC daily.
//
// Never throws to the caller — partial failures are returned in the JSON
// summary so Vercel cron doesn't mark the deployment unhealthy on a transient
// model error.

export const config = { runtime: 'nodejs', maxDuration: 300 }

import { synthesizeBook } from '../_lib/bookSynthesis.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// Stop kicking off new workspaces after this many elapsed ms — leaves
// headroom to write results back and return the response within 300s.
const SOFT_DEADLINE_MS = 270_000

// Cap workspaces per run regardless of time budget. Prevents one cron from
// hogging the whole window and starving everything else; the next run picks
// up wherever this one left off.
const MAX_PER_RUN = 4

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey:        SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer:        'return=representation',
      ...init.headers,
    },
  })
}

async function logSbErr(prefix, r) {
  const body = await r.text().catch(() => '')
  console.error(`[cron/regenerate-stale-books] ${prefix} — supabase ${r.status}: ${body.slice(0, 300)}`)
}

async function upsertBookRow(workspaceId, patch) {
  const r = await sb(`workspace_books?on_conflict=workspace_id`, {
    method: 'POST',
    headers: { Prefer: 'return=minimal,resolution=merge-duplicates' },
    body: JSON.stringify({ workspace_id: workspaceId, ...patch }),
  })
  if (!r.ok) await logSbErr(`upsertBookRow ws=${workspaceId}`, r)
  return r.ok
}

async function regenOne(workspace, started) {
  const wsId = workspace.id
  try {
    await upsertBookRow(wsId, { regen_status: 'regenerating', regen_error: null })

    const result = await synthesizeBook({ workspaceId: wsId, workspace })

    const ok = await upsertBookRow(wsId, {
      manuscript_md:  result.manuscriptMd || null,
      chapters:       result.chapters || [],
      source_counts:  result.sourceCounts || {},
      last_regen_at:  new Date().toISOString(),
      stale_at:       null,
      regen_status:   'idle',
      regen_error:    null,
    })
    if (!ok) {
      await upsertBookRow(wsId, {
        regen_status: 'error',
        regen_error:  'Failed to write manuscript',
      })
      return { ok: false, error: 'write failed' }
    }

    const elapsed = Date.now() - started
    console.info(`[cron/regenerate-stale-books] ws=${workspace.slug} ok — ${result.chapters.length} chapters in ${(elapsed / 1000).toFixed(1)}s`)
    return { ok: true, chapters: result.chapters.length }
  } catch (e) {
    const msg = e?.message || 'Unknown error'
    console.error(`[cron/regenerate-stale-books] ws=${workspace.slug} failed: ${msg}`)
    await upsertBookRow(wsId, {
      regen_status: 'error',
      regen_error:  String(msg).slice(0, 1000),
    })
    return { ok: false, error: msg }
  }
}

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return res.status(503).json({ error: 'CRON_SECRET not configured' })
  const auth = req.headers?.authorization || req.headers?.Authorization
  if (auth !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const runStarted = Date.now()
  const summary = { processed: 0, succeeded: 0, failed: 0, skipped: 0, workspaces: [] }

  try {
    // Pick up the oldest stale rows first so a never-visited workspace doesn't
    // get starved by a busy one.
    const r = await sb(
      `workspace_books?stale_at=not.is.null&regen_status=neq.regenerating` +
      `&select=workspace_id,stale_at&order=stale_at.asc&limit=${MAX_PER_RUN}`
    )
    if (!r.ok) {
      await logSbErr('list stale books', r)
      return res.status(200).json({ ...summary, error: 'list failed' })
    }
    const stale = await r.json()
    if (stale.length === 0) {
      return res.status(200).json({ ...summary, note: 'no stale workspaces' })
    }

    // Fetch the full workspace rows in one shot (synthesizeBook needs the
    // brand_voice, display_name, etc).
    const ids = stale.map((s) => s.workspace_id)
    const wsRes = await sb(`workspaces?id=in.(${ids.join(',')})&select=*`)
    if (!wsRes.ok) {
      await logSbErr('list workspaces', wsRes)
      return res.status(200).json({ ...summary, error: 'workspace fetch failed' })
    }
    const workspaceRows = await wsRes.json()
    const wsById = new Map(workspaceRows.map((w) => [w.id, w]))

    // Process in the same order the stale list returned (oldest stale first).
    for (const s of stale) {
      const elapsed = Date.now() - runStarted
      if (elapsed > SOFT_DEADLINE_MS) {
        summary.skipped++
        continue
      }
      const workspace = wsById.get(s.workspace_id)
      if (!workspace) {
        summary.skipped++
        continue
      }
      summary.processed++
      const result = await regenOne(workspace, runStarted)
      summary.workspaces.push({
        slug:  workspace.slug,
        ok:    result.ok,
        error: result.error || null,
      })
      if (result.ok) summary.succeeded++
      else summary.failed++
    }

    return res.status(200).json(summary)
  } catch (e) {
    console.error('[cron/regenerate-stale-books] threw:', e?.message)
    return res.status(200).json({ ...summary, error: e?.message })
  }
}

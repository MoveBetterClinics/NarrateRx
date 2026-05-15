// Public health endpoint — no auth required.
// Returns 200 when healthy, 503 when a critical dependency is down.
//
// Used by external uptime monitors (UptimeRobot, Better Uptime, etc.) to
// detect outages. Monitors should check HTTP status only — 200 = up, non-200
// = down. The JSON body gives root-cause detail for post-incident review.
//
// Checks performed:
//   1. Supabase REST reachability — a lightweight SELECT on workspaces (limit 0)
//      verifies that the DB connection pool is live without fetching any rows.
//
// NOT checked here (intentionally):
//   - Clerk — it's Anthropic-managed; if it's down the whole auth layer fails
//     visibly and no special health probe helps.
//   - External publish targets (Buffer, WP, Astro) — these are per-tenant and
//     their availability doesn't gate core app functionality.
//
// Runtime: Node (req, res) — follows the convention for all /api/*.js handlers.
// Do NOT switch to Edge: SUPABASE_SERVICE_KEY is a Node-env secret and the
// Edge bundler would need to inline it, plus the whole-graph Edge bundler
// chokes on transitive Node imports that creep in from shared libs.

export const config = { runtime: 'nodejs' }

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

/** Maximum time (ms) to wait for the DB probe before calling it unhealthy. */
const DB_TIMEOUT_MS = 5_000

export default async function handler(req, res) {
  // Allow GET and HEAD. Uptime monitors (UptimeRobot, Better Uptime, etc.)
  // commonly probe with HEAD rather than GET — treat them identically except
  // HEAD responses must not include a body (the status code is what matters).
  const isHead = req.method === 'HEAD'
  if (req.method !== 'GET' && !isHead) {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' })
  }

  const start = Date.now()

  // ── Supabase probe ─────────────────────────────────────────────────────────
  let dbOk    = false
  let dbError = null

  try {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      throw new Error('SUPABASE_URL or SUPABASE_SERVICE_KEY not configured')
    }

    // limit=0 returns no rows but still exercises the connection pool and the
    // PostgREST query path. The response will be an empty array [] with 200.
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/workspaces?select=id&limit=0`,
      {
        headers: {
          apikey:        SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
        signal: AbortSignal.timeout(DB_TIMEOUT_MS),
      }
    )

    if (r.ok) {
      dbOk = true
    } else {
      dbError = `HTTP ${r.status}`
    }
  } catch (e) {
    dbError = e.name === 'TimeoutError'
      ? `timed out after ${DB_TIMEOUT_MS}ms`
      : (e.message || String(e))
  }

  const ms = Date.now() - start

  if (!dbOk) {
    if (isHead) return res.status(503).end()
    return res.status(503).json({
      ok:    false,
      db:    false,
      error: dbError,
      ms,
      ts:    new Date().toISOString(),
    })
  }

  if (isHead) return res.status(200).end()
  return res.status(200).json({
    ok: true,
    db: true,
    ms,
    ts: new Date().toISOString(),
  })
}

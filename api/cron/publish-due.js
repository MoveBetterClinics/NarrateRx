// Scheduled-post dispatcher for platforms without native scheduling (today: GBP).
// Vercel cron hits this on a schedule (see vercel.json). It atomically claims
// due rows with status='scheduled' → 'publishing' (a filtered PostgREST PATCH
// is the lock — two concurrent invocations can't double-claim), dispatches via
// the GBP helpers, then transitions to 'published' or 'failed'.
//
// Per-workspace credential resolution: each claimed row carries workspace_id
// (multitenant DB) or just brand (legacy per-brand DB). For each row, we
// resolve GBP creds via getCredential(row.workspace_id, 'gbp') — the env-var
// fallback inside getCredential covers legacy deployments.
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_KEY plus either
// WORKSPACE_CREDENTIALS_KEY + a workspace_credentials row, or the legacy
// GBP_* / GOOGLE_SERVICE_ACCOUNT_* env vars.
// Optional: CRON_SECRET (when set, request must carry Authorization: Bearer <secret>).

import { getGoogleToken, postToLocation, buildPost } from '../publish/gbp.js'
import { getCredential } from '../_lib/getCredential.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...init.headers,
    },
  })
}

async function markRow(id, patch) {
  return sb(`content_items?id=eq.${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = req.headers?.authorization || req.headers?.Authorization
    if (auth !== `Bearer ${cronSecret}`) return res.status(401).json({ error: 'Unauthorized' })
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(503).json({ error: 'Supabase not configured' })

  const nowIso = new Date().toISOString()

  // Atomic claim: scheduled → publishing for all due GBP rows in one PATCH.
  // PostgREST returns the rows that actually transitioned, so concurrent
  // invocations can't double-claim — only one PATCH wins each row.
  const claimRes = await sb(
    `content_items?platform=eq.gbp&status=eq.scheduled&scheduled_at=lte.${encodeURIComponent(nowIso)}`,
    { method: 'PATCH', body: JSON.stringify({ status: 'publishing' }) }
  )
  if (!claimRes.ok) return res.status(500).json({ error: `Claim failed: ${claimRes.status}` })
  const claimed = await claimRes.json()
  if (!claimed.length) return res.status(200).json({ claimed: 0, dispatched: [] })

  // Resolve creds + token per workspace_id. Cache so a batch of rows for the
  // same workspace doesn't re-fetch creds or re-mint a JWT for each row.
  const tokenCache = new Map() // workspaceId|null → { token, accountId, allLocationIds } | { error }
  async function resolveForRow(row) {
    const key = row.workspace_id || '__legacy__'
    if (tokenCache.has(key)) return tokenCache.get(key)
    const cred = await getCredential(row.workspace_id, 'gbp')
    const accountId = cred?.config?.account_id
    const allLocationIds = Array.isArray(cred?.config?.location_ids) ? cred.config.location_ids : []
    if (!cred?.secret || !accountId || !allLocationIds.length) {
      const v = { error: 'GBP not configured for this workspace' }
      tokenCache.set(key, v)
      return v
    }
    try {
      const token = await getGoogleToken(cred)
      const v = { token, accountId, allLocationIds }
      tokenCache.set(key, v)
      return v
    } catch (e) {
      const v = { error: `Google auth failed: ${e.message}` }
      tokenCache.set(key, v)
      return v
    }
  }

  const dispatched = []
  for (const row of claimed) {
    const resolved = await resolveForRow(row)
    if (resolved.error) {
      // Release back to scheduled so another tick (after the user adds creds)
      // picks it up — vs leaving it stuck in 'publishing'.
      await markRow(row.id, { status: 'scheduled', notes: `Cron: ${resolved.error}` })
      dispatched.push({ id: row.id, ok: false, error: resolved.error })
      continue
    }
    const { token, accountId, allLocationIds } = resolved

    const requested = Array.isArray(row.target_locations) && row.target_locations.length
      ? row.target_locations
      : allLocationIds
    const targets = requested.filter((id) => allLocationIds.includes(id))

    if (!targets.length) {
      await markRow(row.id, { status: 'failed', notes: 'No valid configured locations for this row' })
      dispatched.push({ id: row.id, ok: false, error: 'no_valid_locations' })
      continue
    }

    const post = buildPost(row.content, row.media_urls)
    const results = await Promise.allSettled(
      targets.map((loc) => postToLocation(token, accountId, loc, post))
    )
    const succeeded = results.filter((r) => r.status === 'fulfilled').map((r) => r.value)
    const failed    = results
      .map((r, i) => ({ r, locationId: targets[i] }))
      .filter(({ r }) => r.status === 'rejected')
      .map(({ r, locationId }) => ({ locationId, error: r.reason?.message || 'unknown' }))

    if (succeeded.length) {
      await markRow(row.id, {
        status: 'published',
        published_at: new Date().toISOString(),
        platform_post_id: succeeded.map((s) => s.name).join(','),
        ...(failed.length ? { notes: `Partial: ${failed.map((f) => `${f.locationId}: ${f.error}`).join('; ')}` } : {}),
      })
      dispatched.push({ id: row.id, ok: true, posted: succeeded.length, failed: failed.length })
    } else {
      await markRow(row.id, {
        status: 'failed',
        notes: failed.map((f) => `${f.locationId}: ${f.error}`).join('; '),
      })
      dispatched.push({ id: row.id, ok: false, error: 'all_locations_failed' })
    }
  }

  return res.status(200).json({ claimed: claimed.length, dispatched })
}

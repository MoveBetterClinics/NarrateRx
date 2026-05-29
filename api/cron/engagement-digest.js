// POST /api/cron/engagement-digest
//
// Phase 4 PR 5 — Weekly producer digest cron.
//
// Vercel cron hits this every Monday morning (vercel.json: 0 8 * * 1 UTC).
// For each workspace with engagement_digest_enabled=true:
//   1. Skip if engagement_digest_last_sent_at is within the last 6 days
//      (defense against schedule drift double-firing).
//   2. Collect last 7 days of: published content_items, story_packages stats,
//      and current triage queue.
//   3. Resolve recipients — explicit engagement_digest_recipients list if
//      non-empty, otherwise all clinicians with permission_tier='producer'.
//   4. Pull Clerk user emails for each recipient.
//   5. Send via Resend.
//   6. Stamp engagement_digest_last_sent_at on success.
//
// Auth: Bearer CRON_SECRET (same pattern as the other cron handlers).
//
// Failure handling: per-workspace try/catch so one tenant's failure doesn't
// block the rest of the run. Result summary returned for log inspection.

export const config = { runtime: 'nodejs', maxDuration: 300 }

import { withSentry } from '../_lib/sentry.js'
import { createClerkClient } from '@clerk/backend'
import { buildDigest } from '../_lib/engagementDigestEmail.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const RESEND_API_KEY = process.env.RESEND_API_KEY
const ADMIN_NOTIFY_FROM = process.env.ADMIN_NOTIFY_FROM || 'NarrateRx <noreply@narraterx.ai>'
const CLERK_SECRET = process.env.CLERK_SECRET_KEY

const RESEND_ENDPOINT = 'https://api.resend.com/emails'
const MIN_RESEND_INTERVAL_DAYS = 6  // skip if last send was within this window

let _clerk = null
function clerk() {
  if (!_clerk) _clerk = createClerkClient({ secretKey: CLERK_SECRET })
  return _clerk
}

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}

function daysSince(iso) {
  if (!iso) return Infinity
  return (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24)
}

function isoDaysAgo(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString()
}

async function handler(req, res) {
  // ─── Auth ───────────────────────────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return res.status(503).json({ error: 'CRON_SECRET not configured' })
  const auth = req.headers?.authorization || req.headers?.Authorization
  if (auth !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  if (!RESEND_API_KEY) {
    return res.status(503).json({ error: 'RESEND_API_KEY not configured' })
  }
  if (!CLERK_SECRET) {
    return res.status(503).json({ error: 'CLERK_SECRET_KEY not configured' })
  }

  // ─── Fetch eligible workspaces ──────────────────────────────────────────
  const wsRes = await sb(
    'workspaces?engagement_digest_enabled=eq.true' +
    '&select=id,slug,display_name,name,primary_logo_url,colors,clerk_org_id,' +
    'engagement_digest_recipients,engagement_digest_last_sent_at'
  )
  if (!wsRes.ok) {
    const text = await wsRes.text().catch(() => '')
    console.error('[engagement-digest] workspaces fetch failed:', wsRes.status, text)
    return res.status(500).json({ error: 'db_error' })
  }
  const workspaces = await wsRes.json()

  const weekStart = isoDaysAgo(7)
  const weekEnd   = new Date().toISOString()
  const results = []

  for (const ws of workspaces) {
    try {
      // Skip if we sent recently (covers schedule drift / cron rerun).
      const since = daysSince(ws.engagement_digest_last_sent_at)
      if (since < MIN_RESEND_INTERVAL_DAYS) {
        results.push({ workspace: ws.slug, skipped: 'recent_send', days_since: since.toFixed(1) })
        continue
      }

      // ── Collect data ─────────────────────────────────────────────────────
      // Three concerns, three queries:
      //   • published   — content_items from last 7 days, for the "what
      //                   shipped" section
      //   • weekPackages — story_packages from last 7 days, for slate STATS
      //                    only (generated/approved/skipped/failed counts)
      //   • triagePool  — story_packages from last 30 days that may be in
      //                   triage state (failed any age, complete+low-conf,
      //                   complete+stale). 30-day window is wider than 7 so
      //                   we catch >7-day-old stale packages the previous
      //                   query would have missed. Anything older than 30
      //                   days is assumed effectively abandoned.
      const triageWindow = isoDaysAgo(30)
      const [publishedRes, weekPackageRes, triagePoolRes, queuedRes] = await Promise.all([
        sb(
          `content_items?workspace_id=eq.${ws.id}` +
          `&published_at=gte.${encodeURIComponent(weekStart)}` +
          `&select=id,topic,platform,staff_name,published_at` +
          `&order=published_at.desc&limit=20`
        ),
        sb(
          `story_packages?workspace_id=eq.${ws.id}` +
          `&created_at=gte.${encodeURIComponent(weekStart)}` +
          `&select=id,status,similarity,created_at`
        ),
        sb(
          `story_packages?workspace_id=eq.${ws.id}` +
          `&created_at=gte.${encodeURIComponent(triageWindow)}` +
          `&status=in.(failed,complete)` +
          `&select=id,status,similarity,created_at`
        ),
        sb(
          `story_packages?workspace_id=eq.${ws.id}&status=eq.complete` +
          `&select=id,topic,similarity,staff_id,created_at` +
          `&order=created_at.desc&limit=20`
        ),
      ])

      const published    = publishedRes.ok    ? await publishedRes.json()    : []
      const weekPackages = weekPackageRes.ok  ? await weekPackageRes.json()  : []
      const triagePool   = triagePoolRes.ok   ? await triagePoolRes.json()   : []
      const queued       = queuedRes.ok       ? await queuedRes.json()       : []

      // Resolve clinician names for queued packages (small fetch).
      const cIds = [...new Set(queued.map((q) => q.staff_id).filter(Boolean))]
      let cMap = {}
      if (cIds.length) {
        const cRes = await sb(`staff?id=in.(${cIds.join(',')})&select=id,name`)
        if (cRes.ok) {
          const rows = await cRes.json()
          cMap = Object.fromEntries(rows.map((r) => [r.id, r.name]))
        }
      }
      const queuedWithNames = queued.map((q) => ({ ...q, staff_name: cMap[q.staff_id] }))

      // Roll up slate stats from last-week window only.
      const slateStats = {
        generated: weekPackages.length,
        approved:  weekPackages.filter((p) => p.status === 'approved').length,
        skipped:   weekPackages.filter((p) => p.status === 'skipped').length,
        failed:    weekPackages.filter((p) => p.status === 'failed').length,
        complete_awaiting: weekPackages.filter((p) => p.status === 'complete').length,
      }

      // Triage from the wider 30-day pool. Mirrors src/pages/Slate.jsx →
      // triageReasonFor(): failed any age; complete+low-confidence;
      // complete+stale (>36h since created_at).
      const triageFailed = triagePool.filter((p) => p.status === 'failed').length
      const lowConf = triagePool.filter((p) =>
        p.status === 'complete' && typeof p.similarity === 'number' && p.similarity < 0.65
      ).length
      const stale = triagePool.filter((p) => {
        if (p.status !== 'complete') return false
        const hours = (Date.now() - new Date(p.created_at).getTime()) / (1000 * 60 * 60)
        return hours > 36
      }).length
      const triage = { failed: triageFailed, lowConfidence: lowConf, stale }

      // ── Resolve recipient emails ────────────────────────────────────────
      let recipientUserIds = Array.isArray(ws.engagement_digest_recipients)
        ? ws.engagement_digest_recipients.filter(Boolean)
        : []

      // Empty list = derive from producer-tier clinicians.
      if (recipientUserIds.length === 0) {
        const pRes = await sb(
          `staff?workspace_id=eq.${ws.id}&permission_tier=eq.producer` +
          `&user_id=not.is.null&select=user_id`
        )
        if (pRes.ok) {
          const rows = await pRes.json()
          recipientUserIds = rows.map((r) => r.user_id).filter(Boolean)
        }
      }

      if (recipientUserIds.length === 0) {
        results.push({ workspace: ws.slug, skipped: 'no_recipients' })
        continue
      }

      // Look up Clerk emails (one call per user; could batch but volumes
      // are small per workspace).
      const emails = []
      for (const uid of recipientUserIds) {
        try {
          const user = await clerk().users.getUser(uid)
          const primaryAddr = user.emailAddresses?.find(
            (a) => a.id === user.primaryEmailAddressId
          )?.emailAddress
            || user.emailAddresses?.[0]?.emailAddress
          if (primaryAddr) emails.push(primaryAddr)
        } catch (e) {
          console.warn(`[engagement-digest] clerk user lookup failed for ${uid}:`, e?.message)
        }
      }
      if (emails.length === 0) {
        results.push({ workspace: ws.slug, skipped: 'no_emails_resolved' })
        continue
      }

      // ── Build + send email ──────────────────────────────────────────────
      const { subject, html, text } = buildDigest({
        workspace: ws,
        published,
        slateStats,
        triage,
        queued: queuedWithNames,
        weekStart,
        weekEnd,
      })

      // Send one email per recipient so a single bad address doesn't blackhole
      // the rest of the workspace (Resend rejects an entire batch on any
      // malformed/bounce-listed `to[]` entry). Per-address volumes are small
      // and Resend has no per-call cost, so the extra round-trips are cheap.
      let sentCount = 0
      const perRecipientFailures = []
      for (const email of emails) {
        try {
          const sendRes = await fetch(RESEND_ENDPOINT, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${RESEND_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from:    ADMIN_NOTIFY_FROM,
              to:      [email],
              subject,
              text,
              html,
            }),
          })
          if (sendRes.ok) {
            sentCount++
          } else {
            const errText = await sendRes.text().catch(() => '')
            console.error(`[engagement-digest] resend failed for ${ws.slug} → ${email}:`, sendRes.status, errText.slice(0, 200))
            perRecipientFailures.push({ email, status: sendRes.status })
          }
        } catch (e) {
          console.error(`[engagement-digest] resend network error for ${ws.slug} → ${email}:`, e?.message)
          perRecipientFailures.push({ email, error: e?.message })
        }
      }

      if (sentCount === 0) {
        results.push({
          workspace: ws.slug,
          sent: false,
          error: 'all_recipients_failed',
          failures: perRecipientFailures,
        })
        continue
      }

      // Stamp last_sent_at. CRITICAL: failure here means next week's cron
      // will resend (the time guard reads this column to decide skip). We
      // surface the stamp result explicitly so an operator sees the
      // double-send risk in the response body instead of buried in console
      // warnings.
      let stamped = false
      let stampError = null
      try {
        const stampRes = await sb(`workspaces?id=eq.${ws.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ engagement_digest_last_sent_at: new Date().toISOString() }),
        })
        if (stampRes.ok) {
          stamped = true
        } else {
          stampError = `db_${stampRes.status}`
          console.error(`[engagement-digest] WARN: send succeeded but stamp failed for ${ws.slug}:`, stampError, '— next run may double-send')
        }
      } catch (e) {
        stampError = e?.message || 'unknown'
        console.error(`[engagement-digest] WARN: send succeeded but stamp threw for ${ws.slug}:`, stampError, '— next run may double-send')
      }

      results.push({
        workspace: ws.slug,
        sent: true,
        recipients: sentCount,
        attempted: emails.length,
        per_recipient_failures: perRecipientFailures.length > 0 ? perRecipientFailures : undefined,
        published: published.length,
        queued: queued.length,
        stamped,
        stamp_error: stampError || undefined,
      })
    } catch (e) {
      console.error(`[engagement-digest] error for workspace ${ws.slug}:`, e?.stack || e?.message || e)
      results.push({ workspace: ws.slug, sent: false, error: e?.message || 'unknown' })
    }
  }

  return res.status(200).json({
    ok: true,
    week: { start: weekStart, end: weekEnd },
    processed: results.length,
    results,
  })
}

export default withSentry(handler)

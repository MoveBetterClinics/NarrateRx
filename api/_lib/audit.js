// Append-only audit log for media_assets mutations.
//
// Every mutating endpoint should call recordAudit() AFTER the primary mutation
// succeeds. The function is best-effort and never throws — auditing must not
// block the user's action. A failed audit write is logged to console for
// later forensics; the operation still succeeds from the user's perspective.
//
// Schema lives in supabase/009_media_audit.sql.

import { workspaceScope } from './workspaceScope.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// Pick a small subset of fields for `before`/`after` snapshots so the audit
// table doesn't bloat. We can always look up full row history via Supabase
// PITR if the snapshot omits something needed for forensics.
const SNAPSHOT_FIELDS = [
  'id', 'kind', 'status', 'source', 'filename', 'blob_url', 'blob_pathname',
  'rendered_url', 'patient_pseudonym', 'condition', 'tags', 'ai_tags', 'notes',
  'created_by',
]

export function snapshot(row) {
  if (!row) return null
  const out = {}
  for (const k of SNAPSHOT_FIELDS) {
    if (k in row) out[k] = row[k]
  }
  return out
}

// Extract a best-effort actor + request fingerprint from the inbound request.
// Falls back to 'system' when called from a non-request context (e.g. cron).
export function actorFromRequest(req) {
  // Clerk session is populated by api/_lib/auth.js's requireRole(); if that
  // hasn't been run, fall back to whatever the client claimed via header.
  // We never trust client headers for authorization decisions — only for
  // logging fallback.
  const clerk = req?.clerk?.userId || null
  const claimed = req?.headers?.['x-actor-id'] || null
  return clerk || claimed || 'unknown'
}

export function ipFromRequest(req) {
  const fwd = req?.headers?.['x-forwarded-for']
  if (typeof fwd === 'string') return fwd.split(',')[0].trim()
  return req?.socket?.remoteAddress || null
}

export function uaFromRequest(req) {
  return req?.headers?.['user-agent'] || null
}

export async function recordAudit({ assetId, action, actor, before, after, req, scope }) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.warn('[audit] Supabase env not configured; skipping')
    return
  }
  try {
    // Caller normally passes scope (resolved at request time). When a
    // background or cron-driven path doesn't have one, fall back to resolving
    // from req if available, or to the legacy brand env var.
    let resolved = scope
    if (!resolved) {
      if (req) resolved = await workspaceScope(req)
      else {
        const slug = (process.env.BRAND || process.env.VITE_BRAND || 'people').toLowerCase()
        resolved = { column: 'brand', id: slug, workspace: null }
      }
    }
    const body = {
      [resolved.column]: resolved.id,
      asset_id:   assetId || null,
      action,
      actor:      actor || (req ? actorFromRequest(req) : 'system'),
      before:     before || null,
      after:      after  || null,
      ip:         req ? ipFromRequest(req) : null,
      user_agent: req ? uaFromRequest(req) : null,
    }
    const r = await fetch(`${SUPABASE_URL}/rest/v1/media_audit`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(body),
    })
    if (!r.ok) {
      console.error(`[audit] insert failed: ${r.status} ${await r.text()}`)
    }
  } catch (e) {
    console.error('[audit] threw:', e?.message)
  }
}

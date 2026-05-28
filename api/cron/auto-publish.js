export const config = { runtime: 'nodejs' }
// Cron: auto-publish eligible story packages (every 10 minutes).
//
// For each video-pipeline-enabled workspace that has at least one channel
// with auto_publish enabled, walks approved story_packages that haven't been
// auto-published yet, runs the gate evaluator, and dispatches eligible
// packages via the existing Buffer publish path (useQueue=true so the post
// lands in the Buffer queue rather than firing immediately).
//
// GBP is the only live channel at launch — other channels in
// auto_publish_settings are accepted and stored but silently skipped here
// until they're wired.
//
// Auth: Bearer CRON_SECRET (same as backup-db and refresh-engagement).

import { evaluate } from '../_lib/autoPublishGate.js'
import { getCredential } from '../_lib/getCredential.js'
import { prepareMediaForBuffer } from '../_lib/prepareMediaForBuffer.js'

const SUPABASE_URL  = process.env.SUPABASE_URL
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY
const BUFFER_GQL    = 'https://api.buffer.com/graphql'

// How many approved packages to consider per workspace per run.
const BATCH_SIZE = 20

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

async function gql(token, query, variables = {}) {
  const r = await fetch(BUFFER_GQL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
  })
  const json = await r.json().catch(() => ({}))
  return { ok: r.ok, status: r.status, data: json.data, errors: json.errors }
}

// Resolve Buffer GBP channel IDs for a workspace (same logic as api/publish/buffer.js).
async function resolveGbpChannelIds(workspaceId) {
  const r = await sb(
    `workspace_locations?workspace_id=eq.${workspaceId}&status=eq.active&gbp_location_id=not.is.null&select=id,gbp_location_id`
  )
  if (!r.ok) return []
  const rows = await r.json().catch(() => [])
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => typeof row.gbp_location_id === 'string' && row.gbp_location_id.trim())
    .map((row) => ({ locationId: row.id, channelId: row.gbp_location_id }))
}

// Post a GBP package to Buffer queue; returns { bufferId } or null on failure.
async function dispatchGbp({ pkg, token, locationChannels }) {
  const text = pkg.caption_text || pkg.topic || ''
  const mediaUrls = Array.isArray(pkg.renders)
    ? pkg.renders
        .filter((r) => r.channel === 'gbp_post' && r.blobUrl)
        .map((r) => ({ url: r.blobUrl, type: 'image' }))
    : []
  const preparedMedia = await prepareMediaForBuffer(mediaUrls)
  const assets = preparedMedia.map((m) =>
    m.type?.startsWith('video') ? { video: { url: m.url } } : { image: { url: m.url } }
  )

  const firstBufferId = []
  for (const { channelId } of locationChannels) {
    const input = {
      channelId,
      text,
      schedulingType: 'automatic',
      mode: 'shareNext',
      assets,
      metadata: { google: { type: 'whats_new', detailsWhatsNew: { button: 'learn_more' } } },
    }
    const r = await gql(token, `
      mutation CreatePost($input: CreatePostInput!) {
        createPost(input: $input) {
          __typename
          ... on PostActionSuccess { post { id status dueAt } }
          ... on NotFoundError { message }
          ... on UnauthorizedError { message }
          ... on UnexpectedError { message }
          ... on InvalidInputError { message }
          ... on LimitReachedError { message }
        }
      }
    `, { input })
    if (r.errors || r.data?.createPost?.__typename !== 'PostActionSuccess') {
      const msg = r.errors?.[0]?.message || r.data?.createPost?.message || 'unknown'
      console.error('[auto-publish] GBP createPost failed:', msg, 'pkg:', pkg.id)
      return null
    }
    if (firstBufferId.length === 0) firstBufferId.push(r.data.createPost.post?.id)
  }
  return firstBufferId[0] ? { bufferId: firstBufferId[0] } : null
}

// Upsert the approved content_items row to scheduled + mark auto_published.
async function markContentItemScheduled({ pkg, workspaceId, bufferId }) {
  // Find the GBP content_item created by approve-package for this package.
  const ciRes = await sb(
    `content_items?workspace_id=eq.${workspaceId}` +
    `&provenance->>package_id=eq.${pkg.id}` +
    `&platform=eq.gbp` +
    `&status=eq.approved` +
    `&select=id&limit=1`
  )
  if (!ciRes.ok) {
    console.error('[auto-publish] markContentItemScheduled fetch failed:', ciRes.status, 'pkg:', pkg.id)
    return null
  }
  const rows = await ciRes.json().catch(() => [])
  const ci = rows?.[0]
  if (!ci?.id) {
    console.warn('[auto-publish] markContentItemScheduled: 0 rows matched for pkg:', pkg.id, 'workspace:', workspaceId, 'status:', ciRes.status, 'rows:', rows?.length ?? 0)
    return null
  }

  const now = new Date().toISOString()
  await sb(`content_items?id=eq.${ci.id}&workspace_id=eq.${workspaceId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      status:           'scheduled',
      buffer_update_id: bufferId,
      auto_published:   true,
      approved_at:      now,
      notes:            `Auto-published by cron at ${now}`,
    }),
  })
  return ci.id
}

async function processWorkspace(ws, summary) {
  const settings = ws.auto_publish_settings || {}
  const hasEnabled = Object.values(settings).some((cfg) => cfg?.enabled)
  if (!hasEnabled) return

  // Pull approved packages not yet auto-published.
  const pkgRes = await sb(
    `story_packages?workspace_id=eq.${ws.id}` +
    `&status=eq.approved` +
    `&auto_published_at=is.null` +
    `&select=id,workspace_id,source_asset_id,topic,caption_text,similarity,voice_fidelity_score,channels,renders,qc_flags,source_asset:media_assets(consent_status,qc_flags)` +
    `&order=updated_at.asc` +
    `&limit=${BATCH_SIZE}`
  )
  if (!pkgRes.ok) {
    summary.workspaces.push({ id: ws.id, slug: ws.slug, error: `pkg fetch ${pkgRes.status}` })
    return
  }
  const packages = await pkgRes.json().catch(() => [])
  if (!Array.isArray(packages) || packages.length === 0) {
    summary.workspaces.push({ id: ws.id, slug: ws.slug, evaluated: 0 })
    return
  }

  // Resolve Buffer credential.
  const cred = await getCredential(ws.id, 'buffer')
  if (!cred?.secret) {
    summary.workspaces.push({ id: ws.id, slug: ws.slug, skipped: 'no-buffer-token' })
    return
  }

  // Resolve GBP location channels once (same for all packages).
  const gbpChannels = settings.gbp?.enabled ? await resolveGbpChannelIds(ws.id) : []

  const dispatched = []
  const held = []
  const now = new Date().toISOString()

  for (const pkg of packages) {
    const result = evaluate({ pkg, workspace: ws })

    // Write evaluation state back to the package row (so Slate badge is live).
    await sb(`story_packages?id=eq.${pkg.id}&workspace_id=eq.${ws.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        auto_publish_state: {
          eligible:      result.eligible,
          evaluated_at:  now,
          channels:      result.channels,
          gated_reasons: result.reasons,
        },
        updated_at: now,
      }),
    }).catch((e) => console.error('[auto-publish] state patch failed:', e?.message))

    if (!result.eligible || result.channels.length === 0) {
      held.push({ id: pkg.id, reasons: result.reasons })
      continue
    }

    // Dispatch each eligible channel.
    for (const channel of result.channels) {
      if (channel === 'gbp') {
        if (gbpChannels.length === 0) {
          held.push({ id: pkg.id, reasons: [{ signal: 'config', detail: 'No GBP locations configured' }] })
          continue
        }
        const dispatch = await dispatchGbp({
          pkg,
          token: cred.secret,
          locationChannels: gbpChannels,
          workspaceId: ws.id,
        })
        if (!dispatch) {
          held.push({ id: pkg.id, reasons: [{ signal: 'buffer_error', detail: 'Buffer dispatch failed' }] })
          continue
        }
        const ciId = await markContentItemScheduled({ pkg, workspaceId: ws.id, bufferId: dispatch.bufferId })

        // Mark package auto_published_at so the cron skips it next run.
        await sb(`story_packages?id=eq.${pkg.id}&workspace_id=eq.${ws.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            auto_published_at: now,
            auto_publish_state: {
              eligible:      true,
              evaluated_at:  now,
              channels:      [channel],
              gated_reasons: [],
              published_channels: {
                [channel]: { fired_at: now, content_item_id: ciId, buffer_id: dispatch.bufferId },
              },
            },
            updated_at: now,
          }),
        }).catch((e) => console.error('[auto-publish] auto_published_at patch failed:', e?.message))

        dispatched.push({ id: pkg.id, channel, bufferId: dispatch.bufferId, ciId })
      }
    }
  }

  summary.workspaces.push({
    id: ws.id, slug: ws.slug,
    evaluated: packages.length,
    dispatched: dispatched.length,
    held: held.length,
    dispatched_detail: dispatched,
    held_detail: held,
  })
}

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return res.status(503).json({ error: 'CRON_SECRET not configured' })
  const auth = req.headers?.authorization
  if (auth !== `Bearer ${cronSecret}`) return res.status(401).json({ error: 'Unauthorized' })

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(503).json({ error: 'Supabase env not configured' })
  }

  // Enumerate workspaces with video_pipeline_enabled and non-empty auto_publish_settings.
  const wsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/workspaces?status=eq.active&video_pipeline_enabled=eq.true&select=id,slug,auto_publish_settings`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  )
  if (!wsRes.ok) return res.status(500).json({ error: 'workspace fetch failed' })
  const workspaces = await wsRes.json()

  const summary = { startedAt: new Date().toISOString(), workspaces: [] }
  for (const ws of workspaces) {
    try {
      await processWorkspace(ws, summary)
    } catch (e) {
      summary.workspaces.push({ id: ws.id, slug: ws.slug, error: e?.message || 'unknown' })
    }
  }
  summary.finishedAt = new Date().toISOString()

  return res.status(200).json(summary)
}

// Pinned to Node runtime so the Edge whole-graph bundler doesn't follow
// the ratelimit.js → @clerk/backend → node:crypto chain into middleware.
// Uses Express-style (req, res) handler — the Web-style (req) → Response
// pattern silently hangs on Vercel's Node runtime (response never sent;
// function times out at 300s). Match the convention used by /api/content-pieces/*.
export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../_lib/workspaceContext.js'
import { enforceLimit } from '../_lib/ratelimit.js'
import { buildPlanRows } from '../_lib/atomPlan.js'

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

const ok  = (res, data, status = 200) => res.status(status).json(data)
const err = (res, msg, status = 400)  => res.status(status).json({ error: msg })

// Log a Supabase non-ok response body to function logs and return a generic
// 500 to the client. Public response stays opaque (no schema leak); details
// land in Vercel logs so the next "Database error" report is one log fetch
// away from a root cause.
async function dbErr(res, r, msg = 'Database error', status = 500) {
  const body = await r.text().catch(() => '')
  console.error(`[db/interviews] ${msg} — supabase ${r.status}: ${body.slice(0, 500)}`)
  return res.status(status).json({ error: msg })
}

export default async function handler(req, res) {
  const { searchParams } = new URL(req.url, 'http://localhost')
  const id = searchParams.get('id')
  const userId = req.headers['x-user-id'] ?? null

  const ws = await workspaceContext(req)
  if (!ws) return err(res, 'Workspace not resolved', 400)
  const wsFilter = `workspace_id=eq.${ws.id}`

  if (req.method === 'GET') {
    if (id) {
      const r = await sb(
        `interviews?id=eq.${id}&${wsFilter}&select=id,clinician_id,topic,status,messages,outputs,owner_id,owner_email,tone,voice_mode,prototype_id,location_id,pull_quote_candidates,pull_quote_selected_id,verbatim_flags,created_at,updated_at`
      )
      if (!r.ok) return dbErr(res, r)
      const data = await r.json()
      return ok(res, data[0] ?? null)
    }

    // Search past completed interviews by topic (for cross-interview context)
    const topic = searchParams.get('topic')
    const excludeId = searchParams.get('excludeId')
    if (!topic) return err(res, 'Missing id or topic')

    let qs = `interviews?${wsFilter}&topic=ilike.${encodeURIComponent(topic)}&status=eq.completed`
    qs += `&select=id,topic,messages,created_at,clinicians(name)`
    if (excludeId) qs += `&id=neq.${excludeId}`
    qs += `&order=created_at.desc&limit=3`

    const r = await sb(qs)
    if (!r.ok) return dbErr(res, r)
    return ok(res, await r.json())
  }

  if (req.method === 'POST') {
    if (!(await enforceLimit(req, res, 'media'))) return

    const { clinicianId, topic, ownerId, ownerEmail, tone, voiceMode, prototypeId, locationId } = req.body || {}
    if (!clinicianId) return err(res, 'Missing clinicianId')
    if (!topic?.trim()) return err(res, 'Topic required')
    if (!ownerId) return err(res, 'Unauthorized', 401)

    const r = await sb('interviews', {
      method: 'POST',
      body: JSON.stringify({
        workspace_id: ws.id,
        clinician_id: clinicianId,
        topic: topic.trim(),
        owner_id: ownerId,
        owner_email: ownerEmail,
        status: 'in_progress',
        messages: [],
        tone: tone || 'smart',
        voice_mode: voiceMode === 'personal' ? 'personal' : 'practice',
        prototype_id: prototypeId || null,
        location_id: locationId || null,
      }),
    })
    if (!r.ok) return dbErr(res, r, 'Create failed')
    const data = await r.json()
    return ok(res, data[0], 201)
  }

  if (req.method === 'PATCH') {
    if (!(await enforceLimit(req, res, 'media'))) return

    if (!id) return err(res, 'Missing id')
    if (!userId) return err(res, 'Unauthorized', 401)

    const chk = await sb(`interviews?id=eq.${id}&${wsFilter}&select=owner_id,clinician_id,topic,location_id`)
    if (!chk.ok) return dbErr(res, chk)
    const rows = await chk.json()
    if (!rows.length) return err(res, 'Not found', 404)
    if (rows[0].owner_id !== userId) return err(res, 'Forbidden', 403)

    const body = req.body || {}
    const patch = { updated_at: new Date().toISOString() }
    if (body.messages !== undefined) patch.messages = body.messages
    if (body.outputs !== undefined) patch.outputs = body.outputs
    if (body.status !== undefined) patch.status = body.status
    if (body.locationId !== undefined) patch.location_id = body.locationId || null
    if (body.pullQuoteSelectedId !== undefined) patch.pull_quote_selected_id = body.pullQuoteSelectedId || null
    if (body.verbatimFlags !== undefined) patch.verbatim_flags = body.verbatimFlags

    const r = await sb(`interviews?id=eq.${id}&${wsFilter}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
    if (!r.ok) return dbErr(res, r, 'Update failed')
    const data = await r.json()

    // Auto-create content_items when outputs are saved for the first time
    if (body.outputs && body.status === 'completed') {
      try {
        const { clinician_id, topic, location_id } = rows[0]
        const o = body.outputs

        // Fetch clinician name. Workspace filter is defense-in-depth: clinician_id
        // came from the interview row that's already workspace-filtered above, so
        // any belonging-to-this-workspace clinician is reachable, but an explicit
        // filter prevents a stale FK from another workspace leaking a name string
        // into a content_item insert below.
        let clinicianName = ''
        const clinRes = await sb(`clinicians?id=eq.${clinician_id}&${wsFilter}&select=name`)
        if (clinRes.ok) {
          const clinRows = await clinRes.json()
          clinicianName = clinRows[0]?.name ?? ''
        }

        // Check if content_items already exist for this interview to avoid duplicates.
        // workspace filter is defense-in-depth (interview_id is already workspace-filtered).
        const existsRes = await sb(`content_items?interview_id=eq.${id}&${wsFilter}&select=id&limit=1`)
        const existsRows = existsRes.ok ? await existsRes.json() : []

        if (existsRows.length === 0) {
          // Map outputs keys → platform identifiers. Platforms covered by
          // the on-demand content plan (instagram, facebook, linkedin, gbp,
          // pinterest, tiktok) are intentionally NOT in this map — the Plan
          // tab handles those via content_plan_atoms.
          const platformMap = [
            { key: 'blogPost',        platform: 'blog' },
            { key: 'googleAds',       platform: 'google_ads' },
            { key: 'landingPage',     platform: 'landing_page' },
            { key: 'youtubeScript',   platform: 'youtube' },
            { key: 'emailNewsletter', platform: 'email' },
            { key: 'instagramAds',    platform: 'instagram_ads' },
          ]

          const items = platformMap
            .filter(({ key }) => o[key]?.trim())
            .map(({ key, platform }) => ({
              workspace_id:   ws.id,
              interview_id:   id,
              clinician_id,
              clinician_name: clinicianName,
              topic:          topic ?? '',
              platform,
              content:        o[key],
              // Voice-memory snapshot — never overwritten on edit
              ai_original_content: o[key],
              status:         'draft',
              media_urls:     [],
              location_id:    location_id ?? null,
            }))

          if (items.length > 0) {
            await sb('content_items', {
              method: 'POST',
              body: JSON.stringify(items),
              headers: { Prefer: 'return=minimal' },
            })
          }
        }

        // Auto-create content plan atoms once per interview (idempotent).
        const planExistsRes = await sb(
          `content_plan_atoms?interview_id=eq.${id}&${wsFilter}&select=id&limit=1`
        )
        const planExists = planExistsRes.ok && (await planExistsRes.json()).length > 0
        if (!planExists) {
          const planRows = buildPlanRows(id, ws.id, ws.enabled_outputs ?? [])
          if (planRows.length > 0) {
            await sb('content_plan_atoms', {
              method: 'POST',
              body: JSON.stringify(planRows),
              headers: { Prefer: 'return=minimal' },
            })
          }
        }
      } catch (_) {
        // Non-fatal — interview update already succeeded
      }
    }

    return ok(res, data[0])
  }

  if (req.method === 'DELETE') {
    if (!(await enforceLimit(req, res, 'media'))) return

    if (!id) return err(res, 'Missing id')
    if (!userId) return err(res, 'Unauthorized', 401)

    const chk = await sb(`interviews?id=eq.${id}&${wsFilter}&select=owner_id`)
    if (!chk.ok) return dbErr(res, chk)
    const rows = await chk.json()
    if (!rows.length) return err(res, 'Not found', 404)
    if (rows[0].owner_id !== userId) return err(res, 'Forbidden', 403)

    // Block deletion if any content items from this interview have been published
    const pubChk = await sb(`content_items?interview_id=eq.${id}&${wsFilter}&status=eq.published&select=id&limit=1`)
    if (pubChk.ok) {
      const published = await pubChk.json()
      if (published.length > 0) {
        return err(res, 'This interview has published content and cannot be deleted. Archive the published posts first.', 409)
      }
    }

    const r = await sb(`interviews?id=eq.${id}&${wsFilter}`, { method: 'DELETE' })
    if (!r.ok) return dbErr(res, r, 'Delete failed')
    return ok(res, { ok: true })
  }

  return res.status(405).send('Method not allowed')
}

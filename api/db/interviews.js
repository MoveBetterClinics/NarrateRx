export const config = { runtime: 'edge' }

import { workspaceContext } from '../_lib/workspaceContext.js'

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

const ok = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
const err = (msg, status = 400) =>
  new Response(JSON.stringify({ error: msg }), { status, headers: { 'Content-Type': 'application/json' } })

export default async function handler(req) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  const userId = req.headers.get('x-user-id')

  const ws = await workspaceContext(req)
  if (!ws) return err('Workspace not resolved', 400)
  const wsFilter = `workspace_id=eq.${ws.id}`

  if (req.method === 'GET') {
    if (id) {
      const res = await sb(
        `interviews?id=eq.${id}&${wsFilter}&select=id,clinician_id,topic,status,messages,outputs,owner_id,owner_email,tone,voice_mode,prototype_id,location_id,created_at,updated_at`
      )
      if (!res.ok) return err('Database error', 500)
      const data = await res.json()
      return ok(data[0] ?? null)
    }

    // Search past completed interviews by topic (for cross-interview context)
    const topic = searchParams.get('topic')
    const excludeId = searchParams.get('excludeId')
    if (!topic) return err('Missing id or topic')

    let qs = `interviews?${wsFilter}&topic=ilike.${encodeURIComponent(topic)}&status=eq.completed`
    qs += `&select=id,topic,messages,created_at,clinicians(name)`
    if (excludeId) qs += `&id=neq.${excludeId}`
    qs += `&order=created_at.desc&limit=3`

    const res = await sb(qs)
    if (!res.ok) return err('Database error', 500)
    return ok(await res.json())
  }

  if (req.method === 'POST') {
    const { clinicianId, topic, ownerId, ownerEmail, tone, voiceMode, prototypeId, locationId } = await req.json()
    if (!clinicianId) return err('Missing clinicianId')
    if (!topic?.trim()) return err('Topic required')
    if (!ownerId) return err('Unauthorized', 401)

    const res = await sb('interviews', {
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
    if (!res.ok) return err('Create failed', 500)
    const data = await res.json()
    return ok(data[0], 201)
  }

  if (req.method === 'PATCH') {
    if (!id) return err('Missing id')
    if (!userId) return err('Unauthorized', 401)

    const chk = await sb(`interviews?id=eq.${id}&${wsFilter}&select=owner_id,clinician_id,topic,location_id`)
    if (!chk.ok) return err('Database error', 500)
    const rows = await chk.json()
    if (!rows.length) return err('Not found', 404)
    if (rows[0].owner_id !== userId) return err('Forbidden', 403)

    const body = await req.json()
    const patch = { updated_at: new Date().toISOString() }
    if (body.messages !== undefined) patch.messages = body.messages
    if (body.outputs !== undefined) patch.outputs = body.outputs
    if (body.status !== undefined) patch.status = body.status
    if (body.locationId !== undefined) patch.location_id = body.locationId || null

    const res = await sb(`interviews?id=eq.${id}&${wsFilter}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
    if (!res.ok) return err('Update failed', 500)
    const data = await res.json()

    // Auto-create content_items when outputs are saved for the first time
    if (body.outputs && body.status === 'completed') {
      try {
        const { clinician_id, topic, location_id } = rows[0]
        const o = body.outputs

        // Fetch clinician name
        let clinicianName = ''
        const clinRes = await sb(`clinicians?id=eq.${clinician_id}&select=name`)
        if (clinRes.ok) {
          const clinRows = await clinRes.json()
          clinicianName = clinRows[0]?.name ?? ''
        }

        // Check if content_items already exist for this interview to avoid duplicates
        const existsRes = await sb(`content_items?interview_id=eq.${id}&select=id&limit=1`)
        const existsRows = existsRes.ok ? await existsRes.json() : []

        if (existsRows.length === 0) {
          // Map outputs keys → platform identifiers
          const platformMap = [
            { key: 'blogPost',        platform: 'blog' },
            { key: 'instagram',       platform: 'instagram' },
            { key: 'facebook',        platform: 'facebook' },
            { key: 'linkedin',        platform: 'linkedin' },
            { key: 'gbpPost',         platform: 'gbp' },
            { key: 'googleAds',       platform: 'google_ads' },
            { key: 'landingPage',     platform: 'landing_page' },
            { key: 'youtubeScript',   platform: 'youtube' },
            { key: 'tiktokScript',    platform: 'tiktok' },
            { key: 'emailNewsletter', platform: 'email' },
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
      } catch (_) {
        // Non-fatal — interview update already succeeded
      }
    }

    return ok(data[0])
  }

  if (req.method === 'DELETE') {
    if (!id) return err('Missing id')
    if (!userId) return err('Unauthorized', 401)

    const chk = await sb(`interviews?id=eq.${id}&${wsFilter}&select=owner_id`)
    if (!chk.ok) return err('Database error', 500)
    const rows = await chk.json()
    if (!rows.length) return err('Not found', 404)
    if (rows[0].owner_id !== userId) return err('Forbidden', 403)

    // Block deletion if any content items from this interview have been published
    const pubChk = await sb(`content_items?interview_id=eq.${id}&${wsFilter}&status=eq.published&select=id&limit=1`)
    if (pubChk.ok) {
      const published = await pubChk.json()
      if (published.length > 0) {
        return err('This interview has published content and cannot be deleted. Archive the published posts first.', 409)
      }
    }

    const res = await sb(`interviews?id=eq.${id}&${wsFilter}`, { method: 'DELETE' })
    if (!res.ok) return err('Delete failed', 500)
    return ok({ ok: true })
  }

  return new Response('Method not allowed', { status: 405 })
}

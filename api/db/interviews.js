// Pinned to Node runtime so the Edge whole-graph bundler doesn't follow
// the ratelimit.js → @clerk/backend → node:crypto chain into middleware.
// Uses Express-style (req, res) handler — the Web-style (req) → Response
// pattern silently hangs on Vercel's Node runtime (response never sent;
// function times out at 300s). Match the convention used by /api/content-pieces/*.
export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../_lib/workspaceContext.js'
import { requireRole } from '../_lib/auth.js'
import { enforceLimit } from '../_lib/ratelimit.js'
import { buildPlanRows } from '../_lib/atomPlan.js'
import { extractConcepts, buildInterviewText } from '../_lib/conceptExtractor.js'
import { summarizeInterview } from '../_lib/interviewSummarizer.js'
import { markBookStale } from '../_lib/bookStale.js'

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

  const ws = await workspaceContext(req)
  if (!ws) return err(res, 'Workspace not resolved', 400)
  const wsFilter = `workspace_id=eq.${ws.id}`

  // All interview CRUD requires a verified Clerk session bound to this
  // workspace's org. Previously trusted the x-user-id header for ownership
  // checks on PATCH/DELETE — spoofable by any workspace member, who could
  // PATCH or DELETE another user's interview by setting the header. Fixed
  // 2026-05-21 (audit P0 #4). GET stays open to any workspace member.
  let userId = null
  if (req.method !== 'GET') {
    const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
    if (!auth.ok) {
      return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
    }
    userId = auth.userId
  }

  if (req.method === 'GET') {
    if (id) {
      const r = await sb(
        `interviews?id=eq.${id}&${wsFilter}&select=id,staff_id,topic,status,messages,cleaned_messages,outputs,session_state,paused_at,owner_id,owner_email,tone,voice_mode,prototype_id,location_id,audience,story_type,cleanup_level,pull_quote_candidates,pull_quote_selected_id,verbatim_flags,generation_style,capture_mode,source_audio_url,created_at,updated_at`
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
    qs += `&select=id,topic,messages,created_at,staff(name)`
    if (excludeId) qs += `&id=neq.${excludeId}`
    qs += `&order=created_at.desc&limit=3`

    const r = await sb(qs)
    if (!r.ok) return dbErr(res, r)
    return ok(res, await r.json())
  }

  if (req.method === 'POST') {
    if (!(await enforceLimit(req, res, 'media'))) return

    const { staffId, topic, ownerEmail, tone, voiceMode, prototypeId, locationId, audience, storyType, cleanupLevel, generationStyle, topicBacklogId } = req.body || {}
    if (!staffId) return err(res, 'Missing staffId')
    if (!topic?.trim()) return err(res, 'Topic required')

    // owner_id comes from the verified Clerk token, never the request body.
    // Previously trusted req.body.ownerId — a workspace member could create
    // an interview "owned" by anyone. Fixed 2026-05-21 (audit P0 #4).
    const ownerId = userId

    const r = await sb('interviews', {
      method: 'POST',
      body: JSON.stringify({
        workspace_id: ws.id,
        staff_id: staffId,
        topic: topic.trim(),
        owner_id: ownerId,
        owner_email: ownerEmail,
        status: 'in_progress',
        messages: [],
        tone: tone || 'smart',
        voice_mode: voiceMode === 'personal' ? 'personal' : 'practice',
        prototype_id: prototypeId || null,
        location_id: locationId || null,
        audience: audience || null,
        story_type: storyType || null,
        cleanup_level: cleanupLevel || null,
        generation_style: generationStyle === 'minimal_edits' ? 'minimal_edits' : 'blog_post',
      }),
    })
    if (!r.ok) return dbErr(res, r, 'Create failed')
    const data = await r.json()
    const interview = data[0]

    // Carryover: copy any references attached to the originating topic_backlog
    // row onto the new interview, so the reading list survives after the topic
    // is archived. Best-effort — a copy failure must not 500 the interview
    // create (the row is already inserted above).
    if (topicBacklogId && interview?.id) {
      try {
        const refsRes = await sb(`interview_references?topic_id=eq.${topicBacklogId}&${wsFilter}&select=url,title,notes,use_as_source,added_by`)
        if (refsRes.ok) {
          const refs = await refsRes.json()
          if (Array.isArray(refs) && refs.length > 0) {
            const copies = refs.map((r) => ({
              workspace_id: ws.id,
              interview_id: interview.id,
              topic_id: null,
              url: r.url,
              title: r.title,
              notes: r.notes,
              use_as_source: r.use_as_source,
              added_by: r.added_by,
            }))
            const cpRes = await sb('interview_references', {
              method: 'POST',
              headers: { Prefer: 'return=minimal' },
              body: JSON.stringify(copies),
            })
            if (!cpRes.ok) {
              console.error(`[db/interviews] reference carryover ${cpRes.status} for interview=${interview.id} ws=${ws.slug}`)
            }
          }
        } else {
          console.error(`[db/interviews] reference carryover fetch ${refsRes.status} for topic=${topicBacklogId} ws=${ws.slug}`)
        }
      } catch (e) {
        console.error(`[db/interviews] reference carryover threw for interview=${interview.id} ws=${ws.slug}: ${e?.message}`)
      }
    }

    return ok(res, interview, 201)
  }

  if (req.method === 'PATCH') {
    if (!(await enforceLimit(req, res, 'media'))) return

    if (!id) return err(res, 'Missing id')

    const chk = await sb(`interviews?id=eq.${id}&${wsFilter}&select=owner_id,staff_id,topic,location_id,capture_mode,source_audio_url`)
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
    if (body.generationStyle !== undefined) patch.generation_style = body.generationStyle === 'minimal_edits' ? 'minimal_edits' : 'blog_post'
    // audience / story_type — slot keys, nullable. Both are also set at
    // creation time in POST, but pre-fix interviews + workspaces that added
    // new slots after the fact need a way to backfill them on completed
    // rows. Empty string is treated as null so the editor can "clear" a slot.
    if (body.audience !== undefined)  patch.audience   = body.audience   || null
    if (body.storyType !== undefined) patch.story_type = body.storyType || null
    // topic — story title. Trim and reject empty strings (a story must
    // always have a title visible in the header / lists). Length-capped to
    // 300 chars to keep the header layout sane on long entries.
    if (body.topic !== undefined) {
      const next = typeof body.topic === 'string' ? body.topic.trim() : ''
      if (!next) return err(res, 'Title required')
      patch.topic = next.slice(0, 300)
    }
    // session_state: null clears it (interview complete); object saves it
    if ('session_state' in body) patch.session_state = body.session_state ?? null
    if ('paused_at' in body) patch.paused_at = body.paused_at ?? null

    const r = await sb(`interviews?id=eq.${id}&${wsFilter}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
    if (!r.ok) return dbErr(res, r, 'Update failed')
    const data = await r.json()

    // Auto-create content_items + content_plan_atoms + extract concepts when
    // outputs are saved for the first time. Each block is independently
    // try/catch'd with explicit logging so a single failure (e.g. a
    // misconfigured platform map, a missing column, a Supabase 4xx) cannot
    // silently leave a new tenant's first completed interview with no
    // content downstream. Without per-block diagnostics, a clinician sees
    // "Interview complete!" but Stories + Plan stay empty and there's
    // nothing in vercel logs to root-cause from. The interview row itself
    // already saved before this branch ran — we never want any of the
    // enrichment paths to bubble up and 500 the PATCH.
    if (body.outputs && body.status === 'completed') {
      const { staff_id, topic, location_id, capture_mode, source_audio_url } = rows[0]
      const o = body.outputs
      // URL-import keystone is already-published content (the source URL is
      // the live post). Mark the blog content_item as published with the
      // source URL as resolved_url so the UI surfaces "Published to Website"
      // + "View live post" instead of draft/approve/publish actions.
      const isImportedKeystone = capture_mode === 'text_import' && !!source_audio_url

      // Fetch clinician name once for the inserts below. Workspace filter
      // is defense-in-depth: staff_id came from the interview row that's
      // already workspace-filtered above, so any belonging-to-this-workspace
      // clinician is reachable, but an explicit filter prevents a stale FK
      // from another workspace leaking a name into a content_item insert.
      let staffName = ''
      try {
        const clinRes = await sb(`staff?id=eq.${staff_id}&${wsFilter}&select=name`)
        if (clinRes.ok) {
          const clinRows = await clinRes.json()
          staffName = clinRows[0]?.name ?? ''
        } else {
          console.error(`[db/interviews] post-complete clinician name fetch ${clinRes.status} for interview=${id} ws=${ws.slug}`)
        }
      } catch (e) {
        console.error(`[db/interviews] post-complete clinician name fetch threw for interview=${id} ws=${ws.slug}: ${e?.message}`)
      }

      // content_items insert
      try {
        const existsRes = await sb(`content_items?interview_id=eq.${id}&${wsFilter}&select=id&limit=1`)
        const existsRows = existsRes.ok ? await existsRes.json() : []

        if (existsRows.length === 0) {
          // Platforms covered by the on-demand content plan (instagram,
          // facebook, linkedin, gbp, pinterest, tiktok) are intentionally
          // NOT in this map — the Plan tab handles those via content_plan_atoms.
          const platformMap = [
            { key: 'blogPost',        platform: 'blog' },
            { key: 'googleAds',       platform: 'google_ads' },
            { key: 'landingPage',     platform: 'landing_page' },
            { key: 'youtubeScript',   platform: 'youtube' },
            { key: 'emailNewsletter', platform: 'email' },
            { key: 'instagramAds',    platform: 'instagram_ads' },
          ]

          const nowIso = new Date().toISOString()
          const items = platformMap
            .filter(({ key }) => o[key]?.trim())
            .map(({ key, platform }) => {
              // Imported blog = already-published source. Other platforms
              // (atoms generated from it) are still drafts pending review.
              const isImportedBlog = isImportedKeystone && platform === 'blog'
              return {
                workspace_id:   ws.id,
                interview_id:   id,
                staff_id,
                staff_name: staffName,
                topic:          topic ?? '',
                platform,
                content:        o[key],
                // Voice-memory snapshot — never overwritten on edit
                ai_original_content: o[key],
                status:         isImportedBlog ? 'published' : 'draft',
                published_at:   isImportedBlog ? nowIso : null,
                resolved_url:   isImportedBlog ? source_audio_url : null,
                media_urls:     [],
                location_id:    location_id ?? null,
              }
            })

          if (items.length > 0) {
            const insRes = await sb('content_items', {
              method: 'POST',
              body: JSON.stringify(items),
              headers: { Prefer: 'return=minimal' },
            })
            if (!insRes.ok) {
              const body = await insRes.text().catch(() => '')
              console.error(`[db/interviews] content_items insert ${insRes.status} for interview=${id} ws=${ws.slug}: ${body.slice(0, 500)}`)
            }
          }
        }
      } catch (e) {
        console.error(`[db/interviews] content_items block threw for interview=${id} ws=${ws.slug}: ${e?.message}`)
      }

      // Concept extraction from clinician's transcript turns.
      // Uses cleaned_messages if available (cleanup-transcript pass), else raw messages.
      try {
        const extractRes = await sb(
          `interviews?id=eq.${id}&${wsFilter}&select=cleaned_messages,messages`
        )
        if (!extractRes.ok) {
          console.error(`[db/interviews] concept extraction lookup ${extractRes.status} for interview=${id} ws=${ws.slug}`)
        } else {
          const lookupRows = await extractRes.json()
          const interviewForExtract = lookupRows[0]
          if (interviewForExtract) {
            const turns = interviewForExtract.cleaned_messages?.length
              ? interviewForExtract.cleaned_messages
              : interviewForExtract.messages
            const interviewText = buildInterviewText(turns)
            // extractConcepts is intentionally fire-and-forget — it runs its
            // own async pipeline and shouldn't block the PATCH response.
            extractConcepts({
              workspaceId:  ws.id,
              sourceKind:   'interview_turn',
              sourceId:     id,
              text:         interviewText,
              staffId:  rows[0].staff_id ?? null,
              weightDelta:  1.0,
            })
            // Phase 5 Feature 2 — practice-memory summarization runs alongside
            // concept extraction. Same fire-and-forget contract; writes back to
            // interviews.summary_text on success.
            summarizeInterview({
              interviewId:   id,
              workspaceId:   ws.id,
              staffId:   rows[0].staff_id ?? null,
              staffName,
              topic:         topic,
              messages:      turns,
            })
          }
        }
      } catch (e) {
        console.error(`[db/interviews] concept extraction block threw for interview=${id} ws=${ws.slug}: ${e?.message}`)
      }

      // Auto-create content_plan_atoms once per interview (idempotent).
      try {
        const planExistsRes = await sb(
          `content_plan_atoms?interview_id=eq.${id}&${wsFilter}&select=id&limit=1`
        )
        const planExists = planExistsRes.ok && (await planExistsRes.json()).length > 0
        if (!planExists) {
          const planRows = buildPlanRows(id, ws.id, ws.enabled_outputs ?? [])
          if (planRows.length > 0) {
            const atomRes = await sb('content_plan_atoms', {
              method: 'POST',
              body: JSON.stringify(planRows),
              headers: { Prefer: 'return=minimal' },
            })
            if (!atomRes.ok) {
              const body = await atomRes.text().catch(() => '')
              console.error(`[db/interviews] content_plan_atoms insert ${atomRes.status} for interview=${id} ws=${ws.slug}: ${body.slice(0, 500)}`)
            }
          }
        }
      } catch (e) {
        console.error(`[db/interviews] content_plan_atoms block threw for interview=${id} ws=${ws.slug}: ${e?.message}`)
      }

      // Mark the workspace's book stale so the next cron run (or a manual
      // regenerate click) weaves this newly-completed interview in. Covers
      // both regular interviews and voice memos — voice memos go through
      // this same PATCH path when the capture review pipeline marks them
      // completed.
      markBookStale({ workspaceId: ws.id })
    }

    return ok(res, data[0])
  }

  if (req.method === 'DELETE') {
    if (!(await enforceLimit(req, res, 'media'))) return

    if (!id) return err(res, 'Missing id')

    const chk = await sb(`interviews?id=eq.${id}&${wsFilter}&select=owner_id,capture_mode`)
    if (!chk.ok) return dbErr(res, chk)
    const rows = await chk.json()
    if (!rows.length) return err(res, 'Not found', 404)
    if (rows[0].owner_id !== userId) return err(res, 'Forbidden', 403)

    // Block deletion if any content items from this interview have been
    // published. The guard exists because "published" normally means
    // "live on the user's website via the NarrateRx publish flow" — and
    // deleting the source interview would orphan engagement metrics that
    // point back to it.
    //
    // Imported interviews (capture_mode='text_import') get an automatic
    // status='published' + resolved_url=<source URL> on the keystone,
    // but the source post lives at the user's site independently of
    // NarrateRx. Deleting the interview just removes our record of it —
    // nothing is orphaned. So skip the guard for imports.
    if (rows[0].capture_mode !== 'text_import') {
      const pubChk = await sb(`content_items?interview_id=eq.${id}&${wsFilter}&status=eq.published&select=id&limit=1`)
      if (pubChk.ok) {
        const published = await pubChk.json()
        if (published.length > 0) {
          return err(res, 'This interview has published content and cannot be deleted. Archive the published posts first.', 409)
        }
      }
    }

    const r = await sb(`interviews?id=eq.${id}&${wsFilter}`, { method: 'DELETE' })
    if (!r.ok) return dbErr(res, r, 'Delete failed')
    return ok(res, { ok: true })
  }

  return res.status(405).send('Method not allowed')
}

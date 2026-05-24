// POST /api/import-url
//
// Fetches a URL, extracts the main text content via Jina.ai Reader
// (https://r.jina.ai/{url} — free, no API key, returns clean markdown),
// then creates an interview row with capture_mode='text_import' so the
// existing synthesis pipeline (CaptureReview → blog post → content_items)
// works unchanged.
//
// Request body: { url: string }
// Response:     { clinicianId, interviewId }
//
// source_audio_url is repurposed as source_url — stores the original page
// URL for provenance so the review page can link back to it.
//
// Runtime notes:
//   • Node runtime — @clerk/backend requires node:crypto.
//   • No body-parser override needed — body is small JSON.
//   • maxDuration 60s — Jina.ai fetch can be slow on first hit for large pages.

export const config = { runtime: 'nodejs', maxDuration: 60 }

import { createClerkClient } from '@clerk/backend'
import { requireRole } from './_lib/auth.js'
import { workspaceContext } from './_lib/workspaceContext.js'
import { enforceLimit } from './_lib/ratelimit.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// Jina.ai Reader converts any URL to clean markdown — same engine as Firefox
// Reader Mode. Free, no API key, handles paywalls poorly (expected).
const JINA_BASE = 'https://r.jina.ai/'

// Cap extracted text sent to Claude. Blog posts rarely exceed 10K words
// (~60K chars). We truncate generously to avoid token burn on monster pages.
const MAX_TEXT_CHARS = 80_000

let _clerk = null
function clerkClient() {
  if (!_clerk) _clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })
  return _clerk
}

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

function isValidHttpUrl(str) {
  try {
    const u = new URL(str)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // ── Auth + workspace ──────────────────────────────────────────────────────
  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })

  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  if (!(await enforceLimit(req, res, 'ai'))) return

  // ── Validate URL ──────────────────────────────────────────────────────────
  const { url } = req.body || {}
  if (!url?.trim()) return res.status(400).json({ error: 'url is required' })
  if (!isValidHttpUrl(url.trim())) return res.status(400).json({ error: 'That doesn\'t look like a valid URL. Include https://' })

  const cleanUrl = url.trim()

  // ── Fetch via Jina.ai Reader ──────────────────────────────────────────────
  // Jina.ai prepends r.jina.ai/ to any URL and returns clean plain-text /
  // markdown of the main content — navigation, ads, and boilerplate stripped.
  let extractedText
  try {
    const jinaRes = await fetch(`${JINA_BASE}${encodeURIComponent(cleanUrl)}`, {
      headers: {
        'Accept': 'text/plain',
        'X-Return-Format': 'markdown',
        // Ask Jina to wait for JS-rendered content (up to 10s). Helps with
        // React/Next.js sites that hydrate on client.
        'X-Wait-For-Selector': 'article, main, .content, .post-content',
      },
    })
    if (!jinaRes.ok) {
      throw new Error(`Jina.ai returned ${jinaRes.status} — the page may be paywalled or unreachable.`)
    }
    const raw = await jinaRes.text()
    if (!raw?.trim()) throw new Error('No content extracted from that URL.')

    // Strip Jina's header block. Jina prepends metadata lines like:
    //   Title: ...
    //   URL Source: ...
    //   Published Time: ...
    //   Markdown Content:
    // followed by a blank line and then the actual content. We want only the
    // body — the header is noise when the imported text is used as the
    // keystone piece (or as input to LLM generation).
    let body = raw.trim()
    const markerIdx = body.indexOf('Markdown Content:')
    if (markerIdx !== -1) {
      body = body.slice(markerIdx + 'Markdown Content:'.length).replace(/^\s+/, '')
    }
    extractedText = body.slice(0, MAX_TEXT_CHARS)
    if (!extractedText) throw new Error('Page appears to be empty after extraction.')
  } catch (e) {
    console.error(`[import-url] fetch failed for ${cleanUrl}: ${e?.message}`)
    return res.status(502).json({ error: e?.message || 'Could not fetch that URL.' })
  }

  // ── Find or create Self-clinician ─────────────────────────────────────────
  const wsFilter = `workspace_id=eq.${ws.id}`
  let clinicianId

  const clinRes = await sb(
    `clinicians?${wsFilter}&user_id=eq.${encodeURIComponent(auth.userId)}&select=id&limit=1`
  )
  if (clinRes.ok) {
    const rows = await clinRes.json()
    if (rows.length) clinicianId = rows[0].id
  }

  if (!clinicianId) {
    let name = 'Me'
    try {
      const user = await clerkClient().users.getUser(auth.userId)
      const full = [user.firstName, user.lastName].filter(Boolean).join(' ')
      name = full || user.username || user.primaryEmailAddress?.emailAddress?.split('@')[0] || 'Me'
    } catch (e) {
      console.warn(`[import-url] could not fetch Clerk user ${auth.userId}: ${e?.message}`)
    }

    const cRes = await sb('clinicians', {
      method: 'POST',
      body: JSON.stringify({
        workspace_id: ws.id,
        name,
        user_id: auth.userId,
        created_by_id: auth.userId,
      }),
    })
    if (!cRes.ok) {
      const body = await cRes.text().catch(() => '')
      console.error(`[import-url] clinician create failed ${cRes.status}: ${body.slice(0, 300)}`)
      return res.status(500).json({ error: 'Could not create clinician record' })
    }
    clinicianId = (await cRes.json())[0]?.id
  }

  if (!clinicianId) return res.status(500).json({ error: 'Clinician ID could not be determined' })

  // ── Create interview row (capture_mode = 'text_import') ───────────────────
  // source_audio_url stores the original page URL for provenance.
  // The extracted text lands as a single user-role message — same shape as
  // a voice memo transcript, so CaptureReview + generation work unchanged.
  const hostname = new URL(cleanUrl).hostname.replace(/^www\./, '')
  const topic = `Imported from ${hostname} — ${new Date().toLocaleDateString('en-CA')}`

  const ivRes = await sb('interviews', {
    method: 'POST',
    body: JSON.stringify({
      workspace_id:     ws.id,
      clinician_id:     clinicianId,
      owner_id:         auth.userId,
      topic,
      status:           'in_progress',
      capture_mode:     'text_import',
      source_audio_url: cleanUrl,   // repurposed as source_url for provenance
      messages:         [{ role: 'user', content: extractedText }],
      tone:             'smart',
      voice_mode:       'personal',
      generation_style: 'blog_post',
    }),
  })
  if (!ivRes.ok) {
    const body = await ivRes.text().catch(() => '')
    console.error(`[import-url] interview create failed ${ivRes.status}: ${body.slice(0, 300)}`)
    return res.status(500).json({ error: 'Could not save interview record' })
  }
  const interview = (await ivRes.json())[0]
  if (!interview?.id) return res.status(500).json({ error: 'Interview created but no ID returned' })

  return res.status(200).json({ clinicianId, interviewId: interview.id })
}

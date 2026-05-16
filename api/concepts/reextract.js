// POST /api/concepts/reextract
//
// Admin-triggered re-extraction of workspace concepts from the last 50 approved
// content items and the 20 most recent completed interviews. Queues the work
// fire-and-forget — responds immediately (202) while extraction runs in the
// background. Rate-limited to once per 5 minutes per workspace.
export const config = { runtime: 'nodejs', maxDuration: 300 }

import { workspaceContext } from '../_lib/workspaceContext.js'
import { requireRole } from '../_lib/auth.js'
import { extractConcepts, buildInterviewText } from '../_lib/conceptExtractor.js'
import { invalidateCache } from '../_lib/conceptRetrieval.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// Simple in-process cooldown (per workspace) — 5 minutes between runs.
const lastRun = new Map()
const COOLDOWN_MS = 5 * 60 * 1000

function sb(path) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey:        SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
  })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })

  const auth = await requireRole(req, ['admin'], { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  const last = lastRun.get(ws.id) ?? 0
  if (Date.now() - last < COOLDOWN_MS) {
    return res.status(429).json({ error: 'Re-extraction cooldown — try again in a few minutes.' })
  }
  lastRun.set(ws.id, Date.now())

  // Respond immediately — extraction runs in the background.
  res.status(202).json({ ok: true, message: 'Re-extraction started' })

  // ── Background work ──────────────────────────────────────────────────────
  ;(async () => {
    try {
      const wsFilter = `workspace_id=eq.${ws.id}`

      // Approved content items (last 50)
      const contentRes = await sb(
        `content_items?${wsFilter}&status=eq.approved&select=id,content,clinician_id&order=approved_at.desc&limit=50`
      )
      if (contentRes.ok) {
        const items = await contentRes.json()
        for (const item of items) {
          if (!item.content?.trim()) continue
          await extractConcepts({
            workspaceId:  ws.id,
            sourceKind:   'approved_edit',
            sourceId:     item.id,
            text:         item.content,
            clinicianId:  item.clinician_id ?? null,
            weightDelta:  1.5,
          })
        }
      }

      // Most recent completed interviews (last 20)
      const ivRes = await sb(
        `interviews?${wsFilter}&status=eq.completed&select=id,cleaned_messages,messages,clinician_id&order=created_at.desc&limit=20`
      )
      if (ivRes.ok) {
        const interviews = await ivRes.json()
        for (const iv of interviews) {
          const turns = iv.cleaned_messages?.length ? iv.cleaned_messages : iv.messages
          const text  = buildInterviewText(turns)
          if (!text) continue
          await extractConcepts({
            workspaceId:  ws.id,
            sourceKind:   'interview_turn',
            sourceId:     iv.id,
            text,
            clinicianId:  iv.clinician_id ?? null,
            weightDelta:  1.0,
          })
        }
      }

      // Clear retrieval cache so next fetch shows fresh data.
      invalidateCache(ws.id)
      console.info(`[concepts/reextract] workspace=${ws.id} re-extraction complete`)
    } catch (e) {
      console.error('[concepts/reextract] background error:', e?.message)
    }
  })()
}

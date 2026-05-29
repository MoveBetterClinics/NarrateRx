// GET /api/editorial/shot-list
//
// V10: the "shooting director." Closes the loop between distribution demand
// and capture supply. The Slate's Coverage tab measures which topics still
// need source material; this endpoint turns those gaps into concrete, voiced
// capture directives a clinician can act on from the Capture page:
//
//   "Film a 30s clip of you explaining why morning mobility beats stretching."
//
// Pipeline:
//   1. Rank the workspace's topic_suggestions by coverage gap + priority,
//      with proven topics (past published winners) floated up — the same
//      signal V5 feeds into the daily slate.
//   2. Take the top few gap topics and ask Haiku to phrase each as a single
//      concrete shot directive (format + one-sentence instruction), in the
//      workspace's voice.
//   3. Return directives for the Capture page to surface.
//
// Workspace-scoped + video_pipeline_enabled gated. Read-only (no writes).
// Graceful degradation: if the model call fails we fall back to deterministic
// directives built from topic metadata, so the clinician always gets guidance.
//
// Response 200:
//   { directives: [{ topic, priority, format, title, directive, proven }], asOf }

export const config = { runtime: 'nodejs' }

import { generateText } from 'ai'
import { requireRole } from '../_lib/auth.js'
import { ALL_KNOWN_ROLES } from '../_lib/roles.js'
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
      ...init.headers,
    },
  })
}

const PRIORITY_RANK = { high: 3, medium: 2, low: 1 }
const MAX_DIRECTIVES = 4

// Match a raw package/winner topic string to a suggestion via exact title or
// keyword-alias overlap — the same fuzzy match the coverage rollup uses.
function topicMatchesSuggestion(rawTopic, suggestion) {
  const lc = String(rawTopic || '').trim().toLowerCase()
  if (!lc) return false
  if (lc === String(suggestion.topic || '').toLowerCase()) return true
  const keywords = Array.isArray(suggestion.keywords) ? suggestion.keywords : []
  return keywords.some((k) => lc.includes(String(k).toLowerCase()))
}

// A deterministic directive when the model is unavailable. Uses the topic's
// pnwNote / keywords so it's still specific, not generic boilerplate.
function fallbackDirective(s, proven) {
  const note = String(s.pnwNote || '').trim()
  const base = note
    ? `Capture a short clip on "${s.topic}" — ${note}`
    : `Film a 20–40s clip explaining "${s.topic}" in your own words.`
  return {
    topic: s.topic,
    priority: s.priority || 'medium',
    format: 'video',
    title: s.topic,
    directive: base,
    proven,
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  const ws = await workspaceContext(req)
  if (!ws) return res.status(404).json({ error: 'no_workspace' })
  if (!ws.video_pipeline_enabled) {
    return res.status(403).json({ error: 'feature_disabled' })
  }

  const auth = await requireRole(req, ALL_KNOWN_ROLES, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  const suggestions = Array.isArray(ws.topic_suggestions) ? ws.topic_suggestions : []
  if (suggestions.length === 0) {
    return res.status(200).json({ directives: [], asOf: new Date().toISOString() })
  }

  // --- Coverage signal: which suggestions are covered, which are proven ---
  const packagesRes = await sb(
    `story_packages?workspace_id=eq.${ws.id}&status=in.(complete,approved)&select=topic`
  )
  if (!packagesRes.ok) return res.status(500).json({ error: 'db_error_packages' })
  const packages = await packagesRes.json()

  // Winners are non-fatal — proven bias is a nice-to-have, not load-bearing.
  const winnersRes = await sb(
    `content_items?workspace_id=eq.${ws.id}&status=eq.published&performed_well=eq.true&archived_at=is.null&select=topic`
  )
  const winners = winnersRes.ok ? await winnersRes.json() : []

  // --- Rank suggestions: uncovered first, then priority desc, proven floats up ---
  const ranked = suggestions
    .map((s) => {
      const covered = packages.some((p) => topicMatchesSuggestion(p.topic, s))
      const proven = winners.some((w) => topicMatchesSuggestion(w.topic, s))
      return { ...s, covered, proven }
    })
    .sort((a, b) => {
      if (a.covered !== b.covered) return a.covered ? 1 : -1
      const pd = (PRIORITY_RANK[b.priority] || 0) - (PRIORITY_RANK[a.priority] || 0)
      if (pd !== 0) return pd
      if (a.proven !== b.proven) return a.proven ? -1 : 1
      return String(a.topic || '').localeCompare(String(b.topic || ''))
    })

  const picks = ranked.slice(0, MAX_DIRECTIVES)
  if (picks.length === 0) {
    return res.status(200).json({ directives: [], asOf: new Date().toISOString() })
  }

  // --- Phrase each gap as a concrete shot directive in the workspace voice ---
  const tone = ws?.brand_voice?.tone_descriptors?.join(', ') || 'warm, expert'
  const practiceName = ws.display_name || ws.name || 'the practice'

  let directives = null
  try {
    const system = [
      `You are a "shooting director" for ${practiceName}, a clinical practice making short-form video for social.`,
      `Voice: ${tone}.`,
      'For each topic below, write ONE concrete capture directive a clinician can shoot on their phone in under a minute.',
      'A good directive names the action and the angle — what to film and the one point to make. Be specific, not generic.',
      'Pick the best format for each: "video" for talking-head/demonstration, "photo" for a still that carries the idea.',
      'Return ONLY a JSON array, no prose. Each element: {"topic": string (echo the given topic verbatim), "format": "video"|"photo", "title": short 2-5 word label, "directive": one sentence instruction}.',
    ].join('\n')

    const topicList = picks
      .map((s, i) => `${i + 1}. ${s.topic}${s.pnwNote ? ` — context: ${s.pnwNote}` : ''}${s.proven ? ' (this topic performed well before)' : ''}`)
      .join('\n')

    const { text } = await generateText({
      model: 'anthropic/claude-haiku-4-5',
      system,
      messages: [{ role: 'user', content: `Topics needing capture:\n${topicList}\n\nReturn the JSON array:` }],
      maxOutputTokens: 600,
    })

    const jsonStart = text.indexOf('[')
    const jsonEnd = text.lastIndexOf(']')
    if (jsonStart !== -1 && jsonEnd > jsonStart) {
      const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1))
      if (Array.isArray(parsed)) {
        // Re-join model output to our ranked picks by topic, preserving the
        // priority + proven flags we computed (don't trust the model for those).
        directives = picks.map((s) => {
          const m = parsed.find((d) => topicMatchesSuggestion(d.topic, s)) || {}
          const fmt = m.format === 'photo' ? 'photo' : 'video'
          const directive = String(m.directive || '').trim()
          if (!directive) return fallbackDirective(s, s.proven)
          return {
            topic: s.topic,
            priority: s.priority || 'medium',
            format: fmt,
            title: String(m.title || s.topic).trim().slice(0, 60),
            directive,
            proven: s.proven,
          }
        })
      }
    }
  } catch (e) {
    // Model/gateway hiccup — fall through to deterministic directives below.
    console.warn('[editorial/shot-list] model phrasing failed, using fallback:', e?.message)
  }

  if (!directives) {
    directives = picks.map((s) => fallbackDirective(s, s.proven))
  }

  return res.status(200).json({ directives, asOf: new Date().toISOString() })
}

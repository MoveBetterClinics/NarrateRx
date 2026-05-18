// GET /api/topic-suggestions[?refresh=true]
//
// Returns 5 AI-generated patient questions for this workspace's practice type.
// Results are cached on workspaces.ai_topics_cache for 7 days and refreshed
// when the cache is stale or when ?refresh=true is passed.
//
// Uses the Vercel AI Gateway (same pattern as api/topic-backlog/suggest.js).
// Node runtime required: imports ratelimit.js → @clerk/backend → node:crypto.
export const config = { runtime: 'nodejs', maxDuration: 60 }

import { generateText } from 'ai'
import { workspaceContext } from './_lib/workspaceContext.js'
import { enforceLimit } from './_lib/ratelimit.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey:          SUPABASE_KEY,
      Authorization:   `Bearer ${SUPABASE_KEY}`,
      'Content-Type':  'application/json',
      Prefer:          'return=representation',
      ...init.headers,
    },
  })
}

const ok  = (res, data, status = 200) => res.status(status).json(data)
const err = (res, msg, status = 400)  => res.status(status).json({ error: msg })

const PLATFORM_LABELS = {
  facebook:  'Facebook',
  instagram: 'Instagram',
  linkedin:  'LinkedIn',
  twitter:   'Twitter / X',
  gbp:       'Google Business',
  wordpress: 'Website',
  email:     'Email',
}

// Fetch top performers from engagement_snapshots (latest snapshot per item,
// both Buffer and GA4 sources). Returns top 5 by source-appropriate score.
// Previously read buffer_metrics from content_items, which excluded GA4-backed
// website posts. engagement_snapshots covers both sources.
async function fetchTopPerformers(wsId) {
  try {
    const r = await sb(
      `engagement_snapshots?workspace_id=eq.${encodeURIComponent(wsId)}` +
      `&order=fetched_at.desc&limit=150` +
      `&select=content_item_id,source,stats,content_items(topic,platform,status)`,
    )
    if (!r.ok) return []
    const rows = await r.json().catch(() => [])
    if (!Array.isArray(rows) || rows.length === 0) return []

    // Dedupe to latest snapshot per content item; score by source signal.
    const seen = new Set()
    const candidates = []
    for (const row of rows) {
      if (seen.has(row.content_item_id)) continue
      seen.add(row.content_item_id)
      const ci = row.content_items
      if (!ci || ci.status !== 'published') continue

      let score, reach, engagement
      if (row.source === 'ga4') {
        score = row.stats?.pageviews ?? 0
        reach = score
        engagement = 0
      } else {
        const stats = row.stats?.statistics ?? {}
        const likes = stats.likes ?? stats.favorites ?? 0
        reach = stats.reach ?? 0
        engagement = likes + (stats.comments ?? 0) + (stats.shares ?? 0)
        score = reach
      }
      if (score <= 0) continue
      candidates.push({ topic: ci.topic || 'Untitled', platform: ci.platform, score, reach, engagement })
    }

    return candidates
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((i) => ({
        topic:      i.topic,
        platform:   PLATFORM_LABELS[i.platform] || i.platform || 'Unknown',
        reach:      i.reach,
        engagement: i.engagement,
      }))
  } catch {
    return []
  }
}

function buildPrompt(ws, topPerformers = []) {
  const practiceType = ws.clinic_context
    || ws.audience_description
    || `${ws.display_name} healthcare practice`

  const location = ws.location_keyword || ws.location || 'their local area'
  const audience = ws.audience_description || 'patients seeking healthcare'

  const performersBlock = topPerformers.length > 0
    ? `\nTop performing recent posts:\n${topPerformers.map((p) => `- "${p.topic}" on ${p.platform}: ${p.reach} reach, ${p.engagement} engagements`).join('\n')}\n`
    : ''

  const performersInstruction = topPerformers.length > 0
    ? '- Build on the angles that are already resonating — generate follow-up topics or adjacent questions that would appeal to the same audience'
    : ''

  const brandBlock = ws.brand_guidelines
    ? `BRAND GUIDELINES:\n${ws.brand_guidelines}\n`
    : ''

  return `You are helping a healthcare practice generate interview topics for their clinician content marketing.

PRACTICE: ${ws.display_name}
LOCATION: ${location}
PRACTICE CONTEXT: ${practiceType}
AUDIENCE: ${audience}
${brandBlock}${performersBlock}
Generate exactly 5 specific, patient-focused questions that patients at this practice are likely asking this month.

Requirements:
- Each question must be concrete and specific to this type of practice
- Write from the patient's perspective (what they would actually type or say)
- Include 1-2 questions that are seasonally or time-relevant to now (May 2026)
- Make questions answerable in a short clinician video or article
- No generic questions like "What should I know about my health?"
${performersInstruction}

Return ONLY a JSON array of 5 question strings. No explanation, no preamble, no markdown.
Example format: ["Question 1?", "Question 2?", "Question 3?", "Question 4?", "Question 5?"]`
}

async function generateSuggestions(ws, topPerformers = []) {
  if (!process.env.AI_GATEWAY_API_KEY) {
    throw new Error('AI_GATEWAY_API_KEY is not set on this deployment')
  }

  const systemPrompt = buildPrompt(ws, topPerformers)

  const result = await generateText({
    model: 'anthropic/claude-sonnet-4-6',
    system: systemPrompt,
    messages: [{ role: 'user', content: 'Generate the 5 patient questions now.' }],
    maxTokens: 600,
  })

  const text = (result.text || '').trim()

  // Extract JSON array from response — handle markdown code fences if present
  const jsonMatch = text.match(/\[[\s\S]*\]/)
  if (!jsonMatch) throw new Error('AI returned unparseable response')

  const parsed = JSON.parse(jsonMatch[0])
  if (!Array.isArray(parsed)) throw new Error('AI response is not an array')

  return parsed
    .filter((q) => typeof q === 'string' && q.trim().length > 0)
    .slice(0, 5)
}

async function saveCache(wsId, suggestions) {
  const now = new Date().toISOString()
  const r = await sb(
    `workspaces?id=eq.${encodeURIComponent(wsId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        ai_topics_cache:        suggestions,
        ai_topics_generated_at: now,
      }),
    }
  )
  if (!r.ok) {
    const body = await r.text().catch(() => '')
    console.error('[topic-suggestions] cache save failed:', r.status, body)
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return err(res, 'Method not allowed', 405)
  if (!(await enforceLimit(req, res, 'ai'))) return

  const ws = await workspaceContext(req)
  if (!ws) return err(res, 'Workspace not resolved', 400)

  const url = new URL(req.url, 'http://localhost')
  const forceRefresh = url.searchParams.get('refresh') === 'true'

  // Check cache freshness
  const cacheAge = ws.ai_topics_generated_at
    ? Date.now() - new Date(ws.ai_topics_generated_at).getTime()
    : Infinity

  const cacheValid =
    !forceRefresh &&
    Array.isArray(ws.ai_topics_cache) &&
    ws.ai_topics_cache.length > 0 &&
    cacheAge < SEVEN_DAYS_MS

  if (cacheValid) {
    return ok(res, {
      suggestions:   ws.ai_topics_cache,
      generatedAt:   ws.ai_topics_generated_at,
      fromCache:     true,
    })
  }

  // Cache miss or forced refresh — call Claude
  // Fetch top performers in parallel (fire best-effort; never block on failure)
  const topPerformers = await fetchTopPerformers(ws.id)

  let suggestions
  try {
    suggestions = await generateSuggestions(ws, topPerformers)
  } catch (e) {
    console.error('[topic-suggestions] AI call failed:', e.message)
    // Serve stale cache rather than an error if we have anything
    if (Array.isArray(ws.ai_topics_cache) && ws.ai_topics_cache.length > 0) {
      return ok(res, {
        suggestions: ws.ai_topics_cache,
        generatedAt: ws.ai_topics_generated_at,
        fromCache:   true,
        stale:       true,
      })
    }
    return err(res, e.message || 'AI suggestion failed', 500)
  }

  if (suggestions.length === 0) {
    return err(res, 'AI returned no suggestions — try again', 500)
  }

  // Save to cache (fire-and-forget — don't block the response)
  saveCache(ws.id, suggestions).catch(() => {})

  return ok(res, {
    suggestions,
    generatedAt:  new Date().toISOString(),
    fromCache:    false,
    topPerformers,
  })
}

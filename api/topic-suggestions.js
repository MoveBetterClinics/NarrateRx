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

function buildPrompt(ws) {
  const practiceType = ws.clinic_context
    || ws.audience_description
    || `${ws.display_name} healthcare practice`

  const location = ws.location_keyword || ws.location || 'their local area'
  const audience = ws.audience_description || 'patients seeking healthcare'

  return `You are helping a healthcare practice generate interview topics for their clinician content marketing.

PRACTICE: ${ws.display_name}
LOCATION: ${location}
PRACTICE CONTEXT: ${practiceType}
AUDIENCE: ${audience}

Generate exactly 5 specific, patient-focused questions that patients at this practice are likely asking this month.

Requirements:
- Each question must be concrete and specific to this type of practice
- Write from the patient's perspective (what they would actually type or say)
- Include 1-2 questions that are seasonally or time-relevant to now (May 2026)
- Make questions answerable in a short clinician video or article
- No generic questions like "What should I know about my health?"

Return ONLY a JSON array of 5 question strings. No explanation, no preamble, no markdown.
Example format: ["Question 1?", "Question 2?", "Question 3?", "Question 4?", "Question 5?"]`
}

async function generateSuggestions(ws) {
  if (!process.env.AI_GATEWAY_API_KEY) {
    throw new Error('AI_GATEWAY_API_KEY is not set on this deployment')
  }

  const systemPrompt = buildPrompt(ws)

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
  let suggestions
  try {
    suggestions = await generateSuggestions(ws)
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
    generatedAt: new Date().toISOString(),
    fromCache:   false,
  })
}

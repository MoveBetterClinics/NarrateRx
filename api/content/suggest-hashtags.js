// POST /api/content/suggest-hashtags  { contentItemId: string }
// Derives 8-12 hashtag candidates from what the clinician actually said in
// the interview plus the workspace's explicit metadata. Every returned
// hashtag must be supported by a substring of the transcript or a field
// of the workspace config — no invented "broad-appeal" tags. Validation
// happens server-side before the row is updated.
//
// Stores the result on content_items.hashtag_suggestions as a JSONB array
// of { tag, source }. The editor clicks chips to add/remove from the post.
export const config = { runtime: 'nodejs', maxDuration: 60 }

import { generateText } from 'ai'
import { workspaceContext } from '../_lib/workspaceContext.js'
import { enforceLimit } from '../_lib/ratelimit.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey:        SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer:        'return=representation',
      ...init.headers,
    },
  })
}

const ok  = (res, data, status = 200) => res.status(status).json(data)
const err = (res, msg, status = 400)  => res.status(status).json({ error: msg })

// Loose substring match: lowercase + strip everything non-alphanumeric on
// both sides, then check whether the hashtag's normalized form appears in
// the supporting text. Lets "#kneepain" match a transcript containing
// "knee pain" or workspace metadata containing "Knee Pain Clinic."
function normalize(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

function tagSupportedBy(tag, supportingTexts) {
  const norm = normalize(tag.replace(/^#/, ''))
  if (norm.length < 3) return null
  for (const { source, text } of supportingTexts) {
    if (normalize(text).includes(norm)) return source
  }
  return null
}

function buildPrompt(ws, locations, transcript, condition, platform) {
  const locLines = locations.length
    ? locations.map((l) => `- ${l.name || l.city || l.id}${l.city ? ` (${l.city})` : ''}`).join('\n')
    : '(none)'

  return `You are a social media editor for ${ws.display_name}, a clinic in ${ws.location_keyword || ws.location || 'their area'}.

Suggest 8-12 hashtag candidates for a ${platform || 'social media'} post about "${condition}".

HARD CONSTRAINT: Every hashtag must be supported by EITHER (a) a substring of the interview transcript below, or (b) a field of the workspace metadata. Do NOT invent broad-appeal "boost-reach" tags like #wellness, #health, #fitness unless those exact words appear in the transcript or metadata.

Good hashtag sources:
- Condition names mentioned in the transcript (e.g., the transcript says "plantar fasciitis" → #plantarfasciitis is valid)
- Therapy or technique names actually used by the clinician
- Patient-outcome language they used ("relief", "mobility", "stronger")
- Workspace location words (city, region, neighborhood)
- Workspace clinic name or recognizable brand words

WORKSPACE METADATA:
- Clinic name: ${ws.display_name}
- Location: ${ws.location || ws.location_keyword || 'unspecified'}
- Region: ${ws.region || 'unspecified'}
- Locations on file:
${locLines}
- Audience: ${ws.audience_description || 'unspecified'}
- Clinic context: ${(ws.clinic_context || '').slice(0, 600)}

INTERVIEW TRANSCRIPT (clinician answers):
${transcript.slice(0, 6000)}

Return ONLY a JSON array, no other text. Each item shape: { "tag": "#example", "source": "transcript" | "workspace" }.
- "tag" must start with # and contain only letters/numbers (no spaces, no punctuation).
- "source" indicates which side the support came from.
- Aim for 8-12 candidates, ranked most relevant first.
- Mix condition/therapy tags (from transcript) with location/brand tags (from workspace).`
}

function parseTags(text) {
  // The model occasionally wraps the JSON in prose or a code fence. Pull
  // out the first [...] block and parse that.
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end === -1 || end <= start) return []
  try {
    const arr = JSON.parse(text.slice(start, end + 1))
    if (!Array.isArray(arr)) return []
    return arr.filter((x) => x && typeof x.tag === 'string')
  } catch {
    return []
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405)
  if (!(await enforceLimit(req, res, 'ai'))) return

  const ws = await workspaceContext(req)
  if (!ws) return err(res, 'Workspace not resolved', 400)
  const wsFilter = `workspace_id=eq.${ws.id}`

  const { contentItemId } = req.body || {}
  if (!contentItemId) return err(res, 'Missing contentItemId')

  // Fetch the content_item, scoped to this workspace.
  const itemRes = await sb(`content_items?id=eq.${contentItemId}&${wsFilter}&select=id,interview_id,topic,platform`)
  if (!itemRes.ok) return err(res, 'Database error', 500)
  const itemRows = await itemRes.json()
  const item = itemRows[0]
  if (!item) return err(res, 'Content item not found', 404)

  // Fetch the interview transcript (messages JSONB). Scope by workspace_id
  // again so a hand-crafted contentItemId can't pull a different tenant's
  // transcript through a join.
  const ivRes = await sb(`interviews?id=eq.${item.interview_id}&${wsFilter}&select=topic,messages`)
  if (!ivRes.ok) return err(res, 'Database error', 500)
  const ivRows = await ivRes.json()
  const iv = ivRows[0]
  if (!iv) return err(res, 'Interview not found', 404)

  const userText = (iv.messages || [])
    .filter((m) => m.role === 'user')
    .map((m) => m.content || '')
    .join('\n')

  // Workspace locations (best-effort — table may have no rows for some tenants).
  const locRes = await sb(`workspace_locations?${wsFilter}&select=id,name,city,state`)
  const locations = locRes.ok ? await locRes.json() : []

  const prompt = buildPrompt(ws, locations, userText, iv.topic || item.topic, item.platform)

  let text
  try {
    const result = await generateText({
      model: 'anthropic/claude-sonnet-4-6',
      system: prompt,
      messages: [{ role: 'user', content: 'Suggest hashtags now.' }],
      maxTokens: 800,
    })
    text = result.text
  } catch (e) {
    console.error('[content/suggest-hashtags] AI call failed:', e?.message)
    return err(res, e?.message || 'AI suggestion failed', 500)
  }

  const raw = parseTags(text || '')

  // The "verbatim" guarantee: every tag must trace back to a substring of
  // the transcript or a workspace metadata field. The model is well-aligned
  // to this constraint with the prompt above, but we enforce it server-side
  // so a model slip doesn't ship "#wellness" when the clinician never said
  // "wellness."
  const supportingTexts = [
    { source: 'transcript', text: userText },
    { source: 'workspace',  text: [
        ws.display_name, ws.location, ws.location_keyword, ws.region,
        ws.audience_description, ws.clinic_context, ws.brand_voice,
        ...locations.flatMap((l) => [l.name, l.city, l.state]),
      ].filter(Boolean).join(' ') },
  ]

  const seen = new Set()
  const validated = []
  for (const item of raw) {
    let tag = String(item.tag || '').trim()
    if (!tag.startsWith('#')) tag = `#${tag}`
    tag = tag.replace(/[^A-Za-z0-9#]/g, '')
    if (tag.length < 3) continue
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    const source = tagSupportedBy(tag, supportingTexts)
    if (!source) continue
    seen.add(key)
    validated.push({ tag, source })
    if (validated.length >= 12) break
  }

  if (validated.length === 0) {
    return err(res, 'No verifiable hashtags could be derived from the transcript', 422)
  }

  // Persist on the content_item so the chips survive a reload.
  const upd = await sb(`content_items?id=eq.${contentItemId}&${wsFilter}`, {
    method: 'PATCH',
    body: JSON.stringify({ hashtag_suggestions: validated }),
  })
  if (!upd.ok) {
    const body = await upd.text().catch(() => '')
    console.error(`[content/suggest-hashtags] save failed — supabase ${upd.status}: ${body.slice(0, 300)}`)
    return err(res, 'Database error', 500)
  }

  return ok(res, { suggestions: validated })
}

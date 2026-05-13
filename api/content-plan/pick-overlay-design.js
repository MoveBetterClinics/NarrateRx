// POST /api/content-plan/pick-overlay-design
//   Body: { item_id, mode: 'carousel' | 'single' }
// Returns: { slides: [{ photo_idx, template, emphasis, colorChoice, photoDim, text }] }
//
// Reads a content_item, its overlay_text, its first N media_urls (Claude sees
// them via vision), the workspace brand_style, and asks Claude to choose:
//   - mode='carousel': one slide per filled overlay element (hook/subhead/cta),
//                      using a solo template (combined=false).
//   - mode='single':   one combined slide, using a combined template
//                      (combined=true), with all elements rendered together.
//
// The renderer (src/lib/overlayTemplates.js) consumes the slides array.

export const config = { runtime: 'nodejs', maxDuration: 60 }

import { generateObject } from 'ai'
import { z } from 'zod'
import { workspaceContext } from '../_lib/workspaceContext.js'
import { enforceLimit } from '../_lib/ratelimit.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const MODEL = 'anthropic/claude-sonnet-4-6'

const SOLO_TEMPLATES = ['bold_centered', 'split_block', 'minimal_corner', 'cta_pill']
const COMBINED_TEMPLATES = ['bottom_stack', 'centered_dramatic']

const TEMPLATE_DESCRIPTIONS = {
  bold_centered:     'Photo darkened, single line of large bold text centered. Strong for hook/myth-buster posts. Works on any photo.',
  split_block:       'Photo top half, solid-color block (brand accent or white) bottom half with bold text. Editorial feel. Best when photo subject is in the top half.',
  minimal_corner:    'Photo full-bleed with subtle gradient at bottom, smaller text bottom-left. Use when the photo is the message and text supports it.',
  cta_pill:          'Full-bleed photo with prominent brand-color CTA pill button centered low. CTA-only slides.',
  bottom_stack:      'All three elements stacked at bottom with gradient — hook (largest), subhead, CTA pill. The classic combined layout.',
  centered_dramatic: 'All three elements centered vertically, heavier photo dim, accent-color CTA pill. High-impact "stop scrolling" combined layout.',
}

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

const slideSchema = z.object({
  photo_idx:    z.number().int().min(0),
  template:     z.string(),
  emphasis:     z.enum(['hook', 'subhead', 'cta', 'combined']),
  colorChoice:  z.enum(['accent', 'white']).optional(),
  photoDim:     z.number().min(0).max(1).optional(),
})

const designSchema = z.object({
  slides: z.array(slideSchema).min(1).max(3),
  reasoning: z.string().optional(),
})

export default async function handler(req, res) {
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405)
  if (!(await enforceLimit(req, res, 'ai'))) return

  const ws = await workspaceContext(req)
  if (!ws) return err(res, 'Workspace not resolved', 400)
  const wsFilter = `workspace_id=eq.${ws.id}`

  const { item_id, mode } = req.body || {}
  if (!item_id) return err(res, 'Missing item_id')
  if (!['carousel', 'single'].includes(mode)) return err(res, 'mode must be carousel or single')

  const r = await sb(`content_items?id=eq.${item_id}&${wsFilter}&select=platform,content,overlay_text,media_urls`)
  if (!r.ok) return err(res, 'Could not load content item', 500)
  const rows = await r.json()
  const item = rows[0]
  if (!item) return err(res, 'Content item not found', 404)
  if (item.platform !== 'instagram') return err(res, 'Design picker only supports Instagram for now')

  const overlay = item.overlay_text || {}
  const filled = ['hook', 'subhead', 'cta'].filter((k) => overlay[k]?.trim())
  if (filled.length === 0) return err(res, 'No overlay text to design around — fill at least one field')

  const photos = (item.media_urls || []).filter((m) => m?.type !== 'video' && m?.url)
  if (photos.length === 0) return err(res, 'No photos to design around — attach at least one image')

  const brandStyle = ws.brand_style || {}

  // Build the user message: text instructions + each photo as a vision input.
  const visionParts = photos.slice(0, 3).map((p, i) => ([
    { type: 'text', text: `Photo ${i}:` },
    { type: 'file', data: p.url, mediaType: p.mime_type || 'image/jpeg' },
  ])).flat()

  const filledList = filled.map((k) => `- ${k.toUpperCase()}: "${overlay[k]}"`).join('\n')
  const allowedTemplates = mode === 'carousel' ? SOLO_TEMPLATES : COMBINED_TEMPLATES
  const templateBlock = allowedTemplates.map((t) => `- ${t}: ${TEMPLATE_DESCRIPTIONS[t]}`).join('\n')

  const carouselGuidance = `You are picking ONE slide per filled overlay element. Output one slide for each of: ${filled.join(', ')}.
For each slide, choose:
  - photo_idx: which photo (0-indexed) best fits this element. Distribute photos thoughtfully if you have multiple. If only one photo is available, reuse it.
  - template: one of [${allowedTemplates.join(', ')}]. Use cta_pill for cta slides when a photo works well as backdrop. Use split_block when subject is in the top half. Use minimal_corner when the photo is striking and text should support it.
  - emphasis: the element name (${filled.join(' | ')}).
  - colorChoice: 'accent' for branded color, 'white' for clean look. Pick based on what reads well on the chosen photo.
  - photoDim: 0.3 (light) to 0.7 (heavy). Brighter photos need more dim; already-dark photos need less.`

  const singleGuidance = `You are picking ONE combined slide that renders all filled overlay elements together. Output exactly one slide.
  - photo_idx: pick the strongest single photo (usually 0).
  - template: one of [${allowedTemplates.join(', ')}].
  - emphasis: 'combined'.
  - colorChoice: 'accent' or 'white' depending on what reads well on the photo.
  - photoDim: 0.5–0.8 for legibility behind stacked text.`

  const systemPrompt = `You are a design director choosing layout for an Instagram post for ${ws.display_name}.
Pick the layout(s) that will perform best given the photos provided and the overlay text. Be decisive — don't pad with explanation. The "reasoning" field is one short sentence max.

Brand style:
  - Accent color: ${brandStyle.accent_color || '(none set, defaults will be used)'}
  - Heading font: ${brandStyle.heading_font || '(default)'}
  - Body font: ${brandStyle.body_font || '(default)'}

Filled overlay text:
${filledList}

Available templates (you MUST pick from this list):
${templateBlock}

${mode === 'carousel' ? carouselGuidance : singleGuidance}`

  try {
    const { object } = await generateObject({
      model: MODEL,
      schema: designSchema,
      system: systemPrompt,
      messages: [{ role: 'user', content: [
        { type: 'text', text: 'Here are the available photos. Pick the best design for this post:' },
        ...visionParts,
      ] }],
      temperature: 0.3,
    })

    // Validate templates are in the allowed set; clamp photo_idx to available
    // photos. Defensive — the schema lets through any string for template name.
    const slides = object.slides
      .filter((s) => allowedTemplates.includes(s.template))
      .map((s) => ({
        photo_idx:   Math.min(s.photo_idx, photos.length - 1),
        template:    s.template,
        emphasis:    s.emphasis,
        colorChoice: s.colorChoice || 'accent',
        photoDim:    s.photoDim ?? 0.5,
        text:        s.emphasis === 'combined' ? overlay : overlay[s.emphasis],
        sourceUrl:   photos[Math.min(s.photo_idx, photos.length - 1)].url,
      }))
      .filter((s) => s.text && (typeof s.text === 'string' ? s.text.trim() : Object.values(s.text).some(Boolean)))

    if (slides.length === 0) {
      return err(res, 'Picker returned no usable slides — try again or check your overlay text', 502)
    }

    return ok(res, { slides, reasoning: object.reasoning || '' })
  } catch (e) {
    console.error('[pick-overlay-design]', e?.message || e)
    return err(res, e?.message || 'Design picker failed', 500)
  }
}

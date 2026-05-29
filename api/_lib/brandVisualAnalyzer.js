// Brand visual identity analyzer — Phase 2 Day 9 of the 30-day video output build.
//
// Analyzes a sample of a workspace's photos using Claude Vision to extract:
//   • dominant color palette (for auto-calibrating brand overlay colors)
//   • lighting style and mood
//   • composition patterns (what's typically in the frame)
//   • subject matter (the clinical activities depicted)
//   • brand personality adjectives
//   • recommended overlay opacity
//
// The result is stored in workspaces.brand_visual_identity (jsonb) and used by
// the Phase 3 Story Director to improve automated render quality.
//
// Architecture:
//   1. Fetch top-N photo thumbnails from media_assets (thumbnail_url, ~15-40KB each)
//   2. Download thumbnails into memory as ArrayBuffers
//   3. Send to Claude Vision in batches of BATCH_SIZE
//   4. Parse structured JSON from each response
//   5. Aggregate across batches → final identity object

import { generateText } from 'ai'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// Thumbnails are 320×320 JPEG, typically 10-40KB each.
// 10 per batch × 40KB = 400KB — well under the AI Gateway 20MB cap.
const BATCH_SIZE = 10
const DEFAULT_SAMPLE_SIZE = 20
const ANALYSIS_MODEL = 'anthropic/claude-sonnet-4-5'

async function sb(path, init = {}) {
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

/**
 * Fetch a sample of photo assets with thumbnails from the workspace.
 * Prioritises assets that have been AI-tagged (richer context) and have thumbnails.
 */
async function fetchSamplePhotos(workspaceId, limit) {
  const url = `media_assets?workspace_id=eq.${workspaceId}&kind=eq.photo&archived_at=is.null` +
    `&thumbnail_url=not.is.null&select=id,thumbnail_url,filename,visual_narrative,ai_tags` +
    `&order=created_at.desc&limit=${limit}`
  const res = await sb(url)
  if (!res.ok) throw new Error(`Failed to fetch photos: ${res.status}`)
  return await res.json()
}

/**
 * Download a thumbnail URL and return its ArrayBuffer.
 * Throws if the response is not 2xx or the file is too large.
 */
async function downloadThumbnail(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`Thumbnail fetch ${res.status}: ${url}`)
  const buf = await res.arrayBuffer()
  if (buf.byteLength > 200 * 1024) {
    // Safety: thumbnails should be <40KB; if one is unusually large, skip it.
    throw new Error(`Thumbnail too large (${buf.byteLength} bytes): ${url}`)
  }
  return buf
}

const BATCH_PROMPT = `Analyze these clinical practice photos and return a JSON object with EXACTLY these fields:

{
  "dominantColors": ["#rrggbb", ...],           // 3-5 most common hex colors across ALL photos
  "colorPalette": {
    "background": "#rrggbb",                    // dominant background/wall/table color
    "foreground": "#rrggbb",                    // clinician clothing or main subject color
    "accent": "#rrggbb"                         // recurring accent (scrubs, logo, equipment)
  },
  "lightingStyle": "string",                    // e.g. "warm natural window light, soft shadows"
  "compositionPatterns": ["string", ...],       // 2-4 common framing patterns observed
  "subjectMatter": ["string", ...],             // 2-4 clinical activities depicted
  "brandPersonality": ["string", ...],          // 3-5 adjectives describing the visual feel
  "recommendedOverlayOpacity": 0.88            // 0.70–0.95 — how opaque the caption band should be
                                               // (higher for light/busy backgrounds)
}

Rules:
- Return ONLY valid JSON, no markdown fences, no commentary.
- All color values must be valid 6-digit hex strings (#rrggbb).
- recommendedOverlayOpacity must be a number between 0.70 and 0.95.
- If a field cannot be determined, use a reasonable default rather than null.`

/**
 * Analyze one batch of photos with Claude Vision.
 * Returns a parsed partial identity object (may be missing some fields if the model
 * returned malformed JSON — callers should merge defensively).
 */
async function analyzeBatch(photoBuffers) {
  const imageContent = photoBuffers.map((buf) => ({
    type: 'image',
    image: buf,           // ArrayBuffer — AI SDK v6 accepts this natively
    mimeType: 'image/jpeg',
  }))

  const { text } = await generateText({
    model: ANALYSIS_MODEL,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: BATCH_PROMPT },
        ...imageContent,
      ],
    }],
    maxOutputTokens: 400,
  })

  // Strip any accidental markdown code fences
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    return JSON.parse(cleaned)
  } catch (e) {
    console.error('[brandVisualAnalyzer] JSON parse failed:', e.message, '| raw:', cleaned.slice(0, 200))
    return {}
  }
}

/**
 * Merge multiple partial identity objects from batch analyses into one final object.
 * Arrays are deduplicated and trimmed; scalar fields use the first non-null value.
 */
function mergeIdentities(partials) {
  const merged = {
    dominantColors: [],
    colorPalette: { background: null, foreground: null, accent: null },
    lightingStyle: null,
    compositionPatterns: [],
    subjectMatter: [],
    brandPersonality: [],
    recommendedOverlayOpacity: null,
  }

  for (const p of partials) {
    if (Array.isArray(p.dominantColors)) {
      merged.dominantColors.push(...p.dominantColors)
    }
    if (p.colorPalette) {
      merged.colorPalette.background ??= p.colorPalette.background
      merged.colorPalette.foreground ??= p.colorPalette.foreground
      merged.colorPalette.accent     ??= p.colorPalette.accent
    }
    merged.lightingStyle ??= p.lightingStyle
    if (Array.isArray(p.compositionPatterns)) {
      merged.compositionPatterns.push(...p.compositionPatterns)
    }
    if (Array.isArray(p.subjectMatter)) {
      merged.subjectMatter.push(...p.subjectMatter)
    }
    if (Array.isArray(p.brandPersonality)) {
      merged.brandPersonality.push(...p.brandPersonality)
    }
    merged.recommendedOverlayOpacity ??= p.recommendedOverlayOpacity
  }

  // Deduplicate + cap array lengths
  const dedupe = (arr, max) => [...new Set(arr.filter(Boolean))].slice(0, max)
  merged.dominantColors    = dedupe(merged.dominantColors, 6)
  merged.compositionPatterns = dedupe(merged.compositionPatterns, 6)
  merged.subjectMatter     = dedupe(merged.subjectMatter, 6)
  merged.brandPersonality  = dedupe(merged.brandPersonality, 6)

  // Fallback defaults
  merged.lightingStyle ??= 'natural light, clinical setting'
  merged.recommendedOverlayOpacity ??= 0.88
  merged.colorPalette.background ??= '#f5f0e8'
  merged.colorPalette.foreground ??= '#1a3a5c'
  merged.colorPalette.accent     ??= '#83957C'

  return merged
}

/**
 * Run the full brand visual identity analysis for a workspace.
 *
 * @param {string} workspaceId
 * @param {number} [sampleSize=20] — number of photos to sample
 * @returns {Promise<Object>} brand_visual_identity object ready to store in the DB
 */
export async function analyzeBrandVisuals({ workspaceId, sampleSize = DEFAULT_SAMPLE_SIZE }) {
  // 1. Fetch sample photos
  const photos = await fetchSamplePhotos(workspaceId, sampleSize)
  if (!photos.length) {
    throw new Error('No photos with thumbnails found in this workspace')
  }

  // 2. Download thumbnails (best-effort — skip any that fail)
  const photoBuffers = []
  for (const photo of photos) {
    try {
      const buf = await downloadThumbnail(photo.thumbnail_url)
      photoBuffers.push(buf)
    } catch (e) {
      console.warn(`[brandVisualAnalyzer] skipping ${photo.id}: ${e.message}`)
    }
  }

  if (!photoBuffers.length) {
    throw new Error('All thumbnail downloads failed')
  }

  // 3. Analyse in batches
  const partials = []
  for (let i = 0; i < photoBuffers.length; i += BATCH_SIZE) {
    const batch = photoBuffers.slice(i, i + BATCH_SIZE)
    try {
      const result = await analyzeBatch(batch)
      if (Object.keys(result).length) partials.push(result)
    } catch (e) {
      console.error(`[brandVisualAnalyzer] batch ${i / BATCH_SIZE + 1} failed:`, e.message)
    }
  }

  if (!partials.length) {
    throw new Error('All analysis batches failed')
  }

  // 4. Merge + stamp metadata
  const identity = mergeIdentities(partials)
  identity.analysisTimestamp = new Date().toISOString()
  identity.sampleCount = photoBuffers.length
  identity.model = ANALYSIS_MODEL

  return identity
}

-- Migration 089: brand_visual_identity column on workspaces
--
-- Stores the results of the Phase 2 Day 9 brand visual identity analysis.
-- Populated by POST /api/workspace/extract-brand-visual (owner/admin only)
-- and the companion one-time backfill script.
--
-- Schema (JSONB):
--   {
--     "dominantColors":          string[],  // top hex colors across sample photos
--     "colorPalette":            { background, foreground, accent },
--     "lightingStyle":           string,    // e.g. "warm natural window light"
--     "compositionPatterns":     string[],  // common framing / subject patterns
--     "subjectMatter":           string[],  // what's typically depicted
--     "brandPersonality":        string[],  // adjectives describing the visual feel
--     "recommendedOverlayOpacity": number, // 0.0–1.0 suggested caption band opacity
--     "analysisTimestamp":       string,    // ISO-8601
--     "sampleCount":             number,
--     "model":                   string
--   }

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS brand_visual_identity jsonb;
-- Applied to prod 2026-05-27 via Supabase SQL Editor before code deploy.

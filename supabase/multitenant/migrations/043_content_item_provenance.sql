-- 043_content_item_provenance.sql
--
-- Adds the voice-fidelity substrate for P0-A / P0-C / P0-G:
--   * provenance jsonb — per-block source mapping (paragraph → transcript span)
--                        plus an aggregate summary (verbatim_pct / paraphrase_pct
--                        / synthesis_pct + source + computed_at).
--
-- Shape (v1, paragraph-level):
--   {
--     "version": 1,
--     "granularity": "paragraph",
--     "blocks": [
--       { "ordinal": N, "text_prefix": "…", "source_type": "verbatim|close_paraphrase|synthesis",
--         "source_msg_index": N | null, "source_span": [start, end] | null,
--         "confidence": 0..1 | null }
--     ],
--     "summary": {
--       "verbatim_pct": 0..100,
--       "paraphrase_pct": 0..100,
--       "synthesis_pct": 0..100,
--       "computed_at": "ISO-8601",
--       "source": "model_emit_validated|algorithmic_fallback|algorithmic_backfill"
--     }
--   }
--
-- The GIN index supports reverse-direction queries used by P0-G (Themes view):
--   "find all content_items that quote span X of interview I" via
--   provenance @> '{"blocks":[{"source_msg_index": N}]}' + interview_id filter.

ALTER TABLE public.content_items
  ADD COLUMN IF NOT EXISTS provenance jsonb;

CREATE INDEX IF NOT EXISTS content_items_provenance_gin
  ON public.content_items USING gin (provenance);

-- service_role already holds rights on content_items from earlier migrations,
-- but per CLAUDE.md migrations must be self-sufficient.
GRANT SELECT, UPDATE ON public.content_items TO service_role;

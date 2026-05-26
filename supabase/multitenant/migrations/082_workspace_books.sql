-- Migration 082 — workspace_books (auto-synthesized long-form manuscript per workspace)
--
-- Each workspace gets one continuously-updated "book" — a long-form markdown
-- manuscript synthesized from the workspace's ORIGINAL source material:
--
--   - interviews (status='completed') — both capture_mode='interview' and
--     capture_mode='voice_memo' rows; voice memos are just interviews with a
--     different ingest path
--   - clinician_corpus_documents (doc_type IN ('original_blog','uploaded_draft'))
--
-- Atoms and NarrateRx-generated blog posts are NEVER fed into the book —
-- only the clinician's own raw substrate. The synthesis pass is the only
-- AI step in the loop; the book is "as if the practice wrote it together",
-- with no per-clinician attribution.
--
-- book_mode discriminates the UI/source behavior:
--   group    — workspace has multiple contributing clinicians (Move Better
--              People, Equine, Animals). Write page hidden. Book reads as
--              one collective voice.
--   personal — workspace has a single contributor (Qbook, Studio). Write
--              page stays. Book is single-voice by construction.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. workspaces.book_mode
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS book_mode text NOT NULL DEFAULT 'personal';

ALTER TABLE public.workspaces
  DROP CONSTRAINT IF EXISTS workspaces_book_mode_check;

ALTER TABLE public.workspaces
  ADD CONSTRAINT workspaces_book_mode_check
  CHECK (book_mode IN ('group', 'personal'));

-- Seed the three Move Better workspaces as group books. Qbook and Studio
-- stay 'personal' (column default). New workspaces default to 'personal';
-- onboarding can flip the flag for multi-clinician practices later.
UPDATE public.workspaces
   SET book_mode = 'group'
 WHERE slug IN ('movebetter-people', 'movebetter-equine', 'movebetter-animals');

-- ─────────────────────────────────────────────────────────────────────────
-- 2. workspace_books — one row per workspace, lazily created on first regen
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.workspace_books (
  workspace_id   uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,

  -- Full manuscript markdown — NULL until the first successful regen.
  -- The synthesis pass emits this from the chapters[] array below by
  -- concatenating chapter_md in order; the manuscript_md column is a
  -- denormalized convenience for the read endpoint and exports.
  manuscript_md  text,

  -- Structured chapters for per-chapter operations (pin, exclude, reorder).
  -- Shape: [{ slug: text, title: text, body_md: text, position: int }]
  --   slug          — stable machine id used to match against book_pinned_chapters
  --   title         — chapter heading as rendered
  --   body_md       — chapter body markdown (without the heading)
  --   position      — 0-indexed order in the manuscript at last regen
  chapters       jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Counts of inputs woven into the current manuscript. Shape:
  --   { interviews: N, voice_memos: N, original_blogs: N, uploaded_drafts: N }
  -- Rendered in the UI as the neutral provenance line; no per-clinician
  -- attribution is stored.
  source_counts  jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Lifecycle
  last_regen_at  timestamptz,
  stale_at       timestamptz,                            -- set by ingest hooks
  regen_status   text NOT NULL DEFAULT 'idle',
  regen_error    text,
  regen_run_id   uuid,                                   -- correlates a running
                                                        -- regen with logs/UI
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT workspace_books_regen_status_check
    CHECK (regen_status IN ('idle', 'regenerating', 'error'))
);

CREATE INDEX IF NOT EXISTS workspace_books_stale_idx
  ON public.workspace_books (stale_at)
  WHERE stale_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.workspace_books_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS workspace_books_updated_at ON public.workspace_books;
CREATE TRIGGER workspace_books_updated_at
  BEFORE UPDATE ON public.workspace_books
  FOR EACH ROW EXECUTE FUNCTION public.workspace_books_set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- 3. book_excluded_sources — admin escape hatch: "don't feed the book"
-- ─────────────────────────────────────────────────────────────────────────
--
-- Polymorphic FK by (source_table, source_id). The synthesis source pull
-- subtracts rows in this table before sending to the model.

CREATE TABLE IF NOT EXISTS public.book_excluded_sources (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,

  source_table   text NOT NULL,
  source_id      uuid NOT NULL,

  excluded_at    timestamptz NOT NULL DEFAULT now(),
  excluded_by    text,                                  -- clerk user id (string)
  reason         text,

  CONSTRAINT book_excluded_sources_table_check
    CHECK (source_table IN ('interviews', 'clinician_corpus_documents')),
  CONSTRAINT book_excluded_sources_unique
    UNIQUE (workspace_id, source_table, source_id)
);

CREATE INDEX IF NOT EXISTS book_excluded_sources_workspace_idx
  ON public.book_excluded_sources (workspace_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 4. book_pinned_chapters — admin escape hatch: "don't re-roll this chapter"
-- ─────────────────────────────────────────────────────────────────────────
--
-- Pinned chapters are spliced back into the manuscript verbatim on every
-- regen. position_hint is a best-effort restoration anchor — if the
-- synthesizer's new chapter set diverges, pinned chapters are appended
-- at the end.

CREATE TABLE IF NOT EXISTS public.book_pinned_chapters (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,

  chapter_slug   text NOT NULL,
  chapter_title  text NOT NULL,
  chapter_md     text NOT NULL,
  position_hint  integer,

  pinned_at      timestamptz NOT NULL DEFAULT now(),
  pinned_by      text,

  CONSTRAINT book_pinned_chapters_unique
    UNIQUE (workspace_id, chapter_slug)
);

CREATE INDEX IF NOT EXISTS book_pinned_chapters_workspace_idx
  ON public.book_pinned_chapters (workspace_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Grants — every new table must grant service_role per CLAUDE.md
-- ─────────────────────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_books        TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.book_excluded_sources  TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.book_pinned_chapters   TO service_role;

GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;

COMMIT;

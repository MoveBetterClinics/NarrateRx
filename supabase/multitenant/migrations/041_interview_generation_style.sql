ALTER TABLE public.interviews
  ADD COLUMN IF NOT EXISTS generation_style TEXT NOT NULL DEFAULT 'blog_post'
  CONSTRAINT interviews_generation_style_check
    CHECK (generation_style IN ('blog_post', 'minimal_edits'));
-- No GRANT block needed: service_role already holds DML on public.interviews (migration 003).
-- ALTER TABLE inherits those grants on the new column.

-- 070_movebetter_publish_topics_expansion.sql
--
-- Expands workspaces.publish_topics for the movebetter-people workspace
-- from the original 6-value seed (set in 018_workspace_publish_topics.sql)
-- to the 20-value taxonomy that the movebetter.co site now enforces via
-- z.enum on its blog content collection (see Movebetterco PR #48 →
-- src/content.config.ts).
--
-- Why: NarrateRx-generated posts used to land in "chronic-pain" or
-- "general" by default because nothing else fit. The expanded list lets
-- the generator pick a meaningful slot (assessment, surgery-alternatives,
-- low-back-pain, etc.) and matches the filter pills on /go-deeper.
--
-- This UPDATE is unconditional — the receiving site now rejects any
-- value not in this list, so the workspace's stored topics MUST match
-- the site enum exactly. If a future taxonomy change ships, the order
-- of operations is:
--   1. Ship the site enum change (z.enum in src/content.config.ts)
--   2. Ship a new migration here that mirrors it
--   3. Update NarrateRx admin UI if needed
-- Drift in either direction breaks publishing.
--
-- Idempotent: re-running just rewrites the same value.

UPDATE public.workspaces
SET publish_topics = '[
  "breathing",
  "bracing",
  "hinging",
  "assessment",
  "pain-science",
  "chronic-pain",
  "low-back-pain",
  "neck-pain",
  "knee-pain",
  "postpartum",
  "injury-recovery",
  "surgery-alternatives",
  "recovery",
  "movement-mechanics",
  "strength-training",
  "running",
  "nutrition",
  "mindset",
  "healthcare-system",
  "general"
]'::jsonb
WHERE slug = 'movebetter-people';

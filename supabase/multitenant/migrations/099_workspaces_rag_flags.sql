-- V6 RAG fusion flags. Both default false so rollout is behind a flag per
-- workspace. Flip rag_fusion_enabled first, then rag_hot_tier_enabled once
-- the fusion-layer eval looks clean.
--
-- rag_fusion_enabled   — activates fetchFusedRagContext() in generate-package
-- rag_hot_tier_enabled — replaces buildOwnHistoryBlock with topic-scoped RAG
--                        in all generation handlers that inject practice memory

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS rag_fusion_enabled   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rag_hot_tier_enabled  boolean NOT NULL DEFAULT false;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspaces TO service_role;

-- Geo-local topic intelligence cache (PR: feat/geo-local-topics).
--
-- Adds two columns to workspaces to cache AI-generated patient question
-- suggestions per workspace. The API endpoint regenerates the cache when
-- ai_topics_generated_at is older than 7 days or when ?refresh=true.
--
-- Kept separate from the editorial topic_suggestions JSONB (which stores
-- curated { topic, category, priority, keywords[], pnwNote } objects used
-- by the New Interview topic picker).

alter table workspaces
  add column if not exists ai_topics_cache         jsonb    default '[]'::jsonb,
  add column if not exists ai_topics_generated_at  timestamptz;

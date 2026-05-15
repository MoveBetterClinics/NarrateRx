-- Stores AI-extracted brand guidelines from the assigned brand book PDF.
-- Populated automatically when a brand_book asset is uploaded (extraction runs
-- in the onUploadCompleted webhook) and re-synced whenever a new brand book is
-- assigned via PUT /api/brand-kit/roles/brand_book.
-- Content-generation prompts read this column from the workspace row so they
-- don't need a separate brand-kit query before each generation.
alter table public.workspaces
  add column if not exists brand_guidelines text;

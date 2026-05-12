-- Content plan atoms: one row per (interview × platform × angle × slot).
-- Created (status='pending') automatically when a blog post is first saved.
-- Status lifecycle: pending → drafting → drafted (content_piece_id set)
--                                      → skipped (user dismissed)

CREATE TABLE public.content_plan_atoms (
  id                uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id      uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  interview_id      uuid        NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  platform          text        NOT NULL,
  slot              integer     NOT NULL DEFAULT 1,
  angle             text        NOT NULL,
  angle_label       text        NOT NULL,
  angle_description text,
  status            text        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'drafting', 'drafted', 'skipped')),
  content_piece_id  uuid        REFERENCES content_items(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_plan_atoms TO service_role;

CREATE INDEX content_plan_atoms_interview_idx
  ON public.content_plan_atoms (interview_id);
CREATE INDEX content_plan_atoms_workspace_status_idx
  ON public.content_plan_atoms (workspace_id, status);

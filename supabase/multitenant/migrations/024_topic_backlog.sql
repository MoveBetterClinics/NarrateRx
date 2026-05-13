-- Strategic topic backlog — a prioritized queue of interview topics per workspace.
-- Rows are either AI-suggested (paradigm + coverage-gap aware) or manually
-- added by the clinician. Status flows: pending → in_progress → completed,
-- with archived as a terminal state for "won't do."

CREATE TABLE public.topic_backlog (
  id            uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id  uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  topic         text        NOT NULL,
  rationale     text,
  source        text        NOT NULL DEFAULT 'manual'
                CHECK (source IN ('manual', 'ai_suggested')),
  priority      integer     NOT NULL DEFAULT 50,
  status        text        NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'in_progress', 'completed', 'archived')),
  interview_id  uuid        REFERENCES interviews(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.topic_backlog TO service_role;

CREATE INDEX topic_backlog_workspace_status_idx
  ON public.topic_backlog (workspace_id, status, priority DESC, created_at DESC);

-- Campaigns: workspace-scoped goal clusters that group interviews around a theme.
-- A campaign names which clinicians it expects to hear from (`target_clinician_ids`).
-- Interviews can be tagged with `campaign_id` to count toward a campaign's progress.

CREATE TABLE public.campaigns (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name                  text NOT NULL,
  description           text,
  status                text NOT NULL DEFAULT 'active' CHECK (status IN ('active','complete','archived')),
  target_clinician_ids  uuid[] NOT NULL DEFAULT '{}',
  created_by            text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX campaigns_workspace_idx ON public.campaigns (workspace_id, status);

CREATE TRIGGER update_campaigns_updated_at
  BEFORE UPDATE ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.interviews
  ADD COLUMN IF NOT EXISTS campaign_id uuid REFERENCES public.campaigns(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS interviews_campaign_idx
  ON public.interviews (workspace_id, campaign_id)
  WHERE campaign_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaigns TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.interviews TO service_role;

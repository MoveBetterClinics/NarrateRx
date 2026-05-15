-- Phase 4 (Phase A) — Self-deepening vertical context.
--
-- The workspace knowledge graph that auto-deepens from approved content and
-- completed interviews. Replaces (over time) the static workspaces.patient_context,
-- workspaces.interview_context, and workspaces.topic_suggestions reads at
-- prompt-assembly time with a per-topic retrieval call.
--
-- - workspace_concepts: durable, weighted concept records per workspace.
-- - concept_mentions:   every observation of a concept (interview turn, approved
--                       content, accepted/rejected edit) with weight delta.
--
-- See .claude/development-roadmap-phase-4.md for the full plan.

create extension if not exists pg_trgm;

-- ── workspace_concepts ───────────────────────────────────────────────────────
create table if not exists public.workspace_concepts (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,

  -- Coarse categorization mirrors the existing JSONB shape on workspaces:
  --   archetype  → patient_context.prototypes / staff archetypes
  --   condition  → interview_context.conditions
  --   paradigm   → paradigm phrases (movement-first framing, etc.)
  --   value      → practice values / philosophy statements
  --   objection  → common patient objections / hesitations
  kind                text   not null check (kind in ('archetype','condition','paradigm','value','objection')),
  label               text   not null,
  aliases             text[] not null default '{}',

  evidence_count      integer not null default 0,
  weight              numeric not null default 1.0,

  first_seen_at       timestamptz not null default now(),
  last_seen_at        timestamptz not null default now(),
  last_reinforced_at  timestamptz not null default now()
);

-- One concept per (workspace, kind, lowercased label) so the extractor can
-- safely UPSERT on dedupe.
create unique index if not exists workspace_concepts_unique_label
  on public.workspace_concepts (workspace_id, kind, lower(label));

create index if not exists workspace_concepts_workspace_kind
  on public.workspace_concepts (workspace_id, kind);

-- Fuzzy label lookup for the extractor's dedupe step (similarity()).
create index if not exists workspace_concepts_label_trgm
  on public.workspace_concepts using gin (label gin_trgm_ops);

-- ── concept_mentions ─────────────────────────────────────────────────────────
create table if not exists public.concept_mentions (
  id            uuid primary key default gen_random_uuid(),
  concept_id    uuid not null references public.workspace_concepts(id) on delete cascade,

  -- Denormalized for cheap workspace-scoped queries without a join.
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,

  source_kind   text not null check (source_kind in ('interview_turn','content_item','approved_edit','rejected_edit')),
  source_id     uuid,                        -- nullable: interview_turn refs a row inside cleaned_messages, not a table PK
  clinician_id  uuid references public.clinicians(id) on delete set null,

  weight_delta  numeric not null default 1.0,
  excerpt       text,
  created_at    timestamptz not null default now()
);

create index if not exists concept_mentions_concept
  on public.concept_mentions (concept_id, created_at desc);

create index if not exists concept_mentions_workspace
  on public.concept_mentions (workspace_id, created_at desc);

create index if not exists concept_mentions_source
  on public.concept_mentions (source_kind, source_id);

create index if not exists concept_mentions_clinician
  on public.concept_mentions (clinician_id) where clinician_id is not null;

-- Idempotency: extractor must not double-insert the same source for the same
-- concept. NULL source_id is allowed (interview turn fingerprint can vary).
create unique index if not exists concept_mentions_dedupe
  on public.concept_mentions (concept_id, source_kind, source_id)
  where source_id is not null;

-- ── Service-role grants (per CLAUDE.md migration rule) ───────────────────────
grant select, insert, update, delete on public.workspace_concepts to service_role;
grant select, insert, update, delete on public.concept_mentions   to service_role;

-- All public sequences (covers any future serial cols on these tables and is
-- the same blanket grant migration 003 uses).
grant usage on all sequences in schema public to service_role;

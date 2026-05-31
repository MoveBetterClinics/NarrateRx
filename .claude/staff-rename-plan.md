# Clinician → Staff Full Rename (Option C) — Phased Plan

**Status:** Phase 0 complete (this doc). Awaiting owner sign-off to execute.
**Date:** 2026-05-29
**Decision basis:** Owner chose Option C (full physical rename) + the four scoping/strategy decisions below.

---

## 1. Locked decisions

| # | Decision | Choice |
|---|---|---|
| Q1 | Entity name & the "staff" collision | **`staff`** for the roster entity; rename the pre-existing authZ grouping `STAFF_ROLES`/`isStaff` → `EDITOR_ROLES`/`isEditor` to free the word. |
| Q2 | Scope of the word "clinician" | **Keep "Clinician" as a permission ROLE/classification value** (`ROLE_CLINICIAN`, `TIER_CLINICIAN`, `permission_tier`, `staff_type`, `speaker_role`, `roleLabel`). Rename only the *entity*. |
| Q3 | Published prose / blog / domain comments | **Leave as-is** (clinician = correct English about the profession). |
| Strategy | DB rollout | **Coordinated flip + backward-compat views.** One rename migration (instant/transactional) + updatable views over the 4 renamed tables. Build all entity code in branches, apply migration to prod, merge code immediately (~2-min auto-deploy window where column-level `clinician_id` refs can 500; done at low traffic with an instant rename-back rollback ready). |

### Revised acceptance criteria (supersedes the original "grep returns zero")
- The **entity** "clinician" appears nowhere: no table/column/constraint/index/function-name, no code identifier, no route, no entity UI label.
- "clinician" **legitimately survives** as: (a) permission role/tier/`staff_type`/`speaker_role` VALUES + their labels; (b) published prose/blog/marketing HTML; (c) historical migration files (`supabase/multitenant/migrations/0*.sql` — a changelog of what was applied; **not rewritten**).
- Old `/clinician/:id` URLs redirect to `/staff/:id`.
- All DoD gates green (typecheck, lint ratchet 0, build, `verify-bundles`); app exercised in-browser; E2E specs updated.

---

## 2. Authoritative surface (measured against live prod `wrqfrjhevkbbheymzezy`, 2026-05-29)

### DB objects to RENAME (entity)
**Tables (4):** `clinicians`→`staff`, `clinician_recipes`→`staff_recipes`, `clinician_voice_phrases`→`staff_voice_phrases`, `clinician_corpus_documents`→`staff_corpus_documents`. *(Target names confirmed free of collisions.)*

**Columns `clinician_id`→`staff_id` (12 tables):** `staff_recipes`, `staff_voice_phrases`, `staff_corpus_documents`, `interviews`, `content_items` (+ `clinician_name`→`staff_name`), `media_assets`, `concept_mentions`, `story_packages`, **`video_segments`** *(discovered — added by the multi-clip video feature; NOT in the original spec)*, `visual_memory_chunks`, `practice_memory_chunks`, `workspace_onboarding_interviews`. Plus `campaigns.target_clinician_ids`→`target_staff_ids` (uuid[]).

**Constraints (Postgres does NOT auto-rename on table/column rename):** 12 `*_clinician_id_fkey`, 4 pkeys, 4 workspace_id fkeys, 2 CHECK names on `staff` (`clinicians_permission_tier_check`, `clinicians_staff_type_check` — values kept, names changed), plus `book_excluded_sources_table_check` (stores the literal string `'clinician_corpus_documents'` — **drop/recreate + UPDATE rows**).

**Indexes (17 with "clinician" in the name)** → renamed; index DEFINITIONS auto-track the renamed column, so 3 indexes whose names lack "clinician" (`ccd_workspace_idx`, `interviews_audio_recording_idx`, `practice_memory_chunks_scope_idx`) need no action.

**Functions (2 RPCs)** — bodies reference the renamed column, so recreated in the same migration: `match_practice_memory_chunks(p_clinician_id…)` and `match_visual_memory_chunks(filter_clinician_id…, RETURNS TABLE(… clinician_id …))`. Callers: `api/_lib/practiceMemoryRag.js:288`, `api/_lib/clipSearch.js:64`.

### DB VALUES to KEEP ("clinician" as classification — untouched)
`staff.permission_tier` (`'clinician'`), `staff.staff_type` (`'clinician'`/`'non_clinical_staff'`), `media_assets.speaker_role` (`'clinician'`/`'admin'`/`'patient_guest'`), and `interviews.speaker_role` CHECK.

### Code surface (file groups)
- **authZ rename** (`STAFF_ROLES`/`isStaff`/`.isStaff` → `EDITOR_ROLES`/`isEditor`): **~32 files** across `src` + `api`. Definitions: `src/lib/roles.js`, `api/_lib/roles.js`; hook: `src/lib/useUserRole.js`. Pages/components: `src/pages/Stories.jsx`, `src/pages/Home.jsx`, `src/components/Layout.jsx`, + ~27 api call sites. **Zero DB/entity coupling.**
- **api entity slice: ~55 files.** Includes file renames `api/db/clinicians.js`→`api/db/staff.js`, `api/db/clinician-recipes.js`→`api/db/staff-recipes.js`, dir `api/clinicians/*`→`api/staff/*`; `.from('clinicians')`, `select=`/filter strings, RPC callers.
- **src entity slice: ~32 files** (15 pages + 17 components). File renames `src/pages/ClinicianProfile.jsx`→`StaffProfile.jsx`, `src/components/ClinicianChip.jsx`→`StaffChip.jsx`; hooks `useSelfClinicianId`→`useSelfStaffId`, `useEnsureSelfClinician`→`useEnsureSelfStaff`, `useClinicianSummaries`→`useStaffSummaries` (file `src/lib/useSelfClinicianId.js`→`useSelfStaffId.js`); `src/lib/queries.js` query fns; query keys `['clinician']`/`['clinician-summaries']`/`['clinicians']`→`['staff']`/`['staff-summaries']`; routes in `src/App.jsx`.
- **scripts/tests slice: ~21 files** + CI. `scripts/seed-e2e-fixtures.mjs` (raw SQL `clinicians`), `voice-fidelity-*.mjs`, `ingest-inbox.mjs`, `merge-duplicate-clinicians.mjs`, `merge-drq-rows.mjs`, `reclone-voice.mjs`, etc.; `tests/e2e/interview-flow.spec.ts` (`getByLabel(/^clinician$/i)` selector + `E2E_FIXTURE_CLINICIAN_NAME`), `tests/lib/stories.test.js`, `tests/e2e/README.md`.
- **Prose/blog/mocks — KEEP:** `src/content/blog/**`, `public/*.html` marketing pages, `index.html` meta, code/comment prose. (Full per-file token list saved in the workflow inventory; see §7.)

### Routes (`src/App.jsx`)
`:clinicianId` appears in 5 routes, but only `/clinician/:clinicianId` has "clinician" in the **literal URL**. The others (`/capture/:clinicianId/:interviewId/review`, `/interview/:clinicianId/:interviewId`, `/interview/:clinicianId/:interviewId/output`, `/output/:clinicianId/:interviewId`) use it as a **param name only** → rename `:clinicianId`→`:staffId` is internal (URLs unchanged, no redirect needed). **Only `/clinician/:id` → `/staff/:id` needs a backward-compat redirect.**

---

## 3. Phased plan (PR-by-PR)

| Phase | What | DB? | PRs | Mergeable independently? |
|---|---|---|---|---|
| **0** | Plan & sign-off (this doc) | — | — | ✓ done |
| **1** | **authZ rename** `STAFF_ROLES`→`EDITOR_ROLES`, `isStaff`→`isEditor` (~32 files) | no | 1 | ✓ yes — ships first, frees "staff", no coordination |
| **2** | **Build entity code** (api + src + scripts/tests) in worktree branches, static-green; **dry-run** the migration on a Supabase branch | builds `106` | 1 atomic entity-rename PR (recommended) *or* 3 stacked sub-PRs | held, not merged |
| **3** | **Coordinated cutover**: apply `106` to prod → merge entity PR → auto-deploy (~2-min window) → verify in-browser + smoke; rollback ready | applies `106` to prod | merge of Phase 2 PR | the pivot |
| **4** | **Contract + cleanup**: `107` drops compat views; final acceptance grep; optional UI-copy polish ("Admin staff" → "Admin / Operations"); update CLAUDE.md/memory | applies `107` | 1 | ✓ |

**Why Phase 2 entity work is one atomic PR (or a tight stack):** under coordinated-flip the **column** rename is a hard cutover — every `clinician_id`/`clinician_name`/`target_clinician_ids` reference must flip in the same deploy as the migration (compat views only preserve *table* names, not *column* names). So the entity code lands together. It's largely mechanical (codemod for `clinician_id`→`staff_id`, `.from('clinicians')`→`.from('staff')`, etc.) + hand changes for file renames, routes, RPC callers, and labels — reviewed as a codemod with spot-checks. If review size is a concern, slice into 3 stacked PRs (api → src → scripts/tests) merged bottom-up within the cutover window.

### Cutover mechanics (Phase 3)
1. Confirm Phase 1 (authz) already merged & deployed.
2. Apply `106_rename_clinician_to_staff.sql` to prod (Supabase MCP `apply_migration` or the apply script).
3. Immediately merge the entity PR → GitHub-integration auto-deploy (~2 min).
4. During the window: `.from('clinicians')` etc. survive via compat views; `clinician_id` column refs in the ~2-min-old code error. Run at low traffic.
5. Verify: `vercel inspect narraterx.ai` SHA == `origin/main`; post-deploy E2E smoke; exercise StaffProfile, interviews, Slate, Library, content items in-browser (confirm staff associations resolve).
6. **Rollback:** keep `106_down` (rename back) ready; if deploy fails, apply it and old code works again.

---

## 4. Phase 1 migration SQL (exact) — `supabase/multitenant/migrations/106_rename_clinician_to_staff.sql`

> Authored & **dry-run on a Supabase branch** before prod. One transaction. Bundles `GRANT … service_role` per CLAUDE.md. Values `'clinician'` inside CHECKs are KEPT.

```sql
BEGIN;

-- 1) Core tables
ALTER TABLE public.clinicians                 RENAME TO staff;
ALTER TABLE public.clinician_recipes          RENAME TO staff_recipes;
ALTER TABLE public.clinician_voice_phrases    RENAME TO staff_voice_phrases;
ALTER TABLE public.clinician_corpus_documents RENAME TO staff_corpus_documents;

-- 2) FK columns clinician_id -> staff_id (12 tables) + content_items.clinician_name + campaigns array
ALTER TABLE public.staff_recipes                   RENAME COLUMN clinician_id TO staff_id;
ALTER TABLE public.staff_voice_phrases             RENAME COLUMN clinician_id TO staff_id;
ALTER TABLE public.staff_corpus_documents          RENAME COLUMN clinician_id TO staff_id;
ALTER TABLE public.interviews                      RENAME COLUMN clinician_id TO staff_id;
ALTER TABLE public.content_items                   RENAME COLUMN clinician_id TO staff_id;
ALTER TABLE public.content_items                   RENAME COLUMN clinician_name TO staff_name;
ALTER TABLE public.media_assets                    RENAME COLUMN clinician_id TO staff_id;
ALTER TABLE public.concept_mentions                RENAME COLUMN clinician_id TO staff_id;
ALTER TABLE public.story_packages                  RENAME COLUMN clinician_id TO staff_id;
ALTER TABLE public.video_segments                  RENAME COLUMN clinician_id TO staff_id;
ALTER TABLE public.visual_memory_chunks            RENAME COLUMN clinician_id TO staff_id;
ALTER TABLE public.practice_memory_chunks          RENAME COLUMN clinician_id TO staff_id;
ALTER TABLE public.workspace_onboarding_interviews RENAME COLUMN clinician_id TO staff_id;
ALTER TABLE public.campaigns                       RENAME COLUMN target_clinician_ids TO target_staff_ids;

-- 3) FK constraint names
ALTER TABLE public.staff_recipes                   RENAME CONSTRAINT clinician_recipes_clinician_id_fkey          TO staff_recipes_staff_id_fkey;
ALTER TABLE public.staff_voice_phrases             RENAME CONSTRAINT clinician_voice_phrases_clinician_id_fkey    TO staff_voice_phrases_staff_id_fkey;
ALTER TABLE public.staff_corpus_documents          RENAME CONSTRAINT clinician_corpus_documents_clinician_id_fkey TO staff_corpus_documents_staff_id_fkey;
ALTER TABLE public.interviews                      RENAME CONSTRAINT interviews_clinician_id_fkey                 TO interviews_staff_id_fkey;
ALTER TABLE public.content_items                   RENAME CONSTRAINT content_items_clinician_id_fkey              TO content_items_staff_id_fkey;
ALTER TABLE public.media_assets                    RENAME CONSTRAINT media_assets_clinician_id_fkey               TO media_assets_staff_id_fkey;
ALTER TABLE public.concept_mentions                RENAME CONSTRAINT concept_mentions_clinician_id_fkey           TO concept_mentions_staff_id_fkey;
ALTER TABLE public.story_packages                  RENAME CONSTRAINT story_packages_clinician_id_fkey             TO story_packages_staff_id_fkey;
ALTER TABLE public.video_segments                  RENAME CONSTRAINT video_segments_clinician_id_fkey             TO video_segments_staff_id_fkey;
ALTER TABLE public.visual_memory_chunks            RENAME CONSTRAINT visual_memory_chunks_clinician_id_fkey       TO visual_memory_chunks_staff_id_fkey;
ALTER TABLE public.practice_memory_chunks          RENAME CONSTRAINT practice_memory_chunks_clinician_id_fkey     TO practice_memory_chunks_staff_id_fkey;
ALTER TABLE public.workspace_onboarding_interviews RENAME CONSTRAINT workspace_onboarding_interviews_clinician_id_fkey TO workspace_onboarding_interviews_staff_id_fkey;

-- 4) PK / workspace-FK / CHECK names on the 4 renamed tables (values inside CHECKs kept)
ALTER TABLE public.staff                  RENAME CONSTRAINT clinicians_pkey                       TO staff_pkey;
ALTER TABLE public.staff                  RENAME CONSTRAINT clinicians_workspace_id_fkey          TO staff_workspace_id_fkey;
ALTER TABLE public.staff                  RENAME CONSTRAINT clinicians_permission_tier_check      TO staff_permission_tier_check;
ALTER TABLE public.staff                  RENAME CONSTRAINT clinicians_staff_type_check           TO staff_staff_type_check;
ALTER TABLE public.staff_recipes          RENAME CONSTRAINT clinician_recipes_pkey                TO staff_recipes_pkey;
ALTER TABLE public.staff_recipes          RENAME CONSTRAINT clinician_recipes_workspace_id_fkey   TO staff_recipes_workspace_id_fkey;
ALTER TABLE public.staff_voice_phrases    RENAME CONSTRAINT clinician_voice_phrases_pkey          TO staff_voice_phrases_pkey;
ALTER TABLE public.staff_voice_phrases    RENAME CONSTRAINT clinician_voice_phrases_workspace_id_fkey TO staff_voice_phrases_workspace_id_fkey;
ALTER TABLE public.staff_corpus_documents RENAME CONSTRAINT clinician_corpus_documents_pkey       TO staff_corpus_documents_pkey;
ALTER TABLE public.staff_corpus_documents RENAME CONSTRAINT clinician_corpus_documents_workspace_id_fkey TO staff_corpus_documents_workspace_id_fkey;

-- 5) Indexes whose NAME contains 'clinician' (defs auto-track renamed columns)
--    NOTE: confirm on the Supabase branch whether RENAME CONSTRAINT above already
--    renamed the pkey-backed indexes; if so they are NOT listed here.
ALTER INDEX public.clinicians_active_voice_clone_idx     RENAME TO staff_active_voice_clone_idx;
ALTER INDEX public.clinicians_capture_upload_token_uniq  RENAME TO staff_capture_upload_token_uniq;
ALTER INDEX public.clinicians_workspace_creator_idx      RENAME TO staff_workspace_creator_idx;
ALTER INDEX public.clinicians_workspace_idx              RENAME TO staff_workspace_idx;
ALTER INDEX public.clinicians_workspace_name_idx         RENAME TO staff_workspace_name_idx;
ALTER INDEX public.clinicians_workspace_user_idx         RENAME TO staff_workspace_user_idx;
ALTER INDEX public.clinician_corpus_docs_title_uniq_idx  RENAME TO staff_corpus_docs_title_uniq_idx;
ALTER INDEX public.clinician_recipes_clinician_idx       RENAME TO staff_recipes_staff_idx;
ALTER INDEX public.clinician_recipes_one_default_idx     RENAME TO staff_recipes_one_default_idx;
ALTER INDEX public.clinician_voice_phrases_lookup_idx    RENAME TO staff_voice_phrases_lookup_idx;
ALTER INDEX public.clinician_voice_phrases_uniq_idx      RENAME TO staff_voice_phrases_uniq_idx;
ALTER INDEX public.clinician_voice_phrases_workspace_idx RENAME TO staff_voice_phrases_workspace_idx;
ALTER INDEX public.concept_mentions_clinician            RENAME TO concept_mentions_staff;
ALTER INDEX public.idx_story_packages_clinician_id       RENAME TO idx_story_packages_staff_id;
ALTER INDEX public.interviews_workspace_clinician_idx    RENAME TO interviews_workspace_staff_idx;
ALTER INDEX public.media_assets_clinician_idx            RENAME TO media_assets_staff_idx;
ALTER INDEX public.visual_memory_chunks_clinician_idx    RENAME TO visual_memory_chunks_staff_idx;

-- 6) book_excluded_sources CHECK stores the old table-name as a value
ALTER TABLE public.book_excluded_sources DROP CONSTRAINT book_excluded_sources_table_check;
UPDATE public.book_excluded_sources SET source_table='staff_corpus_documents' WHERE source_table='clinician_corpus_documents';
ALTER TABLE public.book_excluded_sources
  ADD CONSTRAINT book_excluded_sources_table_check
  CHECK (source_table = ANY (ARRAY['interviews'::text, 'staff_corpus_documents'::text]));

-- 7) Recreate RPCs (param + column refs). DROP+CREATE because param names change.
DROP FUNCTION IF EXISTS public.match_practice_memory_chunks(uuid, uuid, vector, integer, uuid[], text[]);
CREATE FUNCTION public.match_practice_memory_chunks(
  p_workspace_id uuid, p_staff_id uuid, p_query_embedding vector,
  p_match_count integer DEFAULT 6, p_exclude_source_ids uuid[] DEFAULT '{}'::uuid[],
  p_source_types text[] DEFAULT NULL::text[])
RETURNS TABLE(id uuid, source_type text, source_id uuid, source_label text, text text, similarity double precision)
LANGUAGE sql STABLE AS $function$
  SELECT c.id, c.source_type, c.source_id, c.source_label, c.text,
         1 - (c.embedding <=> p_query_embedding) AS similarity
  FROM public.practice_memory_chunks c
  WHERE c.workspace_id = p_workspace_id
    AND (p_staff_id IS NULL OR c.staff_id = p_staff_id)
    AND (p_source_types IS NULL OR c.source_type = ANY (p_source_types))
    AND c.embedding IS NOT NULL
    AND NOT (c.source_id = ANY (COALESCE(p_exclude_source_ids, '{}'::uuid[])))
  ORDER BY c.embedding <=> p_query_embedding
  LIMIT GREATEST(p_match_count, 1);
$function$;

DROP FUNCTION IF EXISTS public.match_visual_memory_chunks(vector, integer, uuid, text, real, uuid);
CREATE FUNCTION public.match_visual_memory_chunks(
  query_embedding vector, match_count integer DEFAULT 8, filter_workspace_id uuid DEFAULT NULL::uuid,
  filter_kind text DEFAULT NULL::text, filter_min_score real DEFAULT 0.0, filter_staff_id uuid DEFAULT NULL::uuid)
RETURNS TABLE(chunk_id uuid, workspace_id uuid, staff_id uuid, source_type text, source_id uuid,
  source_blob_url text, chunk_tags jsonb, audio_quality real, video_quality real, story_role text,
  similarity real, asset_kind text, asset_blob_url text, asset_thumbnail_url text, asset_filename text,
  asset_duration_s numeric, asset_aspect_ratio text, asset_visual_narrative text, asset_ai_tags jsonb,
  asset_captured_at timestamp with time zone)
LANGUAGE sql STABLE AS $function$
  SELECT v.id AS chunk_id, v.workspace_id, v.staff_id, v.source_type, v.source_id, v.source_blob_url,
    v.tags AS chunk_tags, v.audio_quality, v.video_quality, v.story_role,
    (1 - (v.embedding <=> query_embedding))::real AS similarity,
    m.kind AS asset_kind, m.blob_url AS asset_blob_url, m.thumbnail_url AS asset_thumbnail_url,
    m.filename AS asset_filename, m.duration_s AS asset_duration_s, m.aspect_ratio AS asset_aspect_ratio,
    m.visual_narrative AS asset_visual_narrative, m.ai_tags AS asset_ai_tags, m.captured_at AS asset_captured_at
  FROM public.visual_memory_chunks v
  LEFT JOIN public.media_assets m ON m.id = v.source_id AND v.source_type = 'media_asset' AND m.archived_at IS NULL
  WHERE v.embedding IS NOT NULL
    AND (filter_workspace_id IS NULL OR v.workspace_id = filter_workspace_id)
    AND (filter_kind IS NULL OR m.kind = filter_kind)
    AND (filter_staff_id IS NULL OR v.staff_id = filter_staff_id)
    AND (1 - (v.embedding <=> query_embedding))::real >= filter_min_score
  ORDER BY v.embedding <=> query_embedding
  LIMIT match_count;
$function$;
-- callers flip in lockstep: api/_lib/practiceMemoryRag.js (p_staff_id), api/_lib/clipSearch.js (filter_staff_id + reads .staff_id)

-- 8) Backward-compat VIEWS (simple, updatable; preserve .from('clinicians') table-name during the burst)
CREATE VIEW public.clinicians                 AS SELECT * FROM public.staff;
CREATE VIEW public.clinician_recipes          AS SELECT * FROM public.staff_recipes;
CREATE VIEW public.clinician_voice_phrases    AS SELECT * FROM public.staff_voice_phrases;
CREATE VIEW public.clinician_corpus_documents AS SELECT * FROM public.staff_corpus_documents;
-- NOTE: views expose staff_id (renamed col), NOT clinician_id. They preserve the TABLE name only,
-- not the old COLUMN name. Column-level clinician_id refs in not-yet-deployed code break during
-- the ~2-min window (accepted per coordinated-flip). Dropped in Phase 4 (107).

-- 9) Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff, public.staff_recipes, public.staff_voice_phrases, public.staff_corpus_documents TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clinicians, public.clinician_recipes, public.clinician_voice_phrases, public.clinician_corpus_documents TO service_role;
GRANT EXECUTE ON FUNCTION public.match_practice_memory_chunks(uuid, uuid, vector, integer, uuid[], text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.match_visual_memory_chunks(vector, integer, uuid, text, real, uuid) TO service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;

COMMIT;
```

### `107_drop_clinician_compat_views.sql` (Phase 4 contract)
```sql
BEGIN;
DROP VIEW IF EXISTS public.clinicians;
DROP VIEW IF EXISTS public.clinician_recipes;
DROP VIEW IF EXISTS public.clinician_voice_phrases;
DROP VIEW IF EXISTS public.clinician_corpus_documents;
COMMIT;
```

### Rollback (`106_down`, prepared before cutover) — reverse of §4: drop views & recreated functions, rename columns/constraints/indexes/tables back, restore the old CHECK.

---

## 5. Minor decisions baked in (defaults — flag if you disagree)
1. **Historical migration files** (`supabase/.../0*.sql`): NOT rewritten — they're a changelog. Acceptance grep excludes them.
2. **RPC params** → renamed to `p_staff_id` / `filter_staff_id` (clean). *Alt:* keep param names (CREATE OR REPLACE body-only) to decouple callers from the cutover — not chosen, since the window is already accepted.
3. **`other_clinicians` audience option** (key+label in `047` seed JSON + live `workspaces.audience_options`): **KEEP** — it's a peer-provider *audience* archetype, not the roster; renaming the key would need a data migration of workspace configs. *(Owner: rename to `other_providers`?)*
4. **"Admin staff" speaker-type labels** (DriveImportPicker, MediaDetail, MediaUploader, MediaHubHelp): a content-subject label, distinct from both entity and authz. Default → optional Phase 4 polish to **"Admin / Operations"** to avoid noun collision with the new staff roster.
5. **Voice-clone blob paths** (`voice-clone-samples/<slug>/<id>-…`): variable rename only; the `<id>` is a UUID value, so stored `voice_clone_sample_url`s are unaffected — **no data backfill**.
6. **CI:** `E2E_FIXTURE_CLINICIAN_NAME`→`E2E_FIXTURE_STAFF_NAME` requires updating the GitHub Actions workflow **and** the CI secret/var. (The `clinicians` compat view keeps the seed script's raw SQL alive during the window regardless.)
7. **Compat views** are simple `SELECT *` (table-name grace only); column window accepted.

---

## 6. Risks
- **~2-min cutover window** (column-level `clinician_id` refs 500). Mitigation: low-traffic timing, compat views for table refs, instant rename-back rollback.
- **Constraint-vs-index rename coupling** (does `RENAME CONSTRAINT` rename the pkey-backed index?) — resolved empirically on the Supabase dry-run branch before prod.
- **CI seed/spec lockstep**: `seed-e2e-fixtures.mjs` + `interview-flow.spec.ts` selector `getByLabel(/^clinician$/i)` + `E2E_FIXTURE_CLINICIAN_NAME` must update together or post-deploy smoke goes red. The new `/new/interview` label must be decided (→ "Staff member"?) so the selector matches.
- **Worktree discipline**: each phase in its own worktree off `origin/main`; project root stays on `main` for deploy only.
- **>3 unmerged PRs**: the Phase 2 entity set is an intentional coordinated exception (built together, merged in the cutover burst).

## 7. Source inventory
Full per-file token lists (entity/authz/keep/prose buckets) from the Phase 0 workflow are saved at the task output:
`/private/tmp/claude-501/-Users-qbook-Claude-Projects-NarrateRx/ab02f7b3-576e-4f5f-bf82-1f4574cac374/tasks/w4zch88uh.output` (`.result.reports[]`). The `src-pages-components` subsystem was recovered via direct grep (agent didn't emit structured output).

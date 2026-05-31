-- 112_merge_staff_fn.sql
-- Atomic server-side staff merge.
--
-- Repoints every staff_id reference (12 FK tables + the denormalized
-- campaigns.target_staff_ids uuid[]) from a SOURCE staff row onto a TARGET, then
-- deletes the source. Powers POST /api/staff/reconcile so a workspace owner can
-- one-click-fix the rare "two bound rows for the same person" split that
-- predates the email-claim added to api/staff/ensure-self.js.
--
-- Why a function (not REST calls): five of the staff_id FKs are ON DELETE
-- CASCADE (content_items, interviews, practice_memory_chunks, staff_recipes,
-- staff_voice_phrases). The source MUST be fully repointed BEFORE the delete or
-- the cascade silently destroys the source's learning. A single plpgsql body
-- runs in one transaction, so a mid-merge failure rolls back entirely — the
-- merge is all-or-nothing and can never partially drop data.
--
-- Three child tables carry a unique index that includes staff_id; a blind
-- repoint would violate it when the target already holds the same key, so the
-- source's colliding rows are dropped first:
--   - staff_voice_phrases  uniq (workspace_id, staff_id, phrase_normalized)
--   - staff_corpus_documents uniq (workspace_id, staff_id, doc_type, title) where archived_at is null
--   - staff_recipes        uniq (staff_id) where is_default  (one default per staff)
-- The other nine tables have no staff_id-bearing unique index → plain repoint.
--
-- Tenant safety: both rows must belong to p_workspace, enforced here so the
-- function can never merge across tenants even if a caller passes bad ids.

create or replace function public.merge_staff(
  p_source    uuid,
  p_target    uuid,
  p_workspace uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_src_ws uuid;
  v_tgt_ws uuid;
begin
  if p_source = p_target then
    raise exception 'merge_staff: source and target are identical (%)', p_source;
  end if;

  select workspace_id into v_src_ws from staff where id = p_source;
  select workspace_id into v_tgt_ws from staff where id = p_target;
  if v_src_ws is null then raise exception 'merge_staff: source % not found', p_source; end if;
  if v_tgt_ws is null then raise exception 'merge_staff: target % not found', p_target; end if;
  if v_src_ws <> p_workspace or v_tgt_ws <> p_workspace then
    raise exception 'merge_staff: cross-workspace merge blocked (src ws %, tgt ws %, expected %)',
      v_src_ws, v_tgt_ws, p_workspace;
  end if;

  -- ── Collision-prone repoints: drop the source rows that would violate a
  --    (…, staff_id, …) unique index on the target, then move the rest. ──

  -- staff_voice_phrases — uniq (workspace_id, staff_id, phrase_normalized)
  delete from staff_voice_phrases s
   where s.staff_id = p_source
     and exists (
       select 1 from staff_voice_phrases t
        where t.staff_id = p_target
          and t.phrase_normalized = s.phrase_normalized
     );
  update staff_voice_phrases set staff_id = p_target where staff_id = p_source;

  -- staff_corpus_documents — uniq (workspace_id, staff_id, doc_type, title) where archived_at is null
  delete from staff_corpus_documents s
   where s.staff_id = p_source
     and s.archived_at is null
     and exists (
       select 1 from staff_corpus_documents t
        where t.staff_id = p_target
          and t.archived_at is null
          and t.doc_type = s.doc_type
          and t.title = s.title
     );
  update staff_corpus_documents set staff_id = p_target where staff_id = p_source;

  -- staff_recipes — one default per staff_id; also drop source recipes whose
  -- name already exists on the target so the merged row has no confusing
  -- duplicate-named recipes (matches scripts/merge-duplicate-staff.mjs).
  if exists (select 1 from staff_recipes where staff_id = p_target and is_default) then
    update staff_recipes set is_default = false where staff_id = p_source and is_default;
  end if;
  delete from staff_recipes s
   where s.staff_id = p_source
     and exists (
       select 1 from staff_recipes t
        where t.staff_id = p_target
          and lower(t.name) = lower(s.name)
     );
  update staff_recipes set staff_id = p_target where staff_id = p_source;

  -- ── Plain repoints (no staff_id-bearing unique index → no collision). ──
  update concept_mentions                set staff_id = p_target where staff_id = p_source;
  update content_items                   set staff_id = p_target where staff_id = p_source;
  update interviews                      set staff_id = p_target where staff_id = p_source;
  update media_assets                    set staff_id = p_target where staff_id = p_source;
  update practice_memory_chunks          set staff_id = p_target where staff_id = p_source;
  update story_packages                  set staff_id = p_target where staff_id = p_source;
  update video_segments                  set staff_id = p_target where staff_id = p_source;
  update visual_memory_chunks            set staff_id = p_target where staff_id = p_source;
  update workspace_onboarding_interviews set staff_id = p_target where staff_id = p_source;

  -- Denormalized uuid[] (no FK): replace source→target, then de-dup in case the
  -- target was already present in the same campaign's target list.
  update campaigns
     set target_staff_ids = (
       select array(select distinct x
                      from unnest(array_replace(target_staff_ids, p_source, p_target)) as x)
     )
   where p_source = any(target_staff_ids);

  -- Source now has zero references — safe to delete (no cascade can fire).
  delete from staff where id = p_source;
end;
$$;

grant execute on function public.merge_staff(uuid, uuid, uuid) to service_role;

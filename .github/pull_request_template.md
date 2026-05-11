## Summary

<!-- 1-3 bullets on what this PR does. -->

## Tenant-isolation check

If this PR touches Supabase tables that are workspace-scoped (anything with `workspace_id NOT NULL`):

- [ ] Every read filters by `workspace_id` (via `workspaceScope(req)` / `workspaceContext(req)` on the server, or a workspace-bound query on the client)
- [ ] Every write stamps `workspace_id` on insert
- [ ] If joining via a junction table without its own `workspace_id` (e.g. `collection_items`), the input id is verified to belong to the current workspace first
- [ ] N/A — this PR doesn't touch tenant data

Background: see [#242](https://github.com/Move-Better/NarrateRx/pull/242) / [#244](https://github.com/Move-Better/NarrateRx/pull/244) / [#250](https://github.com/Move-Better/NarrateRx/pull/250) for the failure mode this checklist is guarding against.

## Test plan

<!-- Checklist of how to verify the change. -->

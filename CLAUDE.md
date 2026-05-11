# NarrateRx — Project Notes

## Session Focus
At the start of EVERY new conversation, before doing anything else, ask:
"What are we working on today?" then confirm it fits one of these session types:

- **Planning / Architecture** — decisions, structure, roadmap
- **Feature: [name]** — building one specific feature end to end
- **Prompts** — writing or tuning AI prompts
- **Debug: [issue]** — one specific problem

If the work drifts into a second unrelated area mid-session, name it and suggest: "That's a good next session — want to note it and come back to it?"

## Multi-tenant SaaS
NarrateRx runs as a single shared deployment that serves multiple workspaces by subdomain (`<slug>.narraterx.ai`). Move Better People, Equine, and Animals are the three seed workspaces; external tenants self-onboard at `narraterx.ai/onboard`. All tenant-editable config — display name, voice/tone modifiers, interview/patient context, topic suggestions, output channels, publish credentials — lives in the `workspaces` row in the shared narraterx Supabase, edited via `/settings/workspace`.

The legacy `brands/<id>/` filesystem-overlay pattern and the `VITE_BRAND` / `BRAND` env vars were retired in Phase 1F (2026-05-10). Paradigm content is no longer build-time-pinned. To onboard a new tenant, use the wizard — there is no per-deployment scaffolding.

`src/lib/workspace.js` retains a static config for legacy per-brand deployments only; runtime code reads `useWorkspace()` (browser) or `workspaceContext(req)` (serverless), which resolve from the DB by subdomain.

**Tenant onboarding** (`/onboard`, `api/onboarding/*`): a Clerk-authenticated user fills the wizard, which (a) creates a Clerk Organization, (b) inserts a `workspaces` row with the chosen slug + paradigm defaults pre-populated into the JSONB columns, (c) binds the Clerk org id back to the workspace, (d) seeds `enabled_outputs` and a default `clinic_settings` row. Subdomain DNS is wildcard (`*.narraterx.ai` → narraterx Vercel project), so the new subdomain works immediately with no DNS step.

**Per-tenant publish credentials** (Buffer / Facebook / GBP / WordPress / etc.) live in the `workspace_credentials` table, encrypted at the column level with `WORKSPACE_CREDENTIALS_KEY` (Sensitive env var on the `narraterx` Vercel project). Each row is `{ workspace_id, service, config (jsonb), secret_ciphertext (text) }`. Read/write goes through `api/_lib/workspaceCredentials.js`; never store these as Vercel env vars again — that pattern died with the per-brand deployments.

**Cross-workspace data isolation** is enforced at the API layer, not at the database layer: there is no RLS on the public schema (service_role bypasses anyway). Every API route that touches tenant-scoped tables must call `workspaceContext(req)` (or `workspaceById(id)` for background paths) and filter by `workspace_id`. Forgetting that = cross-tenant data leak. Treat the workspace_id filter the same way you'd treat an authorization check.

## Supabase migrations
Migrations live in `supabase/multitenant/migrations/` and are applied via `node scripts/apply-multitenant-migrations.mjs <file.sql>` against `MULTITENANT_DATABASE_URL`. There is no migration tracker — the script just applies whatever you pass it, so filename ordering is informational only.

**Required:** any migration that creates a new table, view, sequence, or function MUST include explicit `GRANT … TO service_role` in the same file. The REST API used by serverless functions runs as `service_role` and returns 403 / SQLSTATE 42501 on unprivileged objects (lesson from the early multi-tenant rollout — see `003_grant_service_role.sql` for the backfill pattern). Do NOT rely on re-running `003` after each new migration; bundle grants inline so each migration is self-sufficient. Example:

```sql
CREATE TABLE public.foo (...);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.foo TO service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;
```

If two migrations land on the same day, give them sequential numeric prefixes (008, 009, 010 …) rather than sharing a prefix. Shared prefixes are confusing for humans even though the apply script doesn't care.

## GitHub
Use the GitHub CLI (`gh`) for GitHub-specific interactions — PRs, issues, releases, repo management. `gh` is configured as the git credential helper, so plain `git push` / `git fetch` are fine for ref operations (they authenticate through `gh` under the hood). Do not set up separate HTTPS basic auth or raw SSH credentials.

## Email Template
The email newsletter preview renders the actual TrustDrivenCare (TDC) HTML template via `<iframe srcDoc>`. The template lives at `src/email-template.html` and is imported with Vite's `?raw` loader in `src/components/PostPreview.jsx`.

**To update the template** (e.g. after redesigning in TDC): export the master HTML from TrustDrivenCare, replace `src/email-template.html` with the new HTML, and commit. No React changes needed — all `{{merge_tags}}` are substituted at render time by `fillTemplate()` in PostPreview.jsx.

Merge tags currently in use: `{{preview_text}}`, `{{headline}}`, `{{pull_quote}}`, `{{body_paragraph_1}}`, `{{body_paragraph_2}}`, `{{body_paragraph_3}}`, `{{cta_text}}`, `{{cta_url}}`, `{{ps_text}}`, `{{hero_image_url}}`, `{{year}}`, `{{unsubscribe_url}}`, `{{webview_url}}`.

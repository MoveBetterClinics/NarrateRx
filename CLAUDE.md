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

## API handler runtime conventions
Vercel `/api/*` handlers must match the configured runtime — the runtime flag alone isn't enough. Mismatched handler shapes either crash with a `TypeError` or, worse, **silently hang until the 300s function timeout** (the client just spins forever).

**Node runtime** (`runtime: 'nodejs'`, or default for any file importing Node-only modules like `@sentry/node`, `@clerk/backend`, `@vercel/blob`, `node:*`):
- Signature: `async function handler(req, res)` (Express-style).
- `req.url` is path-only — parse with `new URL(req.url, 'http://localhost')`.
- `req.headers` is a plain lowercased object — use `req.headers['x-foo']`, **not** `.get()`.
- `req.body` is pre-parsed JSON — do **not** call `await req.json()`.
- Respond via `res.status(N).json(...)` or `.send(...)`. **Never return `new Response(...)`** — Vercel ignores it and the function hangs until the 300s execution timeout. No error, no log, just a spinning wheel client-side.
- Rate-limit via `enforceLimit(req, res, bucket)` from `api/_lib/ratelimit.js`.
- Reference handlers: `api/content-pieces/*`, `api/media/*`, `api/db/*`.

**Edge runtime** (`runtime: 'edge'`):
- Signature: `async function handler(req)` where `req` is a Web `Request`.
- Web-style API: `req.url` is a full URL, `req.headers.get()` works, `await req.json()` works.
- Respond via `return new Response(JSON.stringify(...), { status, headers })`.
- Cannot import Node-only modules. The Edge bundler does whole-graph bundling and will choke on even transitive Node imports (e.g. `ratelimit.js → @clerk/backend → node:crypto`).
- Rate-limit via `enforceLimitEdge(req, bucket)` from `api/_lib/ratelimit.js`.

**When converting between runtimes, refactor the handler shape — runtime flag alone is not sufficient.** PR #307 flipped `api/db/*.js` from Edge to Node by only swapping the runtime flag and leaving the Web-style handler in place. Result: four hours of cascading prod failures (PRs #312 / #316 / #317) before the shape was fully fixed.

For Supabase REST failures, the `dbErr(res, r, msg)` helper in each `api/db/*.js` file logs the full PostgREST response body to `vercel logs` (tagged `[db/<file>]`). Use the same pattern when adding new handlers that talk to Supabase REST — public response stays opaque, but root-causing is one log fetch away (`vercel logs --status-code 500 --expand`).

## Large-file handling
Functions that download media (videos, audio, large images) from blob storage **must stream** the response body to disk rather than buffering. `await res.arrayBuffer()` materializes the entire file in RAM and OOMs the function on anything over ~500MB (default Node function memory is 1024MB):

```js
import { createWriteStream } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const r = await fetch(blobUrl)
if (!r.ok) throw new Error(`download failed: ${r.status}`)
await pipeline(Readable.fromWeb(r.body), createWriteStream(localPath))
```

Peak memory is then bounded by the stream's internal buffer (a few MB), independent of source size. Reference: `api/_lib/thumbnail.js`, `api/_lib/tagAsset.js` (PR #318 fixed the OOM that was killing video-thumbnail backfill).

## Lint ratchet
The `npm run lint` script enforces a `--max-warnings <N>` ceiling (currently 152, set during the pre-launch audit). The ratchet should drift **down** over time, not up. Rule:

- A PR may not raise the ratchet ceiling without fixing an equal-or-greater number of warnings elsewhere in the same PR.
- If you introduce 1 new warning, fix at least 1 old one and keep the ceiling unchanged.
- The only exception is intentional `console.error`/`console.warn` in shared instrumentation (e.g. `api/_lib/sentry.js`) — bump the ceiling and note the reason in the commit body, the way `chore(lint): bump ratchet to 152` did.

The ceiling represents merged-baseline tech debt. Driving it down is the goal; raising it is a regression.

## Supabase migrations
Migrations live in `supabase/multitenant/migrations/` and are applied via `node scripts/apply-multitenant-migrations.mjs <file.sql>` against `MULTITENANT_DATABASE_URL`. There is no migration tracker — the script just applies whatever you pass it, so filename ordering is informational only.

**Required:** any migration that creates a new table, view, sequence, or function MUST include explicit `GRANT … TO service_role` in the same file. The REST API used by serverless functions runs as `service_role` and returns 403 / SQLSTATE 42501 on unprivileged objects (lesson from the early multi-tenant rollout — see `003_grant_service_role.sql` for the backfill pattern). Do NOT rely on re-running `003` after each new migration; bundle grants inline so each migration is self-sufficient. Example:

```sql
CREATE TABLE public.foo (...);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.foo TO service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;
```

If two migrations land on the same day, give them sequential numeric prefixes (008, 009, 010 …) rather than sharing a prefix. Shared prefixes are confusing for humans even though the apply script doesn't care.

**Apply before shipping code that depends on them.** Because there's no migration tracker, it's easy to merge a PR that references a new column while the schema lags behind on prod — the handler will 500 with a generic "Database error" on first hit. Rule: before merging a PR that adds a `select=` field, ALTER TABLE, or new column reference, confirm the relevant migration is applied to prod. Quick check via Supabase Studio SQL Editor (https://supabase.com/dashboard/project/wrqfrjhevkbbheymzezy/sql/new):

```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = '<table>';
```

If the column is missing, paste the relevant `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` from the migration file straight into the SQL Editor — faster than running the apply script, and idempotent so safe to re-paste.

Local migration runs require an unredacted `MULTITENANT_DATABASE_URL` in `.env.local`. `vercel env pull` replaces Sensitive vars with `*****REDACTED*****`, which silently breaks the apply script (`TypeError: Invalid URL`). After any `vercel env pull`, restore `MULTITENANT_DATABASE_URL` from 1Password (NarrateRx vault) before running migrations locally.

## GitHub
Use the GitHub CLI (`gh`) for GitHub-specific interactions — PRs, issues, releases, repo management. `gh` is configured as the git credential helper, so plain `git push` / `git fetch` are fine for ref operations (they authenticate through `gh` under the hood). Do not set up separate HTTPS basic auth or raw SSH credentials.

## Branch workflow (avoiding pile-ups)
PRs need to merge close to when they're opened, not batch-stacked indefinitely. The 26-PR pileup of 2026-05-12 happened because work batched while `main` moved in parallel from other contexts — every PR ended up conflicting with a different file `main` had since rewritten. To avoid the repeat:

1. **Rebase before every new branch.** Mechanical rule: at the start of every new feature branch, run `git fetch origin main && git checkout -b <name> origin/main` (or `git fetch && git rebase origin/main` if continuing a branch). The PR's base must be current.

2. **Cap unmerged PRs in flight.** Never open more than 3 unmerged PRs from the same context without stopping to merge. Once 3 are open and unmerged, finish merging before opening a 4th — otherwise the diff against `main` drifts faster than review can keep up.

3. **Enable auto-merge on open.** After `gh pr create`, run `gh pr merge <num> --auto --squash` so the PR ships the moment CI is green. Requires branch protection on `main` to define "ready" (status check on the PR build workflow); without protection, `--auto` merges immediately on open and the gate is moot.

4. **Check for merged-while-you-worked PRs.** Before the next feature branch, run `gh pr list --state merged --search 'merged:>=<session-start-iso>'`. Catches the case where a parallel agent shipped overlapping work — surfaces conflicts in seconds instead of at end-of-session.

When work *has* batched (long autonomous run, lots of stacked PRs), triage rather than mass-merge: identify which PRs are now duplicative of merged work, which can rebase cleanly, and which need to be re-done against the current shape of the codebase.

## Production deploys
Deploy to prod **only** from the project root (`/Users/qbook/Claude Projects/NarrateRx`) and **only** when the project root is on `main`, fully synced with `origin/main`. `vercel deploy --prod` ships the local working tree (not the git ref), so deploying from a worktree, a feature branch, or a project root with uncommitted changes will publish whatever happens to be on disk — including reverting recently-merged PRs.

If the project root is on another branch (with WIP), do not switch under the user. Either run the deploy from a separate `main`-tracking worktree that's `vercel link`ed to the `narraterx` project (copy `.vercel/project.json` in if needed) or ask the user to free up the project root. Always confirm the resulting deploy is aliased to `narraterx.ai` + `*.narraterx.ai` with `vercel inspect <dpl-id>` before declaring it done — deploys from an unlinked worktree silently create a separate Vercel project and never touch the real prod aliases.

## Definition of Done
Every PR must satisfy this checklist before merging. The triage on 2026-05-14 traced 12+ bugs to exactly these gaps being skipped.

### Code quality
- [ ] `npm run typecheck` exits 0 — no new implicit-any or JSDoc contract violations
- [ ] `npm run lint` exits 0 at or below the current ratchet ceiling — never raises it without an equal offset
- [ ] `npm run build` exits 0

### Logic
- [ ] Every new `useMutation` call uses `useAppMutation` (not raw TanStack `useMutation`) — enforced by the `narraterx/no-raw-use-mutation` ESLint rule
- [ ] Every new `fetch()` to an `/api` route uses `apiFetch` or `apiFetchResponse` — never a raw `fetch()` that could miss the Bearer token
- [ ] Every new API handler that touches a tenant-scoped table calls `workspaceContext(req)` and filters by `workspace_id`
- [ ] 401 / 403 branches are handled on `err?.status`, not `err?.message` string matching

### New API routes
- [ ] The handler shape matches the runtime (`(req, res)` for Node, `(req: Request)` for Edge)
- [ ] The Supabase table/column exists on prod before the PR is merged (verify with Studio SQL Editor or `scripts/apply-multitenant-migrations.mjs`)
- [ ] New tables include `GRANT … TO service_role` in the same migration file

### Testing
- [ ] Feature used in-browser at least once before the PR is opened (the step most often skipped)
- [ ] For large-surface features: run `npm run e2e` or manually smoke the relevant page on the Vercel preview URL

### Merge hygiene
- [ ] Branch rebased on current `origin/main` (`git fetch && git rebase origin/main`) immediately before opening the PR
- [ ] `gh pr merge <num> --auto --squash` set on open so CI gates the merge

## Email Template
The email newsletter preview renders the actual TrustDrivenCare (TDC) HTML template via `<iframe srcDoc>`. The template lives at `src/email-template.html` and is imported with Vite's `?raw` loader in `src/components/PostPreview.jsx`.

**To update the template** (e.g. after redesigning in TDC): export the master HTML from TrustDrivenCare, replace `src/email-template.html` with the new HTML, and commit. No React changes needed — all `{{merge_tags}}` are substituted at render time by `fillTemplate()` in PostPreview.jsx.

Merge tags currently in use: `{{preview_text}}`, `{{headline}}`, `{{pull_quote}}`, `{{body_paragraph_1}}`, `{{body_paragraph_2}}`, `{{body_paragraph_3}}`, `{{cta_text}}`, `{{cta_url}}`, `{{ps_text}}`, `{{hero_image_url}}`, `{{year}}`, `{{unsubscribe_url}}`, `{{webview_url}}`.

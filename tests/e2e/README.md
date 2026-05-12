# E2E post-deploy smoke

Playwright smoke that runs **after each merge to `main`** via
`.github/workflows/e2e.yml`. Waits for the Vercel production deploy, then
exercises the core interview-create flow + workspace-gated reads on
`https://movebetter-people.narraterx.ai`.

Catches the kind of regressions that took down 2026-05-11:

- **PR #244** — `/api/db/{interviews,clinicians,content,settings}` weren't
  workspace-scoped. New Interview Step 2 returned "Create failed" for every
  workspace.
- **PR #213** — `OrgGate` raced Clerk's `setActive`. Every workspace-gated
  endpoint returned 403 because the JWT had no `org_id`. Exercised here via
  the `/settings/integrations` credentials fetch.

## Why post-deploy, not pre-merge?

Production Clerk keys can only be used from `narraterx.ai` (or a subdomain).
Vercel preview URLs (`*.vercel.app`) are rejected with *"Production Keys are
only allowed for domain narraterx.ai"* — hardcoded in Clerk, no dashboard
toggle. Testing against PR previews would require a separate staging stack
with dev Clerk keys (deferred; see the `project_e2e_staging_stack_option`
memory in your auto-memory).

The post-deploy compromise: regressions ship to prod for ~1–2 min before
this catches them, but they're caught before customers notice. If something
fails, the next step is `vercel rollback` to the prior deploy.

## Run locally

Local runs go directly against `movebetter-people.narraterx.ai` (prod) by
default. Override with `E2E_BASE_URL` if you want to point at something else
(local dev, a previously aliased preview, etc.).

```
cd "/Users/qbook/Claude Projects/NarrateRx" && \
  set -a && source .env.e2e.local && set +a && \
  npm run e2e:install && \
  npm run e2e:seed && \
  npm run e2e
```

`.env.e2e.local` (gitignored — paste from 1Password "NarrateRx — E2E Smoke User"):

```
E2E_TEST_USER_EMAIL=...
E2E_TEST_USER_PASSWORD=...
MULTITENANT_DATABASE_URL=...   # same value as in your .env.local
```

## Required env vars

| Var | Where | Sensitivity | Used by |
|---|---|---|---|
| `E2E_BASE_URL` | optional, defaults `https://movebetter-people.narraterx.ai` | Not sensitive | Playwright `baseURL` |
| `E2E_WORKSPACE_SLUG` | optional, defaults `movebetter-people` | Not sensitive | seed |
| `E2E_FIXTURE_CLINICIAN_NAME` | optional, defaults `E2E Smoke Clinician` | Not sensitive | seed + spec |
| `E2E_TEST_USER_EMAIL` | GHA secret | Mildly sensitive | sign-in |
| `E2E_TEST_USER_PASSWORD` | GHA secret | **Sensitive** | sign-in |
| `MULTITENANT_DATABASE_URL` | GHA secret (Supabase **shared pooler** URL) | **Sensitive** | fixture seed |

All sensitive values live in the **NarrateRx** 1Password vault and are
mirrored to GitHub repo secrets of the same name.

## Real-prod data caveat

The smoke runs against the actual production `movebetter-people` workspace.
Side effects per run:

- `E2E Smoke Clinician` exists permanently in `clinicians` (seeded
  idempotently).
- Each green run creates one new `interviews` row with topic
  `"E2E smoke topic — safe to delete"` and the smoke clinician as creator.
  The topic prefix is intentional — search for it and bulk-delete from time
  to time. (Future improvement: auto-prune older test interviews in the
  seed step.)

These rows are visible to anyone with admin access to `movebetter-people`
but contain no real PHI.

## When the test fails

Playwright uploads its HTML report as a GHA artifact on failure (retention
7 days). Open it and check:

1. **"Create failed" banner on Step 2** → workspace-scoping regression on a
   `/api/db/*` endpoint. Confirm the endpoint calls `workspaceContext(req)`
   and filters by `workspace_id`. Likely action: `vercel rollback` while
   you fix forward.
2. **"Admins only" / load error on Integrations** → JWT missing `org_id`.
   Check `OrgGate` in `src/App.jsx` and the Clerk dashboard session-token
   template (must include org claims, per the
   `feedback_clerk_session_token_org_claims` memory).
3. **Stuck on sign-in screen** → test user got locked, deleted, or removed
   from the `movebetter-people` Clerk Org in **prod**. Re-create in Clerk
   dashboard → Production instance → Users, re-invite to org as Member,
   refresh 1Password + GHA secrets.
4. **"No access to this workspace" guard** → test user lost org membership.
   Re-invite via Clerk dashboard (prod instance).
5. **Timed out waiting for Vercel Production** → Vercel didn't post a
   deployment_status event for this commit. Investigate Vercel/GitHub
   integration health (per the `feedback_github_rename_breaks_vercel`
   memory, a disconnect+reconnect at project Settings → Git usually fixes
   it).

## What this test does NOT cover

- The voice-driven AI conversation (`SpeechRecognition` doesn't work in
  headless Chromium, and the LLM is too flaky/expensive for every-deploy CI).
- Post-generation `content_items` creation.
- Publishing flows (Buffer, Astro, WordPress, GBP) — those depend on third-
  party credentials we don't want to exercise in CI.

The smoke asserts the surface where the 2026-05-11 regressions happened:
workspace-scoped create + workspace-gated reads. Anything beyond that is
left to manual prod QA.

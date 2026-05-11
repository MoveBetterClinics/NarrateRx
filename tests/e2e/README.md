# E2E preview smoke

Single Playwright spec that runs against every Vercel preview deployment via
`.github/workflows/e2e.yml`. Catches interview-flow regressions before they
reach prod — specifically, the two 2026-05-11 incidents:

- **PR #244** — `/api/db/{interviews,clinicians,content,settings}` weren't
  workspace-scoped. New Interview Step 2 returned "Create failed" for every
  workspace.
- **PR #213** — `OrgGate` raced Clerk's `setActive`. Every workspace-gated
  endpoint returned 403 because the JWT had no `org_id`. Exercised here via
  the `/settings/integrations` credentials fetch.

`npm run build` (in `.github/workflows/pr.yml`) catches type/syntax breaks.
This catches runtime breaks. Both passed for the two incidents above —
neither was a build failure.

## How preview URLs map to a workspace

Preview deploys live at `narraterx-git-<branch>.vercel.app`, which has no
`<slug>.narraterx.ai` subdomain to resolve. We accept `?workspace=<slug>` as
an explicit override:

- Server: `api/_lib/workspaceContext.js` reads `?workspace=` only when
  `VERCEL_ENV !== 'production'`. Prod is unaffected.
- Client: `src/lib/workspaceOverride.js` patches `window.fetch` to append
  the override to outgoing `/api/*` calls (opt-in — no `?workspace=` in URL
  or sessionStorage means no patching).

The Playwright suite always navigates with `?workspace=movebetter-people`.

## Run locally

You need a running narraterx instance and a Clerk test user that's a member
of the fixture workspace's Clerk Organization. Talk to drq@ to get a user
provisioned, or reuse the `E2E Smoke User` in 1Password ("NarrateRx — E2E").

```
cd "/Users/qbook/Claude Projects/NarrateRx" && \
  set -a && source .env.e2e.local && set +a && \
  npm run e2e:install && \
  npm run e2e:seed && \
  E2E_BASE_URL=http://localhost:5173 npm run e2e
```

`.env.e2e.local` (gitignored — paste from 1Password "NarrateRx — E2E"):

```
E2E_TEST_USER_EMAIL=...
E2E_TEST_USER_PASSWORD=...
CLERK_PUBLISHABLE_KEY=...     # pk_test_... — the dev instance, not prod
CLERK_SECRET_KEY=...           # sk_test_...
MULTITENANT_DATABASE_URL=...   # same value as .env.local
```

To run against an actual preview URL instead of localhost:

```
E2E_BASE_URL=https://narraterx-git-<branch>-movebetter.vercel.app npm run e2e
```

## Required env vars

| Var | Where | Sensitivity | Used by |
|---|---|---|---|
| `E2E_BASE_URL` | GHA (auto from wait-for-vercel-preview) / local | Not sensitive | Playwright `baseURL` |
| `E2E_WORKSPACE_SLUG` | optional, defaults `movebetter-people` | Not sensitive | URL override + seed |
| `E2E_FIXTURE_CLINICIAN_NAME` | optional, defaults `E2E Smoke Clinician` | Not sensitive | seed + spec |
| `E2E_TEST_USER_EMAIL` | GHA secret | Mildly sensitive | sign-in |
| `E2E_TEST_USER_PASSWORD` | GHA secret | **Sensitive** | sign-in |
| `CLERK_PUBLISHABLE_KEY` | GHA secret `E2E_CLERK_PUBLISHABLE_KEY` | Mildly sensitive | `@clerk/testing` setup |
| `CLERK_SECRET_KEY` | GHA secret `E2E_CLERK_SECRET_KEY` | **Sensitive** | `@clerk/testing` setup |
| `MULTITENANT_DATABASE_URL` | GHA secret | **Sensitive** | fixture seed |

All sensitive values live in 1Password ("NarrateRx — E2E") and are mirrored
to the GitHub repo secrets of the same name.

## Refreshing the fixture session

Storage state is generated fresh in `auth.setup.ts` on every Playwright run
(saved to `tests/e2e/.auth/user.json`, gitignored). There's nothing to
refresh manually unless:

- The Clerk test user is deleted, locked, or rotated — re-provision in Clerk
  dashboard (dev instance) and update 1Password + GHA secrets.
- The fixture workspace's Clerk Org ID changes — update `workspaces.clerk_org_id`
  for `movebetter-people` and confirm the test user is still a member.

## When the test fails

The Playwright HTML report is uploaded as a GHA artifact on every failure
(retention 7 days). Open it and check:

1. **"Create failed" banner on Step 2** → workspace-scoping regression on a
   `/api/db/*` endpoint. Check that the endpoint calls `workspaceContext(req)`
   and filters by `workspace_id`.
2. **"Admins only" / load error on Integrations** → JWT missing `org_id`.
   Check `OrgGate` in `src/App.jsx` and the session token template in the
   Clerk dashboard (must include org claims).
3. **Stuck on sign-in screen** → Clerk testing token rejected, or test user
   isn't a member of the workspace org. Re-check Clerk env vars in repo
   secrets, and confirm the user is in the `movebetter-people` org.
4. **"No access to this workspace" guard** → fixture user removed from the
   workspace's Clerk Org. Re-invite via the Clerk dashboard.
5. **wait-for-vercel-preview timed out** → Vercel preview didn't finish
   building or the GitHub deployment check is missing. Verify the Vercel
   GitHub integration is still installed on the repo.

## What this test does NOT cover

- The voice-driven AI conversation (`SpeechRecognition` doesn't work in
  headless Chromium, and the AI itself is too flaky/expensive to run on
  every PR).
- Post-generation outputs / content_items creation.
- Publishing flows (Buffer, Astro, WordPress, GBP) — those depend on third-
  party credentials we don't want to exercise in CI.

These are verified by manual prod smoke after deploy. The PR-gate test only
asserts the surface where today's regressions happened: workspace-scoped
create + workspace-gated reads.

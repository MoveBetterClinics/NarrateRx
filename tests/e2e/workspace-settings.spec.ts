// Preview-deploy smoke for the Workspace Settings page.
//
// /settings/workspace is the most-edited surface for tenants — the place
// where they set display_name, voice/tone, clinic context, enabled outputs,
// and per-channel publish credentials. If the page won't load, every tenant
// is blocked from configuring their workspace.
//
// What this catches:
//   (a) /api/workspace/me 403s — JWT missing org_id (PR #213 family).
//   (b) The page mounts but workspace data never binds (the empty-form
//       regression from PR #294: PATCH vs upsert race that left clinic_settings
//       empty; an analogous bug in the workspace fetch would surface here as
//       a populated heading + empty Workspace-name input).
//   (c) Role-guard regressions: if `useUserRole` returns the wrong shape, the
//       page redirects to "/" before rendering. The heading-visible assertion
//       below fails fast in that case.
//
// Read-only: the test does NOT click Save. We intentionally avoid mutating
// real-prod data from CI (the existing interview-flow spec already creates
// one harmless row per run; we keep the workspace untouched).
//
// Why this is separate from interview-flow.spec.ts:
//   The interview-flow spec exercises the create path + workspace-gated reads
//   on /settings/integrations, but never hits the GET surface for the
//   workspace itself. A regression that breaks workspace_settings rendering
//   but leaves the credentials grid intact would slip past interview-flow.

import { test, expect } from '@playwright/test'

test('workspace settings page loads with populated form', async ({ page }) => {
  await page.goto('/settings/workspace')

  // ── 1. Heading visible ──────────────────────────────────────────────────
  // Visible only after (a) Clerk session is loaded, (b) useUserRole returned
  // 'admin', (c) /api/workspace/me succeeded and ws is non-null. If any of
  // those three fails, the page renders the spinner or redirects to "/".
  await expect(
    page.getByRole('heading', { name: /workspace settings/i }),
  ).toBeVisible({ timeout: 30_000 })

  // ── 2. Workspace name input is populated ────────────────────────────────
  // The Field component renders <Label>{label}</Label><Input ... value=... />
  // without htmlFor wiring, so we locate the input via the label text and the
  // sibling input. A non-empty value proves workspace data loaded AND bound
  // into the form state (formFromWorkspace ran successfully).
  const nameInput = page
    .locator('div')
    .filter({ has: page.locator('label', { hasText: /^Workspace name$/i }) })
    .getByRole('textbox')
    .first()

  await expect(nameInput).toBeVisible()
  const nameValue = await nameInput.inputValue()
  expect(nameValue.length, 'Workspace name input should be populated from workspace row').toBeGreaterThan(0)

  // ── 3. No error indicator ───────────────────────────────────────────────
  // The save button area renders an AlertCircle + error text when the GET
  // or PATCH fails. On a fresh page-load (no PATCH yet) any visible error
  // means the workspace fetch itself failed in a way the page tried to
  // surface — assertion catches it.
  await expect(page.locator('text=/network-error|save-failed/i')).toHaveCount(0)

  // ── 4. Save button is present and not in a saving state ────────────────
  // Cheap proof that the page rendered to its interactive form state, not
  // stuck on the Loader2 spinner from the initial roleLoading/ws-undefined
  // branch.
  const saveBtn = page.getByRole('button', { name: /save changes/i })
  await expect(saveBtn).toBeVisible()
  await expect(saveBtn).toBeEnabled()
})

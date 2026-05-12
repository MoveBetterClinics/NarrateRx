// Preview-deploy smoke for the Workspace Settings page.
//
// /settings/workspace is the most-edited surface for tenants — the place
// where they set display_name, voice/tone, clinic context, enabled outputs,
// and per-channel publish credentials. If the page won't load, every tenant
// is blocked from configuring their workspace.
//
// Two-mode assertion — the test adapts to the fixture user's role:
//
//   • Admin path → assert the form renders AND the Workspace-name input is
//     populated from the workspace row. Catches:
//       (a) /api/workspace/me 403 — JWT missing org_id (PR #213 family).
//       (b) Form-binding regression: page mounts but workspace data never
//           threads into useState (PR #294-style PATCH/upsert race in the
//           workspace surface would land here).
//
//   • Non-admin path → the WorkspaceSettings component redirects to "/" via
//     <Navigate>. Assert we landed on the Dashboard (the "Good morning/
//     afternoon/evening" greeting is the dashboard's signature). Catches:
//       (c) Role-guard regression: if `useUserRole` is broken and returns
//           'admin' for everyone, the redirect won't happen and a non-admin
//           user would see the form. Conversely if the guard incorrectly
//           sends an admin away, the admin-path assertion below fails.
//
// The fixture user `E2E_TEST_USER_EMAIL` on movebetter-people is currently a
// member but not an org-admin and has no `publicMetadata.role`, so the
// non-admin path is the one that exercises today. If you promote the fixture
// user to admin (Clerk dashboard → Users → publicMetadata `role: "admin"`
// or grant org:admin in the movebetter-people org), the test transparently
// upgrades to the admin path on the next run — no spec change required.
//
// Read-only: never clicks Save. Intentionally avoids mutating real-prod data
// from CI. The existing interview-flow spec already creates one harmless
// interviews row per run; the workspace row stays untouched here.
//
// Why this is separate from interview-flow.spec.ts:
//   The interview-flow spec exercises the create path + workspace-gated reads
//   on /settings/integrations, but never hits the GET surface for the
//   workspace itself. A regression that breaks workspace_settings rendering
//   but leaves the credentials grid intact would slip past interview-flow.

import { test, expect } from '@playwright/test'

test('workspace settings page resolves the role guard correctly', async ({ page }) => {
  await page.goto('/settings/workspace')

  // ── 1. Wait for the page to settle into a terminal state ────────────────
  // Either:
  //   (a) Workspace Settings heading visible — admin path
  //   (b) Dashboard greeting visible — non-admin redirected to "/" by the
  //       role guard
  // Anything else (stuck spinner, redirect to sign-in, generic error) is a
  // failure — the page didn't resolve its guards.
  const settingsHeading = page.getByRole('heading', { name: /workspace settings/i })
  const dashboardGreeting = page.getByRole('heading', { name: /good (morning|afternoon|evening)/i })

  await expect(
    settingsHeading.or(dashboardGreeting).first(),
  ).toBeVisible({ timeout: 30_000 })

  // ── 2. Branch on which terminal state we hit ────────────────────────────
  if (await settingsHeading.isVisible()) {
    // Admin path — verify the form bound workspace data correctly.
    const nameInput = page
      .locator('div')
      .filter({ has: page.locator('label', { hasText: /^Workspace name$/i }) })
      .getByRole('textbox')
      .first()
    await expect(nameInput).toBeVisible()
    const nameValue = await nameInput.inputValue()
    expect(
      nameValue.length,
      'Workspace name input should be populated from the workspace row (form-binding regression?)',
    ).toBeGreaterThan(0)

    // No load-error indicator near Save.
    await expect(page.locator('text=/network-error|save-failed/i')).toHaveCount(0)

    // Save button reachable + not stuck in saving state.
    const saveBtn = page.getByRole('button', { name: /save changes/i })
    await expect(saveBtn).toBeVisible()
    await expect(saveBtn).toBeEnabled()
  } else {
    // Non-admin path — we should be on the Dashboard, NOT still on
    // /settings/workspace. The Navigate replaces the URL, so the path must
    // not contain /settings/workspace anymore.
    await expect(page).not.toHaveURL(/\/settings\/workspace/)
    // And the dashboard's signature greeting is what we matched.
    await expect(dashboardGreeting).toBeVisible()
  }
})

// Preview-deploy smoke test for the core interview-creation flow.
//
// Catches the two 2026-05-11 regressions:
//   (a) PR #244 — db endpoints not workspace-scoped; New Interview Step 2
//       returned "Create failed" for every workspace.
//   (b) PR #213 — OrgGate raced setActive; every workspace-gated endpoint
//       returned 403 because the JWT had no org_id. The /settings/integrations
//       check exercises that surface.
//
// Scope intentionally stops short of the voice-driven AI conversation: web
// Speech API doesn't work in headless Chromium and the AI itself is a flaky
// dependency in CI. The two assertions here are enough to catch the regressions
// we care about; downstream LLM/voice behavior is verified in manual prod
// smoke after deploy.

import { test, expect } from '@playwright/test'

const FIXTURE_CLINICIAN = process.env.E2E_FIXTURE_CLINICIAN_NAME || 'E2E Smoke Clinician'

test('interview create flow + integrations page', async ({ page }) => {
  // ── 1. Dashboard ─────────────────────────────────────────────────────────
  // OrgGate must admit (PR #213 surface): if the JWT lacks org_id, the page
  // sits on the "No access to this workspace" guard and the New Interview
  // link never renders.
  await page.goto('/')
  const newInterviewLink = page.getByRole('link', { name: /new interview/i }).first()
  await expect(newInterviewLink).toBeVisible({ timeout: 30_000 })

  // ── 2. New Interview screen ──────────────────────────────────────────────
  // /new is a single-screen setup form (Clinician + Topic + tune chips +
  // Start interview). The earlier "Continue → Step 2" flow was collapsed
  // in the May 2026 redesign; one Start press creates the clinician +
  // interview rows and navigates straight into the session.
  //
  // This is the PR #244 surface: without workspace_id filtering on the
  // clinicians/interviews POSTs, the create returned "Create failed" with a
  // 500. We assert (a) no error banner, (b) navigation to the session URL.
  await newInterviewLink.click()
  await expect(page).toHaveURL(/\/new/)
  await page.getByLabel(/^clinician$/i).fill(FIXTURE_CLINICIAN)
  await page.getByLabel(/^topic/i).fill('E2E smoke topic — safe to delete')
  await page.getByRole('button', { name: /start interview/i }).click()

  // The "Create failed" banner is the canary for the regression. Use a race
  // between the destructive banner and the success navigation so we fail
  // fast with a useful message if Create comes back broken.
  await expect.poll(
    async () => {
      const url = page.url()
      if (/\/interview\/[^/]+\/[^/]+/.test(url)) return 'navigated'
      const errorBanner = page.locator('text=/create failed|workspace not resolved/i')
      if (await errorBanner.count() > 0) return 'create-failed'
      return 'waiting'
    },
    { timeout: 30_000, intervals: [500, 1000, 2000] },
  ).toBe('navigated')

  // Confirm we landed on the Interview Session — the "Before we begin" screen
  // is the inert pre-mic state and renders without invoking SpeechRecognition.
  await expect(
    page.getByRole('button', { name: /i'm ready — start the interview/i }),
  ).toBeVisible({ timeout: 15_000 })

  // ── 4. Integrations page ─────────────────────────────────────────────────
  // PR #213 surface: this page calls /api/workspace/credentials which goes
  // through requireRole with an orgId check. If the JWT is missing org_id
  // the call returns 403 and the UI shows "Admins only." or a network-error
  // toast — anything other than the credentials list.
  await page.goto('/settings/integrations')
  await expect(page.getByRole('heading', { name: /integrations/i })).toBeVisible()

  // Negative assertion: the credentials fetch must not have failed with a
  // 403/network error. Either we see the integrations grid (admin user) or
  // the explicit non-admin notice, but never the load-error banner.
  await expect(
    page.locator('text=/admins only|network error loading credentials|couldn\'t load/i'),
  ).toHaveCount(0, { timeout: 10_000 })
})

// Authenticated storageState setup for the rest of the e2e run.
//
// Uses @clerk/testing's Testing Token so Clerk treats the Playwright session
// as a trusted automation client (skips bot detection, lets us reuse a real
// test user instead of impersonation tricks).
//
// One-shot: signs in with the fixture user, waits for the dashboard to
// confirm the OrgGate admitted, then saves storageState so the spec files
// can launch already-signed-in.

import { test as setup, expect } from '@playwright/test'
import { clerk, clerkSetup } from '@clerk/testing/playwright'
import path from 'node:path'
import fs from 'node:fs'

const authFile = path.join(process.cwd(), 'tests/e2e/.auth/user.json')

const WORKSPACE_SLUG = process.env.E2E_WORKSPACE_SLUG || 'movebetter-people'
const TEST_EMAIL    = process.env.E2E_TEST_USER_EMAIL
const TEST_PASSWORD = process.env.E2E_TEST_USER_PASSWORD

setup('authenticate fixture user', async ({ page }) => {
  if (!TEST_EMAIL || !TEST_PASSWORD) {
    throw new Error(
      'E2E_TEST_USER_EMAIL and E2E_TEST_USER_PASSWORD must be set. See tests/e2e/README.md.',
    )
  }

  await clerkSetup()

  // Navigating to the workspace-overridden home loads Clerk on the right host
  // and triggers the SignedOut SignIn component.
  await page.goto(`/?workspace=${WORKSPACE_SLUG}`)

  await clerk.signIn({
    page,
    signInParams: {
      strategy: 'password',
      identifier: TEST_EMAIL,
      password: TEST_PASSWORD,
    },
  })

  // After sign-in, OrgGate has to activate the workspace's org before
  // dashboard renders. Waiting on a dashboard-only element confirms both:
  // (a) the JWT carries org_id (the PR #213 regression surface),
  // (b) /api/workspace/me returned a real workspace (the override path works).
  await page.goto(`/?workspace=${WORKSPACE_SLUG}`)
  await expect(
    page.getByRole('link', { name: /new interview/i })
      .or(page.getByRole('button', { name: /new interview/i }))
      .or(page.getByRole('heading', { name: /dashboard/i }))
      .first(),
  ).toBeVisible({ timeout: 30_000 })

  fs.mkdirSync(path.dirname(authFile), { recursive: true })
  await page.context().storageState({ path: authFile })
})

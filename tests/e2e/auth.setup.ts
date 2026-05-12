// Authenticated storageState setup for the rest of the e2e run.
//
// We use direct UI sign-in rather than @clerk/testing because the deployed
// preview boots with the prod Clerk instance (whatever VITE_CLERK_PUBLISHABLE_KEY
// is set to in Vercel Preview env), and @clerk/testing's testing tokens are a
// development-instance-only feature — prod rejects them with 400 on Clerk
// Frontend API bootstrap, which blocks window.Clerk from ever loading.
//
// One-shot: signs in by filling Clerk's <SignIn /> component (identifier →
// password), waits for OrgGate to admit, then saves storageState so the
// subsequent spec files launch already-signed-in.

import { test as setup, expect } from '@playwright/test'
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

  // Navigate to the workspace-overridden home; SignedOut path renders Clerk's
  // <SignIn /> component.
  await page.goto(`/?workspace=${WORKSPACE_SLUG}`)

  // Clerk's identifier (email) field. Clerk-JS renders it after the SPA mounts
  // and Clerk Frontend API bootstrap returns 200. A long timeout here also
  // doubles as a guard against Clerk failing to load — if window.Clerk doesn't
  // initialize, this just times out with a clear message.
  const emailField = page
    .getByLabel(/email address/i)
    .or(page.locator('input[name="identifier"]'))
    .first()
  await expect(emailField).toBeVisible({ timeout: 45_000 })
  await emailField.fill(TEST_EMAIL)

  await page.getByRole('button', { name: /continue/i }).first().click()

  const passwordField = page
    .getByLabel(/password/i)
    .or(page.locator('input[name="password"]'))
    .first()
  await expect(passwordField).toBeVisible({ timeout: 15_000 })
  await passwordField.fill(TEST_PASSWORD)

  await page.getByRole('button', { name: /continue|sign in/i }).first().click()

  // After sign-in, OrgGate has to activate the workspace's org before the
  // dashboard renders. Waiting on a dashboard-only element confirms both:
  // (a) the JWT carries org_id (the PR #213 regression surface),
  // (b) /api/workspace/me returned a real workspace (the override path works).
  await expect(
    page.getByRole('link', { name: /new interview/i })
      .or(page.getByRole('button', { name: /new interview/i }))
      .or(page.getByRole('heading', { name: /dashboard/i }))
      .first(),
  ).toBeVisible({ timeout: 30_000 })

  fs.mkdirSync(path.dirname(authFile), { recursive: true })
  await page.context().storageState({ path: authFile })
})

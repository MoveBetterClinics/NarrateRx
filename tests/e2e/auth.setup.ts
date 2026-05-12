// Authenticated storageState setup via Clerk Backend API sign-in tokens.
//
// We mint a single-use sign-in ticket server-side (using the prod Clerk
// secret key) and exchange it in-browser. This bypasses Clerk's UI flow
// entirely — no email field, no password, no `needs_client_trust` device
// verification, no MFA prompts, no bot-protection challenges. The ticket
// strategy is the documented Clerk pattern for backend-initiated auth in
// tests and is unaffected by Clerk's user-facing security toggles.

import { test as setup, expect } from '@playwright/test'
import { createClerkClient } from '@clerk/backend'
import path from 'node:path'
import fs from 'node:fs'

const authFile = path.join(process.cwd(), 'tests/e2e/.auth/user.json')

const TEST_EMAIL        = process.env.E2E_TEST_USER_EMAIL
const CLERK_SECRET_KEY  = process.env.CLERK_SECRET_KEY

setup('authenticate fixture user', async ({ page }) => {
  if (!TEST_EMAIL) {
    throw new Error('E2E_TEST_USER_EMAIL must be set. See tests/e2e/README.md.')
  }
  if (!CLERK_SECRET_KEY) {
    throw new Error('CLERK_SECRET_KEY must be set (prod Clerk sk_live_...). See README.')
  }

  const clerk = createClerkClient({ secretKey: CLERK_SECRET_KEY })

  // Resolve the fixture user. Backend SDK v1 returns either `{ data, totalCount }`
  // or `User[]` depending on minor version — handle both shapes.
  const userList: any = await clerk.users.getUserList({
    emailAddress: [TEST_EMAIL],
  })
  const users = Array.isArray(userList) ? userList : (userList?.data ?? [])
  const user = users[0]
  if (!user?.id) {
    throw new Error(
      `No Clerk user found for ${TEST_EMAIL}. Check the secret key is for the prod instance and the user exists in Users → Production.`,
    )
  }

  // Mint a single-use sign-in ticket. Tickets bypass MFA, bot protection,
  // and the new-device "needs_client_trust" challenge. Expire fast — we
  // exchange immediately.
  const ticketResp = await clerk.signInTokens.createSignInToken({
    userId: user.id,
    expiresInSeconds: 300,
  })
  const ticket = (ticketResp as any).token ?? (ticketResp as any).data?.token
  if (!ticket) {
    throw new Error('Clerk did not return a sign-in token; got: ' + JSON.stringify(ticketResp))
  }

  // Load the SPA so window.Clerk is initialized, then exchange the ticket
  // for an active session in the browser. setActive flips the session so
  // <SignedIn> renders and OrgGate can pick up the workspace's org.
  await page.goto('/')
  await page.waitForFunction(() => !!(window as any).Clerk?.loaded, null, {
    timeout: 30_000,
  })

  await page.evaluate(async (t) => {
    const c = (window as any).Clerk
    const signIn = await c.client.signIn.create({ strategy: 'ticket', ticket: t })
    if (signIn.status !== 'complete' || !signIn.createdSessionId) {
      throw new Error(`Ticket sign-in did not complete: status=${signIn.status}`)
    }
    await c.setActive({ session: signIn.createdSessionId })
  }, ticket)

  // After setActive, the app re-renders: ClerkProvider hydrates the session,
  // <SignedIn> mounts, OrgGate activates the workspace org, dashboard renders.
  await expect(
    page.getByRole('link', { name: /new interview/i })
      .or(page.getByRole('button', { name: /new interview/i }))
      .or(page.getByRole('heading', { name: /dashboard/i }))
      .first(),
  ).toBeVisible({ timeout: 30_000 })

  fs.mkdirSync(path.dirname(authFile), { recursive: true })
  await page.context().storageState({ path: authFile })
})

import { defineConfig, devices } from '@playwright/test'

// Base URL points at the workspace's production subdomain. The workflow
// runs post-deploy on main against `https://movebetter-people.narraterx.ai`
// (real prod, real Clerk, real DB). Local runs can override via E2E_BASE_URL
// to point at any reachable narraterx host that already includes a workspace
// subdomain.
const baseURL = process.env.E2E_BASE_URL || 'https://movebetter-people.narraterx.ai'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'tests/e2e/.auth/user.json',
      },
      dependencies: ['setup'],
    },
  ],
})

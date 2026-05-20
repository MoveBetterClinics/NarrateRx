#!/usr/bin/env node
// Writes public/version.json with the current build SHA + timestamp.
// Runs as a prebuild step so the deployed site has a version file that the
// running client can poll to detect new deploys.
//
// SHA source:
//   1. VERCEL_GIT_COMMIT_SHA (set automatically on every Vercel build)
//   2. `git rev-parse HEAD` (local builds)
//   3. literal "dev" (no git available)

import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

function resolveSha() {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return 'dev'
  }
}

const sha = resolveSha()
const builtAt = new Date().toISOString()
const payload = { sha, builtAt }

// Hard-fail only when a git-triggered Vercel deploy lost its SHA — that's a
// real bug (Vercel sets VERCEL_GIT_PROVIDER + VERCEL_GIT_COMMIT_SHA together
// on git-triggered builds, so a provider-without-sha state means something
// broke). CLI deploys (`vercel deploy --prod` from a machine with no .git in
// the upload) legitimately have neither var set; let those through with a
// "dev" sha — the client-side hook short-circuits on BUILT_SHA === 'dev'
// (see src/lib/useVersionCheck.js), so the auto-update modal simply won't
// fire for that deploy.
if (process.env.VERCEL_GIT_PROVIDER && !process.env.VERCEL_GIT_COMMIT_SHA) {
  console.error('[write-version] Git-triggered Vercel build is missing VERCEL_GIT_COMMIT_SHA — refusing to ship without a real SHA.')
  process.exit(1)
}
if (sha === 'dev') {
  console.warn('[write-version] resolved sha="dev" — auto-update notifier will be disabled for this build. For CLI prod deploys, use `npm run deploy:prod` to inject the local git SHA.')
}

const outPath = path.join(root, 'public', 'version.json')
fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n')

console.log(`[write-version] sha=${sha.slice(0, 7)} builtAt=${builtAt}`)

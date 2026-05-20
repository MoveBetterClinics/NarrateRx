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

// CI builds MUST resolve a real SHA — otherwise the client's auto-update
// poller silently never fires (or, worse, never matches against the
// running bundle's BUILT_SHA and shows a perpetual "new version" modal).
// Local builds without git are still fine; they fall through to "dev" and
// the client-side hook short-circuits on BUILT_SHA === 'dev'.
const isCi = !!(process.env.VERCEL || process.env.CI)
if (isCi && sha === 'dev') {
  console.error('[write-version] CI build resolved sha="dev" — refusing to ship a deploy without a real SHA. Check VERCEL_GIT_COMMIT_SHA / git availability in the build environment.')
  process.exit(1)
}

const outPath = path.join(root, 'public', 'version.json')
fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n')

console.log(`[write-version] sha=${sha.slice(0, 7)} builtAt=${builtAt}`)

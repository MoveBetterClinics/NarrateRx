#!/usr/bin/env node
// Verify that all Vercel function bundles in .vercel/output/functions/:
//   1. Declare runtime: 'nodejs' in their .vc-config.json
//   2. Load without crashing under `node --input-type=module import(...)`
//
// Run after `npx vercel build` (which produces .vercel/output/):
//   npm run verify:bundles
//
// Exits non-zero on any failure and prints the offending bundle path.
// Use this when debugging ERR_INTERNAL_ASSERTION crashes — the import()
// smoke reproduces SyntaxError-at-module-link-time locally before deploying.

import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const OUTPUT_DIR = resolve('.vercel/output/functions')

// Functions that are intentionally Edge runtime (none currently, but add here if needed).
const EDGE_ALLOWLIST = new Set([
  // e.g. 'api/some-edge-fn.func'
])

async function listFuncDirs(dir) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    console.error(`\nverify-function-bundles: .vercel/output/functions not found.`)
    console.error(`Run \`npx vercel build\` first, then re-run this script.\n`)
    process.exit(1)
  }
  return entries.filter((e) => e.isDirectory() && e.name.endsWith('.func')).map((e) => e.name)
}

async function readVcConfig(funcDir) {
  const configPath = join(OUTPUT_DIR, funcDir, '.vc-config.json')
  try {
    const raw = await readFile(configPath, 'utf8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

async function smokeImport(funcDir) {
  const indexPath = join(OUTPUT_DIR, funcDir, 'index.js')
  const fileUrl = pathToFileURL(indexPath).href
  try {
    await execFileAsync(process.execPath, ['--input-type=module'], {
      input: `await import(${JSON.stringify(fileUrl)})`,
      timeout: 15_000,
    })
    return null
  } catch (err) {
    const msg = err.stderr || err.message || String(err)
    return msg.trim()
  }
}

async function main() {
  const funcDirs = await listFuncDirs(OUTPUT_DIR)
  if (funcDirs.length === 0) {
    console.log('No function bundles found in .vercel/output/functions/ — nothing to check.')
    process.exit(0)
  }

  console.log(`Checking ${funcDirs.length} function bundle(s)...\n`)

  const failures = []

  for (const funcDir of funcDirs) {
    const isAllowlisted = EDGE_ALLOWLIST.has(funcDir)
    const config = await readVcConfig(funcDir)

    // 1. Manifest runtime check.
    if (!isAllowlisted) {
      if (!config) {
        failures.push({ funcDir, reason: 'missing .vc-config.json' })
        continue
      }
      if (config.runtime !== 'nodejs') {
        failures.push({
          funcDir,
          reason: `runtime is ${JSON.stringify(config.runtime ?? '(missing)')} — expected 'nodejs'. Add to EDGE_ALLOWLIST if intentional.`,
        })
        continue
      }
    }

    // 2. Import smoke test.
    const importErr = await smokeImport(funcDir)
    if (importErr) {
      failures.push({
        funcDir,
        reason: `import smoke failed:\n${importErr.split('\n').map((l) => '    ' + l).join('\n')}`,
      })
    } else {
      console.log(`  ✓ ${funcDir}`)
    }
  }

  if (failures.length === 0) {
    console.log(`\nAll bundles are healthy.`)
    process.exit(0)
  }

  console.error(`\n${failures.length} bundle(s) failed:\n`)
  for (const { funcDir, reason } of failures) {
    console.error(`  ✗ ${funcDir}\n    ${reason}\n`)
  }
  process.exit(1)
}

main()

#!/usr/bin/env node
/**
 * NarrateRx Caption Voice Fidelity — CI gate
 *
 * V1 of the "Deepen the video build" extension set. Reads a committed
 * fixture file written by scripts/voice-fidelity-captions.mjs and refuses
 * to ship when the average dips below the baseline minus a tunable
 * threshold. The fixture is refreshed offline against the live DB; CI
 * never needs SUPABASE / AI_GATEWAY credentials.
 *
 * Why this shape:
 *   - GitHub Actions PR builds don't carry the AI gateway key, and we
 *     don't want to expand CI's secret surface for a quality gate.
 *   - Committed fixture = explicit human checkpoint. Someone runs the
 *     scorer, reviews the dashboard, commits the fixture. The ratchet is
 *     auditable in git history.
 *   - The gate is mechanical: read JSON, compare to threshold, exit 0/1.
 *
 * Fixture path: .claude/voice-fidelity-captions-fixture.json
 *
 * Env:
 *   VOICE_FIDELITY_GATE_BASELINE   (default: 4.8)  — recalibrated 2026-05-31 for the
 *                                                   faithfulness-v2 rubric (api/_lib/
 *                                                   captionFidelityRubric.js). The new rubric
 *                                                   grades against the clip transcript and no
 *                                                   longer rewards clinical register, so its
 *                                                   numbers are NOT comparable to the old ~5.97.
 *                                                   Observed avg on the existing corpus under the
 *                                                   new rubric is ~5.06; default sits below it so
 *                                                   the gate ratchets regressions, not
 *                                                   improvements. Raise as captions improve.
 *   VOICE_FIDELITY_GATE_PCT        (default: 0.05) — allowed dip below baseline (5%)
 *   VOICE_FIDELITY_GATE_MIN_SAMPLE (default: 5)    — refuse to gate if fixture too small
 *   VOICE_FIDELITY_GATE_MAX_AGE_D  (default: 30)   — fail if fixture older than N days
 *
 * Exit codes:
 *   0  — pass OR skipped (no fixture / disabled / opt-out)
 *   1  — fail (avg below threshold, fixture too small, stale, or malformed)
 *
 * Skipping returns 0 by design so a brand-new checkout doesn't fail CI.
 * Once the fixture is committed once, the gate enforces. To intentionally
 * disable, set VOICE_FIDELITY_GATE_DISABLED=1.
 */

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'

const FIXTURE_PATH = '.claude/voice-fidelity-captions-fixture.json'

const BASELINE   = parseFloat(process.env.VOICE_FIDELITY_GATE_BASELINE   || '4.8')
const PCT        = parseFloat(process.env.VOICE_FIDELITY_GATE_PCT        || '0.05')
const MIN_SAMPLE = parseInt(process.env.VOICE_FIDELITY_GATE_MIN_SAMPLE   || '5', 10)
const MAX_AGE_D  = parseInt(process.env.VOICE_FIDELITY_GATE_MAX_AGE_D    || '30', 10)
const DISABLED   = process.env.VOICE_FIDELITY_GATE_DISABLED === '1'

function out(line) { process.stdout.write(`${line}\n`) }
function exitSkip(reason) { out(`⚠ caption-fidelity gate skipped: ${reason}`); process.exit(0) }
function exitPass(reason) { out(`✓ caption-fidelity gate pass: ${reason}`); process.exit(0) }
function exitFail(reason) { out(`✗ caption-fidelity gate FAIL: ${reason}`); process.exit(1) }

if (DISABLED) exitSkip('VOICE_FIDELITY_GATE_DISABLED=1')

if (!existsSync(FIXTURE_PATH)) {
  exitSkip(`fixture not present at ${FIXTURE_PATH} — run scripts/voice-fidelity-captions.mjs --fixture-out=${FIXTURE_PATH}`)
}

let fixture
try {
  fixture = JSON.parse(await readFile(FIXTURE_PATH, 'utf8'))
} catch (e) {
  exitFail(`fixture is unreadable JSON: ${e.message}`)
}

const meta = fixture?.meta ?? {}
const samples = Array.isArray(fixture?.samples) ? fixture.samples : []
const scoredSamples = samples.filter((s) => typeof s?.overall === 'number')

if (scoredSamples.length < MIN_SAMPLE) {
  exitFail(`fixture has ${scoredSamples.length} scored samples (need ≥ ${MIN_SAMPLE}). Refresh with scripts/voice-fidelity-captions.mjs --fixture-out=${FIXTURE_PATH}`)
}

if (meta.generatedAt) {
  const ageMs = Date.now() - new Date(meta.generatedAt).getTime()
  const ageDays = ageMs / (1000 * 60 * 60 * 24)
  if (ageDays > MAX_AGE_D) {
    exitFail(`fixture is ${ageDays.toFixed(1)}d old (max ${MAX_AGE_D}d). Refresh it.`)
  }
}

const avg = scoredSamples.reduce((s, x) => s + x.overall, 0) / scoredSamples.length
const floor = BASELINE * (1 - PCT)

out(`  baseline:    ${BASELINE.toFixed(2)}`)
out(`  tolerance:   ${(PCT * 100).toFixed(1)}%`)
out(`  floor:       ${floor.toFixed(2)}`)
out(`  fixture avg: ${avg.toFixed(2)} (n=${scoredSamples.length})`)
out(`  fixture age: ${meta.generatedAt || '(unknown)'}`)

if (avg < floor) {
  // List the offenders to make the failure actionable.
  const offenders = [...scoredSamples]
    .filter((s) => s.overall < floor)
    .sort((a, b) => a.overall - b.overall)
    .slice(0, 5)
  out('')
  out('Worst-scoring samples (below floor):')
  for (const s of offenders) {
    out(`  - ${s.overall}/10  ${(s.staffName || '?').slice(0, 18).padEnd(18)} "${(s.topic || '').slice(0, 60)}"`)
    if (s.breakdown?.red_flag && s.breakdown.red_flag !== 'none') {
      out(`       red flag: ${s.breakdown.red_flag}`)
    }
  }
  exitFail(`avg ${avg.toFixed(2)} < floor ${floor.toFixed(2)} (baseline ${BASELINE} × ${1 - PCT})`)
}

exitPass(`avg ${avg.toFixed(2)} ≥ floor ${floor.toFixed(2)}`)

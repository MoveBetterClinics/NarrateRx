#!/usr/bin/env node
/**
 * G6 Video Onboarding Smoke
 *
 * Phase 6 chaos-harness extension. Validates that the onboarding claim flow
 * correctly handles the three Phase 6 additions:
 *
 *   1. video_pipeline_enabled=true — every new workspace gets the video
 *      pipeline on by default (asserted via schema check + static logic check)
 *
 *   2. capture_name field — the founding clinician's display name is accepted,
 *      sanitized to 80 chars, and falls back to display_name when blank
 *
 *   3. clinicians.user_id exists on prod — schema guard so the clinician seed
 *      in claim.js doesn't 500 on a missing column
 *
 * Complements `scripts/synthetic-onboarding-harness.mjs` (the 50-profile
 * validation suite) — this script focuses only on Phase 6 additions.
 *
 * Usage:
 *   node scripts/g6-video-onboarding-smoke.mjs
 *
 * Required env (from .env.local):
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY
 *
 * Exit codes:
 *   0 — all assertions green (G6 gate passes)
 *   1 — one or more assertions failed (G6 gate red — fix before releasing)
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'

// ── env ──────────────────────────────────────────────────────────────────────
const envText = await readFile('.env.local', 'utf8').catch(() => '')
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
}

for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY']) {
  if (!process.env[k] || process.env[k].includes('REDACTED')) {
    console.error(`✗ Missing or redacted env: ${k}`)
    process.exit(1)
  }
}

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  })
  if (!r.ok) throw new Error(`Supabase ${r.status} on ${path}: ${await r.text().catch(() => '')}`)
  return r.json()
}

// ── Assertion tracker ─────────────────────────────────────────────────────────
const results = []

function assert(label, condition, detail = '') {
  const passed = Boolean(condition)
  results.push({ label, passed, detail })
  const icon = passed ? '✓' : '✗'
  const msg = detail ? `  ${detail}` : ''
  console.log(`  ${icon} ${label}${msg}`)
  return passed
}

// ── Mirrors claim.js sanitizeStr ─────────────────────────────────────────────
function sanitizeStr(v, max = 2000) {
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!s) return null
  return s.slice(0, max)
}

// ── Import validation helpers ─────────────────────────────────────────────────
const { validateSlug } = await import('../api/_lib/onboardingValidation.js')

// ═══════════════════════════════════════════════════════════════════════════════
// Block 1 — Schema guards
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n🔍 Block 1 — Schema guards\n')

let workspaceColumns, clinicianColumns
try {
  workspaceColumns = await sbGet(
    "rpc/get_columns?table_name=workspaces"
  ).catch(async () => {
    // Fallback: query information_schema via PostgREST RPC isn't available by default;
    // instead probe by selecting the column directly (returns 200 with an array, or 400
    // if the column doesn't exist).
    const probe = await fetch(
      `${SUPABASE_URL}/rest/v1/workspaces?select=video_pipeline_enabled&limit=1`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    )
    return { _status: probe.status }
  })
} catch (e) {
  workspaceColumns = { _error: e.message }
}

// Probe workspaces.video_pipeline_enabled
{
  const probe = await fetch(
    `${SUPABASE_URL}/rest/v1/workspaces?select=video_pipeline_enabled&limit=1`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  )
  assert(
    'workspaces.video_pipeline_enabled column exists',
    probe.ok,
    probe.ok ? '' : `→ got HTTP ${probe.status} — run migration 083_video_pipeline_flag.sql`
  )
}

// Probe clinicians.user_id
{
  const probe = await fetch(
    `${SUPABASE_URL}/rest/v1/staff?select=user_id&limit=1`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  )
  assert(
    'clinicians.user_id column exists',
    probe.ok,
    probe.ok ? '' : `→ got HTTP ${probe.status} — run migration 051_clinician_user_id.sql`
  )
}

// Confirm existing Move Better workspaces have video_pipeline_enabled=true
{
  const rows = await sbGet(
    'workspaces?status=eq.active&select=slug,video_pipeline_enabled&slug=in.(movebetter-people,movebetter-equine,movebetter-animals)'
  ).catch(() => null)
  if (rows && rows.length > 0) {
    const allEnabled = rows.every(r => r.video_pipeline_enabled === true)
    assert(
      'Seed workspaces have video_pipeline_enabled=true',
      allEnabled,
      allEnabled ? `(${rows.map(r => r.slug).join(', ')})` :
        `→ disabled on: ${rows.filter(r => !r.video_pipeline_enabled).map(r => r.slug).join(', ')}`
    )
  } else {
    assert('Seed workspaces have video_pipeline_enabled=true', false,
      '→ could not load seed workspaces from DB')
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Block 2 — capture_name field logic
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n🔍 Block 2 — capture_name field logic\n')

// 2a. Well-formed capture_name is preserved
{
  const raw = 'Dr. Sarah Chen'
  const result = sanitizeStr(raw, 80)
  assert('Well-formed capture_name passes through', result === raw)
}

// 2b. Long capture_name is truncated to 80 chars
{
  const raw = 'A'.repeat(100)
  const result = sanitizeStr(raw, 80)
  assert(
    'capture_name truncates to 80 chars',
    result !== null && result.length === 80,
    `got length ${result?.length}`
  )
}

// 2c. Empty string falls through to null (triggers display_name fallback)
{
  const raw = '   '
  const result = sanitizeStr(raw, 80)
  assert('Blank capture_name → null (fallback to display_name)', result === null)
}

// 2d. null/undefined → null (fallback)
{
  assert('null capture_name → null', sanitizeStr(null, 80) === null)
  assert('undefined capture_name → null', sanitizeStr(undefined, 80) === null)
}

// 2e. display_name fallback logic (mirrors: sanitizeStr(body.capture_name, 80) || display_name)
{
  const testCases = [
    { capture_name: 'Dr. Kate', display_name: 'Kate Chiro', expected: 'Dr. Kate' },
    { capture_name: '', display_name: 'Kate Chiro', expected: 'Kate Chiro' },
    { capture_name: null, display_name: 'Kate Chiro', expected: 'Kate Chiro' },
    { capture_name: '   ', display_name: 'Kate Chiro', expected: 'Kate Chiro' },
  ]
  for (const tc of testCases) {
    const result = sanitizeStr(tc.capture_name, 80) || tc.display_name
    assert(
      `capture_name="${tc.capture_name ?? 'null'}" → "${tc.expected}"`,
      result === tc.expected,
      result !== tc.expected ? `got "${result}"` : ''
    )
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Block 3 — video_pipeline_enabled=true in claim.js insertBody
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n🔍 Block 3 — claim.js insertBody audit\n')

// Read the claim.js source and verify the flag is present in insertBody
const claimSrc = await readFile('api/onboarding/claim.js', 'utf8').catch(() => null)

assert(
  'claim.js sets video_pipeline_enabled: true in insertBody',
  claimSrc && /video_pipeline_enabled:\s*true/.test(claimSrc),
  claimSrc ? '' : '→ could not read api/onboarding/claim.js'
)

assert(
  'claim.js seeds clinicians row after workspace insert',
  claimSrc && /sb\('staff'.*method.*POST/s.test(claimSrc),
  claimSrc ? '' : '→ clinician seed call not found in claim.js'
)

assert(
  'claim.js reads capture_name from request body',
  claimSrc && /capture_name/.test(claimSrc),
  claimSrc ? '' : '→ capture_name not referenced in claim.js'
)

// Verify capture_name falls back to display_name in claim.js
assert(
  'claim.js uses display_name as capture_name fallback',
  claimSrc && /capture_name.*\|\|.*display_name|display_name.*\|\|.*capture_name/.test(claimSrc),
  ''
)

// ═══════════════════════════════════════════════════════════════════════════════
// Block 4 — video-enabled tenant profiles
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n🔍 Block 4 — Video-enabled tenant profile validation\n')

const VIDEO_TENANTS = [
  // Happy path: well-formed video tenants with capture_name
  { slug: 'video-chiro-portland', display_name: 'Portland Sport Chiro', _specialty: 'chiropractic',
    capture_name: 'Dr. Alex Kim',
    enabled_outputs: ['blog', 'instagram', 'facebook'],
    locations: [{ city: 'Portland', region: 'OR' }],
    clinic_context: 'Sports chiro for Portland cyclists and runners.',
    brand_voice: 'Direct and evidence-based.' },

  { slug: 'video-pt-seattle', display_name: 'Seattle Movement PT', _specialty: 'PT',
    capture_name: 'Dr. Jordan Walsh',
    enabled_outputs: ['blog', 'instagram'],
    locations: [{ city: 'Seattle', region: 'WA' }],
    clinic_context: 'Sports PT for Seattle tech workers and athletes.',
    brand_voice: 'Clear and modern.' },

  { slug: 'video-integrated-denver', display_name: 'Denver Integrated Care', _specialty: 'integrative',
    capture_name: 'Dr. Maria Santos',
    enabled_outputs: ['blog', 'linkedin', 'instagram'],
    locations: [{ city: 'Denver', region: 'CO' }],
    clinic_context: 'Chiro and acupuncture in Denver.',
    brand_voice: 'Thoughtful and team-based.' },

  // capture_name edge cases
  { slug: 'video-long-name', display_name: 'Long Name Clinic', _specialty: 'chiropractic',
    capture_name: 'A'.repeat(100), // should truncate to 80
    enabled_outputs: ['blog'],
    locations: [{ city: 'Austin', region: 'TX' }] },

  { slug: 'video-no-capname', display_name: 'No Cap Name Clinic', _specialty: 'chiropractic',
    capture_name: null, // should fall back to display_name
    enabled_outputs: ['blog', 'instagram'],
    locations: [{ city: 'Nashville', region: 'TN' }] },

  { slug: 'video-blank-capname', display_name: 'Blank Cap Name Clinic', _specialty: 'PT',
    capture_name: '   ', // whitespace-only → null → fallback
    enabled_outputs: ['blog'],
    locations: [{ city: 'Chicago', region: 'IL' }] },

  // Multi-location video tenant
  { slug: 'video-multi-loc', display_name: 'Multi Location Video Group', _specialty: 'chiropractic',
    capture_name: 'Dr. Sam Taylor',
    enabled_outputs: ['blog', 'instagram', 'facebook'],
    locations: [
      { city: 'Dallas', region: 'TX', label: 'Uptown' },
      { city: 'Fort Worth', region: 'TX', label: 'Fort Worth Clinic' },
    ] },

  // Veterinary video tenant (prompt_mode concern)
  { slug: 'video-vet-clinic', display_name: 'Mountain Vet Rehab', _specialty: 'vet',
    capture_name: 'Dr. Casey Hill',
    enabled_outputs: ['blog', 'instagram'],
    locations: [{ city: 'Bozeman', region: 'MT' }],
    clinic_context: 'Equine and canine rehab.' },

  // Minimal video tenant
  { slug: 'video-minimal', display_name: 'Minimal Video Clinic', _specialty: 'chiropractic',
    capture_name: 'Dr. Min',
    enabled_outputs: ['blog'],
    locations: [{ city: 'Phoenix', region: 'AZ' }] },

  // Unicode in capture_name (international)
  { slug: 'video-clinic-mtl', display_name: 'Clinique Santé Montréal', _specialty: 'chiropractic',
    capture_name: 'Dr. François Béland',
    enabled_outputs: ['blog', 'instagram'],
    locations: [{ city: 'Montréal', region: 'QC' }] },
]

let profilesPassed = 0
let profilesFailed = 0

for (const tenant of VIDEO_TENANTS) {
  const issues = []

  // Slug validation
  const slugCheck = validateSlug(tenant.slug)
  if (!slugCheck.ok) issues.push(`slug invalid: ${slugCheck.reason}`)

  // display_name required
  if (!sanitizeStr(tenant.display_name, 200)) issues.push('display_name missing')

  // enabled_outputs non-empty (simplified — just checks array is non-empty)
  if (!Array.isArray(tenant.enabled_outputs) || tenant.enabled_outputs.length === 0) {
    issues.push('enabled_outputs empty')
  }

  // capture_name: resolve final value (mirrors claim.js logic)
  const resolvedCaptureName = sanitizeStr(tenant.capture_name, 80) || tenant.display_name
  if (!resolvedCaptureName) issues.push('capture_name could not resolve (display_name also blank)')
  if (resolvedCaptureName && resolvedCaptureName.length > 80) {
    issues.push(`resolved capture_name too long: ${resolvedCaptureName.length}`)
  }

  const passed = issues.length === 0
  if (passed) profilesPassed++; else profilesFailed++

  const icon = passed ? '✓' : '✗'
  const nameInfo = resolvedCaptureName ? ` → capture_name="${resolvedCaptureName.slice(0, 30)}${resolvedCaptureName.length > 30 ? '…' : ''}"` : ''
  const errInfo = issues.length ? `  ISSUES: ${issues.join(', ')}` : ''
  console.log(`  ${icon} ${tenant.slug.padEnd(28)}${nameInfo}${errInfo}`)
}

assert(
  `All ${VIDEO_TENANTS.length} video-enabled profiles pass validation`,
  profilesFailed === 0,
  profilesFailed > 0 ? `→ ${profilesFailed} profile(s) failed` : ''
)

// ═══════════════════════════════════════════════════════════════════════════════
// Block 5 — PWA manifest present and wired
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n🔍 Block 5 — PWA manifest\n')

const manifestSrc = await readFile('public/manifest.json', 'utf8').catch(() => null)
let manifest = null
try { manifest = JSON.parse(manifestSrc) } catch { /* noop */ }

assert('public/manifest.json exists', manifestSrc !== null)
assert('manifest.start_url is /capture', manifest?.start_url === '/capture',
  manifest ? `got ${manifest.start_url}` : '')
assert('manifest.display is standalone', manifest?.display === 'standalone',
  manifest ? `got ${manifest.display}` : '')
assert('manifest has icons array', Array.isArray(manifest?.icons) && manifest.icons.length > 0)

const indexSrc = await readFile('index.html', 'utf8').catch(() => null)
assert('index.html references manifest.json',
  indexSrc && indexSrc.includes('rel="manifest"') && indexSrc.includes('manifest.json'),
  indexSrc ? '' : '→ could not read index.html')

// ═══════════════════════════════════════════════════════════════════════════════
// Results
// ═══════════════════════════════════════════════════════════════════════════════
const passed = results.filter(r => r.passed).length
const failed = results.filter(r => !r.passed).length
const total = results.length

console.log('\n' + '═'.repeat(60))
console.log(`G6 Video Onboarding Smoke: ${passed}/${total} assertions passed`)
if (failed > 0) {
  console.log(`\n⚠️  ${failed} FAILED:\n`)
  for (const r of results.filter(r => !r.passed)) {
    console.log(`  ✗ ${r.label}`)
    if (r.detail) console.log(`    ${r.detail}`)
  }
}
console.log('═'.repeat(60) + '\n')

// Write report
const dateStr = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '')
const outPath = `.claude/g6-video-smoke-${dateStr}.md`
const reportMd = `# G6 Video Onboarding Smoke — ${new Date().toISOString().slice(0, 10)}

**Result:** ${failed === 0 ? '✅ ALL GREEN' : `❌ ${failed} FAILED`}
**Assertions:** ${passed}/${total} passed

## Blocks

### Block 1 — Schema guards
${results.filter(r => r.label.includes('column') || r.label.includes('workspace') || r.label.includes('Seed')).map(r => `- ${r.passed ? '✓' : '✗'} ${r.label}${r.detail ? ` — ${r.detail}` : ''}`).join('\n')}

### Block 2 — capture_name field logic
${results.filter(r => r.label.includes('capture_name') || r.label.includes('blank') || r.label.includes('truncat') || r.label.includes('null') || r.label.includes('undefined') || r.label.includes('"Dr.')).map(r => `- ${r.passed ? '✓' : '✗'} ${r.label}${r.detail ? ` — ${r.detail}` : ''}`).join('\n')}

### Block 3 — claim.js source audit
${results.filter(r => r.label.includes('claim.js')).map(r => `- ${r.passed ? '✓' : '✗'} ${r.label}${r.detail ? ` — ${r.detail}` : ''}`).join('\n')}

### Block 4 — Video-enabled tenant profiles (${VIDEO_TENANTS.length} profiles)
- ${profilesPassed} passed, ${profilesFailed} failed

### Block 5 — PWA manifest
${results.filter(r => r.label.includes('manifest') || r.label.includes('display') || r.label.includes('start_url') || r.label.includes('icons') || r.label.includes('index.html')).map(r => `- ${r.passed ? '✓' : '✗'} ${r.label}${r.detail ? ` — ${r.detail}` : ''}`).join('\n')}

## G6 Audit Gate

${failed === 0
  ? '**PASS** — all Phase 6 video onboarding additions validated. Safe to merge and close the G6 gate.'
  : `**FAIL** — fix the ${failed} failing assertion(s) above before declaring G6 complete.`}

_Re-run: \`node scripts/g6-video-onboarding-smoke.mjs\`_
`

try {
  if (!existsSync('.claude')) await mkdir('.claude', { recursive: true })
  await writeFile(outPath, reportMd, 'utf8')
  console.log(`Report: ${outPath}`)
} catch (e) {
  console.error('Could not write report:', e.message)
}

process.exit(failed === 0 ? 0 : 1)

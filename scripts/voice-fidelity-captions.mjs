#!/usr/bin/env node
/**
 * NarrateRx Caption Voice Fidelity Scorer
 *
 * V1 of the "Deepen the video build" extension set. Scores caption_text +
 * topic (thumbnail title equivalent) on story_packages against the owning
 * clinician's voice phrase corpus. Persists the score on the row so:
 *   1. The Story Director Slate can render a fidelity badge per card.
 *   2. The CI gate (scripts/verify-caption-fidelity.mjs) can refuse to
 *      ship when average fidelity dips below baseline.
 *
 * Captures are SHORT-form. The dimension set mirrors the long-form scorer
 * (scripts/voice-fidelity-score.mjs) so the two dashboards are comparable,
 * but the evaluator prompt is tuned for the short, distribution-channel
 * text that lives on a package.
 *
 * Usage:
 *   node scripts/voice-fidelity-captions.mjs [--workspace=<slug>]
 *                                            [--package-id=<uuid>]
 *                                            [--limit=<n>] [--since=<date>]
 *                                            [--fixture-out=<path>]
 *                                            [--no-persist]
 *
 * Options:
 *   --workspace=<slug>     Scope to one workspace (default: all)
 *   --package-id=<uuid>    Score one specific package (overrides --workspace/--limit)
 *   --limit=<n>            Max packages to score (default: 50)
 *   --since=<YYYY-MM-DD>   Only score packages created after this date
 *   --status=<s,s,...>     Statuses to include (default: complete)
 *   --fixture-out=<path>   Also write a CI fixture file
 *   --no-persist           Skip persisting score back to story_packages
 *
 * Required env (from .env.local):
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY, AI_GATEWAY_API_KEY
 *
 * Output:
 *   .claude/voice-fidelity-captions-<date>.md   (dashboard)
 *   .claude/voice-fidelity-captions-raw-<date>.json
 *   Plus (when --fixture-out set) a CI fixture file.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { generateText } from 'ai'

// ── env ──────────────────────────────────────────────────────────────────────
const envText = await readFile('.env.local', 'utf8').catch(() => '')
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
}

const args = process.argv.slice(2)
function arg(name, fallback = null) {
  const m = args.find((a) => a.startsWith(`--${name}=`))
  return m ? m.split('=').slice(1).join('=') : fallback
}
const WORKSPACE_SLUG = arg('workspace')
const PACKAGE_ID     = arg('package-id')
const LIMIT          = parseInt(arg('limit', '50'), 10)
const SINCE          = arg('since')
const STATUS_FILTER  = (arg('status', 'complete') || 'complete').split(',').filter(Boolean)
const FIXTURE_OUT    = arg('fixture-out')
const PERSIST        = !args.includes('--no-persist')

for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'AI_GATEWAY_API_KEY']) {
  if (!process.env[k] || process.env[k].includes('REDACTED')) {
    console.error(`✗ Missing or redacted env: ${k}`)
    process.exit(1)
  }
}

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const EVAL_MODEL   = 'anthropic/claude-haiku-4-5'

// ── Supabase helpers ──────────────────────────────────────────────────────────
function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}
async function sbGet(path) {
  const r = await sb(path)
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${path} — ${(await r.text()).slice(0, 200)}`)
  return r.json()
}

// ── Load data ─────────────────────────────────────────────────────────────────
console.log('\n📦 Loading data from Supabase…')

// Workspaces
const wsFilter = WORKSPACE_SLUG ? `slug=eq.${WORKSPACE_SLUG}&` : ''
const workspaces = await sbGet(`workspaces?${wsFilter}select=id,slug,display_name`)
if (!workspaces.length) { console.error('No workspaces found'); process.exit(1) }
const workspaceMap = Object.fromEntries(workspaces.map((w) => [w.id, w]))
const wsIds = workspaces.map((w) => w.id)
console.log(`  ✓ Workspaces: ${workspaces.map((w) => w.slug).join(', ')}`)

// Clinicians
const clinicians = await sbGet(
  `staff?workspace_id=in.(${wsIds.join(',')})&select=id,name,workspace_id,voice_notes`
)
const staffMap = Object.fromEntries(clinicians.map((c) => [c.id, c]))
console.log(`  ✓ Clinicians: ${clinicians.length}`)

// Voice phrases
const cIds = clinicians.map((c) => c.id)
const phraseRows = cIds.length
  ? await sbGet(`staff_voice_phrases?staff_id=in.(${cIds.join(',')})&select=staff_id,phrase,weight&order=weight.desc`)
  : []
const phrasesMap = {}
for (const p of phraseRows) {
  if (!phrasesMap[p.staff_id]) phrasesMap[p.staff_id] = []
  phrasesMap[p.staff_id].push(p)
}
console.log(`  ✓ Voice phrases: ${phraseRows.length} across ${Object.keys(phrasesMap).length} clinicians`)

// Story packages
let packages = []
if (PACKAGE_ID) {
  packages = await sbGet(`story_packages?id=eq.${PACKAGE_ID}&select=id,workspace_id,staff_id,topic,caption_text,status,created_at`)
  if (!packages.length) { console.error(`Package ${PACKAGE_ID} not found`); process.exit(1) }
  // Verify it belongs to one of our in-scope workspaces.
  if (!wsIds.includes(packages[0].workspace_id)) {
    console.error('Package is outside the requested workspace scope')
    process.exit(1)
  }
} else {
  const statusIn = STATUS_FILTER.length === 1 ? `status=eq.${STATUS_FILTER[0]}` : `status=in.(${STATUS_FILTER.join(',')})`
  const perWsLimit = Math.max(1, Math.ceil(LIMIT / wsIds.length))
  for (const wsId of wsIds) {
    let p = `story_packages?workspace_id=eq.${wsId}&${statusIn}&select=id,workspace_id,staff_id,topic,caption_text,status,created_at&order=created_at.desc&limit=${perWsLimit}`
    if (SINCE) p += `&created_at=gte.${SINCE}`
    const rows = await sbGet(p)
    packages.push(...rows)
  }
  packages = packages.slice(0, LIMIT)
}
console.log(`  ✓ Packages to score: ${packages.length}`)

// ── Evaluator ─────────────────────────────────────────────────────────────────
function buildEvalPrompt({ topic, caption, staffName, phrases, workspaceName }) {
  const phraseExamples = (phrases || []).slice(0, 8).map((p) => `- "${p.phrase}"`).join('\n')
  const hasPhrases = phraseExamples.length > 0

  return {
    system:
`You are a precise content quality evaluator for SHORT social-distribution copy
(captions + thumbnail titles). Score the package on multiple voice fidelity
dimensions. Return ONLY valid JSON — no markdown, no preamble, no commentary.`,
    user:
`Evaluate this story package — a thumbnail title + accompanying caption that
will be burned into video subtitles and posted as the social caption. Written
for ${staffName} at ${workspaceName}.

${hasPhrases
  ? `CLINICIAN'S AUTHENTIC VOICE PHRASES (use these to judge fidelity):
${phraseExamples}`
  : `(No voice phrases on record for this clinician yet — score voice_fidelity at 5 if you can't compare.)`}

TITLE (thumbnail text, ${(topic || '').length} chars):
"${topic || ''}"

CAPTION (subtitle + social copy, ${(caption || '').length} chars):
"${caption || ''}"

Score each dimension 1–10 and return this exact JSON shape (no other keys):
{
  "voice_fidelity": <1-10; rhythm + word choice match to the voice phrases above${hasPhrases ? '' : '; score 5 if no phrases'}>,
  "clinical_texture": <1-10; sounds like a real practitioner, not generic content-mill>,
  "redundancy": <1-10 INVERSE — 10=tight no repetition, 1=title and caption restate each other>,
  "specificity": <1-10; concrete vs vague (real anatomy, technique names, situations, not platitudes)>,
  "brand_fit": <1-10; feels like an authentic practice voice, not a corporate template>,
  "red_flag": "<one short phrase: the single biggest issue, or 'none'>"
}`,
  }
}

// ── Main scoring loop ─────────────────────────────────────────────────────────
console.log(`\n🔬 Scoring ${packages.length} packages with ${EVAL_MODEL}…\n`)

const scored = []
let skipped = 0

for (let i = 0; i < packages.length; i++) {
  const pkg = packages[i]
  const clinician = staffMap[pkg.staff_id]
  const workspace = workspaceMap[pkg.workspace_id]
  const phrases = phrasesMap[pkg.staff_id] || []

  const captionText = (pkg.caption_text || '').trim()
  const topicText = (pkg.topic || '').trim()
  if (!captionText && !topicText) {
    skipped++
    continue
  }

  const cName = clinician?.name || 'unknown clinician'
  const wName = workspace?.display_name || 'unknown workspace'

  process.stdout.write(`  [${i + 1}/${packages.length}] ${pkg.id.slice(0, 8)} ${cName.slice(0, 18).padEnd(18)} `)

  try {
    const evalPrompt = buildEvalPrompt({
      topic: topicText,
      caption: captionText,
      staffName: cName,
      phrases,
      workspaceName: wName,
    })

    const { text } = await generateText({
      model: EVAL_MODEL,
      system: evalPrompt.system,
      messages: [{ role: 'user', content: evalPrompt.user }],
      maxOutputTokens: 220,
    })

    let evalResult = {}
    try {
      evalResult = JSON.parse(text.trim())
    } catch {
      const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
      try { evalResult = JSON.parse(cleaned) } catch { /* ignore */ }
    }

    const dims = ['voice_fidelity', 'clinical_texture', 'redundancy', 'specificity', 'brand_fit']
    const validDims = dims.filter((d) => typeof evalResult[d] === 'number')
    const overall = validDims.length
      ? Number((validDims.reduce((s, d) => s + evalResult[d], 0) / validDims.length).toFixed(2))
      : null

    const breakdown = {
      voice_fidelity:   evalResult.voice_fidelity   ?? null,
      clinical_texture: evalResult.clinical_texture ?? null,
      redundancy:       evalResult.redundancy       ?? null,
      specificity:      evalResult.specificity      ?? null,
      brand_fit:        evalResult.brand_fit        ?? null,
      red_flag:         evalResult.red_flag         || null,
      has_phrases:      phrases.length > 0,
      phrase_count:     phrases.length,
      scored_at:        new Date().toISOString(),
      model:            EVAL_MODEL,
    }

    scored.push({
      packageId:     pkg.id,
      workspaceId:   pkg.workspace_id,
      workspaceName: wName,
      staffId:   pkg.staff_id,
      staffName: cName,
      topic:         topicText,
      captionText,
      createdAt:     pkg.created_at,
      overall,
      breakdown,
    })

    if (PERSIST && overall != null) {
      const patchRes = await sb(`story_packages?id=eq.${pkg.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          voice_fidelity_score: overall,
          voice_fidelity_breakdown: breakdown,
        }),
      })
      if (!patchRes.ok) {
        const errText = await patchRes.text().catch(() => '')
        console.log(`${overall}/10  ⚠ persist failed: ${patchRes.status} ${errText.slice(0, 80)}`)
        continue
      }
    }

    console.log(`${overall != null ? `${overall}/10` : '  ?'}  ${evalResult.red_flag || ''}`)
  } catch (err) {
    console.error(`ERROR: ${err.message}`)
    skipped++
  }
}

console.log(`\n  Done. Scored: ${scored.length}, skipped: ${skipped}`)

// ── Outputs ───────────────────────────────────────────────────────────────────
const dateStr = new Date().toISOString().slice(0, 10)
const outputDir = '.claude'
if (!existsSync(outputDir)) await mkdir(outputDir, { recursive: true })

const overallVals = scored.map((s) => s.overall).filter((v) => v != null)
const avgScore = overallVals.length
  ? Number((overallVals.reduce((a, b) => a + b, 0) / overallVals.length).toFixed(2))
  : null

const md = [
  `# NarrateRx Caption Voice Fidelity — ${dateStr}`,
  '',
  `> Generated by \`scripts/voice-fidelity-captions.mjs\``,
  `> Scope: ${WORKSPACE_SLUG || 'all workspaces'} | Packages scored: ${scored.length} | Model: ${EVAL_MODEL}`,
  `> Status filter: ${STATUS_FILTER.join(',')} | Since: ${SINCE || 'all time'} | Persisted: ${PERSIST}`,
  '',
  '## Global',
  '',
  '| Metric | Value |',
  '|---|---|',
  `| Packages scored | ${scored.length} |`,
  `| Avg overall | **${avgScore ?? 'n/a'} / 10** |`,
  '',
  '## Per package',
  '',
  '| # | Clinician | Score | Red flag | Title |',
  '|---|---|---|---|---|',
  ...scored.map((s, i) => `| ${i + 1} | ${s.staffName} | ${s.overall ?? '—'} | ${s.breakdown.red_flag || '—'} | ${s.topic.slice(0, 60)} |`),
  '',
].join('\n')

const mdPath = `${outputDir}/voice-fidelity-captions-${dateStr}.md`
const jsonPath = `${outputDir}/voice-fidelity-captions-raw-${dateStr}.json`

await Promise.all([
  writeFile(mdPath, md, 'utf8'),
  writeFile(jsonPath, JSON.stringify({ meta: { dateStr, scored: scored.length, avgScore }, scored }, null, 2), 'utf8'),
])

if (FIXTURE_OUT) {
  const fixture = {
    meta: {
      generatedAt: new Date().toISOString(),
      generatedBy: 'scripts/voice-fidelity-captions.mjs',
      model: EVAL_MODEL,
      scopedWorkspace: WORKSPACE_SLUG || null,
      sample: scored.length,
      avgScore,
    },
    samples: scored.map((s) => ({
      packageId: s.packageId,
      workspaceName: s.workspaceName,
      staffName: s.staffName,
      topic: s.topic,
      captionText: s.captionText,
      overall: s.overall,
      breakdown: s.breakdown,
    })),
  }
  await writeFile(FIXTURE_OUT, JSON.stringify(fixture, null, 2), 'utf8')
  console.log(`✅ Fixture: ${FIXTURE_OUT}`)
}

console.log(`✅ Dashboard: ${mdPath}`)
console.log(`✅ Raw data:  ${jsonPath}`)
if (avgScore != null) console.log(`   Avg overall: ${avgScore}/10 across ${scored.length} packages`)

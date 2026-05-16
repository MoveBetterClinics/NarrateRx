#!/usr/bin/env node
// Calibrate the VERBATIM_THRESHOLD / PARAPHRASE_THRESHOLD constants in
// provenanceMatcher.js.
//
// Three modes:
//
//   1. Synthetic sanity check (default; always run first)
//      Built-in (paragraph, userMessages, expectedLabel) triples that any
//      sensible matcher should classify correctly. If these fail, the algorithm
//      itself needs work — threshold tuning won't help.
//
//   2. Distribution-only mode (--distribution)
//      Pulls every content_item with provenance + transcript and re-scores
//      each paragraph. Reports score quartiles and the share of paragraphs
//      that would land in each band at the current thresholds. Useful even
//      without ground truth — it shows whether the threshold values are in a
//      sensible part of the score range.
//
//   3. Labeled-ground-truth mode (--analyze=<file> or model_emit_validated
//      rows present in DB)
//      Pulls (or reads) (paragraph, label) pairs and runs grid search,
//      confusion matrix, and a threshold recommendation. Until model-emit
//      validated data exists, supply a hand-labeled JSON file in this shape:
//      [{ paragraph: "...", userMessages: ["..."], label: "verbatim" }, ...]
//
// Usage (from NarrateRx project root):
//   node scripts/calibrate-provenance-thresholds.mjs           # synthetic
//   node scripts/calibrate-provenance-thresholds.mjs --distribution
//   node scripts/calibrate-provenance-thresholds.mjs --analyze=labeled.json
//   node scripts/calibrate-provenance-thresholds.mjs --dump=corpus.json
//
// Flags:
//   --distribution         Pull all provenance rows from DB, report score
//                          distribution (no ground truth required).
//   --analyze=FILE         Read labeled samples from FILE and run calibration.
//   --dump=FILE            Save samples (from DB or labels) to FILE and exit.
//   --limit=N              Cap rows pulled from DB.
//   --include-backfill     In --distribution mode, also include algorithmic_
//                          backfill rows (i.e. all provenance, not just
//                          model-validated). Default in distribution mode.
//
// No writes to the DB. The script never updates the matcher; it prints
// recommendations for a human to apply after reviewing the data.

import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { scoreParagraph } from '../api/_lib/provenanceMatcher.js'

const require = createRequire(import.meta.url)
const { Client } = require('pg')

// ─── Args ────────────────────────────────────────────────────────────────────

const DISTRIBUTION_MODE = process.argv.includes('--distribution')
const DUMP_PATH         = argValue('--dump')
const ANALYZE_PATH      = argValue('--analyze')
const LIMIT             = Number.parseInt(argValue('--limit') ?? '0', 10) || null

function argValue(flag) {
  const m = process.argv.find((a) => a.startsWith(`${flag}=`))
  return m ? m.split('=').slice(1).join('=') : null
}

// ─── Constants (mirror the matcher) ──────────────────────────────────────────
// Keep these in sync with VERBATIM_THRESHOLD / PARAPHRASE_THRESHOLD in
// api/_lib/provenanceMatcher.js. They represent the values currently
// shipping in production; the calibration report compares them to the
// best grid result so the human can see the delta from a re-tune.

const CURRENT_T_VERBATIM   = 0.30
const CURRENT_T_PARAPHRASE = 0.15
const LABELS = ['verbatim', 'close_paraphrase', 'synthesis']

// ─── Helpers ─────────────────────────────────────────────────────────────────

function splitParagraphs(content) {
  if (typeof content !== 'string') return []
  return content.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean)
}

function extractUserMessages(rawMessages, cleanedMessages) {
  const src = Array.isArray(cleanedMessages) && cleanedMessages.length
    ? cleanedMessages
    : (Array.isArray(rawMessages) ? rawMessages : [])
  return src
    .filter((row) => row?.role === 'user' && typeof row?.content === 'string')
    .map((row) => row.content)
}

function classifyAt(score, tV, tP) {
  if (score >= tV) return 'verbatim'
  if (score >= tP) return 'close_paraphrase'
  return 'synthesis'
}

function quartiles(values) {
  if (values.length === 0) return { n: 0, min: 0, q1: 0, median: 0, q3: 0, max: 0, mean: 0 }
  const sorted = [...values].sort((a, b) => a - b)
  const pick = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))]
  const sum = sorted.reduce((a, b) => a + b, 0)
  return {
    n: sorted.length,
    min: sorted[0],
    q1: pick(0.25),
    median: pick(0.50),
    q3: pick(0.75),
    max: sorted[sorted.length - 1],
    mean: sum / sorted.length,
  }
}

function histogram(values, bucketEdges) {
  // bucketEdges: array of upper bounds. Returns counts per bucket + tail.
  const buckets = new Array(bucketEdges.length + 1).fill(0)
  for (const v of values) {
    let placed = false
    for (let i = 0; i < bucketEdges.length; i += 1) {
      if (v < bucketEdges[i]) { buckets[i] += 1; placed = true; break }
    }
    if (!placed) buckets[buckets.length - 1] += 1
  }
  return buckets
}

function fmt(n, digits = 3) {
  return Number.isFinite(n) ? n.toFixed(digits) : '—'
}

function pad(s, n) {
  return String(s).padEnd(n)
}

function rpad(s, n) {
  return String(s).padStart(n)
}

// ─── Synthetic sanity checks ─────────────────────────────────────────────────

const SYNTHETIC_CASES = [
  {
    name: 'A. Exact verbatim quote',
    expectedLabel: 'verbatim',
    expectedScoreRange: [0.80, 1.00],
    userMessages: ['I always tell my patients that rest is medicine. The hardest part is convincing them.'],
    paragraph: 'I always tell my patients that rest is medicine. The hardest part is convincing them.',
  },
  {
    name: 'B. Verbatim with pronoun shift (clinic voice)',
    expectedLabel: 'verbatim',
    expectedScoreRange: [0.55, 0.95],
    userMessages: ['I always tell my patients that rest is medicine. The hardest part is convincing them.'],
    paragraph: 'We always tell our patients that rest is medicine. The hardest part is convincing them.',
  },
  {
    // Known limitation: bigram-Jaccard cannot detect semantic paraphrases.
    // Documenting current behaviour so this test serves as a canary — when
    // we add a semantic feature (embeddings or model-emitted labels), the
    // expectedLabel should flip back to 'close_paraphrase' and this test
    // will catch the regression.
    name: 'C. Close paraphrase (semantic — known algorithmic limit)',
    expectedLabel: 'synthesis',
    expectedScoreRange: [0.00, 0.10],
    userMessages: ['I always tell my patients that rest is medicine. The hardest part is convincing them.'],
    paragraph: 'Recovery is the most powerful treatment we prescribe — and the hardest one for patients to accept.',
  },
  {
    name: 'D. Generic synthesis (unrelated)',
    expectedLabel: 'synthesis',
    expectedScoreRange: [0.00, 0.20],
    userMessages: ['I always tell my patients that rest is medicine. The hardest part is convincing them.'],
    paragraph: 'Physical therapy combines targeted exercise with manual therapy and patient education for long-term outcomes.',
  },
  {
    name: 'E. Long transcript, one matching sentence buried inside',
    expectedLabel: 'verbatim',
    expectedScoreRange: [0.50, 1.00],
    userMessages: [
      'So I went to college and then graduate school, and at one point I considered different paths, but I ended up sticking with physical therapy because it felt right.',
      'My approach has always been a little different from textbook. I always tell my patients that rest is medicine. The hardest part is convincing them. Then I get into the specifics of their program.',
      'Looking back, my mentor really shaped how I think about all this.',
    ],
    paragraph: 'I always tell my patients that rest is medicine. The hardest part is convincing them.',
  },
  {
    name: 'F. Empty paragraph',
    expectedLabel: 'synthesis',
    expectedScoreRange: [0.00, 0.00],
    userMessages: ['Anything'],
    paragraph: '',
  },
  {
    name: 'G. No transcript',
    expectedLabel: 'synthesis',
    expectedScoreRange: [0.00, 0.00],
    userMessages: [],
    paragraph: 'Anything goes here, including made-up words and phrases.',
  },
  {
    name: 'H. Slight verbatim with extra connective tissue',
    expectedLabel: 'verbatim',
    expectedScoreRange: [0.40, 0.95],
    userMessages: ['Rotator cuff repairs need at least six weeks of immobilization before we start loading anything.'],
    paragraph: 'In her words: rotator cuff repairs need at least six weeks of immobilization before we start loading anything.',
  },
]

function runSyntheticChecks() {
  console.log('\n── Synthetic sanity checks ──')
  console.log(`${pad('case', 60)} ${rpad('score', 7)} ${rpad('expected', 22)} ${rpad('label@curr', 18)} ${rpad('result', 8)}`)
  let pass = 0
  let fail = 0
  const issues = []
  for (const c of SYNTHETIC_CASES) {
    const { score } = scoreParagraph(c.paragraph, c.userMessages)
    const labelAtCurrent = classifyAt(score, CURRENT_T_VERBATIM, CURRENT_T_PARAPHRASE)
    const [lo, hi] = c.expectedScoreRange
    const inRange = score >= lo && score <= hi
    const labelOk = labelAtCurrent === c.expectedLabel
    const ok = inRange && labelOk
    if (ok) pass += 1
    else { fail += 1; issues.push({ case: c.name, score, lo, hi, expectedLabel: c.expectedLabel, gotLabel: labelAtCurrent }) }
    console.log(
      `${pad(c.name, 60)} ${rpad(fmt(score), 7)} ${rpad(`[${fmt(lo, 2)}, ${fmt(hi, 2)}]`, 22)} ${rpad(labelAtCurrent, 18)} ${rpad(ok ? 'PASS' : 'FAIL', 8)}`
    )
  }
  console.log(`\nSynthetic: ${pass} pass / ${fail} fail`)
  if (issues.length) {
    console.log('Issues:')
    for (const i of issues) {
      const why = []
      if (i.score < i.lo || i.score > i.hi) why.push(`score ${fmt(i.score)} outside [${fmt(i.lo, 2)}, ${fmt(i.hi, 2)}]`)
      if (i.gotLabel !== i.expectedLabel) why.push(`label ${i.gotLabel} ≠ expected ${i.expectedLabel}`)
      console.log(`  · ${i.case}: ${why.join('; ')}`)
    }
  }
  return { pass, fail }
}

// ─── DB fetchers ─────────────────────────────────────────────────────────────

async function connect() {
  const env = await readFile('/Users/qbook/Claude Projects/NarrateRx/.env.local', 'utf8').catch(() => '')
  const m = env.match(/^MULTITENANT_DATABASE_URL=(.+)$/m)
  if (!m) {
    console.error('MULTITENANT_DATABASE_URL not found in project-root .env.local')
    process.exit(1)
  }
  const connectionString = m[1].trim().replace(/^"(.*)"$/, '$1')
  if (connectionString.includes('REDACTED')) {
    console.error('MULTITENANT_DATABASE_URL is redacted — restore from 1Password (NarrateRx vault)')
    process.exit(1)
  }
  const client = new Client({ connectionString })
  await client.connect()
  return client
}

async function fetchDistributionCorpus(client) {
  const limitClause = LIMIT ? `LIMIT ${LIMIT}` : ''
  const sql = `
    SELECT ci.id,
           ci.content,
           ci.provenance,
           iv.messages,
           iv.cleaned_messages
    FROM content_items ci
    JOIN interviews iv ON iv.id = ci.interview_id
    WHERE ci.content IS NOT NULL
      AND length(trim(ci.content)) > 0
      AND ci.provenance IS NOT NULL
    ORDER BY ci.created_at DESC
    ${limitClause}
  `
  const { rows } = await client.query(sql)
  const samples = []
  let skipped = 0
  for (const row of rows) {
    const userMessages = extractUserMessages(row.messages, row.cleaned_messages)
    const paragraphs = splitParagraphs(row.content)
    if (paragraphs.length === 0 || userMessages.length === 0) { skipped += 1; continue }
    const blocks = Array.isArray(row.provenance?.blocks) ? row.provenance.blocks : []
    for (let i = 0; i < paragraphs.length; i += 1) {
      const { score, msg } = scoreParagraph(paragraphs[i], userMessages)
      samples.push({
        contentItemId: row.id,
        ordinal: i,
        score,
        matchedMsg: msg,
        userMsgCount: userMessages.length,
        paragraphLen: paragraphs[i].length,
        textPrefix: paragraphs[i].slice(0, 60),
        // Existing label is from the algorithm itself for backfill rows —
        // include it but it is NOT ground truth for calibration.
        algorithmLabel: blocks[i]?.source_type ?? null,
        source: row.provenance?.summary?.source ?? null,
      })
    }
  }
  return { samples, skipped }
}

async function fetchValidatedCorpus(client) {
  const limitClause = LIMIT ? `LIMIT ${LIMIT}` : ''
  const sql = `
    SELECT ci.id, ci.content, ci.provenance, iv.messages, iv.cleaned_messages
    FROM content_items ci
    JOIN interviews iv ON iv.id = ci.interview_id
    WHERE ci.provenance->'summary'->>'source' = 'model_emit_validated'
      AND ci.content IS NOT NULL AND length(trim(ci.content)) > 0
    ORDER BY ci.created_at DESC ${limitClause}
  `
  const { rows } = await client.query(sql)
  const samples = []
  for (const row of rows) {
    const userMessages = extractUserMessages(row.messages, row.cleaned_messages)
    const paragraphs = splitParagraphs(row.content)
    const blocks = Array.isArray(row.provenance?.blocks) ? row.provenance.blocks : []
    if (blocks.length !== paragraphs.length) continue
    for (let i = 0; i < paragraphs.length; i += 1) {
      const label = blocks[i]?.source_type
      if (!LABELS.includes(label)) continue
      const { score } = scoreParagraph(paragraphs[i], userMessages)
      samples.push({
        contentItemId: row.id, ordinal: i, label, score,
        textPrefix: paragraphs[i].slice(0, 60), source: 'model_emit_validated',
      })
    }
  }
  return samples
}

// ─── Distribution report ─────────────────────────────────────────────────────

function reportDistribution(samples) {
  console.log(`\n── Score distribution across ${samples.length} paragraphs ──`)
  const all = samples.map((s) => s.score)
  const q = quartiles(all)
  console.log(`overall: mean=${fmt(q.mean)} min=${fmt(q.min)} q1=${fmt(q.q1)} median=${fmt(q.median)} q3=${fmt(q.q3)} max=${fmt(q.max)}`)

  const edges = [0.05, 0.10, 0.15, 0.20, 0.30, 0.40, 0.45, 0.50, 0.60, 0.70, 0.80, 0.90, 1.00]
  const buckets = histogram(all, edges)
  console.log('\nHistogram (score < bound):')
  let prev = 0
  for (let i = 0; i < edges.length; i += 1) {
    const bar = '█'.repeat(Math.max(0, Math.round((buckets[i] / Math.max(1, all.length)) * 40)))
    console.log(`  [${fmt(prev, 2)}, ${fmt(edges[i], 2)}) ${rpad(buckets[i], 5)} ${bar}`)
    prev = edges[i]
  }
  const tail = buckets[buckets.length - 1]
  if (tail > 0) {
    const bar = '█'.repeat(Math.max(0, Math.round((tail / Math.max(1, all.length)) * 40)))
    console.log(`  [${fmt(prev, 2)},  ∞)   ${rpad(tail, 5)} ${bar}`)
  }

  // Shares at current thresholds
  let nV = 0, nP = 0, nS = 0
  for (const v of all) {
    if (v >= CURRENT_T_VERBATIM) nV += 1
    else if (v >= CURRENT_T_PARAPHRASE) nP += 1
    else nS += 1
  }
  console.log(`\nAt current thresholds (T_v=${CURRENT_T_VERBATIM} / T_p=${CURRENT_T_PARAPHRASE}):`)
  console.log(`  verbatim:        ${nV} (${fmt((nV / all.length) * 100, 1)}%)`)
  console.log(`  close_paraphrase:${nP} (${fmt((nP / all.length) * 100, 1)}%)`)
  console.log(`  synthesis:       ${nS} (${fmt((nS / all.length) * 100, 1)}%)`)

  // Suggest "natural breakpoints" by looking for big gaps in sorted scores.
  const sorted = [...all].sort((a, b) => a - b)
  let gaps = []
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i] - sorted[i - 1] > 0.02) gaps.push({ pos: (sorted[i] + sorted[i - 1]) / 2, gap: sorted[i] - sorted[i - 1] })
  }
  gaps.sort((a, b) => b.gap - a.gap)
  console.log('\nLargest score gaps (potential natural breakpoints):')
  for (const g of gaps.slice(0, 5)) {
    console.log(`  ~${fmt(g.pos, 3)} (gap of ${fmt(g.gap, 3)})`)
  }
}

// ─── Labeled-corpus analysis (full grid search) ──────────────────────────────

function confusionMatrix(samples, tV, tP) {
  const m = {}
  for (const a of LABELS) { m[a] = {}; for (const b of LABELS) m[a][b] = 0 }
  for (const s of samples) {
    const predicted = classifyAt(s.score, tV, tP)
    m[s.label][predicted] += 1
  }
  return m
}

function macroF1(matrix) {
  const f1s = []
  const perLabel = {}
  for (const label of LABELS) {
    const tp = matrix[label][label]
    const fn = LABELS.reduce((sum, p) => sum + (p === label ? 0 : matrix[label][p]), 0)
    const fp = LABELS.reduce((sum, t) => sum + (t === label ? 0 : matrix[t][label]), 0)
    const precision = tp + fp === 0 ? 0 : tp / (tp + fp)
    const recall    = tp + fn === 0 ? 0 : tp / (tp + fn)
    const f1        = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall)
    f1s.push(f1)
    perLabel[label] = { precision, recall, f1, support: tp + fn }
  }
  return { macro: f1s.reduce((a, b) => a + b, 0) / f1s.length, perLabel }
}

function reportConfusion(matrix, tV, tP) {
  const { macro, perLabel } = macroF1(matrix)
  console.log(`\n── Confusion matrix @ T_v=${tV} / T_p=${tP} ──`)
  console.log(`${pad('truth ↓ / pred →', 20)} ${rpad('verbatim', 12)} ${rpad('paraphrase', 14)} ${rpad('synthesis', 12)} ${rpad('precision', 11)} ${rpad('recall', 8)} ${rpad('f1', 8)}`)
  for (const label of LABELS) {
    const row = matrix[label]
    const stats = perLabel[label]
    console.log(`${pad(label, 20)} ${rpad(row.verbatim, 12)} ${rpad(row.close_paraphrase, 14)} ${rpad(row.synthesis, 12)} ${rpad(fmt(stats.precision), 11)} ${rpad(fmt(stats.recall), 8)} ${rpad(fmt(stats.f1), 8)}`)
  }
  console.log(`macro-F1: ${fmt(macro)}`)
  return macro
}

function gridSearch(samples) {
  const vSpace = []
  for (let v = 0.30; v <= 0.95 + 1e-9; v += 0.05) vSpace.push(Math.round(v * 100) / 100)
  const pSpace = []
  for (let p = 0.05; p <= 0.70 + 1e-9; p += 0.05) pSpace.push(Math.round(p * 100) / 100)

  let best = { tV: CURRENT_T_VERBATIM, tP: CURRENT_T_PARAPHRASE, macro: -1 }
  const results = []
  for (const tV of vSpace) {
    for (const tP of pSpace) {
      if (tP >= tV) continue
      const { macro } = macroF1(confusionMatrix(samples, tV, tP))
      results.push({ tV, tP, macro })
      if (macro > best.macro) best = { tV, tP, macro }
    }
  }
  return { best, results }
}

function recommendThresholds(samples, grid) {
  const VIABLE = grid.results.filter((r) =>
    r.tV >= 0.55 && r.tP >= 0.20 && (r.tV - r.tP) >= 0.20
  )
  const top = VIABLE.length > 0
    ? VIABLE.reduce((a, b) => (b.macro > a.macro ? b : a))
    : grid.best
  const currentMacro = macroF1(confusionMatrix(samples, CURRENT_T_VERBATIM, CURRENT_T_PARAPHRASE)).macro
  console.log('\n── Recommendation ──')
  console.log(`  Current thresholds   : T_v=${CURRENT_T_VERBATIM} / T_p=${CURRENT_T_PARAPHRASE} (macro-F1=${fmt(currentMacro)})`)
  console.log(`  Best by grid (any)   : T_v=${fmt(grid.best.tV, 2)} / T_p=${fmt(grid.best.tP, 2)} (macro-F1=${fmt(grid.best.macro)})`)
  console.log(`  Best within sane band: T_v=${fmt(top.tV, 2)} / T_p=${fmt(top.tP, 2)} (macro-F1=${fmt(top.macro)})`)
  const gain = top.macro - currentMacro
  if (gain >= 0.03) console.log(`  Δ +${fmt(gain)} — RECOMMEND updating to T_v=${fmt(top.tV, 2)} / T_p=${fmt(top.tP, 2)}.`)
  else if (gain >= 0.005) console.log(`  Δ +${fmt(gain)} — marginal; hold pending more data.`)
  else console.log(`  Δ ${fmt(gain)} — no meaningful improvement; HOLD current thresholds.`)
}

// ─── Main ────────────────────────────────────────────────────────────────────

const synth = runSyntheticChecks()

if (ANALYZE_PATH) {
  const raw = await readFile(ANALYZE_PATH, 'utf8')
  const labeled = JSON.parse(raw)
  // Accept either dump format ({ paragraph, userMessages, label }) or already-scored format.
  const samples = labeled.map((row, i) => {
    if (typeof row.score === 'number' && row.label) return row
    const { score } = scoreParagraph(row.paragraph, row.userMessages || [])
    return {
      contentItemId: row.contentItemId ?? `analyze_${i}`,
      ordinal: row.ordinal ?? i,
      label: row.label,
      score,
      textPrefix: (row.paragraph || '').slice(0, 60),
    }
  }).filter((s) => LABELS.includes(s.label))

  if (DUMP_PATH) {
    await writeFile(DUMP_PATH, JSON.stringify(samples, null, 2))
    console.log(`[calibrate] dumped ${samples.length} scored samples to ${DUMP_PATH}`)
    process.exit(0)
  }
  if (samples.length === 0) {
    console.log('No labeled samples after filtering — check the input file.')
    process.exit(1)
  }
  console.log(`\n[calibrate] analyzing ${samples.length} labeled samples from ${ANALYZE_PATH}`)
  reportConfusion(confusionMatrix(samples, CURRENT_T_VERBATIM, CURRENT_T_PARAPHRASE), CURRENT_T_VERBATIM, CURRENT_T_PARAPHRASE)
  const grid = gridSearch(samples)
  reportConfusion(confusionMatrix(samples, grid.best.tV, grid.best.tP), grid.best.tV, grid.best.tP)
  recommendThresholds(samples, grid)
  process.exit(0)
}

if (DISTRIBUTION_MODE) {
  const client = await connect()
  console.log(`\n[calibrate] connecting to DB for distribution analysis…`)
  const { samples, skipped } = await fetchDistributionCorpus(client)
  await client.end()
  console.log(`[calibrate] fetched ${samples.length} paragraph scores (skipped ${skipped} rows missing content or transcript)`)
  if (DUMP_PATH) {
    await writeFile(DUMP_PATH, JSON.stringify(samples, null, 2))
    console.log(`[calibrate] dumped to ${DUMP_PATH}`)
  }
  if (samples.length > 0) reportDistribution(samples)
  process.exit(0)
}

// Default path: synthetic + check DB for validated rows.
const client = await connect()
const validated = await fetchValidatedCorpus(client)
await client.end()
if (validated.length === 0) {
  console.log('\n── Ground-truth check ──')
  console.log('No content_items.provenance.summary.source = "model_emit_validated" rows yet.')
  console.log('Until the model-emit pipeline produces validated samples, threshold')
  console.log('tuning cannot be data-driven. Two next steps:')
  console.log('  1. Run --distribution to inspect score distribution on existing content.')
  console.log('  2. Generate a few new content_items via the normal flow — the trailer')
  console.log('     pipeline runs every generation and should populate validated rows.')
  console.log('Synthetic results above remain a useful correctness check.')
  if (synth.fail > 0) {
    console.log('\n⚠ Synthetic checks failed. Fix the algorithm before tuning thresholds.')
    process.exit(2)
  }
  process.exit(0)
}

console.log(`\n[calibrate] ${validated.length} model_emit_validated paragraph blocks available as ground truth`)
if (DUMP_PATH) {
  await writeFile(DUMP_PATH, JSON.stringify(validated, null, 2))
  console.log(`[calibrate] dumped to ${DUMP_PATH}`)
}
reportConfusion(confusionMatrix(validated, CURRENT_T_VERBATIM, CURRENT_T_PARAPHRASE), CURRENT_T_VERBATIM, CURRENT_T_PARAPHRASE)
const grid = gridSearch(validated)
reportConfusion(confusionMatrix(validated, grid.best.tV, grid.best.tP), grid.best.tV, grid.best.tP)
recommendThresholds(validated, grid)

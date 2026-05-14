#!/usr/bin/env node
// Seeds the people workspace's topic_suggestions[] with `prototypes` archetype
// tags, recovering the hand-mapping from the closed PR #128
// (feat(people): prototype-aware topic suggestions + filter UI).
//
// Matches each existing topic_suggestions row by keyword(s) against the
// topic name (case-insensitive contains). Rows that don't match any rule
// are left untouched. Idempotent — safe to re-run; rows already tagged
// get overwritten with the canonical mapping.
//
// Usage:
//   node scripts/seed-people-topic-prototypes.mjs            # dry run, prints proposed changes
//   node scripts/seed-people-topic-prototypes.mjs --apply    # writes back to the DB
//
// Reads MULTITENANT_DATABASE_URL from .env.local.

import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { Client } = require('pg')

const APPLY = process.argv.includes('--apply')
const SLUG = 'movebetter-people'

// Keyword → prototype mapping recovered from PR #128. First match wins;
// keywords are matched case-insensitively against the topic name.
const RULES = [
  // Spine & core
  { kw: ['si joint', 'sacroiliac'],                                prototypes: ['reconnect'] },
  // Head & nervous system
  { kw: ['concussion'],                                            prototypes: ['reconnect'] },
  // Shoulder
  { kw: ['rotator cuff'],                                          prototypes: ['reconnect'] },
  { kw: ['frozen shoulder'],                                       prototypes: ['reconnect'] },
  { kw: ['climbing'],                                              prototypes: ['excel'] },
  // Hip & lower extremity
  { kw: ['achilles'],                                              prototypes: ['reconnect', 'excel'] },
  // PNW sports & activity
  { kw: ['trail running'],                                         prototypes: ['excel'] },
  { kw: ['cycling'],                                               prototypes: ['excel', 'retain'] },
  { kw: ['skiing', 'snowboard'],                                   prototypes: ['excel'] },
  { kw: ['hiking'],                                                prototypes: ['retain'] },
  { kw: ['swimming', 'kayak', 'paddleboard', 'paddle board', 'sup'], prototypes: ['excel'] },
  { kw: ['youth sport', 'young athlete'],                          prototypes: ['excel'] },
  // Special populations
  { kw: ['prenatal', 'pregnan'],                                   prototypes: ['reconnect'] },
  { kw: ['postpartum'],                                            prototypes: ['reconnect'] },
  { kw: ['aging', 'over 50', 'older adult', 'longevity'],          prototypes: ['retain'] },
  // Chronic & systemic
  { kw: ['whiplash', 'mva', 'auto accident'],                      prototypes: ['reconnect'] },
  { kw: ['arthritis'],                                             prototypes: ['retain'] },
  { kw: ['fibromyalgia'],                                          prototypes: ['reconnect'] },
  { kw: ['strength training', 'movement training', 'prevention'],  prototypes: ['retain'] },
  // PT & rehab
  { kw: ['return to sport', 'return to activity', 'rehab'],        prototypes: ['reconnect', 'excel'] },
  { kw: ['core stability'],                                        prototypes: ['excel'] },
  { kw: ['hip strength', 'glute activation'],                      prototypes: ['excel'] },
  { kw: ['load management', 'overuse'],                            prototypes: ['retain', 'excel'] },
  { kw: ['post-surgical', 'post surgical', 'postsurgical'],        prototypes: ['reconnect'] },
  // Trust & differentiation
  { kw: ['maintenance care'],                                      prototypes: ['retain'] },
  // Patient journey
  { kw: ['performance plateau', 'athletic performance'],           prototypes: ['excel'] },
  { kw: ['chronic pain'],                                          prototypes: ['reconnect'] },
  { kw: ['fear avoidance', 'am i broken'],                         prototypes: ['reconnect'] },
  { kw: ['health for family', 'family'],                           prototypes: ['retain'] },
  // Combat sports & body comp
  { kw: ['grappling', 'bjj', 'jiu-jitsu', 'wrestling', 'mma'],     prototypes: ['excel'] },
  { kw: ['train through injury'],                                  prototypes: ['excel'] },
  { kw: ['mcl', 'acl', 'knee ligament'],                           prototypes: ['reconnect', 'excel'] },
  { kw: ['body composition', 'metabolic health'],                  prototypes: ['excel'] },
  { kw: ['gym anxiety', 'fear of exercise'],                       prototypes: ['reconnect'] },
  // Powerlifting / lifting
  { kw: ['powerlifting', 'deadlift', 'squat'],                     prototypes: ['excel'] },
]

function tagFor(topicName) {
  const lc = String(topicName || '').toLowerCase()
  for (const rule of RULES) {
    if (rule.kw.some((k) => lc.includes(k))) return rule.prototypes
  }
  return null
}

const env = await readFile('.env.local', 'utf8')
const match = env.match(/^MULTITENANT_DATABASE_URL=(.+)$/m)
if (!match) {
  console.error('MULTITENANT_DATABASE_URL not found in .env.local')
  process.exit(1)
}
const connectionString = match[1].trim().replace(/^"(.*)"$/, '$1')

const client = new Client({ connectionString })
await client.connect()

try {
  const { rows } = await client.query(
    'SELECT id, slug, topic_suggestions FROM workspaces WHERE slug = $1',
    [SLUG],
  )
  if (rows.length === 0) {
    console.error(`Workspace with slug "${SLUG}" not found`)
    process.exit(1)
  }
  const ws = rows[0]
  const topics = Array.isArray(ws.topic_suggestions) ? ws.topic_suggestions : []
  if (topics.length === 0) {
    console.log(`Workspace ${SLUG} has no topic_suggestions to tag.`)
    process.exit(0)
  }

  let tagged = 0
  let untagged = 0
  const next = topics.map((row) => {
    const proto = tagFor(row.topic)
    if (proto) {
      tagged += 1
      return { ...row, prototypes: proto }
    }
    untagged += 1
    const { prototypes: _drop, ...rest } = row
    return rest
  })

  console.log(`Topics: ${topics.length} total — ${tagged} tagged, ${untagged} left untagged`)
  console.log('\nTagged rows:')
  for (const row of next) {
    if (row.prototypes) {
      console.log(`  ${row.topic.padEnd(50)} → [${row.prototypes.join(', ')}]`)
    }
  }
  if (untagged > 0) {
    console.log('\nUntagged rows (no rule matched — review and add to RULES if needed):')
    for (const row of next) {
      if (!row.prototypes) console.log(`  ${row.topic}`)
    }
  }

  if (!APPLY) {
    console.log('\nDry run only. Re-run with --apply to persist.')
    process.exit(0)
  }

  await client.query(
    'UPDATE workspaces SET topic_suggestions = $1::jsonb WHERE id = $2',
    [JSON.stringify(next), ws.id],
  )
  console.log('\nApplied.')
} finally {
  await client.end()
}

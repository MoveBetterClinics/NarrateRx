#!/usr/bin/env node
// Seed the per-workspace paradigm-content JSONB columns introduced by
// migration 009 — patient_context, interview_context, topic_suggestions —
// from the existing brands/<id>/{patient,interview,topic}*.js overlays.
//
// One-shot. Idempotent: re-running overwrites the JSONB blobs with the
// current overlay state. Run it after migration 009 has been applied to
// the shared narraterx Supabase. PR 3 deletes the overlay files once
// this script has been run.
//
// Field renames at seed time (paradigm-neutral storage):
//   patientProfile / horseProfile  → audienceProfile
//   lifestyleStakes / ownerStakes  → audienceStakes
//   pnwAngles                      → regionalAngles
//   interviewTopics, chronicRelevant, prototypes — unchanged
//
// The matching prompts.js formatter is paradigm-neutral and reads these
// normalized field names.
//
// Usage:
//   SUPABASE_URL=https://wrqfrjhevkbbheymzezy.supabase.co \
//   SUPABASE_KEY=<service_role_key> \
//   [DRY_RUN=true] \
//   node scripts/seed-workspace-paradigm-content.mjs

import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_KEY
const DRY_RUN = process.env.DRY_RUN === 'true'

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_KEY are required.')
  process.exit(1)
}

const BRAND_TO_SLUG = {
  people:  'movebetter-people',
  equine:  'movebetter-equine',
  animals: 'movebetter-animals',
}

function renameConditionEntry(entry) {
  // Normalize people/equine field names to a single shape.
  const out = {
    chronicRelevant: !!entry.chronicRelevant,
    audienceProfile: entry.patientProfile ?? entry.horseProfile ?? '',
    audienceStakes:  entry.lifestyleStakes ?? entry.ownerStakes ?? '',
    regionalAngles:  Array.isArray(entry.pnwAngles) ? entry.pnwAngles : [],
    interviewTopics: Array.isArray(entry.interviewTopics) ? entry.interviewTopics : [],
  }
  if (Array.isArray(entry.prototypes)) out.prototypes = entry.prototypes
  return out
}

function normalizeBank(bank) {
  const out = {}
  for (const [k, v] of Object.entries(bank || {})) {
    out[k] = renameConditionEntry(v)
  }
  return out
}

async function loadInterviewContext(brand) {
  const mod = await import(pathToFileURL(path.join(ROOT, 'brands', brand, 'interviewContext.js')).href)
  // People: PNW_CONDITION_BANK + getPNWContext (fuzzy fallback inline).
  // Equine: PNW_HORSE_CONDITION_BANK + getPNWHorseContext.
  // Animals: stub — formatPNWContextForPrompt returns ''.
  const bank = mod.PNW_CONDITION_BANK ?? mod.PNW_HORSE_CONDITION_BANK ?? null
  if (!bank) return {} // animals stub → empty interview_context

  // The fuzzy keyword maps live inside the `getPNWContext` function bodies
  // and aren't exported, so we hand-mirror them here from the source files.
  // Edit-once: changes to the keyword map require updating the seed script
  // too. After PR 3 deletes the overlays, this script's mirrored maps are
  // the canonical seed source.
  const keywordAliases = KEYWORD_ALIASES[brand] || {}
  const fallback       = FALLBACK_ENTRIES[brand] || null

  return {
    conditions: normalizeBank(bank),
    keywordAliases,
    fallback: fallback ? renameConditionEntry(fallback) : null,
  }
}

async function loadPatientContext(brand) {
  const mod = await import(pathToFileURL(path.join(ROOT, 'brands', brand, 'patientContext.js')).href)
  const prototypes = Array.isArray(mod.PATIENT_PROTOTYPES) ? mod.PATIENT_PROTOTYPES : []
  if (!mod.PRIMARY_AVATAR && prototypes.length === 0) {
    return {} // equine/animals stubs — empty
  }
  return {
    summaryBlurb: SUMMARY_BLURBS[brand] || '',
    primaryAvatar: mod.PRIMARY_AVATAR || null,
    prototypes,
    priorProviderPainPoints: mod.PRIOR_PROVIDER_PAIN_POINTS || [],
    staffProfiles: mod.STAFF_PROFILES || [],
  }
}

async function loadTopicSuggestions(brand) {
  const mod = await import(pathToFileURL(path.join(ROOT, 'brands', brand, 'topicSuggestions.js')).href)
  return Array.isArray(mod.TOPIC_SUGGESTIONS) ? mod.TOPIC_SUGGESTIONS : []
}

// ── Seed-only mirrors of overlay function-body data ─────────────────────────
// (kept in this script because the overlay functions don't export them)

const SUMMARY_BLURBS = {
  people: `Move Better's primary patient is "The Frustrated Active Adult" — ages 30–55, active or formerly active, family-oriented, college-educated. They've seen other providers and left feeling unheard, rushed, or handed a generic plan. They don't want surgery or medication. They want someone who sees them as an individual and gives them a real plan.`,
}

const KEYWORD_ALIASES = {
  people: {
    'back': 'lower back pain',
    'lumbar': 'lower back pain',
    'sciatica': 'sciatica',
    'disc': 'disc herniation',
    'herniat': 'disc herniation',
    'neck': 'neck pain',
    'cervical': 'neck pain',
    'shoulder': 'shoulder pain',
    'rotator': 'shoulder pain',
    'knee': 'knee pain',
    'it band': 'knee pain',
    'patell': 'knee pain',
    'hip': 'hip pain',
    'plantar': 'plantar fasciitis',
    'heel': 'plantar fasciitis',
    'ankle': 'ankle sprain',
    'headache': 'headaches',
    'migraine': 'headaches',
    'chronic': 'chronic pain',
    'fibromyalgia': 'fibromyalgia',
    'fibro': 'fibromyalgia',
    'persistent': 'chronic pain',
    'tennis elbow': 'tennis elbow',
    'lateral epicondyl': 'tennis elbow',
    'golfer': "golfer's elbow",
    'medial epicondyl': "golfer's elbow",
    'carpal': 'carpal tunnel',
    'wrist': 'carpal tunnel',
    'mid-back': 'mid-back pain',
    'thoracic': 'mid-back pain',
    'upper back': 'mid-back pain',
    'si joint': 'si joint pain',
    'sacroiliac': 'si joint pain',
    'whiplash': 'whiplash',
    'auto accident': 'whiplash',
    'car accident': 'whiplash',
    'osteoarthritis': 'osteoarthritis',
    'arthritis': 'osteoarthritis',
    'numb': 'numbness and tingling',
    'tingling': 'numbness and tingling',
    'nerve pain': 'numbness and tingling',
    'vertigo': 'vertigo',
    'dizziness': 'vertigo',
    'dizzy': 'vertigo',
    'pregnan': 'pregnancy pain',
    'postpartum': 'pregnancy pain',
    'achilles': 'achilles tendinitis',
    'it band ': 'it band syndrome',
    'iliotibial': 'it band syndrome',
    'movement': 'movement assessment',
    'performance': 'sports performance',
    'athletic': 'sports performance',
    'sport': 'sports performance',
  },
  equine: {
    'kissing spine': 'kissing spine',
    'dorsal spinous': 'kissing spine',
    'cold-back': 'cold-backed',
    'cold back': 'cold-backed',
    'humpy': 'cold-backed',
    'back pain': 'back pain',
    'thoracic': 'back pain',
    'lumbar': 'back pain',
    'sore back': 'back pain',
    'sacroiliac': 'sacroiliac dysfunction',
    'si joint': 'sacroiliac dysfunction',
    'si dysfunction': 'sacroiliac dysfunction',
    'sacrum': 'sacroiliac dysfunction',
    'hunter': 'hunters bump',
    'tuber sacrale': 'hunters bump',
    'poll': 'poll restriction',
    'tmj': 'tmj',
    'jaw': 'tmj',
    'bit grinding': 'tmj',
    'cervical': 'cervical pain',
    'neck pain': 'cervical pain',
    'wobbler': 'cervical pain',
    'withers': 'withers and shoulder restriction',
    'shoulder': 'withers and shoulder restriction',
    'lead': 'lead refusal',
    'cross-canter': 'cross cantering',
    'cross canter': 'cross cantering',
    'disunited': 'cross cantering',
    'buck': 'bucking and rearing',
    'rear': 'bucking and rearing',
    'head toss': 'head tossing',
    'head shak': 'head tossing',
    'head shy': 'head tossing',
    'girth': 'girthiness',
    'cinch': 'girthiness',
    'lame': 'mystery lameness',
    'mystery': 'mystery lameness',
    'off': 'mystery lameness',
    'hock': 'hock arthritis',
    'spavin': 'hock arthritis',
    'saddle fit': 'saddle fit pain',
    'saddle pain': 'saddle fit pain',
    'senior': 'senior horse stiffness',
    'older horse': 'senior horse stiffness',
    'aging': 'senior horse stiffness',
    'arthritis': 'senior horse stiffness',
    'performance': 'performance maintenance',
    'maintenance': 'performance maintenance',
    'rehab': 'post injury rehab',
    'post-injury': 'post injury rehab',
    'stall rest': 'post injury rehab',
    'pull back': 'pull back trauma',
    'pulled back': 'pull back trauma',
    'tied': 'pull back trauma',
  },
}

const FALLBACK_ENTRIES = {
  people: {
    chronicRelevant: false,
    prototypes: ['reconnect', 'retain'],
    patientProfile:
      'Active Portland and Vancouver residents — trail runners, cyclists, climbers, hikers, desk workers — who want to stay active and avoid medication or surgery. Often 30–55, family-oriented, and have tried other providers without lasting relief.',
    lifestyleStakes:
      'Maintaining their outdoor lifestyle: hiking the Gorge, running Forest Park, skiing Mt. Hood, or simply keeping up with their kids — and not becoming a patient who just manages pain forever.',
    pnwAngles: [
      "Portland's active, health-conscious culture means patients have often tried everything before arriving",
      'The PNW patient wants to understand the WHY — they respond to education over prescription',
      'Seasonal outdoor activities create predictable injury patterns throughout the year',
      'Tech-worker culture means many patients sit for 8+ hours before and after their athletic pursuits',
    ],
    interviewTopics: [
      'What does this condition look like in an active PNW patient vs. a more sedentary patient?',
      'What lifestyle factors unique to the Pacific Northwest contribute to or worsen this condition?',
      'What does success look like — what activity do patients want to get back to?',
      'What makes the Move Better approach different from what patients have already tried?',
      "What do you tell the patient who has already seen other providers and hasn't found lasting relief?",
    ],
  },
  equine: {
    chronicRelevant: false,
    horseProfile:
      'Horse owners across Southwest Washington and the Portland area — sport-horse competitors, trail and pleasure riders, ranch hands, and aging-horse caretakers who want their horse moving and feeling well.',
    ownerStakes:
      'Keeping the horse comfortable and capable — for the next ride, the next show, or simply a long, sound retirement.',
    pnwAngles: [
      'PNW horses live with cold, wet winters and active spring–fall competition seasons — patterns of stiffness and recovery follow that calendar',
      'Trail, ranch, and sport-horse work are all common locally — discipline-specific compensation patterns vary widely',
      'Local owners are educated and integrative — they want to understand how chiropractic, vet care, saddle fit, and farrier work fit together',
      'Cambered pasture and uneven trail terrain create asymmetries that owners often miss until a bodyworker points them out',
    ],
    interviewTopics: [
      'What does this issue look like in a PNW horse vs. a horse in another region?',
      'How does the local climate, terrain, or competition calendar shape this presentation?',
      'What does a realistic resolution timeline look like — and what would put the horse on the slower end of that range?',
      'When does this need a vet referral first, and how do you frame that conversation with the owner?',
    ],
  },
}

// ── PATCH workspace by slug ──────────────────────────────────────────────────

async function patch(slug, payload) {
  const url = `${SUPABASE_URL}/rest/v1/workspaces?slug=eq.${encodeURIComponent(slug)}`
  if (DRY_RUN) {
    const sizes = Object.fromEntries(Object.entries(payload).map(([k, v]) => [k, JSON.stringify(v).length]))
    console.log(`[dry-run] PATCH ${slug} payload sizes: ${JSON.stringify(sizes)}`)
    return
  }
  const r = await fetch(url, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(payload),
  })
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    throw new Error(`PATCH ${slug} failed: ${r.status} ${text}`)
  }
  console.log(`✓ patched ${slug}`)
}

async function main() {
  for (const [brand, slug] of Object.entries(BRAND_TO_SLUG)) {
    const [interview_context, patient_context, topic_suggestions] = await Promise.all([
      loadInterviewContext(brand),
      loadPatientContext(brand),
      loadTopicSuggestions(brand),
    ])
    await patch(slug, { interview_context, patient_context, topic_suggestions })
  }
  console.log(DRY_RUN ? 'Dry run complete.' : 'Seeding complete.')
}

main().catch((e) => { console.error(e); process.exit(1) })

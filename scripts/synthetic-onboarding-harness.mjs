#!/usr/bin/env node
/**
 * NarrateRx Synthetic Onboarding Harness
 *
 * Validates 50 synthetic tenant onboarding payloads against the real
 * claim.js logic WITHOUT hitting Clerk, Vercel domains, or inserting
 * DB rows. Catches validation gaps, edge cases, and capacity issues
 * before a real chiro friend tries to onboard.
 *
 * Usage:
 *   node scripts/synthetic-onboarding-harness.mjs [--run]
 *
 * Default: dry validation only (no DB writes, no Clerk calls).
 * --run flag reserved for future: actually POST to a staging endpoint.
 *
 * Required env (from .env.local):
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY
 *
 * Output:
 *   .claude/chaos-onboarding-report-<date>.md
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

// ── Import claim validation logic ─────────────────────────────────────────────
const { validateSlug, FOUNDING_CAP, SEED_SLUGS, RESERVED_SLUGS } =
  await import('../api/_lib/onboardingValidation.js')
const { OUTPUT_CHANNELS } = await import('../src/lib/outputChannels.js')

const VALID_OUTPUTS = new Set(Object.keys(OUTPUT_CHANNELS))

// ── Real Supabase capacity + slug check ───────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  })
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${path}`)
  return r.json()
}

console.log('\n📦 Loading real Supabase state…')
const allWorkspaces = await sbGet('workspaces?status=eq.active&select=slug')
const existingSlugs = new Set(allWorkspaces.map(w => w.slug))
const externalCount = allWorkspaces.filter(w => !SEED_SLUGS.has(w.slug)).length
console.log(`  ✓ Active workspaces: ${allWorkspaces.length} (${externalCount} external of ${FOUNDING_CAP} cap)`)
console.log(`  ✓ Valid output channels: ${[...VALID_OUTPUTS].join(', ')}`)

// ── Validation engine (mirrors claim.js logic) ────────────────────────────────
function sanitizeStr(v, max = 2000) {
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!s) return null
  return s.slice(0, max)
}

function sanitizeUrl(v) {
  const s = sanitizeStr(v, 500)
  if (!s) return null
  if (!/^https?:\/\//i.test(s)) return `https://${s}`
  return s
}

function pickEnabledOutputs(arr) {
  if (!Array.isArray(arr)) return []
  return arr.filter(id => typeof id === 'string' && VALID_OUTPUTS.has(id))
}

function validatePayload(payload, currentExternalCount) {
  const issues = []  // { severity: 'P0'|'P1'|'P2', field, message }
  const warnings = []

  // ── Slug ──────────────────────────────────────────────────────────────────
  const slugCheck = validateSlug(payload.slug)
  if (!slugCheck.ok) {
    issues.push({ severity: 'P0', field: 'slug', message: `Invalid slug: ${slugCheck.reason}` })
  } else if (existingSlugs.has(slugCheck.slug)) {
    issues.push({ severity: 'P0', field: 'slug', message: `Slug already taken: ${slugCheck.slug}` })
  }

  // ── Display name ──────────────────────────────────────────────────────────
  const display_name = sanitizeStr(payload.display_name, 200)
  if (!display_name) {
    issues.push({ severity: 'P0', field: 'display_name', message: 'Missing or empty display_name' })
  } else if (display_name.length > 100) {
    warnings.push({ severity: 'P2', field: 'display_name', message: `Long display_name (${display_name.length} chars) — may truncate in UI` })
  }

  // ── Enabled outputs ───────────────────────────────────────────────────────
  const enabled_outputs = pickEnabledOutputs(payload.enabled_outputs)
  if (enabled_outputs.length === 0) {
    issues.push({ severity: 'P0', field: 'enabled_outputs', message: 'No valid output channels selected' })
  }
  if (Array.isArray(payload.enabled_outputs)) {
    const invalid = payload.enabled_outputs.filter(id => !VALID_OUTPUTS.has(id))
    if (invalid.length > 0) {
      warnings.push({ severity: 'P1', field: 'enabled_outputs', message: `Unknown channels (silently dropped): ${invalid.join(', ')}` })
    }
  }

  // ── Capacity ──────────────────────────────────────────────────────────────
  if (currentExternalCount >= FOUNDING_CAP) {
    issues.push({ severity: 'P0', field: 'capacity', message: `Founding cap (${FOUNDING_CAP}) reached — signup would be rejected` })
  } else if (currentExternalCount >= FOUNDING_CAP - 2) {
    warnings.push({ severity: 'P1', field: 'capacity', message: `Only ${FOUNDING_CAP - currentExternalCount} founding spot(s) left` })
  }

  // ── Locations ─────────────────────────────────────────────────────────────
  const incomingLocations = Array.isArray(payload.locations) ? payload.locations : []
  const validLocations = incomingLocations.filter(l => l && typeof l === 'object' && sanitizeStr(l.city, 100))
  if (validLocations.length === 0) {
    warnings.push({ severity: 'P1', field: 'locations', message: 'No valid locations — workspace.location will be null; prompts may degrade' })
  }
  if (validLocations.length > 5) {
    warnings.push({ severity: 'P2', field: 'locations', message: `${validLocations.length} locations — workspace_locations table gets that many rows on claim` })
  }

  // ── Website ───────────────────────────────────────────────────────────────
  const website = sanitizeUrl(payload.website)
  if (!website) {
    warnings.push({ severity: 'P2', field: 'website', message: 'No website — internal_links_markdown in prompts will be empty' })
  } else {
    try { new URL(website) } catch {
      issues.push({ severity: 'P1', field: 'website', message: `Malformed website URL after sanitization: ${website}` })
    }
  }

  // ── Content fields ────────────────────────────────────────────────────────
  const clinic_context = sanitizeStr(payload.clinic_context, 4000)
  const brand_voice    = sanitizeStr(payload.brand_voice, 4000)
  const audience_short = sanitizeStr(payload.audience_short, 400)

  if (!clinic_context) {
    warnings.push({ severity: 'P1', field: 'clinic_context', message: 'Empty clinic_context — interview prompts will have no workspace framing' })
  }
  if (!brand_voice) {
    warnings.push({ severity: 'P1', field: 'brand_voice', message: 'Empty brand_voice — blog/social prompts will have no voice anchoring' })
  }
  if (!audience_short) {
    warnings.push({ severity: 'P2', field: 'audience_short', message: 'Empty audience_short — social prompts will have no audience targeting' })
  }
  if (payload.clinic_context && sanitizeStr(payload.clinic_context)?.length > 3800) {
    warnings.push({ severity: 'P2', field: 'clinic_context', message: 'clinic_context near max length (3800+) — may approach prompt token limits' })
  }

  // ── Specialty-specific checks ─────────────────────────────────────────────
  if (payload._specialty) {
    // Vet/animal specialty requires general-mode or paradigm override
    if (['vet', 'veterinary', 'animal'].includes(payload._specialty.toLowerCase())) {
      if (!payload.prompt_mode || payload.prompt_mode !== 'general') {
        warnings.push({ severity: 'P1', field: 'prompt_mode', message: `Vet specialty may need prompt_mode='general' — clinical mode assumes human patients` })
      }
    }
    // Mental health requires HIPAA-aware flag check
    if (['mental health', 'psychology', 'therapy', 'counseling'].includes(payload._specialty.toLowerCase())) {
      warnings.push({ severity: 'P1', field: '_specialty', message: 'Mental health tenant — verify case study / outcome content is disabled before launch' })
    }
  }

  return {
    slug: slugCheck.ok ? slugCheck.slug : payload.slug,
    display_name,
    enabled_outputs,
    valid_locations: validLocations,
    website,
    p0s: issues.filter(i => i.severity === 'P0'),
    p1s: [...issues.filter(i => i.severity === 'P1'), ...warnings.filter(w => w.severity === 'P1')],
    p2s: warnings.filter(w => w.severity === 'P2'),
    willPass: issues.filter(i => i.severity === 'P0').length === 0,
  }
}

// ── 50 synthetic tenant profiles ─────────────────────────────────────────────
const TENANTS = [
  // ─ Happy path: well-formed chiro/PT/integrative profiles ─────────────────
  { slug: 'spine-and-motion-co', display_name: 'Spine & Motion Co', _specialty: 'chiropractic',
    enabled_outputs: ['blog', 'instagram', 'facebook'],
    locations: [{ city: 'Austin', region: 'TX', label: 'Austin Clinic' }],
    website: 'https://spineandmotion.co',
    clinic_context: 'Performance-focused chiropractic care for Austin athletes and desk workers. Dr. Sarah Chen specializes in sports rehab and corrective exercise.',
    brand_voice: 'Conversational, evidence-based, and empowering. We explain the why behind every treatment decision so patients leave understanding their own bodies.',
    audience_short: 'Austin athletes, weekend warriors, and desk workers aged 25–50 who want to stay active.', },

  { slug: 'peak-performance-pt', display_name: 'Peak Performance Physical Therapy', _specialty: 'PT',
    enabled_outputs: ['blog', 'instagram', 'linkedin', 'email_newsletter'],
    locations: [{ city: 'Denver', region: 'CO' }],
    website: 'https://peakperformancept.com',
    clinic_context: 'Sports physical therapy and post-surgical rehab in Denver. Dr. Marcus Webb works with competitive athletes at all levels.',
    brand_voice: 'Direct, athlete-to-athlete. No fluff — just what works, why it works, and how long it takes.',
    audience_short: 'Denver competitive athletes and post-surgical patients wanting to return to sport.', },

  { slug: 'rooted-naturopathic', display_name: 'Rooted Naturopathic Medicine', _specialty: 'naturopathic',
    enabled_outputs: ['blog', 'instagram', 'email_newsletter'],
    locations: [{ city: 'Portland', region: 'OR' }],
    website: 'https://rootednaturopathic.com',
    clinic_context: 'Functional and naturopathic medicine in Portland, OR. Dr. Annika Torres focuses on root-cause resolution of chronic conditions.',
    brand_voice: 'Warm, educational, and holistic. We connect lifestyle, nutrition, and nervous system function in plain language.',
    audience_short: 'Portland adults dealing with chronic fatigue, hormonal issues, and digestive problems.', },

  { slug: 'align-chiro-nashville', display_name: 'Align Chiropractic Nashville', _specialty: 'chiropractic',
    enabled_outputs: ['blog', 'facebook', 'gbp'],
    locations: [{ city: 'Nashville', region: 'TN' }],
    website: 'https://alignchironashville.com',
    clinic_context: 'Family and sports chiropractic serving Nashville musicians, healthcare workers, and weekend warriors.',
    brand_voice: 'Friendly and down-to-earth. Nashville is a hardworking city — we write for people who are on their feet all day.',
    audience_short: 'Nashville musicians, nurses, and young families managing musculoskeletal pain.', },

  { slug: 'integrative-motion-seattle', display_name: 'Integrative Motion Seattle', _specialty: 'integrative',
    enabled_outputs: ['blog', 'instagram', 'linkedin'],
    locations: [{ city: 'Seattle', region: 'WA' }],
    website: 'https://integrativemotion.com',
    clinic_context: 'Integrative chiro, acupuncture, and massage under one roof in Capitol Hill. Team-based care for complex cases.',
    brand_voice: 'Thoughtful and collaborative. We explain how different modalities interact, because our patients are curious.',
    audience_short: 'Seattle tech workers and endurance athletes who want a whole-body approach.', },

  // ─ Adjacent clinical: dental, optometry, mental health, audiology ─────────
  { slug: 'clarity-dental-arts', display_name: 'Clarity Dental Arts', _specialty: 'dental',
    enabled_outputs: ['blog', 'instagram', 'facebook'],
    locations: [{ city: 'San Diego', region: 'CA' }],
    website: 'https://claritydental.com',
    clinic_context: 'Cosmetic and family dentistry in San Diego. Focus on patient education and anxiety reduction.',
    brand_voice: 'Calm and approachable. We take the fear out of dental care with clear explanations and patient-first communication.',
    audience_short: 'San Diego adults who are anxious about dental care or looking for cosmetic improvements.', },

  { slug: 'mindful-move-therapy', display_name: 'Mindful Movement Therapy', _specialty: 'mental health',
    enabled_outputs: ['blog', 'instagram'],
    locations: [{ city: 'Chicago', region: 'IL' }],
    website: 'https://mindfulmovement.com',
    clinic_context: 'Somatic therapy and movement-based mental health care in Chicago. Dr. Priya Singh specializes in trauma-informed care.',
    brand_voice: 'Gentle, trauma-aware, and body-positive. We write with compassion and careful attention to lived experience.',
    audience_short: 'Chicago adults working through anxiety, trauma, and stress-related physical symptoms.', },

  { slug: 'clear-sight-optometry', display_name: 'Clear Sight Optometry', _specialty: 'optometry',
    enabled_outputs: ['blog', 'facebook', 'instagram'],
    locations: [{ city: 'Phoenix', region: 'AZ' }],
    website: 'https://clearsightaz.com',
    clinic_context: 'Holistic optometry in Phoenix with a focus on myopia management and blue light / screen fatigue.',
    brand_voice: 'Educational and preventive. We write about eye health the way we talk to patients — practical and science-backed.',
    audience_short: 'Phoenix parents managing kids myopia and professionals with screen fatigue.', },

  // ─ Veterinary / animal specialty ────────────────────────────────────────────
  { slug: 'equine-rehab-colorado', display_name: 'Colorado Equine Rehab', _specialty: 'veterinary',
    enabled_outputs: ['blog', 'instagram'],
    locations: [{ city: 'Fort Collins', region: 'CO' }],
    website: 'https://coloradoequinerehab.com',
    clinic_context: 'Equine chiropractic and rehabilitation in northern Colorado. Dr. Jamie Walsh works with sport horses and barrel racers.',
    brand_voice: 'Practical and horse-person fluent. We write for people who live in barns, not waiting rooms.',
    audience_short: 'Colorado horse owners in competitive disciplines.', },

  { slug: 'canine-motion-clinic', display_name: 'Canine Motion Clinic', _specialty: 'veterinary',
    enabled_outputs: ['blog', 'instagram', 'facebook'],
    locations: [{ city: 'Minneapolis', region: 'MN' }],
    website: 'https://caninemotionclinic.com',
    clinic_context: 'Canine rehabilitation and sports medicine. We work with working dogs, agility dogs, and post-op pets.',
    brand_voice: 'Warm and dog-owner friendly. We explain biomechanics through dog stories because that is what resonates.',
    audience_short: 'Minneapolis dog owners with working dogs, sport dogs, or post-surgical rehab needs.', },

  // ─ Multi-location practices ──────────────────────────────────────────────────
  { slug: 'elevate-chiro-group', display_name: 'Elevate Chiropractic Group', _specialty: 'chiropractic',
    enabled_outputs: ['blog', 'instagram', 'facebook', 'linkedin'],
    locations: [
      { city: 'Charlotte', region: 'NC', label: 'Uptown Location' },
      { city: 'Charlotte', region: 'NC', label: 'South Charlotte' },
      { city: 'Raleigh', region: 'NC', label: 'Raleigh Clinic' },
    ],
    website: 'https://elevatechirogroup.com',
    clinic_context: 'Multi-location chiropractic group in the Carolinas. Sports rehab and corporate wellness.',
    brand_voice: 'Professional yet approachable. We represent a team, not an individual — warm but brand-consistent.',
    audience_short: 'Charlotte and Raleigh professionals and athletes seeking sports and workplace injury care.', },

  { slug: 'harbor-wellness-boston', display_name: 'Harbor Wellness Center', _specialty: 'integrative',
    enabled_outputs: ['blog', 'email_newsletter', 'instagram'],
    locations: [
      { city: 'Boston', region: 'MA', label: 'Beacon Hill' },
      { city: 'Cambridge', region: 'MA', label: 'Cambridge Clinic' },
    ],
    website: 'https://harborwellness.com',
    clinic_context: 'Chiro, PT, and functional medicine together in Boston. Academic-adjacent — many Harvard and MGH referring providers.',
    brand_voice: 'Evidence-driven and intellectually engaging. Our audience reads NEJM editorials for fun.',
    audience_short: 'Boston academics, healthcare workers, and athletes who want to understand their care deeply.', },

  // ─ Solo practitioners ─────────────────────────────────────────────────────
  { slug: 'drkatewilson-chiro', display_name: 'Dr. Kate Wilson Chiropractic', _specialty: 'chiropractic',
    enabled_outputs: ['blog', 'instagram'],
    locations: [{ city: 'Bozeman', region: 'MT' }],
    website: 'https://drkate.com',
    clinic_context: 'Solo female chiropractor in Bozeman, MT. Specializes in pre- and post-natal care and outdoor athlete injuries.',
    brand_voice: 'Warm and personal. Kate writes in first person because she is the practice.',
    audience_short: 'Bozeman pregnant patients, new moms, and outdoor athletes.', },

  { slug: 'dr-james-acupuncture', display_name: 'Dr. James Chen Acupuncture', _specialty: 'acupuncture',
    enabled_outputs: ['blog', 'facebook'],
    locations: [{ city: 'San Francisco', region: 'CA' }],
    website: 'https://drjamesacupuncture.com',
    clinic_context: 'Classical acupuncture and Chinese medicine. 20 years of practice in the Richmond District.',
    brand_voice: 'Thoughtful and historically grounded. James explains classical medicine in a way that respects both tradition and modern evidence.',
    audience_short: 'San Francisco adults seeking acupuncture for chronic pain, fertility support, and stress.', },

  // ─ Edge cases: slug validation ───────────────────────────────────────────────
  { slug: 'ab',  // too short (< 3 chars)
    display_name: 'AB Chiro', _specialty: 'chiropractic',
    enabled_outputs: ['blog'], locations: [{ city: 'Miami', region: 'FL' }], },

  { slug: 'this-slug-is-way-too-long-for-the-system-to-accept-it',  // > 32 chars
    display_name: 'Long Slug Chiro', _specialty: 'chiropractic',
    enabled_outputs: ['blog'], locations: [{ city: 'Atlanta', region: 'GA' }], },

  { slug: '-leading-hyphen',  // leading hyphen
    display_name: 'Hyphen Chiro', _specialty: 'chiropractic',
    enabled_outputs: ['blog'], locations: [{ city: 'Dallas', region: 'TX' }], },

  { slug: 'double--hyphen',  // double hyphen
    display_name: 'Double Hyphen Chiro', _specialty: 'chiropractic',
    enabled_outputs: ['blog'], locations: [{ city: 'Houston', region: 'TX' }], },

  { slug: 'admin',  // reserved word
    display_name: 'Admin Chiro', _specialty: 'chiropractic',
    enabled_outputs: ['blog'], locations: [{ city: 'Denver', region: 'CO' }], },

  { slug: 'settings',  // reserved word
    display_name: 'Settings Wellness', _specialty: 'integrative',
    enabled_outputs: ['blog'], locations: [{ city: 'Seattle', region: 'WA' }], },

  { slug: 'Blog',  // uppercase (should normalize to 'blog' which is reserved)
    display_name: 'Blog Chiro', _specialty: 'chiropractic',
    enabled_outputs: ['blog'], locations: [{ city: 'Portland', region: 'OR' }], },

  { slug: 'valid-chiro-slug',  // this slug might already exist in prod
    display_name: 'Valid Chiro', _specialty: 'chiropractic',
    enabled_outputs: ['blog'], locations: [{ city: 'Nashville', region: 'TN' }], },

  // ─ Edge cases: missing / bad required fields ──────────────────────────────
  { slug: 'missing-display-name',
    display_name: '',  // empty display name
    _specialty: 'chiropractic',
    enabled_outputs: ['blog'], locations: [{ city: 'Austin', region: 'TX' }], },

  { slug: 'no-outputs',
    display_name: 'No Outputs Clinic', _specialty: 'chiropractic',
    enabled_outputs: [],  // empty outputs
    locations: [{ city: 'Chicago', region: 'IL' }], },

  { slug: 'invalid-outputs',
    display_name: 'Invalid Outputs Clinic', _specialty: 'chiropractic',
    enabled_outputs: ['twitter', 'tiktok', 'youtube'],  // unknown channels
    locations: [{ city: 'Miami', region: 'FL' }], },

  { slug: 'mixed-outputs',
    display_name: 'Mixed Outputs Clinic', _specialty: 'chiropractic',
    enabled_outputs: ['blog', 'twitter', 'instagram'],  // mix of valid and invalid
    locations: [{ city: 'Denver', region: 'CO' }], },

  // ─ Edge cases: location issues ───────────────────────────────────────────
  { slug: 'no-location-clinic',
    display_name: 'No Location Clinic', _specialty: 'chiropractic',
    enabled_outputs: ['blog'],
    locations: [],  // no locations at all
    website: 'https://nolocationclinic.com',
    clinic_context: 'A clinic with no location configured.',
    brand_voice: 'Test voice.', },

  { slug: 'null-city-clinic',
    display_name: 'Null City Clinic', _specialty: 'chiropractic',
    enabled_outputs: ['blog'],
    locations: [{ city: '', region: 'TX' }],  // empty city
    website: 'https://nullcity.com', },

  { slug: 'many-locations-clinic',
    display_name: 'Many Locations Group', _specialty: 'chiropractic',
    enabled_outputs: ['blog', 'instagram'],
    locations: [
      { city: 'Austin', region: 'TX' }, { city: 'Houston', region: 'TX' },
      { city: 'Dallas', region: 'TX' }, { city: 'San Antonio', region: 'TX' },
      { city: 'El Paso', region: 'TX' }, { city: 'Fort Worth', region: 'TX' },
    ],
    website: 'https://manylocations.com',
    clinic_context: 'Large multi-location Texas group.', },

  // ─ Edge cases: website / URL issues ──────────────────────────────────────
  { slug: 'no-website-clinic',
    display_name: 'No Website Clinic', _specialty: 'chiropractic',
    enabled_outputs: ['blog'],
    locations: [{ city: 'Portland', region: 'OR' }],
    website: null,
    clinic_context: 'A clinic with no website.', },

  { slug: 'bad-url-clinic',
    display_name: 'Bad URL Clinic', _specialty: 'chiropractic',
    enabled_outputs: ['blog'],
    locations: [{ city: 'Seattle', region: 'WA' }],
    website: 'not-a-valid-url-at-all',
    clinic_context: 'A clinic with a malformed website.', },

  { slug: 'no-protocol-url',
    display_name: 'No Protocol Clinic', _specialty: 'chiropractic',
    enabled_outputs: ['blog'],
    locations: [{ city: 'Denver', region: 'CO' }],
    website: 'noproto.com',  // missing https:// — sanitizeUrl should fix this
    clinic_context: 'A clinic with website missing protocol.', },

  // ─ Edge cases: missing content fields ────────────────────────────────────
  { slug: 'empty-context-clinic',
    display_name: 'Empty Context Clinic', _specialty: 'chiropractic',
    enabled_outputs: ['blog', 'instagram'],
    locations: [{ city: 'Nashville', region: 'TN' }],
    website: 'https://emptycontext.com',
    clinic_context: null,
    brand_voice: null,
    audience_short: null, },

  { slug: 'minimal-config-clinic',
    display_name: 'Minimal Config', _specialty: 'chiropractic',
    enabled_outputs: ['blog'],
    locations: [{ city: 'Austin', region: 'TX' }], },  // no website, no context, no voice

  // ─ Edge cases: very long content fields ──────────────────────────────────
  { slug: 'longcontext-clinic',
    display_name: 'Long Context Clinic', _specialty: 'integrative',
    enabled_outputs: ['blog', 'instagram'],
    locations: [{ city: 'San Francisco', region: 'CA' }],
    website: 'https://longcontext.com',
    clinic_context: 'A'.repeat(3900),  // near-max length
    brand_voice: 'B'.repeat(3900),  // near-max length
    audience_short: 'C'.repeat(400), },

  // ─ Specialty edge cases ───────────────────────────────────────────────────
  { slug: 'paws-and-hooves-vet', display_name: 'Paws & Hooves Veterinary', _specialty: 'vet',
    enabled_outputs: ['blog', 'instagram'],
    locations: [{ city: 'Lexington', region: 'KY' }],
    website: 'https://pawsandhooves.vet',
    clinic_context: 'Mixed animal veterinary practice in Lexington horse country.',
    brand_voice: 'Practical and animal-owner empathetic.' },

  { slug: 'somatics-center-pdx', display_name: 'Somatics Center Portland', _specialty: 'mental health',
    enabled_outputs: ['blog'],
    locations: [{ city: 'Portland', region: 'OR' }],
    website: 'https://somaticspdx.com',
    clinic_context: 'Somatic therapy and trauma-informed counseling.',
    brand_voice: 'Gentle and nervous-system aware.' },

  { slug: 'crossfit-recovery-lab', display_name: 'CrossFit Recovery Lab', _specialty: 'PT',
    enabled_outputs: ['blog', 'instagram', 'youtube'],  // youtube is invalid
    locations: [{ city: 'Atlanta', region: 'GA' }],
    website: 'https://crossfitrecovery.com',
    clinic_context: 'CrossFit injury recovery and performance PT.',
    brand_voice: 'High energy, athlete-coded, no BS.' },

  // ─ International / non-US ─────────────────────────────────────────────────
  { slug: 'spine-health-toronto', display_name: 'Spine Health Toronto', _specialty: 'chiropractic',
    enabled_outputs: ['blog', 'instagram'],
    locations: [{ city: 'Toronto', region: 'ON' }],
    website: 'https://spinehealth.ca',
    clinic_context: 'Chiropractic care in downtown Toronto. OHIP-aware practice.',
    brand_voice: 'Professional and Canadian-healthcare-context aware.' },

  { slug: 'motion-clinic-london', display_name: 'Motion Clinic London', _specialty: 'osteopathy',
    enabled_outputs: ['blog', 'instagram'],
    locations: [{ city: 'London', region: 'England' }],
    website: 'https://motionclinic.co.uk',
    clinic_context: 'Osteopathy and sports massage in central London.',
    brand_voice: 'Measured and British-healthcare-literate. We avoid American-style marketing urgency.' },

  // ─ Additional happy-path variety ──────────────────────────────────────────
  { slug: 'functional-movement-kc', display_name: 'Functional Movement KC', _specialty: 'chiropractic',
    enabled_outputs: ['blog', 'facebook', 'gbp'],
    locations: [{ city: 'Kansas City', region: 'MO' }],
    website: 'https://functionalmovement.cc',
    clinic_context: 'Functional movement assessment and correction in Kansas City.',
    brand_voice: 'Midwest-practical. We skip the jargon and explain what is happening in your body.',
    audience_short: 'Kansas City adults with chronic pain who have "tried everything."' },

  { slug: 'the-manual-therapist', display_name: 'The Manual Therapist', _specialty: 'PT',
    enabled_outputs: ['blog', 'instagram', 'linkedin'],
    locations: [{ city: 'Raleigh', region: 'NC' }],
    website: 'https://themanualtherapist.com',
    clinic_context: 'Manual therapy, dry needling, and vestibular rehab in Raleigh.',
    brand_voice: 'Evidence-based and peer-credible. We cite research because our patients and referring MDs expect it.' },

  { slug: 'movement-rx-brooklyn', display_name: 'Movement Rx Brooklyn', _specialty: 'chiropractic',
    enabled_outputs: ['blog', 'instagram'],
    locations: [{ city: 'Brooklyn', region: 'NY' }],
    website: 'https://movementrx.nyc',
    clinic_context: 'Urban chiropractic care for Brooklyn creatives, parents, and athletes.',
    brand_voice: 'Direct and New York-paced. We skip the preamble.' },

  { slug: 'blue-ridge-sport-chiro', display_name: 'Blue Ridge Sport Chiropractic', _specialty: 'chiropractic',
    enabled_outputs: ['blog', 'instagram', 'facebook'],
    locations: [{ city: 'Asheville', region: 'NC' }],
    website: 'https://blueridgesport.com',
    clinic_context: 'Asheville sport chiro for trail runners, cyclists, and climbers.',
    brand_voice: 'Outdoorsy and technical. We write for people who plan weekend routes on Gaia GPS.' },

  { slug: 'core-sports-medicine', display_name: 'Core Sports Medicine', _specialty: 'PT',
    enabled_outputs: ['blog', 'instagram', 'linkedin', 'email_newsletter'],
    locations: [{ city: 'Salt Lake City', region: 'UT' }],
    website: 'https://coresportsmedicine.com',
    clinic_context: 'Sports medicine PT in Salt Lake City for skiers, climbers, and trail runners.',
    brand_voice: 'Data-driven and gear-knowledgeable. Our patients track their heart rate variability.' },

  { slug: 'balance-point-wellness', display_name: 'Balance Point Wellness', _specialty: 'integrative',
    enabled_outputs: ['blog', 'instagram', 'facebook'],
    locations: [{ city: 'Bend', region: 'OR' }],
    website: 'https://balancepointwellness.com',
    clinic_context: 'Chiro and acupuncture together in Bend, OR.',
    brand_voice: 'Outdoorsy and integrative. We write for the Bend lifestyle.' },

  { slug: 'urban-athlete-clinic', display_name: 'Urban Athlete Clinic', _specialty: 'chiropractic',
    enabled_outputs: ['blog', 'instagram'],
    locations: [{ city: 'Philadelphia', region: 'PA' }],
    website: 'https://urbanathleteclinic.com',
    clinic_context: 'Chiro and sports rehab for Philly urban athletes and crossfit community.',
    brand_voice: 'Gritty and Philly-proud. We are part of the community we serve.' },

  { slug: 'spine-strong-tampa', display_name: 'SpineStrong Tampa', _specialty: 'chiropractic',
    enabled_outputs: ['blog', 'instagram', 'facebook', 'gbp'],
    locations: [{ city: 'Tampa', region: 'FL' }],
    website: 'https://spinestrongtampa.com',
    clinic_context: 'Family and sports chiro in Tampa with a strong youth athlete program.',
    brand_voice: 'Family-forward and sports-savvy. We speak to parents and athletes in the same voice.' },

  { slug: 'highland-chiro-denver', display_name: 'Highland Chiropractic Denver', _specialty: 'chiropractic',
    enabled_outputs: ['blog', 'facebook'],
    locations: [{ city: 'Denver', region: 'CO' }],
    website: 'https://highlandchirodenver.com',
    clinic_context: 'Neighborhood chiro in the Highlands neighborhood. Community-rooted practice.',
    brand_voice: 'Neighborly and honest. We write like a friend who happens to be a doctor.' },

  { slug: 'sport-and-spine-nyc', display_name: 'Sport & Spine NYC', _specialty: 'chiropractic',
    enabled_outputs: ['blog', 'instagram', 'linkedin'],
    locations: [{ city: 'New York', region: 'NY' }],
    website: 'https://sportandspinenyc.com',
    clinic_context: 'Manhattan sport chiro serving finance workers, marathon runners, and dancers.',
    brand_voice: 'Sophisticated and time-respectful. Our patients are busy. We are direct.' },

  { slug: 'holistic-vet-motion', display_name: 'Holistic Vet & Motion', _specialty: 'veterinary',
    enabled_outputs: ['blog', 'instagram'],
    locations: [{ city: 'Scottsdale', region: 'AZ' }],
    website: 'https://holisticvetmotion.com',
    clinic_context: 'Veterinary chiro and rehab in Scottsdale for horses and sporting dogs.',
    brand_voice: 'Science-forward and animal-owner empathetic.' },

  // ─ Near-capacity stress test ──────────────────────────────────────────────
  // These last few are extra — they test what happens when capacity is nearly full.
  { slug: 'capacity-test-clinic-a', display_name: 'Capacity Test A', _specialty: 'chiropractic',
    enabled_outputs: ['blog'],
    locations: [{ city: 'Test City', region: 'TC' }],
    website: 'https://capacitytest.com', _note: 'capacity-stress-test' },

  { slug: 'capacity-test-clinic-b', display_name: 'Capacity Test B', _specialty: 'PT',
    enabled_outputs: ['blog'],
    locations: [{ city: 'Test City', region: 'TC' }],
    website: 'https://capacitytest.com', _note: 'capacity-stress-test' },
]

// ── Run validation ────────────────────────────────────────────────────────────
console.log(`\n🔬 Validating ${TENANTS.length} synthetic tenant profiles…\n`)

let currentExternalCount = externalCount
const results = []

for (const tenant of TENANTS) {
  const result = validatePayload(tenant, currentExternalCount)
  const status = result.willPass ? '✓' : '✗'
  const p0Label = result.p0s.length ? ` P0:${result.p0s.map(i => i.message).join('; ')}` : ''
  const p1Label = result.p1s.length ? ` [${result.p1s.length} P1s]` : ''
  console.log(`  ${status} ${(tenant.slug || '?').padEnd(35)} ${p0Label}${p1Label}`)
  results.push({ ...result, _input: tenant })
}

// ── Build report ──────────────────────────────────────────────────────────────
console.log('\n📊 Building report…')

const passing = results.filter(r => r.willPass)
const failing = results.filter(r => !r.willPass)
const withP1s = results.filter(r => r.p1s.length > 0)
const withP2s = results.filter(r => r.p2s.length > 0)

// Aggregate all P0/P1 issues
const p0Patterns = {}
const p1Patterns = {}
for (const r of results) {
  for (const i of r.p0s) {
    const key = i.field
    p0Patterns[key] = (p0Patterns[key] || 0) + 1
  }
  for (const i of r.p1s) {
    const key = i.field
    p1Patterns[key] = (p1Patterns[key] || 0) + 1
  }
}

const dateStr = new Date().toISOString().slice(0, 10)
let report = `# Synthetic Onboarding Chaos Report — ${dateStr}

> Generated by \`scripts/synthetic-onboarding-harness.mjs\`
> Profiles tested: ${TENANTS.length} | Passing: ${passing.length} | Failing: ${failing.length}
> Capacity at test time: ${externalCount}/${FOUNDING_CAP} external workspaces used

## Summary

| Category | Count |
|---|---|
| **Total profiles** | ${TENANTS.length} |
| **Would pass (no P0s)** | **${passing.length}** |
| **Would fail (P0 blockers)** | **${failing.length}** |
| **Have P1 warnings** | ${withP1s.length} |
| **Have P2 notes** | ${withP2s.length} |

---

## P0 Blockers (Would reject on /api/onboarding/claim)

${failing.length === 0 ? '_No P0 blockers found across all profiles_' :
  failing.map(r => `### ${r._input.slug || r._input.display_name}
**Specialty:** ${r._input._specialty || 'unspecified'}
${r.p0s.map(i => `- **[P0] ${i.field}:** ${i.message}`).join('\n')}
${r.p1s.length ? r.p1s.map(i => `- [P1] ${i.field}: ${i.message}`).join('\n') : ''}
`).join('\n')
}

---

## P0 Issue Patterns (fields causing blockers)

| Field | Times blocked |
|---|---|
${Object.entries(p0Patterns).sort(([,a],[,b]) => b-a).map(([f,n]) => `| ${f} | ${n} |`).join('\n')}

---

## P1 Warnings Across All Profiles

${withP1s.length === 0 ? '_No P1 warnings_' :
  withP1s.map(r => `**${r.slug || r._input.display_name}:** ${r.p1s.map(i => `${i.field}: ${i.message}`).join(' | ')}`).join('\n')
}

---

## Passing Profiles (Happy Path)

| Slug | Specialty | Locations | Outputs | Notes |
|---|---|---|---|---|
${passing.map(r => {
  const locs = r.valid_locations.map(l => l.city).join(', ')
  const note = r._input._note || (r.p1s.length ? `${r.p1s.length} P1s` : '✓')
  return `| ${r.slug} | ${r._input._specialty || '-'} | ${locs || 'none'} | ${r.enabled_outputs.join(', ')} | ${note} |`
}).join('\n')}

---

## Key Findings & Recommended Fixes

${Object.keys(p0Patterns).length > 0 ? `### P0 patterns (fix before first real tenant)
${Object.entries(p0Patterns).sort(([,a],[,b]) => b-a).map(([field, count]) => {
  const examples = failing.filter(r => r.p0s.some(i => i.field === field)).slice(0, 2).map(r => r._input.slug).join(', ')
  return `- **${field}**: ${count} profiles blocked — examples: ${examples}`
}).join('\n')}` : '✅ No systematic P0 blockers found — the claim flow handles all tested edge cases correctly.'}

${Object.keys(p1Patterns).length > 0 ? `### P1 patterns (address before scaling to many tenants)
${Object.entries(p1Patterns).sort(([,a],[,b]) => b-a).map(([field, count]) => {
  return `- **${field}**: ${count} profiles with warnings`
}).join('\n')}` : ''}

### Specialty-specific findings
- **Veterinary tenants**: ${results.filter(r => ['vet','veterinary','animal'].includes((r._input._specialty||'').toLowerCase())).length} tested — check prompt_mode warning status above
- **Mental health tenants**: ${results.filter(r => ['mental health','psychology','therapy','counseling'].includes((r._input._specialty||'').toLowerCase())).length} tested — patient-facing AI content principle applies
- **Multi-location tenants**: ${results.filter(r => (r._input.locations||[]).length > 1).length} tested — workspace_locations inserts at capacity

### Capacity status
- Current: ${externalCount}/${FOUNDING_CAP} external workspaces (${FOUNDING_CAP - externalCount} spots remaining)
- ${externalCount >= FOUNDING_CAP - 2 ? `⚠️ Near cap — next ${FOUNDING_CAP - externalCount} real tenants will succeed; the rest will get founding-spots-full error` : '✅ Capacity comfortable for first batch of chiro friends'}

---

## What to Do Next

1. **Fix any P0 patterns above** before the first real chiro friend onboards
2. **Manually smoke-test** the top 3 happy-path slugs above by running the wizard as a real user on a test account
3. **Re-run this script** after any changes to \`api/onboarding/claim.js\` or \`api/_lib/onboardingValidation.js\`
4. **Monitor capacity** — bump \`FOUNDING_CAP\` in onboardingValidation.js when ready to open more spots

_Re-run: \`node scripts/synthetic-onboarding-harness.mjs\`_
`

const outputDir = '.claude'
if (!existsSync(outputDir)) await mkdir(outputDir, { recursive: true })
const outPath = `${outputDir}/chaos-onboarding-report-${dateStr}.md`
await writeFile(outPath, report, 'utf8')

console.log(`\n✅ Report: ${outPath}`)
console.log(`   ${passing.length}/${TENANTS.length} profiles would pass`)
if (failing.length) {
  console.log(`   P0 issues in fields: ${Object.keys(p0Patterns).join(', ')}`)
}

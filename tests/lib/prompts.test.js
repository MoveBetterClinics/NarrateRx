import { describe, it, expect } from 'vitest'
import {
  TONES,
  GENERAL_TONES,
  getTonesForWorkspace,
  getInterviewSystemPrompt,
  getBlogPostSystemPrompt,
} from '../../src/lib/prompts.js'

// Minimal workspace fixture — clinical mode (default).
function clinicalWorkspace(overrides = {}) {
  return {
    display_name: 'Move Better People',
    location: 'Bellingham, WA',
    location_keyword: 'Bellingham',
    region: 'PNW',
    region_short: 'PNW',
    location_hashtag: '#Bellingham',
    brand_hashtag: '#MoveBetter',
    brand_voice: 'Warm, clinical, movement-first.',
    clinic_context: 'Integrative movement clinic in Bellingham.',
    audience_short: 'Active PNW adults.',
    audience_description: 'Active PNW adults dealing with chronic pain.',
    website: 'https://movebetterpeople.com',
    website_hostname: 'movebetterpeople.com',
    booking_url: 'https://movebetterpeople.com/book',
    pinterest_boards: 'Movement, PT',
    internal_links_markdown: '- [About](/about)',
    interviewer_name: 'Bernard',
    spoken_url: 'movebetterpeople.com',
    newsletter_template_name: 'TrustDrivenCare',
    interview_context: null,
    patient_context: null,
    tone_modifiers: {},
    ...overrides,
  }
}

// General mode workspace (founder/consultant/coach content).
function generalWorkspace(overrides = {}) {
  return {
    ...clinicalWorkspace(),
    display_name: 'NarrateRx',
    brand_voice: 'Direct, peer-to-peer, opinionated.',
    clinic_context: 'Voice-faithful interview-to-content engine for clinicians.',
    booking_url: 'https://narraterx.ai/early-access',
    prompt_mode: 'general',
    ...overrides,
  }
}

describe('TONES / GENERAL_TONES', () => {
  it('has identical IDs across the two tone sets (so the same picker UI works)', () => {
    const clinicalIds = TONES.map((t) => t.id).sort()
    const generalIds = GENERAL_TONES.map((t) => t.id).sort()
    expect(generalIds).toEqual(clinicalIds)
  })

  it('clinical TONES still describes patient-facing tones (unchanged from pre-refactor)', () => {
    expect(JSON.stringify(TONES)).toContain('patient')
  })

  it('GENERAL_TONES has zero "patient" references', () => {
    expect(JSON.stringify(GENERAL_TONES)).not.toContain('patient')
  })
})

describe('getTonesForWorkspace', () => {
  it('returns clinical TONES for workspaces without prompt_mode', () => {
    expect(getTonesForWorkspace({})).toBe(TONES)
    expect(getTonesForWorkspace(null)).toBe(TONES)
    expect(getTonesForWorkspace(undefined)).toBe(TONES)
  })

  it('returns clinical TONES for workspaces with prompt_mode === "clinical"', () => {
    expect(getTonesForWorkspace({ prompt_mode: 'clinical' })).toBe(TONES)
  })

  it('returns GENERAL_TONES for workspaces with prompt_mode === "general"', () => {
    expect(getTonesForWorkspace({ prompt_mode: 'general' })).toBe(GENERAL_TONES)
  })
})

describe('getInterviewSystemPrompt — clinical mode (default)', () => {
  it('produces a prompt with clinical framing for default workspaces', () => {
    const ws = clinicalWorkspace()
    const prompt = getInterviewSystemPrompt(ws, 'Dr. Smith', 'lower back pain', [], null, {
      isFirstMessage: true,
    })
    // The clinical hardcodes the refactor PRESERVES (intentional — Move Better
    // and other clinical workspaces must see no behavior change).
    expect(prompt).toContain('treat lower back pain')
    expect(prompt).toContain('PATIENT SCENARIO')
    expect(prompt).toContain('CLINICAL PHILOSOPHY')
    expect(prompt).toContain('TREATMENT & RECOVERY PROCESS')
    expect(prompt).toContain('FOR REFERRING PROVIDERS')
  })

  it('produces identical output regardless of whether prompt_mode is unset, null, or "clinical"', () => {
    const a = getInterviewSystemPrompt(clinicalWorkspace(), 'Dr. Smith', 'sciatica', [], null, { isFirstMessage: true })
    const b = getInterviewSystemPrompt(clinicalWorkspace({ prompt_mode: null }), 'Dr. Smith', 'sciatica', [], null, { isFirstMessage: true })
    const c = getInterviewSystemPrompt(clinicalWorkspace({ prompt_mode: 'clinical' }), 'Dr. Smith', 'sciatica', [], null, { isFirstMessage: true })
    expect(a).toBe(b)
    expect(a).toBe(c)
  })
})

describe('getInterviewSystemPrompt — general mode (non-clinical workspaces)', () => {
  it('drops clinical framing entirely', () => {
    const ws = generalWorkspace()
    const prompt = getInterviewSystemPrompt(ws, 'Michael Quasney', 'why I built NarrateRx', [], null, {
      isFirstMessage: true,
    })
    // The clinical-specific section headers from the old template MUST NOT appear.
    expect(prompt).not.toContain('PATIENT SCENARIO')
    expect(prompt).not.toContain('CLINICAL PHILOSOPHY')
    expect(prompt).not.toContain('TREATMENT & RECOVERY PROCESS')
    expect(prompt).not.toContain('FOR REFERRING PROVIDERS')
    expect(prompt).not.toContain('LOCAL COMMUNITY ANGLE')
    // "patient" and "treat <topic>" should not appear in the general template.
    expect(prompt).not.toContain('patient')
    expect(prompt).not.toContain('treat why I built NarrateRx')
  })

  it('includes the general-mode collection areas', () => {
    const ws = generalWorkspace()
    const prompt = getInterviewSystemPrompt(ws, 'Michael Quasney', 'why I built NarrateRx', [], null, {
      isFirstMessage: true,
    })
    expect(prompt).toContain('THE CONCRETE MOMENT')
    expect(prompt).toContain('THE COUNTERINTUITIVE TAKE')
    expect(prompt).toContain('THE UNDERLYING PRINCIPLE')
    expect(prompt).toContain('CONTRAST WITH WHAT EXISTS')
    expect(prompt).toContain('WHAT IT MEANS FOR THE READER')
  })

  it('uses GENERAL_TONES probe goal, not clinical tone language', () => {
    const ws = generalWorkspace()
    const prompt = getInterviewSystemPrompt(ws, 'Michael Quasney', 'why I built NarrateRx', [], null, {
      tone: 'warm',
      isFirstMessage: true,
    })
    const warmGeneral = GENERAL_TONES.find((t) => t.id === 'warm')
    expect(prompt).toContain(warmGeneral.probe_goal)
    // The clinical warm probe goal mentions "patient" — must not leak in.
    const warmClinical = TONES.find((t) => t.id === 'warm')
    expect(prompt).not.toContain(warmClinical.probe_goal)
  })
})

describe('getBlogPostSystemPrompt — clinical mode (default)', () => {
  it('produces a prompt with clinical section headers for default workspaces', () => {
    const ws = clinicalWorkspace()
    const prompt = getBlogPostSystemPrompt(ws, 'Dr. Smith', 'lower back pain')
    expect(prompt).toContain('What Our Patients Experience')
    expect(prompt).toContain('Mayo Clinic')
    expect(prompt).toContain('Ready to Move Better?')
    expect(prompt).toContain(ws.booking_url)
  })

  it('preserves the clinical "treating" framing in the opening line', () => {
    const ws = clinicalWorkspace()
    const prompt = getBlogPostSystemPrompt(ws, 'Dr. Smith', 'lower back pain')
    expect(prompt).toContain('treating lower back pain')
  })

  it('produces identical output regardless of whether prompt_mode is unset, null, or "clinical"', () => {
    const a = getBlogPostSystemPrompt(clinicalWorkspace(), 'Dr. Smith', 'sciatica')
    const b = getBlogPostSystemPrompt(clinicalWorkspace({ prompt_mode: null }), 'Dr. Smith', 'sciatica')
    const c = getBlogPostSystemPrompt(clinicalWorkspace({ prompt_mode: 'clinical' }), 'Dr. Smith', 'sciatica')
    expect(a).toBe(b)
    expect(a).toBe(c)
  })
})

describe('getBlogPostSystemPrompt — general mode', () => {
  it('drops clinical section headers and patient framing', () => {
    const ws = generalWorkspace()
    const prompt = getBlogPostSystemPrompt(ws, 'Michael Quasney', 'why I built NarrateRx')
    expect(prompt).not.toContain('What Our Patients Experience')
    expect(prompt).not.toContain('What I See in My Patients')
    expect(prompt).not.toContain('Mayo Clinic')
    expect(prompt).not.toContain('NIH')
    expect(prompt).not.toContain('Cleveland Clinic')
    expect(prompt).not.toContain('Book Your Movement Assessment')
    expect(prompt).not.toContain('patient')
    expect(prompt).not.toContain('treating why I built NarrateRx')
  })

  it('includes general writing rules and target length', () => {
    const ws = generalWorkspace()
    const prompt = getBlogPostSystemPrompt(ws, 'Michael Quasney', 'why I built NarrateRx')
    expect(prompt).toContain('Open with a concrete moment from the transcript')
    expect(prompt).toContain('voice fidelity matters more than polish')
    expect(prompt).toContain('900–1200 words')
  })

  it('emits the workspace booking_url as the CTA link when set', () => {
    const ws = generalWorkspace({ booking_url: 'https://narraterx.ai/early-access' })
    const prompt = getBlogPostSystemPrompt(ws, 'Michael Quasney', 'why I built NarrateRx')
    expect(prompt).toContain('https://narraterx.ai/early-access')
  })

  it('omits the CTA section entirely when no booking_url / website is set', () => {
    const ws = generalWorkspace({ booking_url: null, website: null })
    const prompt = getBlogPostSystemPrompt(ws, 'Michael Quasney', 'why I built NarrateRx')
    expect(prompt).not.toContain('Want to talk?')
  })

  it('switches to personal-voice framing when voiceMode === "personal"', () => {
    const ws = generalWorkspace()
    const personal = getBlogPostSystemPrompt(ws, 'Michael Quasney', 'why I built NarrateRx', 'smart', 'personal')
    const practice = getBlogPostSystemPrompt(ws, 'Michael Quasney', 'why I built NarrateRx', 'smart', 'practice')
    expect(personal).toContain('PERSONAL VOICE')
    expect(personal).toContain('First-person throughout')
    expect(practice).not.toContain('PERSONAL VOICE')
  })
})

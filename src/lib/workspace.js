// Workspace registry. NarrateRx is one codebase deployed once per workspace
// — each deployment sets BRAND (server) / VITE_BRAND (client; env var names
// retained pre-multitenant cutover) and the active workspace object is
// selected here. Slated for retirement in the multi-tenant cutover PR that
// flips reads to the DB-backed `workspaces` table; until then this file is
// the source of truth for the three Move Better workspaces.

const PEOPLE = {
  id: 'people',

  // Identity
  name: 'Move Better',
  appName: 'Move Better — NarrateRx',
  tagline: 'Movement Based Medicine',
  signInBlurb: 'Move Better · Sign in with your @movebetter.co account',

  // Auth
  authDomain: 'movebetter.co',

  // Web presence
  website: 'https://www.movebetter.co/',
  websiteHostname: 'movebetter.co',

  // Location
  location: 'Portland, OR',
  region: 'Pacific Northwest',
  regionShort: 'PNW',

  // Visual identity
  logo: { main: '/logo.svg', icon: '/icon.svg' },
  colors: { primary: '#E36525', grey: '#6E7072' },
  socialAvatarInitials: 'MB',
  linkPreviewBlurb: 'Movement-first care for lasting pain relief.',
  linkedInIndustry: 'Chiropractic',

  // Social handles (used in mock previews)
  social: {
    instagram: 'movebetterclinic',
    facebook: 'movebetterclinic',
  },

  // Strings injected into AI system prompts. Equine/animals will replace
  // these with species-appropriate context — the prompt code stays identical.
  prompt: {
    clinicContext:
      'movement-first clinic in Portland, OR. They treat the root cause of pain through movement assessment (breathing, bracing, hinging), soft tissue work, exercise rehab, chiropractic, and education. They help patients get off medication and restore function long-term.',

    audienceDescription:
      'active Pacific Northwesterners — Portland trail runners, cyclists, climbers, hikers, skiers, kayakers, tech desk workers, aging athletes who refuse to slow down. They live near Forest Park, the Columbia River Gorge, Mt. Hood, and Smith Rock. Skeptical of medication and quick fixes. They respond to education and authenticity.',

    audienceShort:
      'active Pacific Northwesterners dealing with pain who want to keep doing what they love. Skeptical of generic advice. They respond to specific, honest, movement-based perspectives.',

    brandVoice: `- Warm and conversational — like advice from a knowledgeable, caring friend
- Movement-first: pain is a signal that movement is broken, not something to just suppress or medicate away
- Educational but accessible — zero medical jargon, everything explained simply and naturally
- Patient-centered: speak directly to the reader's experience using "you" often
- Empowering and hopeful: readers should finish feeling understood and optimistic
- Use "we" and "our patients" naturally — the clinic has a team perspective
- Reference Move Better's approach when relevant: addressing root causes, Movement Paradigm Scoring, teaching lifelong skills`,

    // Internal-link library used by the blog post prompt. Each brand keeps
    // its own equivalent. Drop in verbatim — the prompt expects markdown.
    internalLinksMarkdown: `CORE PAGES:
- Movement Paradigm Scoring (our assessment system): https://www.movebetter.co/mps/
- Our team: https://www.movebetter.co/team-members/
- Sports chiropractic: https://www.movebetter.co/treatments/sports-chiropractic/
- Insurance info: https://www.movebetter.co/insurance/

CHRONIC PAIN (link when relevant to the topic):
- "How to Fix Chronic Low Back Pain": https://www.movebetter.co/how-to-fix-chronic-low-back-pain/
- "Chiropractic Manipulation for Chronic Pain": https://www.movebetter.co/chiropractic-manipulation-for-chronic-pain/
- "5 Myths About Chronic Pain": https://www.movebetter.co/myths-about-chronic-pain/
- "What Pain Science Has to Say About Chronic Pain": https://www.movebetter.co/what-pain-science-has-to-say-about-chronic-pain/
- "Chronic Pain Management: What to Expect": https://www.movebetter.co/chronic-pain-management-what-to-expect-from-a-treatment-plan/
- "A Better Way to Diagnose Chronic Pain": https://www.movebetter.co/a-better-way-to-diagnose-chronic-pain/

MOVEMENT & CORE:
- "Function Over Structure": https://www.movebetter.co/function-over-structure/
- "Belly Breathing vs. Chest Breathing": https://www.movebetter.co/belly-breathing-vs-chest-breathing-why-you-might-be-in-pain-or-experiencing-stress/
- "Brace Yourself! Abdominal Activation": https://www.movebetter.co/brace-yourself-abdominal-activation-for-pain-reduction-and-muscle-relaxation/
- "Are You Using Your Glutes?": https://www.movebetter.co/are-you-using-your-glutes-or-are-you-using-your-body/
- "How Do You Pull? (neck/shoulder/back pain)": https://www.movebetter.co/how-do-you-pull-potential-reason-for-neck-shoulder-and-back-pain/

SPECIFIC CONDITIONS:
- Knee pain: https://www.movebetter.co/knee-pain-and-rehabilitation-overview/
- Neck pain: https://www.movebetter.co/combatting-chronic-neck-pain/
- Low back pain: https://www.movebetter.co/i-almost-hurt-my-back/
- Running form: https://www.movebetter.co/how-to-run/
- Whiplash/accidents: https://www.movebetter.co/exploring-the-physics-of-vehicle-accidents-and-effects-on-the-body/
- Post-accident recovery: https://www.movebetter.co/still-not-right-after-your-accident-or-injury-heres-what-might-be-missing/
- Prenatal/postpartum: https://www.movebetter.co/a-note-to-mothers/

STRENGTH & REHAB:
- "Strength is Medicine": https://www.movebetter.co/strength-is-medicine-how-can-being-stronger-reduce-pain/
- "Workouts vs. Rehabilitation": https://www.movebetter.co/workouts-vs-rehabilitation-are-they-really-that-different/
- "Load Management for Pain Management": https://www.movebetter.co/load-management-for-pain-management/
- "Progress Isn't Always Painless": https://www.movebetter.co/progress-isnt-always-painless/
- "Playing the Long Game": https://www.movebetter.co/playing-the-long-game/`,

    // The single anchor link the blog CTA must always land on.
    bookingUrl: 'https://www.movebetter.co/',

    // The clinic's signature assessment / proprietary system, referenced by
    // the blog and landing-page prompts. Equine has its own equivalent.
    signatureSystemName: 'Movement Paradigm Scoring',
    signatureSystemUrl: 'https://www.movebetter.co/mps/',

    // Pinterest board names suggested for pin-batching.
    pinterestBoards:
      'Pain Relief & Recovery / Portland Wellness / Movement & Fitness / Chiropractic Care',

    // Hashtags / spoken brand handle used by the video script prompt.
    locationKeyword: 'Portland',
    locationHashtag: '#PortlandChiropractor',
    brandHashtag: '#MoveBetter',
    spokenUrl: 'MoveBetter.co',

    // Tone-modifier vocabulary that varies by audience.
    sportContext:
      'sport-specific scenarios relevant to the Pacific Northwest (running, lifting, cycling, climbing, hiking, skiing)',
  },

  // Master template name used by the email-generation prompt and the Content
  // Hub email-copy header. Tracks the TrustDrivenCare master template.
  newsletterTemplateName: 'Move Better Newsletter - Master',
  newsletterCopyHeader: 'Copy into TrustDrivenCare — Move Better Newsletter · Master',

  // Per-brand product capabilities. Flip to true once the receiving end is
  // wired up. people brand is still pending — movebetter.co is the only Move
  // Better marketing site without a publish receiver yet.
  capabilities: {
    websitePublish: false,
  },
}

const EQUINE = {
  id: 'equine',

  // Identity
  name: 'Move Better Equine',
  appName: 'Move Better Equine — NarrateRx',
  tagline: 'Restoring Movement, Balance, and Comfort for Horses',
  signInBlurb: 'Move Better Equine · Sign in with your @movebetter.co account',

  // Auth — Whitney signs in with her existing @movebetter.co Workspace email.
  // The equine brand has no email hosting on its own domain. Same auth pool
  // as the human brand, but a separate Clerk app keeps sessions and the user
  // list distinct per deployment.
  authDomain: 'movebetter.co',

  // Web presence
  website: 'https://movebetterequine.com/',
  websiteHostname: 'movebetterequine.com',

  // Location — physical haul-in base; service area is broader (see region).
  location: 'Ridgefield, WA',
  region: 'Southwest Washington and Greater Portland',
  regionShort: 'PNW',

  // Visual identity. Logo paths resolve from each deployment's public/ — the
  // equine-branded SVGs will replace the default ones in Move Better Equine/public/.
  logo: { main: '/logo.svg', icon: '/icon.svg' },
  colors: { primary: '#E36525', grey: '#6E7072' },
  socialAvatarInitials: 'MBE',
  linkPreviewBlurb: 'Mobile equine chiropractic care across Southwest Washington and the greater Portland area — restoring movement, balance, and comfort for horses.',
  linkedInIndustry: 'Veterinary',

  // Social handles — none claimed yet for the equine workspace. Placeholders mirror
  // expected usernames so PostPreview mocks render coherently. Update when claimed.
  social: {
    instagram: 'movebetterequine',
    facebook: 'movebetterequine',
  },

  // Strings injected into AI system prompts. Mirror the PEOPLE structure exactly
  // so prompts.js stays brand-agnostic.
  prompt: {
    clinicContext:
      'mobile equine chiropractic practice serving Southwest Washington and the greater Portland, Oregon region. Dr. Whitney Phillips visits horses on-site at farms and barns, with a haul-in option to Ridgefield, WA. Each horse is evaluated individually with attention to posture, gait, and joint motion; care is tailored to the horse\'s discipline and stage of life. Movement-based chiropractic restoring mobility, balance, and overall comfort — always positioned as complementary to veterinary care, never a replacement.',

    audienceDescription:
      'horse owners, riders, trainers, and equestrian professionals across Southwest Washington and the Portland, Oregon area, ranging from recreational riders to high-performance sport-horse competitors. They notice subtle changes in their horses — refusal to pick up a lead, shifted posture, tail swishing, bit grinding, reluctance to move forward — and want to address restrictions before they become bigger problems. They value evidence-informed, systems-based explanations and respect their veterinarian, looking for complementary care that supports their horse\'s long-term soundness.',

    audienceShort:
      'horse owners, trainers, and riders in Southwest Washington and the Portland area who notice subtle movement changes in their horses and want evidence-informed, complementary care that supports long-term soundness.',

    brandVoice: `- Educational and evidence-informed — explain what's happening anatomically without drifting into jargon
- Systems-based: movement is a whole-body story (poll, withers, thoracic, lumbar, hips), not isolated symptoms
- Subtle-signs language — name what owners actually observe: lead refusals, tail swishing, bit grinding, posture shifts, reluctance to move forward
- Always complementary to veterinary care, never positioned as a replacement
- Owner-centered: speak to the rider/owner directly using "you" and "your horse"
- Hopeful and practical — the goal is restoring balance, comfort, and efficient movement so a horse can do its job well and feel good doing it
- Reference Move Better Equine's approach when relevant: individual evaluation of posture, gait, and joint motion; care tailored to the horse's discipline and stage of life`,

    // Internal-link library used by the blog post prompt. Each brand keeps
    // its own equivalent. Drop in verbatim — the prompt expects markdown.
    internalLinksMarkdown: `CORE PAGES:
- Move Better Equine (homepage): https://movebetterequine.com/
- Contact / book a visit: https://movebetterequine.com/contact/
- Blog index: https://movebetterequine.com/blog/

BLOG POSTS:
- "Subtle Signs Your Horse's Movement May Be Restricted": https://movebetterequine.com/subtle-signs-your-horses-movement-may-be-restricted/`,

    // The single anchor link the blog CTA must always land on. Equine has no
    // online booking — this is the contact page where owners arrange a visit.
    bookingUrl: 'https://movebetterequine.com/contact/',

    // No signature assessment system for the equine workspace. prompts.js checks
    // for null and omits the relevant sentences when these are absent.
    signatureSystemName: null,
    signatureSystemUrl: null,

    pinterestBoards:
      'Equine Wellness / Sport Horse Care / Horse Health / Pacific Northwest Equestrian',

    locationKeyword: 'Southwest Washington',
    locationHashtag: '#PNWEquestrian',
    brandHashtag: '#MoveBetterEquine',
    spokenUrl: 'MoveBetterEquine.com',

    // Tone-modifier vocabulary for performance/sport-focused content.
    sportContext:
      'discipline-specific scenarios across English, Western, and sport horse work — dressage, jumping, eventing, reining, ranch and trail riding common to the Pacific Northwest',
  },

  // Newsletter — the equine variant of the TrustDrivenCare master template
  // hasn't been authored yet. Names mirror the PEOPLE convention; update once
  // the actual TDC template exists.
  newsletterTemplateName: 'Move Better Equine Newsletter - Master',
  newsletterCopyHeader: 'Copy into TrustDrivenCare — Move Better Equine Newsletter · Master',

  capabilities: {
    websitePublish: true,
  },
}

const ANIMALS = {
  id: 'animals',

  // Identity
  name: 'Move Better Animal Chiropractic',
  appName: 'Move Better Animal Chiropractic — NarrateRx',
  tagline: 'Chiropractic care for the pets you love',
  signInBlurb: 'Move Better Animal Chiropractic · Sign in with your @movebetter.co account',

  // Auth — Whitney signs in with her existing @movebetter.co Workspace email.
  // The animals brand has no email hosting on its own domain. Same auth pool
  // as the human brand, but a separate Clerk app keeps sessions and the user
  // list distinct per deployment.
  authDomain: 'movebetter.co',

  // Web presence
  website: 'https://movebetteranimal.co/',
  websiteHostname: 'movebetteranimal.co',

  // Location — two operational clinics; primary listed first.
  location: 'Portland, OR & Vancouver, WA',
  region: 'Pacific Northwest',
  regionShort: 'PNW',

  // Visual identity. Logos reuse the Move Better marks per brand-owner direction —
  // public/ in this deployment will hold the same SVGs as the human deployment.
  logo: { main: '/logo.svg', icon: '/icon.svg' },
  colors: { primary: '#E36525', grey: '#6E7072' },
  socialAvatarInitials: 'MBA',
  linkPreviewBlurb: 'AVCA-certified animal chiropractic in Portland and Vancouver — gentle adjustments for dogs, cats, and small animals.',
  linkedInIndustry: 'Veterinary',

  // Social handles — none claimed yet. Placeholders mirror expected usernames so
  // PostPreview mocks render coherently. Update once handles are claimed.
  social: {
    instagram: 'movebetteranimal',
    facebook: 'movebetteranimal',
  },

  // Strings injected into AI system prompts. Mirror PEOPLE/EQUINE structure exactly
  // so prompts.js stays brand-agnostic.
  prompt: {
    clinicContext:
      'AVCA-certified animal chiropractic practice with two clinics in Portland, OR and Vancouver, WA. Dr. Whitney Phillips treats dogs, cats, and small animals (bunnies, rats, others case-by-case) with gentle hands-on adjustments and complementary modalities. Visits include full history, gait and joint evaluation, soft tissue work, and targeted adjustments. Most issues resolve within 3–4 visits. Care is positioned as a first-resort option for musculoskeletal complaints — and explicitly complementary to veterinary care, never a replacement.',

    audienceDescription:
      'pet owners in Portland, OR and Vancouver, WA — the people whose dogs are slowing down on walks, whose cats are stiff getting off the couch, whose senior pets are losing the spark they used to have. They have often already been to the vet and either heard "it\'s just aging" or been quoted expensive surgical and medication options. They want a less invasive first step. Many are juggling pet health alongside human family demands; they value providers who explain things plainly, charge transparently, and respect their relationship with their veterinarian.',

    audienceShort:
      'pet owners in Portland and Vancouver who notice their dog or cat slowing down, getting stiff, or behaving differently — and want a less invasive option than surgery or long-term meds before things escalate.',

    brandVoice: `- Warm but credentialed — sound like a doctor who happens to also be a pet owner, not a marketing brochure
- Patient-centered — lead with what the owner is worried about ("your dog can't get up the stairs"), not what the clinic offers
- Educational, not salesy — explain the why before the call to book
- Plain analogies over jargon — "imagine walking in high heels all day" beats "biomechanical loading"
- Specific, not abstract — "a dog who can't climb stairs" beats "mobility-impaired companion animals"
- Always complementary to veterinary care, never a replacement — name vets as the right call for emergencies, infections, or anything that needs imaging, medication, or surgery
- Reference Dr. Whitney's AVCA certification when relevant — it's the credential that matters in this field
- Avoid "fur baby" / "spa for pets" framing — this is healthcare, not luxury
- Recurring beliefs to surface: chiropractic should be a first resort, not a last resort; the body is an integrated system; the goal is to reduce unnecessary suffering`,

    // Internal-link library used by the blog post prompt. Each brand keeps
    // its own equivalent. Drop in verbatim — the prompt expects markdown.
    //
    // NOTE: Blog post URLs below assume the slugs we plan to use on movebetteranimal.co.
    // Verify and update once the site is live.
    internalLinksMarkdown: `CORE PAGES:
- Move Better Animal (homepage): https://movebetteranimal.co/
- About Dr. Whitney Phillips: https://movebetteranimal.co/about
- Services & pricing: https://movebetteranimal.co/services
- Is my pet a candidate?: https://movebetteranimal.co/candidate
- Visit Portland: https://movebetteranimal.co/visit/portland
- Visit Vancouver: https://movebetteranimal.co/visit/vancouver
- Blog index: https://movebetteranimal.co/blog

BLOG POSTS:
- "Everything You Need to Know About Chiropractic Care for Pets and Animals": https://movebetteranimal.co/blog/everything-you-need-to-know-about-chiropractic-care-for-pets-and-animals
- "Animal Chiropractor vs. Veterinarian: What's the Difference?": https://movebetteranimal.co/blog/animal-chiropractor-vs-veterinarian
- "An Outsider's View of Animal Chiropractic": https://movebetteranimal.co/blog/an-outsiders-view-of-animal-chiropractic
- "A Dog's Toenail Length Matters": https://movebetteranimal.co/blog/a-dogs-toenail-length-matters`,

    // The single anchor link the blog CTA must always land on. The animal
    // brand uses the same Jane booking instance as the human workspace.
    bookingUrl: 'https://movebetter.janeapp.com/',

    // No proprietary signature assessment system for the animal brand yet.
    // prompts.js checks for null and omits the relevant sentences when these
    // are absent — same behavior as EQUINE.
    signatureSystemName: null,
    signatureSystemUrl: null,

    pinterestBoards:
      'Dog Health & Wellness / Cat Health / Senior Pet Care / Pet Mobility / Pacific Northwest Pets',

    locationKeyword: 'Portland',
    locationHashtag: '#PortlandPets',
    brandHashtag: '#MoveBetterAnimal',
    spokenUrl: 'MoveBetterAnimal.co',

    // Tone-modifier vocabulary for working- and athletic-dog scenarios common
    // to PNW pet owners.
    sportContext:
      'working- and athletic-dog scenarios common to the Pacific Northwest — agility competition, hunting and field work, dock diving, herding, and trail/hiking companionship',
  },

  // Newsletter — the animal variant of the TrustDrivenCare master template
  // hasn't been authored yet. Names mirror the PEOPLE/EQUINE convention; update
  // once the actual TDC template exists.
  newsletterTemplateName: 'Move Better Animal Newsletter - Master',
  newsletterCopyHeader: 'Copy into TrustDrivenCare — Move Better Animal Newsletter · Master',

  capabilities: {
    websitePublish: true,
  },
}

const WORKSPACES = {
  people: PEOPLE,
  equine: EQUINE,
  animals: ANIMALS,
}

function readWorkspaceId() {
  // Vite replaces import.meta.env.VITE_BRAND at build time. Wrapped in
  // try/catch so this file is also safe to import from Node ESM (where
  // import.meta exists but import.meta.env does not). Env var names
  // (VITE_BRAND, BRAND) retained pre-multitenant cutover.
  let viteWorkspace
  try { viteWorkspace = import.meta.env.VITE_BRAND } catch {}
  if (viteWorkspace) return String(viteWorkspace).toLowerCase()

  if (typeof process !== 'undefined' && process.env && process.env.BRAND) {
    return String(process.env.BRAND).toLowerCase()
  }
  return 'people'
}

const activeId = readWorkspaceId()
export const workspace = WORKSPACES[activeId] || PEOPLE
export function getWorkspace() { return workspace }
export function getWorkspaceById(id) { return WORKSPACES[id] || PEOPLE }

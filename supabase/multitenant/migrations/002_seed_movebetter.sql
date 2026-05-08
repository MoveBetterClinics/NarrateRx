-- Move Better workspace seeds. Three rows mirroring the current
-- src/lib/brand.js BRANDS const verbatim. Slugs are stable subdomains.
--
-- These are *staging* seeds for Phase 0/1 development. Phase 2 cutover will
-- create the real workspace_id mappings and migrate live data.
--
-- enabled_outputs and clerk_org_id are intentionally left empty here:
--   - enabled_outputs gets populated in Phase 1 once the output registry is
--     codified and the brand owner picks their channels in the settings UI.
--   - clerk_org_id gets bound when each workspace's Clerk Organization is
--     provisioned during Phase 2 cutover.
--
-- TDC newsletter config (template_name + copy_header) is NOT a workspace
-- column — it lives in workspace_credentials.config keyed by service='tdc'
-- since it only matters for workspaces that use TrustDrivenCare. See the
-- second insert block below.

insert into workspaces (
  slug, display_name, app_name, tagline, sign_in_blurb,
  website, website_hostname,
  location, region, region_short,
  logo, colors, social_avatar_initials, link_preview_blurb, linkedin_industry, social,
  clinic_context, audience_description, audience_short, brand_voice,
  internal_links_markdown, booking_url,
  signature_system_name, signature_system_url,
  pinterest_boards, location_keyword, location_hashtag, brand_hashtag,
  spoken_url, activity_context,
  capabilities
) values
-- =============================================================================
-- movebetter-people (Move Better — human chiropractic, Portland OR)
-- =============================================================================
(
  'movebetter-people',
  'Move Better',
  'Move Better — NarrateRx',
  'Movement Based Medicine',
  'Move Better · Sign in with your @movebetter.co account',
  'https://www.movebetter.co/',
  'movebetter.co',
  'Portland, OR',
  'Pacific Northwest',
  'PNW',
  '{"main": "/logo.svg", "icon": "/icon.svg"}'::jsonb,
  '{"primary": "#E36525", "grey": "#6E7072"}'::jsonb,
  'MB',
  'Movement-first care for lasting pain relief.',
  'Chiropractic',
  '{"instagram": "movebetterclinic", "facebook": "movebetterclinic"}'::jsonb,
  $clinicctx$movement-first clinic in Portland, OR. They treat the root cause of pain through movement assessment (breathing, bracing, hinging), soft tissue work, exercise rehab, chiropractic, and education. They help patients get off medication and restore function long-term.$clinicctx$,
  $aud$active Pacific Northwesterners — Portland trail runners, cyclists, climbers, hikers, skiers, kayakers, tech desk workers, aging athletes who refuse to slow down. They live near Forest Park, the Columbia River Gorge, Mt. Hood, and Smith Rock. Skeptical of medication and quick fixes. They respond to education and authenticity.$aud$,
  $audshort$active Pacific Northwesterners dealing with pain who want to keep doing what they love. Skeptical of generic advice. They respond to specific, honest, movement-based perspectives.$audshort$,
  $voice$- Warm and conversational — like advice from a knowledgeable, caring friend
- Movement-first: pain is a signal that movement is broken, not something to just suppress or medicate away
- Educational but accessible — zero medical jargon, everything explained simply and naturally
- Patient-centered: speak directly to the reader's experience using "you" often
- Empowering and hopeful: readers should finish feeling understood and optimistic
- Use "we" and "our patients" naturally — the clinic has a team perspective
- Reference Move Better's approach when relevant: addressing root causes, Movement Paradigm Scoring, teaching lifelong skills$voice$,
  $links$CORE PAGES:
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
- "Playing the Long Game": https://www.movebetter.co/playing-the-long-game/$links$,
  'https://www.movebetter.co/',
  'Movement Paradigm Scoring',
  'https://www.movebetter.co/mps/',
  'Pain Relief & Recovery / Portland Wellness / Movement & Fitness / Chiropractic Care',
  'Portland',
  '#PortlandChiropractor',
  '#MoveBetter',
  'MoveBetter.co',
  'sport-specific scenarios relevant to the Pacific Northwest (running, lifting, cycling, climbing, hiking, skiing)',
  '{"websitePublish": false}'::jsonb
),
-- =============================================================================
-- movebetter-equine (mobile equine chiropractic, SW Washington / Portland)
-- =============================================================================
(
  'movebetter-equine',
  'Move Better Equine',
  'Move Better Equine — NarrateRx',
  'Restoring Movement, Balance, and Comfort for Horses',
  'Move Better Equine · Sign in with your @movebetter.co account',
  'https://movebetterequine.com/',
  'movebetterequine.com',
  'Ridgefield, WA',
  'Southwest Washington and Greater Portland',
  'PNW',
  '{"main": "/logo.svg", "icon": "/icon.svg"}'::jsonb,
  '{"primary": "#E36525", "grey": "#6E7072"}'::jsonb,
  'MBE',
  'Mobile equine chiropractic care across Southwest Washington and the greater Portland area — restoring movement, balance, and comfort for horses.',
  'Veterinary',
  '{"instagram": "movebetterequine", "facebook": "movebetterequine"}'::jsonb,
  $clinicctx$mobile equine chiropractic practice serving Southwest Washington and the greater Portland, Oregon region. Dr. Whitney Phillips visits horses on-site at farms and barns, with a haul-in option to Ridgefield, WA. Each horse is evaluated individually with attention to posture, gait, and joint motion; care is tailored to the horse's discipline and stage of life. Movement-based chiropractic restoring mobility, balance, and overall comfort — always positioned as complementary to veterinary care, never a replacement.$clinicctx$,
  $aud$horse owners, riders, trainers, and equestrian professionals across Southwest Washington and the Portland, Oregon area, ranging from recreational riders to high-performance sport-horse competitors. They notice subtle changes in their horses — refusal to pick up a lead, shifted posture, tail swishing, bit grinding, reluctance to move forward — and want to address restrictions before they become bigger problems. They value evidence-informed, systems-based explanations and respect their veterinarian, looking for complementary care that supports their horse's long-term soundness.$aud$,
  $audshort$horse owners, trainers, and riders in Southwest Washington and the Portland area who notice subtle movement changes in their horses and want evidence-informed, complementary care that supports long-term soundness.$audshort$,
  $voice$- Educational and evidence-informed — explain what's happening anatomically without drifting into jargon
- Systems-based: movement is a whole-body story (poll, withers, thoracic, lumbar, hips), not isolated symptoms
- Subtle-signs language — name what owners actually observe: lead refusals, tail swishing, bit grinding, posture shifts, reluctance to move forward
- Always complementary to veterinary care, never positioned as a replacement
- Owner-centered: speak to the rider/owner directly using "you" and "your horse"
- Hopeful and practical — the goal is restoring balance, comfort, and efficient movement so a horse can do its job well and feel good doing it
- Reference Move Better Equine's approach when relevant: individual evaluation of posture, gait, and joint motion; care tailored to the horse's discipline and stage of life$voice$,
  $links$CORE PAGES:
- Move Better Equine (homepage): https://movebetterequine.com/
- Contact / book a visit: https://movebetterequine.com/contact/
- Blog index: https://movebetterequine.com/blog/

BLOG POSTS:
- "Subtle Signs Your Horse's Movement May Be Restricted": https://movebetterequine.com/subtle-signs-your-horses-movement-may-be-restricted/$links$,
  'https://movebetterequine.com/contact/',
  null,
  null,
  'Equine Wellness / Sport Horse Care / Horse Health / Pacific Northwest Equestrian',
  'Southwest Washington',
  '#PNWEquestrian',
  '#MoveBetterEquine',
  'MoveBetterEquine.com',
  'discipline-specific scenarios across English, Western, and sport horse work — dressage, jumping, eventing, reining, ranch and trail riding common to the Pacific Northwest',
  '{"websitePublish": true}'::jsonb
),
-- =============================================================================
-- movebetter-animals (animal chiropractic — dogs/cats, Portland + Vancouver)
-- =============================================================================
(
  'movebetter-animals',
  'Move Better Animal Chiropractic',
  'Move Better Animal Chiropractic — NarrateRx',
  'Chiropractic care for the pets you love',
  'Move Better Animal Chiropractic · Sign in with your @movebetter.co account',
  'https://movebetteranimal.co/',
  'movebetteranimal.co',
  'Portland, OR & Vancouver, WA',
  'Pacific Northwest',
  'PNW',
  '{"main": "/logo.svg", "icon": "/icon.svg"}'::jsonb,
  '{"primary": "#E36525", "grey": "#6E7072"}'::jsonb,
  'MBA',
  'AVCA-certified animal chiropractic in Portland and Vancouver — gentle adjustments for dogs, cats, and small animals.',
  'Veterinary',
  '{"instagram": "movebetteranimal", "facebook": "movebetteranimal"}'::jsonb,
  $clinicctx$AVCA-certified animal chiropractic practice with two clinics in Portland, OR and Vancouver, WA. Dr. Whitney Phillips treats dogs, cats, and small animals (bunnies, rats, others case-by-case) with gentle hands-on adjustments and complementary modalities. Visits include full history, gait and joint evaluation, soft tissue work, and targeted adjustments. Most issues resolve within 3–4 visits. Care is positioned as a first-resort option for musculoskeletal complaints — and explicitly complementary to veterinary care, never a replacement.$clinicctx$,
  $aud$pet owners in Portland, OR and Vancouver, WA — the people whose dogs are slowing down on walks, whose cats are stiff getting off the couch, whose senior pets are losing the spark they used to have. They have often already been to the vet and either heard "it's just aging" or been quoted expensive surgical and medication options. They want a less invasive first step. Many are juggling pet health alongside human family demands; they value providers who explain things plainly, charge transparently, and respect their relationship with their veterinarian.$aud$,
  $audshort$pet owners in Portland and Vancouver who notice their dog or cat slowing down, getting stiff, or behaving differently — and want a less invasive option than surgery or long-term meds before things escalate.$audshort$,
  $voice$- Warm but credentialed — sound like a doctor who happens to also be a pet owner, not a marketing brochure
- Patient-centered — lead with what the owner is worried about ("your dog can't get up the stairs"), not what the clinic offers
- Educational, not salesy — explain the why before the call to book
- Plain analogies over jargon — "imagine walking in high heels all day" beats "biomechanical loading"
- Specific, not abstract — "a dog who can't climb stairs" beats "mobility-impaired companion animals"
- Always complementary to veterinary care, never a replacement — name vets as the right call for emergencies, infections, or anything that needs imaging, medication, or surgery
- Reference Dr. Whitney's AVCA certification when relevant — it's the credential that matters in this field
- Avoid "fur baby" / "spa for pets" framing — this is healthcare, not luxury
- Recurring beliefs to surface: chiropractic should be a first resort, not a last resort; the body is an integrated system; the goal is to reduce unnecessary suffering$voice$,
  $links$CORE PAGES:
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
- "A Dog's Toenail Length Matters": https://movebetteranimal.co/blog/a-dogs-toenail-length-matters$links$,
  'https://movebetter.janeapp.com/',
  null,
  null,
  'Dog Health & Wellness / Cat Health / Senior Pet Care / Pet Mobility / Pacific Northwest Pets',
  'Portland',
  '#PortlandPets',
  '#MoveBetterAnimal',
  'MoveBetterAnimal.co',
  'working- and athletic-dog scenarios common to the Pacific Northwest — agility competition, hunting and field work, dock diving, herding, and trail/hiking companionship',
  '{"websitePublish": true}'::jsonb
);

-- =============================================================================
-- TDC (TrustDrivenCare) credentials per workspace.
-- Lives in workspace_credentials so external workspaces that use a different
-- newsletter provider don't carry dead TDC columns. The actual TDC API token
-- (when provisioned) goes in secret_encrypted; template_name + copy_header
-- are non-secret config and live in the config jsonb.
-- =============================================================================
insert into workspace_credentials (workspace_id, service, config) values
  (
    (select id from workspaces where slug = 'movebetter-people'),
    'tdc',
    jsonb_build_object(
      'template_name', 'Move Better Newsletter - Master',
      'copy_header', 'Copy into TrustDrivenCare — Move Better Newsletter · Master'
    )
  ),
  (
    (select id from workspaces where slug = 'movebetter-equine'),
    'tdc',
    jsonb_build_object(
      'template_name', 'Move Better Equine Newsletter - Master',
      'copy_header', 'Copy into TrustDrivenCare — Move Better Equine Newsletter · Master'
    )
  ),
  (
    (select id from workspaces where slug = 'movebetter-animals'),
    'tdc',
    jsonb_build_object(
      'template_name', 'Move Better Animal Newsletter - Master',
      'copy_header', 'Copy into TrustDrivenCare — Move Better Animal Newsletter · Master'
    )
  );

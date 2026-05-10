-- Phase 1F (PR 1) — move tone modifier prompt fragments from filesystem
-- overlays (brands/<id>/toneModifiers.js) into workspace rows so each
-- tenant — including self-onboarded ones — gets paradigm-correct content
-- without a code deploy.
--
-- Shape: tone_modifiers jsonb is { active, clinical, warm, smart } — four
-- prompt fragments. Templates may include the placeholders {display_name}
-- and {activity_context}; substitution happens at render time in
-- src/lib/prompts.js. Empty / missing column → empty string injected
-- (safe default for self-onboarded tenants until they fill them in).
--
-- Seed UPDATEs below copy the existing JS literals from
-- brands/people, brands/equine, brands/animals verbatim, with the only
-- change being `${brand.display_name}` → `{display_name}` and
-- `${brand.activity_context}` → `{activity_context}`.

alter table workspaces
  add column if not exists tone_modifiers jsonb default '{}'::jsonb;

-- =============================================================================
-- movebetter-people
-- =============================================================================
update workspaces set tone_modifiers = jsonb_build_object(
  'active', $tone$
CONTENT TONE — Active & Driven:
This content targets athletes, fitness-minded patients, and high performers. Write with direct, efficient language. Reference {activity_context}. Speak to performance, return-to-sport timelines, and understanding the mechanics. These readers don't need hand-holding — they want precision and actionable specifics. Avoid overly gentle or reassuring language.$tone$,
  'clinical', $tone$
CONTENT TONE — Clinical & In-Depth:
This content targets educated patients who want the full clinical picture. Use precise anatomical and medical vocabulary where it adds clarity — always briefly explain technical terms inline. Include biomechanical reasoning, research-backed framing, and detailed process descriptions. These readers have often already tried standard treatments and want to understand exactly why {display_name}'s approach is different. Do not oversimplify.$tone$,
  'warm', $tone$
CONTENT TONE — Warm & Reassuring:
This content targets patients who are anxious, overwhelmed, or have tried many things without success. Lead with empathy and validation — make them feel seen and understood before anything else. Use gentle, hopeful language throughout. Emphasize that recovery is possible, that their experience is valid, and that they are not alone. Avoid clinical jargon entirely. Focus on small wins, realistic timelines, and the emotional journey alongside the physical. Never make readers feel blamed for their condition.$tone$,
  'smart', $tone$
CONTENT TONE — Smart Default:
Optimize for maximum patient connection and engagement. Write at an accessible level that a motivated patient with no medical background can fully understand and act on. Use warm, relatable language while still being specific and credible. Prioritize the framing most likely to resonate with someone experiencing this condition and considering seeking help at a movement-based clinic.$tone$
)
where slug = 'movebetter-people';

-- =============================================================================
-- movebetter-equine
-- =============================================================================
update workspaces set tone_modifiers = jsonb_build_object(
  'active', $tone$
CONTENT TONE — Active & Driven:
This content targets competitive riders, sport-horse trainers, and performance-focused owners whose horses are working hard — show, eventing, dressage, jumping, reining, ranch and trail. Write with direct, efficient language. Reference {activity_context}. Speak to discipline-specific demands, soundness under load, return-to-work timelines, and the biomechanics of performance. These readers don't need hand-holding — they want precision and actionable specifics. Avoid overly gentle or reassuring language.$tone$,
  'clinical', $tone$
CONTENT TONE — Clinical & In-Depth:
This content targets evidence-minded riders, trainers, and owners who want the full anatomical picture. Use precise equine anatomical and biomechanical vocabulary where it adds clarity — always briefly explain technical terms inline. Include systems-based reasoning (poll, withers, thoracic, lumbar, hips), research-informed framing, and detailed process descriptions. Always position care as complementary to veterinary work — never as a replacement. These readers often work closely with their vet and want to understand exactly how {display_name}'s approach fits alongside that care. Do not oversimplify.$tone$,
  'warm', $tone$
CONTENT TONE — Warm & Reassuring:
This content targets owners who are worried about a horse showing subtle changes — refusing a lead, swishing the tail, grinding the bit, hesitating to move forward, or just "not quite right." Lead with empathy and validation — make the owner feel seen for noticing what others might miss. Use gentle, hopeful language throughout. Emphasize that small changes are worth investigating early, that restoring comfort and balance is realistic, and that they are not overreacting. Avoid clinical jargon entirely. Focus on incremental wins, realistic timelines, and the partnership between owner, horse, vet, and chiropractor. Never make owners feel blamed for what their horse is experiencing.$tone$,
  'smart', $tone$
CONTENT TONE — Smart Default:
Optimize for maximum owner connection and engagement. Write at an accessible level that a motivated horse owner with no veterinary background can fully understand and act on. Use warm, knowledgeable language while still being specific and credible. Prioritize the framing most likely to resonate with someone watching their horse move differently and considering complementary chiropractic care alongside their vet.$tone$
)
where slug = 'movebetter-equine';

-- =============================================================================
-- movebetter-animals
-- =============================================================================
update workspaces set tone_modifiers = jsonb_build_object(
  'active', $tone$
CONTENT TONE — Active & Driven:
This content targets working- and athletic-dog handlers — agility competitors, hunting and field-dog owners, dock-diving handlers, herding-dog and trail-companion owners whose dogs are working hard. Write with direct, efficient language. Reference {activity_context}. Speak to performance, soundness across long days of work, return-to-work timelines, and the biomechanics that matter for a working dog. These readers don't need hand-holding — they want precision and actionable specifics. Avoid overly gentle or reassuring language.$tone$,
  'clinical', $tone$
CONTENT TONE — Clinical & In-Depth:
This content targets research-oriented pet owners who want the full anatomical picture — owners who have already been to the vet, often more than once, and want to understand the underlying mechanics before agreeing to surgery or long-term medication. Use precise anatomical and biomechanical vocabulary where it adds clarity — always briefly explain technical terms inline. Include systems-based reasoning, evidence-informed framing, and detailed process descriptions. Always position chiropractic care as complementary to veterinary work — never as a replacement; name vets as the right call for emergencies, infections, imaging, or surgical decisions. These readers want to understand exactly how {display_name}'s AVCA-certified approach fits alongside their vet's care. Do not oversimplify.$tone$,
  'warm', $tone$
CONTENT TONE — Warm & Reassuring:
This content targets anxious owners whose dog or cat is slowing down, getting stiff, struggling on the stairs, or just losing the spark they used to have — owners who have often heard "it's just aging" from a vet and want a less invasive option before surgery or long-term meds. Lead with empathy and validation — make the owner feel seen for noticing the change and for wanting to do something about it. Use gentle, hopeful language throughout. Emphasize that mobility can often be restored, that small wins add up, and that wanting to help your pet is not overreacting. Avoid clinical jargon entirely. Focus on incremental progress, realistic timelines, and the partnership between owner, vet, and chiropractor. Never make owners feel blamed for what their pet is experiencing.$tone$,
  'smart', $tone$
CONTENT TONE — Smart Default:
Optimize for maximum owner connection and engagement. Write at an accessible level that a motivated pet owner with no veterinary background can fully understand and act on. Use warm, knowledgeable language while still being specific and credible. Prioritize the framing most likely to resonate with someone watching their dog or cat slow down, get stiff, or behave differently — and considering complementary chiropractic care alongside their vet.$tone$
)
where slug = 'movebetter-animals';

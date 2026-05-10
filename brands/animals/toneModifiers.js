// Animals paradigm: pet owners (dogs, cats, small animals) — usually senior or
// athletic pets — seeking complementary care alongside their veterinarian. Use
// 'your dog' / 'your cat' / 'pet owner' — never 'patient'. Avoid 'fur baby' or
// luxury-spa framing; this is healthcare. brand.prompt.sportContext supplies
// the working/athletic-dog vocabulary for the 'active' tone.

export function getToneModifier(tone, brand) {
  switch (tone) {
    case 'active':
      return `
CONTENT TONE — Active & Driven:
This content targets working- and athletic-dog handlers — agility competitors, hunting and field-dog owners, dock-diving handlers, herding-dog and trail-companion owners whose dogs are working hard. Write with direct, efficient language. Reference ${brand.activity_context}. Speak to performance, soundness across long days of work, return-to-work timelines, and the biomechanics that matter for a working dog. These readers don't need hand-holding — they want precision and actionable specifics. Avoid overly gentle or reassuring language.`

    case 'clinical':
      return `
CONTENT TONE — Clinical & In-Depth:
This content targets research-oriented pet owners who want the full anatomical picture — owners who have already been to the vet, often more than once, and want to understand the underlying mechanics before agreeing to surgery or long-term medication. Use precise anatomical and biomechanical vocabulary where it adds clarity — always briefly explain technical terms inline. Include systems-based reasoning, evidence-informed framing, and detailed process descriptions. Always position chiropractic care as complementary to veterinary work — never as a replacement; name vets as the right call for emergencies, infections, imaging, or surgical decisions. These readers want to understand exactly how ${brand.display_name}'s AVCA-certified approach fits alongside their vet's care. Do not oversimplify.`

    case 'warm':
      return `
CONTENT TONE — Warm & Reassuring:
This content targets anxious owners whose dog or cat is slowing down, getting stiff, struggling on the stairs, or just losing the spark they used to have — owners who have often heard "it's just aging" from a vet and want a less invasive option before surgery or long-term meds. Lead with empathy and validation — make the owner feel seen for noticing the change and for wanting to do something about it. Use gentle, hopeful language throughout. Emphasize that mobility can often be restored, that small wins add up, and that wanting to help your pet is not overreacting. Avoid clinical jargon entirely. Focus on incremental progress, realistic timelines, and the partnership between owner, vet, and chiropractor. Never make owners feel blamed for what their pet is experiencing.`

    default: // 'smart' or undefined
      return `
CONTENT TONE — Smart Default:
Optimize for maximum owner connection and engagement. Write at an accessible level that a motivated pet owner with no veterinary background can fully understand and act on. Use warm, knowledgeable language while still being specific and credible. Prioritize the framing most likely to resonate with someone watching their dog or cat slow down, get stiff, or behave differently — and considering complementary chiropractic care alongside their vet.`
  }
}

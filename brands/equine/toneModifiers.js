// Equine paradigm: horse owners, riders, trainers, and sport-horse competitors.
// Care is always positioned as complementary to veterinary care. Use 'horse' /
// 'your horse' / 'rider' / 'owner' — never 'patient'. brand.prompt.sportContext
// supplies discipline-specific vocabulary for the 'active' tone.

export function getToneModifier(tone, brand) {
  switch (tone) {
    case 'active':
      return `
CONTENT TONE — Active & Driven:
This content targets competitive riders, sport-horse trainers, and performance-focused owners whose horses are working hard — show, eventing, dressage, jumping, reining, ranch and trail. Write with direct, efficient language. Reference ${brand.activity_context}. Speak to discipline-specific demands, soundness under load, return-to-work timelines, and the biomechanics of performance. These readers don't need hand-holding — they want precision and actionable specifics. Avoid overly gentle or reassuring language.`

    case 'clinical':
      return `
CONTENT TONE — Clinical & In-Depth:
This content targets evidence-minded riders, trainers, and owners who want the full anatomical picture. Use precise equine anatomical and biomechanical vocabulary where it adds clarity — always briefly explain technical terms inline. Include systems-based reasoning (poll, withers, thoracic, lumbar, hips), research-informed framing, and detailed process descriptions. Always position care as complementary to veterinary work — never as a replacement. These readers often work closely with their vet and want to understand exactly how ${brand.display_name}'s approach fits alongside that care. Do not oversimplify.`

    case 'warm':
      return `
CONTENT TONE — Warm & Reassuring:
This content targets owners who are worried about a horse showing subtle changes — refusing a lead, swishing the tail, grinding the bit, hesitating to move forward, or just "not quite right." Lead with empathy and validation — make the owner feel seen for noticing what others might miss. Use gentle, hopeful language throughout. Emphasize that small changes are worth investigating early, that restoring comfort and balance is realistic, and that they are not overreacting. Avoid clinical jargon entirely. Focus on incremental wins, realistic timelines, and the partnership between owner, horse, vet, and chiropractor. Never make owners feel blamed for what their horse is experiencing.`

    default: // 'smart' or undefined
      return `
CONTENT TONE — Smart Default:
Optimize for maximum owner connection and engagement. Write at an accessible level that a motivated horse owner with no veterinary background can fully understand and act on. Use warm, knowledgeable language while still being specific and credible. Prioritize the framing most likely to resonate with someone watching their horse move differently and considering complementary chiropractic care alongside their vet.`
  }
}

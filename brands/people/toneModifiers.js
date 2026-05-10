// People paradigm: human patients in a movement-based chiropractic clinic.
// Audience defaults skew athletic / PNW-flavored — see brand.prompt.sportContext
// for the brand-specific sport vocabulary used in the 'active' tone.

export function getToneModifier(tone, brand) {
  switch (tone) {
    case 'active':
      return `
CONTENT TONE — Active & Driven:
This content targets athletes, fitness-minded patients, and high performers. Write with direct, efficient language. Reference ${brand.activity_context}. Speak to performance, return-to-sport timelines, and understanding the mechanics. These readers don't need hand-holding — they want precision and actionable specifics. Avoid overly gentle or reassuring language.`

    case 'clinical':
      return `
CONTENT TONE — Clinical & In-Depth:
This content targets educated patients who want the full clinical picture. Use precise anatomical and medical vocabulary where it adds clarity — always briefly explain technical terms inline. Include biomechanical reasoning, research-backed framing, and detailed process descriptions. These readers have often already tried standard treatments and want to understand exactly why ${brand.display_name}'s approach is different. Do not oversimplify.`

    case 'warm':
      return `
CONTENT TONE — Warm & Reassuring:
This content targets patients who are anxious, overwhelmed, or have tried many things without success. Lead with empathy and validation — make them feel seen and understood before anything else. Use gentle, hopeful language throughout. Emphasize that recovery is possible, that their experience is valid, and that they are not alone. Avoid clinical jargon entirely. Focus on small wins, realistic timelines, and the emotional journey alongside the physical. Never make readers feel blamed for their condition.`

    default: // 'smart' or undefined
      return `
CONTENT TONE — Smart Default:
Optimize for maximum patient connection and engagement. Write at an accessible level that a motivated patient with no medical background can fully understand and act on. Use warm, relatable language while still being specific and credible. Prioritize the framing most likely to resonate with someone experiencing this condition and considering seeking help at a movement-based clinic.`
  }
}

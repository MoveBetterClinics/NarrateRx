// Per-atom system prompt builder. Each atom is a single focused piece of
// content — one platform, one angle, generated from the full interview
// transcript with the approved blog post passed in as editorial context.
// Returns null for unknown platform/angle combos so callers can bail early.
//
// Voice-fidelity note (PR for atoms-from-transcript): atoms used to be
// generated from the blog post alone, which guaranteed near-zero provenance
// overlap with the source transcript and produced two layers of LLM-driven
// voice loss (transcript → blog → atom). Atoms now receive the conversation
// as their primary source and the blog as a thematic guidepost. Each channel
// can quote different moments from the same interview rather than compressing
// the same blog summary five different ways.

function buildVoicePhrasesBlock(phrases) {
  const list = Array.isArray(phrases) ? phrases : []
  if (!list.length) return ''
  const examples = list.slice(0, 8).map((p) => `  • ${p.phrase || ''}`).filter((l) => l.trim() !== '•').join('\n')
  if (!examples) return ''
  return `\n\nVOICE PHRASE ANCHORS — sentences this clinician has shipped in approved content. When a similar idea arises, prefer phrasing in this register rather than rewriting it in a generic clinical voice. These are examples, NOT required quotations — only echo when the meaning genuinely aligns:\n${examples}\n`
}

// `campaignContext` — output of getTentpolePromptContext(campaign, ws) from
// api/_lib/tentpoleCampaignContext.js. Empty string when no campaign is
// active or when the active campaign's content_style is 'clinical'. When
// present, it overrides the default CTA framing in each per-platform
// instruction. Blog posts intentionally do NOT consume this — blogs are
// evergreen and outlast any single campaign window.
//
// Voice-fidelity rewrite (2026-05-28): the `tone`, `audienceLabel`, and
// `storyTypeLabel` parameters were producing voice drift. They're accepted
// but ignored. The CORE of every atom is a single point — a claim plus the
// why behind it, in the clinician's voice. The SURFACE (hook, intro, CTA,
// formatting) flexes per platform. The per-platform `instructions` block
// below IS the surface; voice fidelity is enforced by the preamble + voice
// phrase anchors. See .claude/design-interview-output-voice-fidelity.md.
export function getAtomSystemPrompt(workspace, staffName, condition, platform, angle, voiceMode = 'practice', tone = 'smart', voiceNotes = '', brandGuidelines = '', voicePhrases = [], audienceLabel = null, storyTypeLabel = null, campaignContext = '', ownHistoryBlock = '') {
  void tone; void audienceLabel; void storyTypeLabel
  const firstName = staffName.split(' ')[0]
  const isPersonal = voiceMode === 'personal'

  // Appended to every Instagram prompt. Instructs the AI to plan a multi-slide
  // carousel with per-slide text blocks. draft.js parses this JSON block as
  // the canonical source for content_items.slides.
  const instagramOverlayInstructions = `

After the caption and hashtags, add this separator on its own line:
---SLIDES---
Then output a valid JSON array (no prose, no markdown fences) with 3–5 slide objects describing the carousel plan. Each slide has a "template" (cover, explainer, demonstration, quote, or cta) and a "blocks" array of on-photo text blocks. Each block has a "role" (hook, body, caption, cta, attribution, or page), a "text" string, and optionally a "position" (top, top-left, top-right, center, center-left, center-right, bottom, bottom-left, bottom-right).

Template guidance:
- cover (slide 1): one hook block, optional page-number. Hook = scroll-stopping statement, 5–7 words, ALL CAPS.
- explainer (slides 2–N): hook + body (+ optional caption). Body = 1–2 sentences explaining the idea.
- demonstration: no text — the photo carries the slide.
- quote: a body block (the actual quote, italic) + an attribution block.
- cta (final slide): hook + body + cta. CTA = 3–5 word action phrase like "Book Your Free Assessment".

Aim for 3–5 slides total. The last slide should usually be a "cta" template. Don't repeat the same text across slides. Each slide's blocks should cohere with the slide's template defaults but you can omit/add blocks if it serves the story.

Example shape (do NOT copy verbatim — write fresh text per the caption):
[
  { "template": "cover",     "blocks": [{ "role": "hook", "text": "YOUR PIRIFORMIS MIGHT NOT BE TIGHT", "position": "center" }] },
  { "template": "explainer", "blocks": [{ "role": "hook", "text": "MRI SAYS HERNIATED", "position": "top" }, { "role": "body", "text": "But the structure isn't the problem — the pattern that stressed it is.", "position": "center" }] },
  { "template": "cta",       "blocks": [{ "role": "hook", "text": "READY TO MOVE PAST THE MRI?", "position": "top" }, { "role": "body", "text": "Book a free movement assessment.", "position": "center" }, { "role": "cta", "text": "Reserve Your Free Seat", "position": "bottom" }] }
]`

  const instructions = {
    instagram: {
      hook: `Write a single Instagram caption (~175 words) for ${workspace.display_name} about ${condition}.
ANGLE: Open with the most scroll-stopping moment from the conversation — a myth-buster, bold claim, or surprising fact ${firstName ? `${firstName} actually said` : 'the clinician actually said'}. Make it impossible to scroll past.
${isPersonal ? `Write in ${firstName}'s first-person voice.` : `Use "we" and "our team" language.`}
Close with: "Full article at the link in bio 👆"
Add a blank line, then 8–10 hashtags: condition-specific, movement, ${workspace.location_hashtag ?? '#physicaltherapy'}, ${workspace.brand_hashtag ?? ''}.
Do NOT include any URLs in the caption body.${instagramOverlayInstructions}`,

      patient_scenario: `Write a single Instagram caption (~175 words) for ${workspace.display_name} about ${condition}.
ANGLE: Lead with an anonymized patient scenario that shows the before/after transformation. Make it feel real and specific — describe symptoms, daily limitations, and the outcome.
${isPersonal ? `Write in ${firstName}'s first-person voice — I treated this patient.` : `Frame as a patient the team worked with.`}
Close with: "Read the full story — link in bio"
Add a blank line, then 8–10 hashtags: condition-specific, movement, ${workspace.location_hashtag ?? '#physicaltherapy'}, ${workspace.brand_hashtag ?? ''}.
Do NOT include any URLs in the caption body.${instagramOverlayInstructions}`,

      clinical_insight: `Write a single Instagram caption (~175 words) for ${workspace.display_name} about ${condition}.
ANGLE: Lead with "The one thing most people get wrong about ${condition} is…" and deliver the key clinical insight ${firstName ? `${firstName} surfaced` : 'the clinician surfaced'} in the conversation.
${isPersonal ? `Write in ${firstName}'s first-person voice.` : `Use "we" and "our team" language.`}
Close with: "Full breakdown at the link in bio 👆"
Add a blank line, then 8–10 hashtags: condition-specific, movement, ${workspace.location_hashtag ?? '#physicaltherapy'}, ${workspace.brand_hashtag ?? ''}.
Do NOT include any URLs in the caption body.${instagramOverlayInstructions}`,

      cta: `Write a single Instagram caption (~125 words) for ${workspace.display_name} about ${condition}.
ANGLE: Direct invitation to book. Lead with a one-line hook that mirrors back the specific pattern or experience of someone dealing with ${condition} — not a generic "Are you suffering from pain?" opener. Briefly describe what the assessment at ${workspace.display_name} actually involves (movement screen, not just "a consult"). Make the ask feel like the natural next step after the insight you led with.
${isPersonal ? `Write in ${firstName}'s first-person voice.` : `Use "we" and "our team" language.`}
End with: "Book your assessment — link in bio 👆"
Add a blank line, then 5–6 targeted local hashtags: ${workspace.location_hashtag ?? '#physicaltherapy'}, ${workspace.brand_hashtag ?? ''}, plus condition tags.
Do NOT include any URLs in the caption body.${instagramOverlayInstructions}`,
    },

    linkedin: {
      clinical_perspective: `Write a LinkedIn post (~200 words) for ${workspace.display_name} about ${condition}.
ANGLE: Lead with what this clinic approaches differently about ${condition} — framed for clinicians, coaches, and referring providers.
${isPersonal
  ? `Write in ${firstName}'s first-person professional voice — this is my clinical perspective.`
  : `Frame as ${workspace.display_name}'s team perspective: "At ${workspace.display_name}, we approach ${condition} differently…"`}
Close with: "Happy to connect with colleagues working with patients dealing with ${condition}."
Include URL ${workspace.website} at end. No hashtags.`,

      referring_provider: `Write a LinkedIn post (~200 words) for ${workspace.display_name} about ${condition}.
ANGLE: Written specifically for referring providers — what should a GP, orthopedic surgeon, or sports medicine doc know before referring a ${condition} patient?
${isPersonal
  ? `Write in ${firstName}'s first-person professional voice.`
  : `Frame from ${workspace.display_name}'s clinical team perspective.`}
Close with: "Happy to answer questions or discuss complex cases — reach out directly."
Include URL ${workspace.website} at end. No hashtags.`,

      movement_principle: `Write a LinkedIn post (~200 words) for ${workspace.display_name} about ${condition}.
ANGLE: Zoom out to the underlying movement principle or clinical reasoning that guides treatment. Educational for clinicians who don't specialize in this area.
${isPersonal
  ? `Write in ${firstName}'s first-person professional voice.`
  : `Frame from ${workspace.display_name}'s clinical team perspective.`}
Include URL ${workspace.website} at end. No hashtags.`,
    },

    facebook: {
      community: `Write a Facebook post (~125 words) for ${workspace.display_name} about ${condition}.
ANGLE: Community-first. Lead with the local angle — people in ${workspace.location_keyword ?? 'your area'} dealing with ${condition}. Neighbor-to-neighbor tone, not clinic broadcasting.
${isPersonal
  ? `Write in ${firstName}'s first-person voice — a clinician who cares about the local community.`
  : `Write as ${workspace.display_name} the clinic.`}
Include the full URL ${workspace.website} on its own line near the end.
End with a question that sparks comments. 1–2 hashtags max.`,

      educational: `Write a Facebook post (~125 words) for ${workspace.display_name} about ${condition}.
ANGLE: Educational myth-buster or "did you know" format. One surprising or commonly misunderstood fact about ${condition}, explained simply.
${isPersonal
  ? `Write in ${firstName}'s first-person voice.`
  : `Write as ${workspace.display_name} the clinic.`}
Include the full URL ${workspace.website} on its own line near the end.
End with a question that invites comments. 1–2 hashtags max.`,
    },

    gbp: {
      local_authority: `Write a Google Business Profile post (~200 words) about ${condition} for ${workspace.display_name} in ${workspace.location_keyword ?? 'your area'}.
ANGLE: Establish local authority.
VOICE FIRST: Open with 1–2 sentences that use the clinician's distinctive diagnostic framing from the VOICE PHRASE ANCHORS above — their specific clinical insight or "how" explanation about ${condition}. Do NOT open with a generic "At [clinic] we treat..." line.
Then connect that insight to the local context: what ${workspace.display_name} does differently for ${condition} patients in ${workspace.location_keyword ?? 'your area'}.
Use "we" and "our team" throughout.
Close with 1–2 sentences that echo the specific insight above before the booking ask — not a bare "book now." E.g. "If that pattern sounds familiar, a movement screen at ${workspace.display_name} is how we start untangling it: ${workspace.website}"
No hashtags. Conversational, not salesy.`,

      patient_outcome: `Write a Google Business Profile post (~200 words) about ${condition} for ${workspace.display_name} in ${workspace.location_keyword ?? 'your area'}.
ANGLE: Results framing.
VOICE FIRST: Open with 1–2 sentences in the clinician's authentic voice — pull a specific clinical mechanism or patient insight from the VOICE PHRASE ANCHORS above rather than leading with a generic outcomes statement.
Then pivot to results: what does recovery from ${condition} actually look like at ${workspace.display_name}? Include a specific, believable outcome ("patients typically find…" or "the goal is…").
Use "we" and "our team" throughout.
Close with 1–2 sentences that connect the outcome above to the next step — not a bare "book now." E.g. "If you're ready to find out what recovery actually looks like for your situation: ${workspace.website}"
No hashtags. Conversational, results-focused.`,
    },

    pinterest: {
      pin_batch: `Create 3 Pinterest pin variations for ${workspace.display_name} about ${condition}. For each:
PIN TITLE: (max 100 characters, include keywords naturally — brand as ${workspace.display_name})
PIN DESCRIPTION: (200–400 characters, keyword-rich natural language, include ${workspace.website})
BOARD: (${workspace.pinterest_boards ?? 'Health & Wellness'})`,
    },

    tiktok: {
      myth_buster: `Write a 45–60 second TikTok / Instagram Reels script (~130 words) for ${workspace.display_name} about ${condition}.
ANGLE: Lead with the most counterintuitive claim from the conversation. First 3 seconds must stop the scroll.

[HOOK — first 3 seconds]
One punchy sentence starting with tension or a myth. Example: "Everything you've been told about ${condition} is probably slowing your recovery."

[BODY — 30–40 seconds]
3–4 short punchy points. 1–2 sentences each. Plain language. Add [ON SCREEN TEXT: ...] for text overlays.

[CLOSE — 10 seconds]
"If you're dealing with ${condition} in ${workspace.location_keyword ?? 'your area'}, follow for more — link in bio to book at ${workspace.display_name}."

CAPTION:
50–80 word TikTok caption with 5–6 hashtags. Brand as ${workspace.display_name}.`,

      process: `Write a 45–60 second TikTok / Instagram Reels script (~130 words) for ${workspace.display_name} about ${condition}.
ANGLE: Show what the recovery process actually looks like step by step. Demystify the treatment.

[HOOK — first 3 seconds]
One punchy sentence that promises a clear answer. Example: "Here's what actually happens when you come in for ${condition} at ${workspace.display_name}."

[BODY — 30–40 seconds]
Walk through: assessment → first session → what improves first → full recovery. Short steps. Add [ON SCREEN TEXT: ...] for key steps.

[CLOSE — 10 seconds]
"Book your first assessment — link in bio."

CAPTION:
50–80 word TikTok caption with 5–6 hashtags. Brand as ${workspace.display_name}.`,
    },

    twitter: {
      hook: `Write a single tweet (X post) for ${workspace.display_name} about ${condition}. Hard limit: 280 characters total INCLUDING any URL or hashtags.
ANGLE: Pull the sharpest claim, myth-buster, or counterintuitive insight from the conversation. Make it quotable — the kind of line someone screenshots or quote-tweets.
${isPersonal ? `Write in ${firstName}'s first-person voice — punchy and direct.` : `Use plural "we"/"our team" but keep it punchy, not corporate.`}
No threading. No "1/" prefix. No emoji unless the conversation's tone is unmistakably casual.
At most 1–2 hashtags. Prefer NO link unless the punchline only lands with one — Twitter throttles posts with links.
Output ONLY the tweet body. Do not include "TWEET:" or any label.`,
    },

    threads: {
      community_take: `Write a single Threads post for ${workspace.display_name} about ${condition}. Hard limit: 500 characters.
ANGLE: Conversational, opinion-forward. Open with a stance or observation that invites disagreement or "same here" replies — Threads rewards posts that spark replies, not broadcasts.
${isPersonal ? `Write in ${firstName}'s first-person voice — like you're posting from your phone, not a brand account.` : `Write as the clinic team but in a personal, conversational register — first names and "we" rather than third-person clinic-speak.`}
End with an open question or invitation to share experiences. No corporate hashtag stacks — at most 1–2 lowercase hashtags if they feel natural.
Do NOT include a URL — Threads users rarely click out; the goal is engagement.
Output ONLY the post body.`,
    },

    bluesky: {
      clinical_share: `Write a single Bluesky post for ${workspace.display_name} about ${condition}. Hard limit: 300 characters.
ANGLE: Considered clinician-to-clinician share — assume the reader is another health professional, athlete, or unusually informed patient. The Bluesky audience skews technical and rewards specificity over hype.
${isPersonal ? `Write in ${firstName}'s first-person professional voice — like sharing a clinical observation with peers.` : `Write as the clinical team. Specific, not promotional.`}
NO hashtags (Bluesky culture doesn't use them).
NO link unless it's genuinely the post's purpose — and if so, put it on its own line at the end.
Lean slightly more clinical/precise than the source — this audience can handle technical specificity.
Output ONLY the post body.`,
    },

    mastodon: {
      educational: `Write a single Mastodon post (toot) for ${workspace.display_name} about ${condition}. Hard limit: 500 characters.
ANGLE: Plain-language educational, federated-community-conscious. The Mastodon audience values: clear writing, inclusive language, accessibility, and content warnings on potentially-distressing health topics.
${isPersonal ? `Write in ${firstName}'s first-person voice — like a clinician posting on their personal account.` : `Write as the clinic team in a community register, not a marketing register.`}
If ${condition} touches injury, pain, weight, eating, or mental health, prefix the post with a content warning line: \`CW: <one-phrase topic>\` on its own line, then a blank line, then the body.
Include alt-text guidance if a visual would normally accompany the post: add \`[image alt: ...]\` placeholder at the end.
At most 2–3 hashtags, written in CamelCase for screen-reader accessibility (e.g. #PhysicalTherapy not #physicaltherapy).
Output ONLY the post body (with the CW prefix and alt-text placeholder if applicable).`,
    },
  }

  const instruction = instructions[platform]?.[angle]
  if (!instruction) return null

  const voiceNotesTrimmed = (voiceNotes || '').trim()
  const voiceBlock = voiceNotesTrimmed
    ? `\n\nCLINICIAN VOICE PATTERNS — apply these consistently. They were learned from how this clinician edits drafts, so respecting them up-front saves a round of revisions:\n${voiceNotesTrimmed}\n`
    : ''

  const brandGuidelinesTrimmed = (brandGuidelines || '').trim()
  const brandBlock = brandGuidelinesTrimmed
    ? `\n\nBRAND GUIDELINES — extracted from ${workspace.display_name}'s brand book. Apply these to every word choice:\n${brandGuidelinesTrimmed}\n`
    : ''

  const voicePhrasesBlockStr = buildVoicePhrasesBlock(voicePhrases)

  return `You are turning a real conversation with ${staffName || 'the clinician'} about ${condition} into one ${platform} atom for ${workspace.display_name}.

CORE vs SURFACE — the rule:
- The CORE of this atom is a single point: a claim plus the why behind it, in ${staffName || 'the clinician'}'s actual voice. The core sentences must use their phrasing, not a smoother / more generic version.
- The SURFACE (hook, intro line, CTA, formatting, hashtags) flexes per platform. Platform-specific punch is fine and expected. The surface wraps the core; it never replaces it.

VOICE FIDELITY rules for the core:
- Quote ${staffName || 'the clinician'}'s words from the transcript verbatim where the meaning fits. The conversation is the primary source; the editorial summary (approved long-form post on this topic) is only thematic guidance.
- Never paraphrase a sentence ${staffName || 'the clinician'} said into a smoother version. If a sentence is hard to fit, split it at a natural breath point — don't rewrite the words.
- Preserve every strong claim or opinion in its original strength. Don't soften, balance, or hedge.

Your job: pick the moment in the conversation that best fits this platform and angle, build the core around that moment in their voice, and wrap it in the platform's surface format per the instructions below. Output ONLY the final content — no section markers, headers, labels, or meta-commentary.

PLAIN TEXT ONLY: Do not use markdown formatting — no *asterisks* for emphasis, no **double asterisks** for bold, no --- horizontal rules, no # headers. Social platforms render these as literal characters.

${instruction}
${brandBlock}${voiceBlock}${voicePhrasesBlockStr}${ownHistoryBlock}${campaignContext ? `\n${campaignContext}\n\nThe CAMPAIGN FOCUS directive above OVERRIDES any default "book a visit" / "link in bio" CTAs in the per-platform instructions. Rewrite the CTA portion of this piece to match the campaign — including the exact URL and button phrasing when provided. Keep platform-specific structural rules (character limits, hashtag counts, overlay format) intact.\n` : ''}`
}

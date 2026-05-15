// Per-atom system prompt builder. Each atom is a single focused piece of
// content — one platform, one angle, generated from the full blog post.
// Returns null for unknown platform/angle combos so callers can bail early.

export function getAtomSystemPrompt(workspace, clinicianName, condition, platform, angle, voiceMode = 'practice', tone = 'smart', voiceNotes = '', brandGuidelines = '') {
  const firstName = clinicianName.split(' ')[0]
  const isPersonal = voiceMode === 'personal'
  const toneNote = tone === 'smart'
    ? 'Write in a confident, warm, expert-but-approachable voice. Avoid jargon. Speak to real people.'
    : tone === 'clinical'
    ? 'Write in a precise, evidence-informed clinical voice. Accessible but authoritative.'
    : 'Write in a warm, encouraging, community-first voice. Plain language. No clinical distance.'

  // Appended to every Instagram prompt. Instructs the AI to output a
  // machine-parseable overlay block after the caption so draft.js can split
  // the two pieces without regex-ing through the caption body.
  const instagramOverlayInstructions = `

After the caption and hashtags, add this separator on its own line:
---OVERLAY---
Then provide exactly three lines (no other text):
HOOK: [Bold scroll-stopping statement, 5–7 words, ALL CAPS, derived from the caption's opening hook]
SUBHEAD: [Supporting benefit or context, 8–12 words, Title Case]
CTA: [Button action phrase, 3–5 words, Title Case, e.g. "Book Your Free Assessment"]`

  const instructions = {
    instagram: {
      hook: `Write a single Instagram caption (~175 words) for ${workspace.display_name} about ${condition}.
ANGLE: Open with the most scroll-stopping hook from the blog post — a myth-buster, bold claim, or surprising fact. Make it impossible to scroll past.
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
ANGLE: Lead with "The one thing most people get wrong about ${condition} is…" and deliver the key clinical insight from the blog post.
${isPersonal ? `Write in ${firstName}'s first-person voice.` : `Use "we" and "our team" language.`}
Close with: "Full breakdown at the link in bio 👆"
Add a blank line, then 8–10 hashtags: condition-specific, movement, ${workspace.location_hashtag ?? '#physicaltherapy'}, ${workspace.brand_hashtag ?? ''}.
Do NOT include any URLs in the caption body.${instagramOverlayInstructions}`,

      cta: `Write a single Instagram caption (~125 words) for ${workspace.display_name} about ${condition}.
ANGLE: Direct invitation to book. Lead with a one-line condition-specific hook ("Still dealing with ${condition}?"), briefly describe what the assessment includes, then a clear CTA.
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
ANGLE: Establish local authority. Lead with what ${workspace.display_name} does differently for ${condition} patients locally. Include local keywords naturally.
Use "we" and "our team" throughout.
Close with: "Book your ${condition} assessment at ${workspace.display_name} — link in profile"
No hashtags. Conversational, not salesy.`,

      patient_outcome: `Write a Google Business Profile post (~200 words) about ${condition} for ${workspace.display_name} in ${workspace.location_keyword ?? 'your area'}.
ANGLE: Results framing. What does recovery from ${condition} actually look like at ${workspace.display_name}? Lead with a specific, believable outcome ("patients typically find…" or "the goal is…").
Use "we" and "our team" throughout.
Close with: "Ready to start your recovery? Book at ${workspace.display_name} — link in profile"
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
ANGLE: Lead with the most counterintuitive claim from the blog post. First 3 seconds must stop the scroll.

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
ANGLE: Pull the sharpest claim, myth-buster, or counterintuitive insight from the blog post. Make it quotable — the kind of line someone screenshots or quote-tweets.
${isPersonal ? `Write in ${firstName}'s first-person voice — punchy and direct.` : `Use plural "we"/"our team" but keep it punchy, not corporate.`}
No threading. No "1/" prefix. No emoji unless the blog post tone is unmistakably casual.
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
${toneNote.includes('clinical') ? '' : 'Lean slightly more clinical than the source tone here — this audience can handle precision.'}
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

  return `You are a content strategist helping ${workspace.display_name} create platform-specific content derived from a longer blog post about ${condition}.

Your job: extract the most compelling angle and write ONE focused piece of content following the exact instructions below. Do NOT include section markers, headers, labels, or meta-commentary. Output ONLY the final content, ready to copy and use.

${instruction}

${toneNote}${brandBlock}${voiceBlock}`
}

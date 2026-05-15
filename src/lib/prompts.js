// All paradigm content (tone modifiers, interview/PNW context, patient
// prototypes, topic suggestions) is now stored per-workspace in JSONB
// columns and read at render time. Empty / missing → empty string
// injected (safe default for self-onboarded tenants until they fill the
// sections in via Settings).
//
// Tone modifier templates may include {display_name} and {activity_context};
// substitution happens in renderToneTemplate below.

export const TONES = [
  {
    id: 'smart',
    label: 'Smart Default',
    emoji: '✨',
    description: 'AI picks what best connects patients with this condition',
    probe_goal: 'Always try to get one concrete patient story or before/after moment per topic before moving on.',
  },
  {
    id: 'active',
    label: 'Active & Driven',
    emoji: '⚡',
    description: 'Athletes and high performers — direct, sport-specific, efficient',
    probe_goal: 'Always probe for a specific performance metric or training moment before moving on.',
  },
  {
    id: 'clinical',
    label: 'Clinical & In-Depth',
    emoji: '🔬',
    description: 'Educated patients who want the full picture — precise, research-backed',
    probe_goal: 'Always probe for the mechanism or evidence behind each clinical claim before moving on.',
  },
  {
    id: 'warm',
    label: 'Warm & Reassuring',
    emoji: '🤝',
    description: 'Anxious or overwhelmed patients — empathetic, gentle, hopeful',
    probe_goal: 'Always probe for the emotional moment or turning point in the patient\'s experience before moving on.',
  },
]

// Voice modes are workspace-aware — the practice-voice description names the
// workspace. Computed per-render from the runtime workspace row.
export function getVoiceModes(workspace) {
  return [
    {
      id: 'practice',
      label: 'Practice voice',
      emoji: '🏥',
      description: `Speaking for the clinic. The interview is about how ${workspace.display_name} as a team approaches this — outputs use "we" and "our team."`,
    },
    {
      id: 'personal',
      label: 'Personal voice',
      emoji: '🗣️',
      description: 'Speaking for yourself. The interview is about your own lived experience or a specific patient moment — outputs preserve "I" and end with your signature.',
    },
  ]
}

// Patient prototype selector — driven by workspace.patient_context.prototypes.
// First entry (id: null) is the "all patients" default. Workspaces with no
// prototypes (equine, animals, fresh self-onboarded tenants) return only
// that first entry, and the selector is effectively hidden in the UI.
export function getPatientPrototypesUi(workspace) {
  const prototypes = workspace?.patient_context?.prototypes
  const list = Array.isArray(prototypes) ? prototypes : []
  return [
    {
      id: null,
      label: 'All patients',
      emoji: '✨',
      description: 'No specific archetype — AI draws on the full patient base',
    },
    ...list.map((p) => ({
      id: p.id,
      label: p.shortLabel || p.label,
      emoji: p.emoji || '',
      description: p.coreDesire,
    })),
  ]
}

// Resolve a condition string to one of the workspace's interview-context
// entries. Exact match on the bank key first, then a fuzzy keyword-alias
// pass, then the workspace's fallback entry, then null.
function resolveInterviewContext(workspace, condition) {
  const ctx = workspace?.interview_context
  if (!ctx || typeof ctx !== 'object') return null
  const conditions = ctx.conditions || {}
  if (!condition) return ctx.fallback || null
  const lower = String(condition).toLowerCase()
  if (conditions[lower]) return conditions[lower]
  const aliases = ctx.keywordAliases || {}
  for (const [keyword, key] of Object.entries(aliases)) {
    if (lower.includes(keyword) && conditions[key]) return conditions[key]
  }
  return ctx.fallback || null
}

// Paradigm-neutral formatter. Reads normalized fields:
// audienceProfile, audienceStakes, regionalAngles[], interviewTopics[],
// chronicRelevant. Returns '' if the workspace has no interview_context yet.
function formatInterviewContextForPrompt(workspace, condition) {
  const ctx = resolveInterviewContext(workspace, condition)
  if (!ctx) return ''
  const angles = (ctx.regionalAngles || []).map(a => `  • ${a}`).join('\n')
  const topics = (ctx.interviewTopics || []).map(q => `  • ${q}`).join('\n')
  const chronic = ctx.chronicRelevant ? `
LONG-STANDING / CHRONIC ANGLE — explore this when it fits naturally:
${condition} often presents as a long-standing pattern rather than a fresh issue. Where relevant, draw out:
  • How does treating chronic ${condition} (months or years) differ from an acute case?
  • What chain of compensation through the rest of the body do you almost always find?
  • What does a realistic resolution timeline look like — and how do you set expectations for someone who has been living with this for a long time?
  • How does ${workspace?.display_name || 'this practice'}'s approach complement other care this person may have already had?
` : ''
  return `
AUDIENCE CONTEXT — use this to shape your questions:
- Who shows up for this: ${ctx.audienceProfile || ''}
- What is at stake for them: ${ctx.audienceStakes || ''}
- Regional angles that make content resonate locally:
${angles}
- Key interview areas specific to this condition and audience:
${topics}
${chronic}`
}

// Paradigm-neutral patient-context formatter. Returns '' when the
// workspace has no patient_context (equine/animals stubs today, or any
// fresh self-onboarded tenant). When a prototypeId matches one of the
// workspace's prototypes, sharpen the context toward that archetype.
function formatPatientContextForPrompt(workspace, selectedPrototypeId) {
  const ctx = workspace?.patient_context
  if (!ctx || typeof ctx !== 'object') return ''
  const prototypes = Array.isArray(ctx.prototypes) ? ctx.prototypes : []
  const painPoints = Array.isArray(ctx.priorProviderPainPoints) ? ctx.priorProviderPainPoints : []
  const summary = ctx.summaryBlurb || ''
  if (!summary && prototypes.length === 0 && painPoints.length === 0) return ''

  const painPointLines = painPoints.slice(0, 6).map((pp) => `  • ${pp}`).join('\n')
  const selected = selectedPrototypeId ? prototypes.find((p) => p.id === selectedPrototypeId) : null

  if (selected) {
    const angleLines = (selected.contentAngles || []).map((a) => `  • ${a}`).join('\n')
    const triggerList = (selected.triggers || []).join(', ')
    return `AUDIENCE CONTEXT — WHO THIS CONTENT SERVES:
${summary}

FOCUS FOR THIS INTERVIEW: ${selected.shortLabel || selected.label || selected.id} ${selected.emoji || ''}
This interview is targeting the "${selected.shortLabel || selected.label || selected.id}" archetype — ${selected.summary || ''}

Core desire: ${selected.coreDesire || ''}
What they need: ${selected.whatTheyNeed || ''}

Sharpen your questions and content toward these angles:
${angleLines}

Common triggers for this archetype: ${triggerList}

Common frustrations with prior providers (address indirectly):
${painPointLines}`
  }

  const prototypeLines = prototypes
    .map((p) => `  • ${p.emoji || ''} ${p.label || p.shortLabel || p.id}: ${p.coreDesire || ''}. ${p.whatTheyNeed || ''}`)
    .join('\n')

  return `AUDIENCE CONTEXT — WHO THIS CONTENT SERVES:
${summary}
${prototypeLines ? `\nArchetypes that define this audience:\n${prototypeLines}` : ''}
${painPointLines ? `\nCommon frustrations with prior providers (address these indirectly in content):\n${painPointLines}` : ''}`
}

function renderToneTemplate(tpl, workspace) {
  if (!tpl) return ''
  return String(tpl)
    .replace(/\{display_name\}/g, workspace?.display_name ?? '')
    .replace(/\{activity_context\}/g, workspace?.activity_context ?? '')
}

function getToneModifier(tone, workspace) {
  const tones = workspace?.tone_modifiers
  if (!tones || typeof tones !== 'object') return ''
  const key = tone || 'smart'
  return renderToneTemplate(tones[key] ?? '', workspace)
}

// Per-clinician voice notes block. Built from observed edit patterns by
// /api/clinicians/refresh-voice-notes. Empty string when no notes yet.
// Exported because the server-side atom prompts also use it.
export function voiceNotesBlock(voiceNotes) {
  const trimmed = (voiceNotes || '').trim()
  if (!trimmed) return ''
  return `
CLINICIAN VOICE PATTERNS — apply these consistently. They were learned from how this clinician edits drafts, so respecting them up-front saves a round of revisions:
${trimmed}
`
}

// Appended to long-form generation prompts (blog + minimal-edits). Instructs
// the model to emit a single trailing JSON block that maps each paragraph in
// the generated content back to a user-message index + character span in the
// transcript. Captured by the streaming consumer (extractProvenanceBlock in
// api/_lib/provenanceValidator.js) and stored on content_items.provenance.
//
// The substrate powers three voice-fidelity surfaces:
//   • P0-A — transcript ↔ asset highlight on Story Detail
//   • P0-C — verbatim/paraphrase/synthesis scorecard in ApprovalPanel
//   • P0-G — verbatim contrasting quotes in Themes view
//
// If the model fails to emit cleanly or validation rejects the trailer, the
// server falls back to algorithmic similarity matching — feature works either
// way. Token cost: ~80 in / ~150 out per generation (≈0.5% overhead).
export const PROVENANCE_INSTRUCTION = `

After the content body, emit a single JSON block in this exact shape, on its own lines after the content:

<PROVENANCE>
{"blocks":[{"text_prefix":"First 80 chars of paragraph...","msg":3,"type":"paraphrase","span":[44,187]}]}
</PROVENANCE>

For EACH paragraph in the content body above (in order), emit one block with:
- text_prefix: the first 80 characters of that paragraph (used to verify alignment)
- msg: the index of the user message in the transcript that inspired the paragraph (0-indexed), OR null if the paragraph is synthesis from workspace context / your own knowledge
- type: "verbatim" if quoted exactly | "paraphrase" if reworded from the user message | "synthesis" if drawn from workspace context, exemplars, or your own knowledge
- span: [start, end] character offsets within that user message's text; OMIT this field when type is "synthesis"

Rules:
- Emit ONLY the JSON block — no markdown fence, no commentary, no leading or trailing prose.
- The number of blocks MUST equal the number of paragraphs in the content body.
- Do NOT include the <PROVENANCE> markers themselves in the content body above.
- If your message index is wrong or you cannot identify a source, prefer "synthesis" with msg: null over guessing.`

// Returns the framing-rule block injected into each generation prompt.
// In practice mode: scrub first-person → clinic voice (existing behavior).
// In personal mode: preserve first-person voice, append a brand-attribution signature.
function getFramingRule(workspace, { voiceMode, clinicianName, assetType }) {
  if (voiceMode === 'personal') {
    return `CRITICAL FRAMING RULE — PERSONAL VOICE:
This is a personal-voice piece. Preserve ${clinicianName}'s first-person voice ("I", "my", "me") throughout — do NOT convert to "we" or "our team." This is ${clinicianName}'s lived experience or perspective, told in their own words.
Brand attribution still applies: end the piece with a signature line on its own — "— ${clinicianName}, ${workspace.display_name}, ${workspace.location}". Internal links, paradigm vocabulary, and links to ${workspace.display_name} resources should still appear naturally.`
  }
  // Practice voice — current behavior, with explicit conversion guidance.
  const clinicianMention = assetType === 'video'
    ? `${clinicianName} is the on-camera clinician and expert, but the brand being promoted is ${workspace.display_name}. Scripts should introduce ${clinicianName} as "our clinician" or "part of the ${workspace.display_name} team." All CTAs, bookings, and references point to ${workspace.display_name}, not to ${clinicianName} personally.`
    : `The clinician's name may appear once or twice naturally (e.g., "one of our clinicians, ${clinicianName}, notes that…") but should never be in a headline, section header, or the main focus of a paragraph.`
  return `CRITICAL FRAMING RULE:
This content is branded for ${workspace.display_name} as a clinic — NOT for the individual clinician. The subject is always "we at ${workspace.display_name}" or "our team" or "our approach." Even if the clinician used "I" or "me" in the interview, convert it to clinic voice in the output (e.g., "I see this in patients" → "We see this in patients at ${workspace.display_name}"). ${clinicianMention}`
}

export function getInterviewSystemPrompt(workspace, clinicianName, condition, pastInterviews = [], prototypeId = null, opts = {}) {
  const {
    tone = 'smart',
    isFirstMessage = false,
    shallowReprobe = false,
    priorSessionContext = null,
    conceptBlock   = '',
    agreementBlock = '',
    gapBlock       = '',
  } = opts

  const interviewerName = workspace?.interviewer_name || 'Bernard'

  let pastContext = ''
  if (pastInterviews.length > 0) {
    const formatted = pastInterviews.map((pi) => {
      const who = pi.clinicians?.name || 'a colleague'
      const responses = (pi.messages || [])
        .filter((m) => m.role === 'user')
        .slice(0, 6)
        .map((m) => `- ${m.content}`)
        .join('\n')
      // Mark each cross-staff block with [CONTRAST] so the UI can detect it
      return `[CONTRAST][${who}]\n${responses}`
    }).join('\n\n')

    pastContext = `

CROSS-STAFF PERSPECTIVES — colleagues at ${workspace.display_name} have covered ${condition} before:
${formatted}

When a colleague's perspective meaningfully differs from what ${clinicianName} is saying, surface it as a gentle contrast probe — frame it as: "A colleague mentioned [X] — does that match what you see, or do you experience it differently?" Never frame it as contradiction or disagreement. Skip anything that is already aligned; only probe on genuine differences.
`
  }

  // Probe depth goal from tone definition
  const toneObj = TONES.find((t) => t.id === tone) ?? TONES[0]
  const probeGoal = toneObj.probe_goal
    ? `\nPROBE DEPTH GOAL (${toneObj.label} tone): ${toneObj.probe_goal}`
    : ''

  // Re-probe instruction injected when the previous answer was too shallow
  const reprobeInstruction = shallowReprobe
    ? `\nSHALLOW ANSWER DETECTED: The previous answer was brief and lacked a specific example. Before moving to the next topic, ask for a concrete example or patient moment. Do not repeat the question — probe for concreteness. Only do this once on this topic.\n`
    : ''

  // Prior session reference (Feature 5)
  const priorSessionBlock = priorSessionContext
    ? `\nPRIOR SESSION CONTEXT: This staff member has been interviewed before. In their last session they discussed "${priorSessionContext.topic}". You may reference this naturally once early in the interview if it connects to today's topic: "Last time we talked about ${priorSessionContext.topic} — I'm curious if your thinking has evolved." Only use this if it genuinely connects to today's topic.\n`
    : ''

  // Persona intro — only on the very first AI message
  const personaIntro = isFirstMessage
    ? `Your name is ${interviewerName}. Open with one warm, natural sentence — vary it, don't recite a script. Something like "Hey ${clinicianName}, ${interviewerName} here — thanks for making the time. Ready to dig in?" or "Hi ${clinicianName}, I'm ${interviewerName}. Let's get into it." Then go straight into your first question.`
    : `Your name is ${interviewerName}. Do NOT introduce yourself again — you already did at the start.`

  return `You are ${interviewerName}, a content facilitator helping ${clinicianName} at ${workspace.display_name} think out loud about how they treat ${condition}. Your job is to pull out their clinical perspective efficiently so it can be turned into patient-facing content branded for ${workspace.display_name} as a whole.

VOICE & PERSONA — sound like a real person named ${interviewerName}, not a survey bot:
- Warm, curious, quietly confident — the way a thoughtful senior colleague would interview a peer over coffee.
- Conversational rhythm. Short reactions are fine and human ("Got it." "Makes sense." "Huh, interesting."). One beat, then the next question.
- Use contractions ("you're", "that's", "I'd"). Plain language. No corporate filler, no therapy-speak, no clinical jargon you wouldn't say out loud.
- Vary your sentence openings. Don't start every turn with the same word.
- When you probe, it should feel like genuine curiosity, not an interrogation — "Can you walk me through what that looks like?" beats "Provide a specific example."

${personaIntro}
${formatInterviewContextForPrompt(workspace, condition)}${pastContext}
${workspace.display_name} context: ${workspace.clinic_context}

${formatPatientContextForPrompt(workspace, prototypeId)}
${conceptBlock}
${agreementBlock}
${gapBlock}
${probeGoal}
${reprobeInstruction}${priorSessionBlock}
CONTENT YOU NEED TO COLLECT — each area below produces specific downstream content. Ask about them in any order that flows naturally, but DO NOT move on from an area until the answer is specific and concrete enough to write from. Vague answers get follow-ups.

1. CLINICAL PHILOSOPHY — How they approach ${condition} and the underlying principle that makes their approach different. The "why" behind their method, not just the "what." Press for the principle, not just the procedure.

2. THE COMMON MISCONCEPTION — The single most counterintuitive or surprising thing about ${condition}. What does conventional treatment get wrong? What myth do patients arrive with? Push for one specific, punchy statement — not a list of generalities.

3. THE ONE CLINICAL INSIGHT — The single movement, anatomy, or biomechanics insight that most patients with ${condition} have never heard. Specific enough to fit in one sentence. Press if the answer is generic.

4. PATIENT SCENARIO — One specific anonymized patient: their symptoms, what they tried before, what the assessment revealed, what changed, and how long it took. Concrete details ("a 45-year-old runner who'd been doing PT for 6 months") not generic ("a typical patient"). Get the before/after arc.

5. TREATMENT & RECOVERY PROCESS — Walk through it step by step: what the first visit involves, what changes by week 1, week 4, week 8. What does a realistic timeline look like? Specifics, not "it depends."

6. FOR REFERRING PROVIDERS — What should a GP, orthopedic surgeon, sports medicine doc, or coach know before referring this condition to them? Red flags? What makes a good referral? When should someone NOT see a movement specialist first?

7. LOCAL COMMUNITY ANGLE — Who in ${workspace.location_keyword} most commonly deals with ${condition}? Active retirees, weekend warriors, desk workers, manual laborers, parents lifting kids? Press for the specific local archetype, not "everyone."

RULES — conversational but efficient:
- Brief, natural acknowledgments are fine ("Got it." "Yeah, that makes sense.") — one short beat, then move on. Never gush ("great point," "I love that," "amazing"). Never flatter.
- Don't restate or summarize what they just said back to them. They know what they said.
- Skip throat-clearing transitions ("building on that," "following up on what you mentioned"). Just ask the next question.
- Ask as many questions as needed to get complete, specific content — there is no exchange limit.
- If their answer already covers a later area in the list, skip ahead and move on.
- Ask follow-ups when an answer is vague or generic — phrase them like a curious peer would ("Can you walk me through a recent one?" "What does that actually look like week to week?" "Who specifically — what kind of patient?").
- A vague answer to a numbered area is not enough — keep pressing on that area before moving to the next one. Generic answers produce generic downstream content.
- Questions can be as long as they need to be to give the clinician proper context and framing.

ENDING THE INTERVIEW:
- Only add INTERVIEW_COMPLETE on its own line when the clinician clearly signals they want to stop — listen for phrases like "I think that covers it," "that's everything I have," "I'm done," "let's generate," or similar. Do not end the interview on your own. Keep asking questions until the clinician wraps it up.

${isFirstMessage ? 'Introduce yourself briefly, then ask your first question.' : 'Continue the interview — do not reintroduce yourself.'}`
}

export function getBlogPostSystemPrompt(workspace, clinicianName, condition, tone = 'smart', voiceMode = 'practice', prototypeId = null, voiceNotes = '') {
  const isPersonal = voiceMode === 'personal'
  return `You are a content writer for ${workspace.display_name} in ${workspace.location}. Based on the interview transcript below with ${clinicianName} about treating ${condition}, write an engaging, on-brand blog post targeted at ${workspace.region} readers.

${getFramingRule(workspace, { voiceMode, clinicianName, assetType: 'blog' })}
${voiceNotesBlock(voiceNotes)}
${workspace.display_name.toUpperCase()} BRAND VOICE:
${workspace.brand_voice}

${formatPatientContextForPrompt(workspace, prototypeId)}

LINK BUILDING — this is required, not optional:

Internal links — weave these in naturally where the topic fits. Use descriptive anchor text (never "click here"):

${workspace.internal_links_markdown}

External links — add 2–3 to authoritative, non-competing sources where they genuinely support a claim:
- Mayo Clinic (mayoclinic.org) for condition definitions or prevalence stats
- NIH / PubMed (pubmed.ncbi.nlm.nih.gov) for research citations
- Cleveland Clinic (my.clevelandclinic.org) for anatomy or condition explanations
- American Chiropractic Association (acatoday.org) for chiropractic-specific statistics
- Only use real, stable URLs you are confident exist — if unsure, link to the domain homepage rather than a specific article

LINKING RULES:
- Aim for 3–5 internal links and 2–3 external links per post
- Anchor text must be descriptive and natural — describe what the reader will find, not the URL
- Never stuff links — each link must genuinely serve the reader
- Spread links throughout the post, not bunched in one section
- The CTA section must always link to ${workspace.booking_url} for booking

BLOG POST FORMAT (write in Markdown):

# [Headline: compelling, specific, hopeful — about the condition${isPersonal ? '' : ` and ${workspace.display_name}'s approach`}. Never include the clinician's name in the headline.]

[Hook paragraph: open with ${isPersonal ? 'a moment from my own practice or a patient I remember' : "the patient's lived experience or a relatable question"}. 2–3 sentences that make the reader feel seen.]

## What's Really Going On With ${condition}
[Explain the condition in plain language from a clinical perspective — what's actually happening in the body and why standard approaches often fall short. Include 1–2 links here: one internal to a related ${workspace.display_name} post, one external to an authoritative source.]

## ${isPersonal ? `My Approach to ${condition}` : `The ${workspace.display_name} Approach to ${condition}`}
[${isPersonal
  ? `Describe my specific approach in first person — what makes my method different, what the process looks like in my own work. Concrete and specific to what was shared in the interview.`
  : `${workspace.display_name}'s specific treatment approach — what makes it different, what the process looks like. Use "we" and "our team." Make it concrete and specific to what was shared in the interview.`}${workspace.signature_system_name ? ` Link to ${workspace.signature_system_name} (${workspace.signature_system_url}) if relevant.` : ''}]

## ${isPersonal ? 'What I See in My Patients' : 'What Our Patients Experience'}
[${isPersonal
  ? `Walk through the patient journey from first visit onward in first person — what I do, what changes, realistic timeline. Cite any success stories from the interview (anonymized). Link to a relevant ${workspace.display_name} post if it fits naturally.`
  : `Walk through the patient journey from first visit onward — what happens, what changes, realistic timeline. Cite any success stories from the interview (anonymized). Use "our patients" language. Link to a relevant ${workspace.display_name} post if it fits naturally.`}]

## The Insight Most People With ${condition} Are Missing
[${isPersonal
  ? `The key clinical observation from the interview — in my own voice. This is the moment that makes the post human and builds trust.`
  : `The key clinical observation from the interview — framed as ${workspace.display_name}'s team perspective. This makes the post human and builds trust. The clinician's name may appear here once naturally if it adds credibility, e.g. "As our clinician ${clinicianName} puts it…"`}]

## Ready to Move Better?
[Warm, encouraging CTA — 3–4 sentences. Reinforce movement as the solution. Invite them to book at [${workspace.display_name}](${workspace.booking_url}). Keep it conversational, not salesy.]
${isPersonal ? '' : `
---
*${workspace.display_name} · ${workspace.location}*
`}
TARGET LENGTH: 700–950 words. Write like a human who genuinely cares about helping people move better — not like a content marketing checklist.
${getToneModifier(tone, workspace)}${PROVENANCE_INSTRUCTION}`
}

export function getMinimalEditSystemPrompt(clinicianName, voiceMode = 'practice', voiceNotes = '') {
  return `You are a transcript editor. Your only job is to turn a spoken interview transcript into clean, readable prose without adding anything that wasn't in the speaker's own words.

${voiceNotesBlock(voiceNotes)}
WHAT YOU MUST DO:
- Remove filler words and verbal tics: um, uh, like (as filler), you know, basically, sort of, kind of, right?, I mean, literally (as emphasis filler)
- Fix run-on sentences: split at natural breath points, keep the speaker's syntax otherwise
- Fix obvious grammar errors (subject-verb agreement, tense consistency within a sentence)
- Add paragraph breaks where the speaker shifts topic — one blank line between paragraphs
- Preserve the speaker's vocabulary, sentence rhythm, and technical terminology exactly
- Preserve all numerical claims, timelines, and clinical specifics word-for-word

WHAT YOU MUST NOT DO:
- Do not add section headers, subheadings, or any markdown structure
- Do not add bullet points or numbered lists unless the speaker explicitly listed them
- Do not invent transitions, narrative connectives, or summary sentences
- Do not inject marketing language, calls to action, or any mention of booking
- Do not add links of any kind
- Do not rearrange the order of topics or ideas
- Do not add any sentence that was not paraphrasable from the speaker's own words

VOICE: ${voiceMode === 'personal'
    ? `Preserve all first-person language ("I", "my", "me") exactly as spoken. This is ${clinicianName}'s own words.`
    : `Preserve the speaker's natural voice. Keep "I" or "we" as used — do not convert to any clinic brand voice.`}

OUTPUT FORMAT: Plain prose only. No markdown headers. No preamble. Begin directly with the first cleaned sentence.${PROVENANCE_INSTRUCTION}`
}

export function getSocialBatchSystemPrompt(workspace, clinicianName, condition, campaignContext = '', tone = 'smart', voiceMode = 'practice', prototypeId = null, voiceNotes = '') {
  const isPersonal = voiceMode === 'personal'
  const patientContext = formatPatientContextForPrompt(workspace, prototypeId)
  return `Based on the blog post provided, generate social media content for ${workspace.display_name}. The post is about ${condition}.

${getFramingRule(workspace, { voiceMode, clinicianName, assetType: 'social' })}
${voiceNotesBlock(voiceNotes)}${patientContext ? `\n${patientContext}\n` : ''}
${workspace.display_name}'s audience: ${workspace.audience_description}

Output each section separated by the exact markers below. Include the marker line itself.

---INSTAGRAM---
- 150–200 words
- Open with a scroll-stopping hook (relatable question, bold statement, or surprising fact about ${condition})
- Share the single most compelling insight from the blog ${isPersonal ? 'in my own first-person voice' : `as ${workspace.display_name}'s team perspective`}
${isPersonal ? `- Write in first person — this is my voice, my experience` : `- Use "we" and "our team" language — not a single clinician's voice`}
- Close with: "Full article at the link in bio 👆" or "Read the full post — link in bio"
- Do NOT include any URLs in the caption body itself
- Skip a line, then add 8–10 hashtags: condition-specific, movement, ${workspace.location_keyword}/${workspace.region_short}, and brand tags

---FACEBOOK---
- 100–150 words
${isPersonal ? `- Written in my own first-person voice — sharing with the local ${workspace.location_keyword} community from a personal angle` : `- Written as ${workspace.display_name} the clinic sharing with the local ${workspace.location_keyword} community`}
${isPersonal ? `- Story-driven and personal — written as me, the clinician, in my own voice` : `- Story-driven and personal — but always "our team" not an individual`}
- Include the full URL ${workspace.website} on its own line near the end for rich link preview
- End with an engagement question to spark comments
- 1–2 hashtags max

---GBP POST---
Google Business Profile post:
- 150–250 words
- Start with one compelling insight or question about ${condition}
- Share ${isPersonal ? 'my key perspective' : `${workspace.display_name}'s key perspective`} — what makes the approach different
${isPersonal ? `- Write in first person ("I", "my")` : `- Use "we" and "our team" throughout`}
- Include 1 anonymized patient result if available from the blog
- Close with: "Book your assessment at ${workspace.display_name} — link in profile"
- Conversational, no hashtags

---LINKEDIN---
- 150–250 words
${isPersonal
  ? `- Written in my first-person professional voice — for other clinicians, coaches, employers, and referring providers
- Frame as my clinical perspective: "I approach ${condition} differently than most…"
- Include what my approach gets right that others miss`
  : `- Written from ${workspace.display_name}'s company voice — for other clinicians, coaches, employers, and referring providers
- Frame as clinical perspective: "At ${workspace.display_name}, we approach ${condition} differently…"
- Include what ${workspace.display_name}'s approach gets right that others miss
- May reference that this comes from a conversation with one of the clinical team`}
- Close with: "Happy to connect with colleagues or coaches working with patients dealing with ${condition}."
- Include URL ${workspace.website} at end
- No hashtags

---PINTEREST---
Create 3 Pinterest pin variations. For each:
PIN TITLE: (max 100 characters, include keywords naturally — brand as ${workspace.display_name})
PIN DESCRIPTION: (200–400 characters, keyword-rich natural language, include ${workspace.website})
BOARD: (${workspace.pinterest_boards})${campaignContext}
${getToneModifier(tone, workspace)}`
}

export function getVideoScriptBatchSystemPrompt(workspace, clinicianName, condition, campaignContext = '', tone = 'smart', voiceMode = 'practice', prototypeId = null, voiceNotes = '') {
  const firstName = clinicianName.split(' ')[0]
  const isPersonal = voiceMode === 'personal'
  const patientContext = formatPatientContextForPrompt(workspace, prototypeId)
  return `Based on the blog post provided, write a YouTube video script for ${workspace.display_name} about ${condition}.

${getFramingRule(workspace, { voiceMode, clinicianName, assetType: 'video' })}
${voiceNotesBlock(voiceNotes)}${patientContext ? `\n${patientContext}\n` : ''}
${workspace.display_name}'s audience: ${workspace.audience_short}

Output each section separated by the exact markers below.

---YOUTUBE SCRIPT---
Write a 5–8 minute video script (~700–1000 words spoken at conversational pace).

[HOOK — first 15 seconds]
A direct, specific statement that stops a viewer from scrolling. Lead with the most surprising or counterintuitive thing about ${condition}. Not "today we're going to talk about…"

[INTRO — 30 seconds]
${firstName} introduces themselves naturally: name, role at ${workspace.display_name}, one sentence on ${isPersonal ? 'their movement-first philosophy' : `${workspace.display_name}'s movement-first philosophy`}.

[THE PROBLEM — 60–90 seconds]
What conventional treatment gets wrong about ${condition}. Specific, not generic. Framed as ${isPersonal ? `${firstName}'s clinical perspective in first person` : `${workspace.display_name}'s clinical perspective`}.

[${isPersonal ? 'MY APPROACH' : `THE ${workspace.display_name.toUpperCase()} APPROACH`} — 2–3 minutes]
${isPersonal
  ? `${firstName}'s actual assessment and treatment process for ${condition}, in first person. Patient-friendly language. Use "I" and "my approach." Add [B-ROLL: ...] notes in brackets where relevant footage would help.`
  : `${workspace.display_name}'s actual assessment and treatment process for ${condition}. Patient-friendly language. Use "we" and "our team." Add [B-ROLL: ...] notes in brackets where relevant footage would help.`}

[PATIENT CASE — 60–90 seconds]
Bring the anonymized patient story from the blog to life as a narrative. What changed, how fast, what they can do now. ${isPersonal ? `Reference it as one of ${firstName}'s patients, in first person.` : `Reference it as a ${workspace.display_name} patient.`}

[KEY INSIGHT — 30–60 seconds]
The single movement insight most ${condition} patients have never heard. Make it memorable and specific.

[CTA — 30 seconds]
Warm, direct close. Invite viewers to book a movement assessment at ${workspace.display_name} in ${workspace.location_keyword}. Say the URL naturally: "You can book at ${workspace.spoken_url}" and tell viewers to check the description for the link.

[VIDEO DESCRIPTION]
Write a complete YouTube description (200–300 words):
- Opening sentence mirroring the hook
- 3–4 sentence summary of what the video covers
- Book link: ${workspace.website}
- 5–8 keyword hashtags for YouTube (#${condition.replace(/\s+/g, '')} ${workspace.location_hashtag} ${workspace.brand_hashtag} etc.)${campaignContext}
${getToneModifier(tone, workspace)}`
}

export function getMarketingBatchSystemPrompt(workspace, clinicianName, condition, campaignContext = '', tone = 'smart', prototypeId = null, voiceNotes = '') {
  const firstName = clinicianName.split(' ')[0]
  const conditionSlug = condition.toLowerCase().replace(/\s+/g, '-').slice(0, 20)
  const patientContext = formatPatientContextForPrompt(workspace, prototypeId)
  return `Based on the blog post provided, generate three marketing assets for ${workspace.display_name} about ${condition}. Use the blog post as your source of truth.
${patientContext ? `\n${patientContext}\n` : ''}${voiceNotesBlock(voiceNotes)}
CRITICAL FRAMING RULE:
All assets are branded for ${workspace.display_name} as a clinic. The clinician's expertise informs the content but ${workspace.display_name} is always the subject. Use "we," "our team," and "${workspace.display_name}" throughout. The clinician's name (${firstName}) may appear once in the email as a credibility signal but should not appear in headlines, page titles, or ad copy.

Output each section separated by the exact markers below.

---EMAIL NEWSLETTER---
Monthly patient newsletter for TrustDrivenCare delivery. Output MUST use the exact section markers below — each maps to a named field in the ${workspace.newsletter_template_name} template.

---SUBJECT LINE---
One subject line. Curiosity- or benefit-driven. About the condition and what ${workspace.display_name} does — not the clinician. Under 50 characters.

---PREVIEW TEXT---
One sentence, 50–90 characters. The inbox preview snippet. Complements the subject line — don't repeat it.

---HEADLINE---
The email's main headline. Hopeful, specific, under 12 words. No clinician name. This appears in large bold type at the top of the email body.

---PULL QUOTE---
One single compelling sentence pulled or adapted from the body — the most memorable insight. 15–25 words. First person plural ("we") or declarative. This appears as a styled callout block.

---BODY PARAGRAPH 1---
Opening hook. 3–5 sentences. Make the reader feel seen — speak directly to someone living with ${condition}. Warm, no jargon.

---BODY PARAGRAPH 2---
${workspace.display_name}'s perspective. 3–5 sentences on what makes the approach different for ${condition}. Use "we" and "our team." May reference "one of our clinicians, ${firstName}" once for credibility.

---BODY PARAGRAPH 3---
Patient story + bridge to action. 3–4 sentences. Anonymized case from the blog if available, framed as a ${workspace.display_name} patient. End with a natural transition toward booking.

---CTA TEXT---
Button label only. 4–7 words. Action-oriented. E.g. "Book Your Movement Assessment" or "Start Moving Better Today".

---CTA URL---
${workspace.booking_url}

---PS---
One optional P.S. line. 1–2 sentences. Add urgency, a secondary CTA, or a human touch. Keep it brief.

Tone: warm, educational, knowledgeable friend. No medical jargon.

---LANDING PAGE---
Conversion-focused landing page copy for a condition-specific ${workspace.display_name} page about ${condition}.

HEADLINE: (compelling, specific, hopeful — under 10 words — about the condition and ${workspace.display_name}. No clinician name.)
SUBHEADLINE: (one sentence expanding — what ${workspace.display_name} offers for ${condition})

ABOVE THE FOLD:
2–3 sentences speaking directly to someone in pain who has tried other things. End with primary CTA button text.

SECTION — THE PROBLEM:
H2 + 2–3 sentences on what conventional ${condition} treatment misses. For a skeptical patient.

SECTION — OUR APPROACH:
H2 + 3–4 sentences on ${workspace.display_name}'s specific assessment and treatment process. Use "we" and "our team."${workspace.signature_system_name ? ` Reference ${workspace.signature_system_name} if it fits, linking to ${workspace.signature_system_url}.` : ''}

SECTION — WHAT TO EXPECT:
H2 + 3–4 sentences on first visit, realistic timeline, what changes. Always "our patients" language.

SECTION — PATIENT STORY:
H2 + 3–4 sentences. Anonymized, specific, outcomes-focused. Frame as a ${workspace.display_name} patient.

TRUST SIGNALS:
4–6 one-line bullet points (e.g. "Movement-first — we treat root causes, not just symptoms")

CLOSING CTA:
H2 + 2 sentences + button text. Link destination: ${workspace.booking_url}

SEO:
TITLE TAG: (under 60 characters, include "${condition}" and "${workspace.location_keyword}" and "${workspace.display_name}")
META DESCRIPTION: (under 160 characters, compelling, includes condition and location)

---GOOGLE ADS---
Google Responsive Search Ad copy for ${workspace.display_name} targeting ${condition} searches in ${workspace.location_keyword}.

HEADLINES — write 15, max 30 characters each (label each with char count):
1. [headline] (XX chars)
[continue to 15]

DESCRIPTIONS — write 4, max 90 characters each (label each with char count):
1. [description] (XX chars)
[continue to 4]

FINAL URL: ${workspace.website}
DISPLAY PATH: ${workspace.website_hostname}/${conditionSlug}

CALLOUT EXTENSIONS — 5–6 short phrases under 25 chars each:
- [callout]

SITELINK EXTENSIONS — 4, with title and 2-line description each:
1. Title: [title]
   Line 1: [line 1]
   Line 2: [line 2]
[continue to 4]

Mix brand terms (${workspace.display_name}, ${workspace.location_keyword}), condition terms (${condition}), and benefit terms (pain relief, root cause, movement assessment). Avoid superlatives unless substantiated. No prices.

---INSTAGRAM ADS---
Meta Ads creative copy for ${workspace.display_name}, targeting ${condition} on Instagram in ${workspace.location_keyword}. This will be pasted into Meta Ads Manager — output each field on its own line with the exact label shown.

PRIMARY TEXT: (125 chars recommended for above-the-fold, 2200 max — hook in the first sentence, lead with the problem or a counterintuitive insight about ${condition}, frame as ${workspace.display_name}'s perspective using "we"/"our team", end with a clear next step. No URLs in the body.)
[primary text]

HEADLINE: (max 40 chars — appears under the creative in bold; benefit-driven, names the condition or outcome)
[headline]

DESCRIPTION: (optional, max 30 chars — brief supporting detail or location signal)
[description]

CTA BUTTON: (pick one of: Learn More, Book Now, Sign Up, Get Offer, Contact Us)
[CTA]

DESTINATION URL:
${workspace.booking_url}

CREATIVE NOTES:
- Required: square (1:1) or vertical (4:5) image or 9:16 video
- Keep key text away from edges (Meta crops the top/bottom for placements)
- Avoid text-heavy creatives; let the primary text carry the message
- Recommend a real photo of ${workspace.display_name} clinicians or patients in motion over stock${campaignContext}
${getToneModifier(tone, workspace)}`
}


// ── Exemplar block — Tier 1 of the feedback loop ──────────────────────────
//
// Renders a "use these as style references" section from editor-flagged
// posts. Returns empty string when the pool is empty (common at first), so
// callers can append unconditionally:
//
//   const exemplars = await fetchTopExemplars({ platform })
//   const prompt = base + getExemplarsBlock(exemplars)
//
// Verbatim-preservation constraint. When the editor has flagged specific
// passages from the transcript as "use exactly," append this block to the
// system prompt so every draft + redraft is bound to preserve the phrases
// word-for-word. Returns an empty string when there are no flags, which
// keeps it safe to concatenate unconditionally at every call site.
export function buildVerbatimBlock(flags) {
  if (!Array.isArray(flags) || flags.length === 0) return ""
  const lines = flags
    .map((f, i) => `${i + 1}. "${(f.text || '').trim()}"`)
    .filter((s) => s.length > 4)
    .join('\n')
  if (!lines) return ""
  return `\n\n---VERBATIM PASSAGES (CRITICAL)---\nMUST preserve these exact phrases verbatim in every draft — do not paraphrase, summarize, or rearrange the words. If a passage doesn't fit naturally where you were going to put it, find a place where it does. These are the clinician's own words and must appear in the output exactly as written:\n${lines}\n`
}

// Kept terse on purpose — verbose "STYLE GUIDE" framing makes models mimic
// surface phrases. We want them to absorb voice, not parrot.
export function getExemplarsBlock(exemplars) {
  if (!Array.isArray(exemplars) || exemplars.length === 0) return ""
  const samples = exemplars
    .map((e, i) => `[Example ${i + 1}]\n${e.content}`)
    .join("\n\n")
  return `\n\n---EXEMPLARS---\nThese past posts performed well with our audience. Match their voice and rhythm — do not copy phrasing:\n\n${samples}\n`
}

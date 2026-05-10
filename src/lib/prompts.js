import { formatPNWContextForPrompt } from '@brand-overlay/interviewContext'
import { PATIENT_PROTOTYPES, getPatientContextForPrompt } from '@brand-overlay/patientContext'

// Tone modifiers are now stored per-workspace in workspaces.tone_modifiers
// (jsonb keyed by tone id). Templates may include {display_name} and
// {activity_context}; substitution happens in renderToneTemplate below.
// Empty / missing → empty string injected (safe default for self-onboarded
// tenants until they fill the section in via Settings → AI tone modifiers).
//
// Interview context and patient context still live under brands/<id>/ and
// will move to per-workspace columns in Phase 1F PR 2.

export const TONES = [
  {
    id: 'smart',
    label: 'Smart Default',
    emoji: '✨',
    description: 'AI picks what best connects patients with this condition',
  },
  {
    id: 'active',
    label: 'Active & Driven',
    emoji: '⚡',
    description: 'Athletes and high performers — direct, sport-specific, efficient',
  },
  {
    id: 'clinical',
    label: 'Clinical & In-Depth',
    emoji: '🔬',
    description: 'Educated patients who want the full picture — precise, research-backed',
  },
  {
    id: 'warm',
    label: 'Warm & Reassuring',
    emoji: '🤝',
    description: 'Anxious or overwhelmed patients — empathetic, gentle, hopeful',
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

// Patient prototype selector — driven by workspace overlay data.
// First entry (id: null) is the "all patients" default.
// Equine/animals workspaces return an empty PATIENT_PROTOTYPES array, so the
// selector will only show the first entry and is effectively hidden.
export const PATIENT_PROTOTYPES_UI = [
  {
    id: null,
    label: 'All patients',
    emoji: '✨',
    description: 'No specific archetype — AI draws on the full patient base',
  },
  ...PATIENT_PROTOTYPES.map((p) => ({
    id: p.id,
    label: p.shortLabel || p.label,
    emoji: p.emoji || '',
    description: p.coreDesire,
  })),
]

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

export function getInterviewSystemPrompt(workspace, clinicianName, condition, pastInterviews = [], prototypeId = null) {
  let pastContext = ''
  if (pastInterviews.length > 0) {
    const formatted = pastInterviews.map((pi) => {
      const who = pi.clinicians?.name || 'a colleague'
      const responses = (pi.messages || [])
        .filter((m) => m.role === 'user')
        .slice(0, 6)
        .map((m) => `- ${m.content}`)
        .join('\n')
      return `[${who}]\n${responses}`
    }).join('\n\n')

    pastContext = `

PRIOR COVERAGE — ${condition} has already been interviewed at ${workspace.display_name}:
${formatted}

Skip anything already covered in depth above unless ${clinicianName}'s answer clearly differs. If there's a difference in approach or philosophy, ask directly: "How does your approach differ from that?"
`
  }

  return `You are a content facilitator helping ${clinicianName} at ${workspace.display_name} think out loud about how they treat ${condition}. Your job is to pull out their clinical perspective efficiently so it can be turned into patient-facing content branded for ${workspace.display_name} as a whole.
${formatPNWContextForPrompt(condition)}${pastContext}
${workspace.display_name} context: ${workspace.clinic_context}

${getPatientContextForPrompt(prototypeId)}

CONTENT YOU NEED TO COLLECT — ask about these in any order that flows naturally:
1. Their actual assessment and treatment process for ${condition}
2. What conventional treatment usually gets wrong
3. What patients most commonly misunderstand about this condition
4. What a realistic recovery looks like (timeline, what changes)
5. What the first visit actually involves
6. A specific patient case that shows their approach working (anonymized)
7. The one movement insight that most patients with ${condition} have never heard

RULES — be direct and efficient:
- No filler: no "great point," "that's interesting," "I love that," or any acknowledgment before asking
- Do not restate or summarize what they just said
- Do not use transition phrases like "building on that" or "following up on"
- Ask as many questions as needed to get complete, specific content — there is no exchange limit
- If their answer already covers the next topic, skip it and move on
- Ask follow-ups when an answer is vague or needs more detail ("Can you give an example?" "What does that look like for a typical patient?" "How long does that usually take?")
- Questions can be as long as they need to be to give the clinician proper context and framing

ENDING THE INTERVIEW:
- Only add INTERVIEW_COMPLETE on its own line when the clinician clearly signals they want to stop — listen for phrases like "I think that covers it," "that's everything I have," "I'm done," "let's generate," or similar. Do not end the interview on your own. Keep asking questions until the clinician wraps it up.

Start immediately with your first question. No greeting, no introduction.`
}

export function getBlogPostSystemPrompt(workspace, clinicianName, condition, tone = 'smart', voiceMode = 'practice', prototypeId = null) {
  const isPersonal = voiceMode === 'personal'
  return `You are a content writer for ${workspace.display_name} in ${workspace.location}. Based on the interview transcript below with ${clinicianName} about treating ${condition}, write an engaging, on-brand blog post targeted at ${workspace.region} readers.

${getFramingRule(workspace, { voiceMode, clinicianName, assetType: 'blog' })}

${workspace.display_name.toUpperCase()} BRAND VOICE:
${workspace.brand_voice}

${getPatientContextForPrompt(prototypeId)}

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
${getToneModifier(tone, workspace)}`
}

export function getSocialBatchSystemPrompt(workspace, clinicianName, condition, campaignContext = '', tone = 'smart', voiceMode = 'practice', prototypeId = null) {
  const isPersonal = voiceMode === 'personal'
  const patientContext = getPatientContextForPrompt(prototypeId)
  return `Based on the blog post provided, generate social media content for ${workspace.display_name}. The post is about ${condition}.

${getFramingRule(workspace, { voiceMode, clinicianName, assetType: 'social' })}
${patientContext ? `\n${patientContext}\n` : ''}
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

export function getVideoScriptBatchSystemPrompt(workspace, clinicianName, condition, campaignContext = '', tone = 'smart', voiceMode = 'practice', prototypeId = null) {
  const firstName = clinicianName.split(' ')[0]
  const isPersonal = voiceMode === 'personal'
  const patientContext = getPatientContextForPrompt(prototypeId)
  return `Based on the blog post provided, write two video scripts for ${workspace.display_name} about ${condition}.

${getFramingRule(workspace, { voiceMode, clinicianName, assetType: 'video' })}
${patientContext ? `\n${patientContext}\n` : ''}
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
- 5–8 keyword hashtags for YouTube (#${condition.replace(/\s+/g, '')} ${workspace.location_hashtag} ${workspace.brand_hashtag} etc.)

---TIKTOK SCRIPT---
Write a 45–60 second TikTok / Instagram Reels script (~120–150 words).

[HOOK — first 3 seconds]
One punchy sentence that stops the scroll. Lead with tension or a counterintuitive claim. Example: "Most people with ${condition} are doing this wrong — and it's making it worse."

[BODY — 30–40 seconds]
3–4 short punchy points from ${isPersonal ? `${firstName}'s clinical perspective in first person` : `${workspace.display_name}'s clinical perspective`}. 1–2 sentences each. Plain language, no jargon. Add [ON SCREEN TEXT: ...] for any text overlays.

[CLOSE — 10 seconds]
Soft CTA: "If you're dealing with ${condition} in ${workspace.location_keyword}, follow for more — link in bio to book at ${workspace.display_name}."

CAPTION:
50–80 word TikTok caption with 5–6 relevant hashtags. Brand as ${workspace.display_name}.${campaignContext}
${getToneModifier(tone, workspace)}`
}

export function getMarketingBatchSystemPrompt(workspace, clinicianName, condition, campaignContext = '', tone = 'smart', prototypeId = null) {
  const firstName = clinicianName.split(' ')[0]
  const conditionSlug = condition.toLowerCase().replace(/\s+/g, '-').slice(0, 20)
  const patientContext = getPatientContextForPrompt(prototypeId)
  return `Based on the blog post provided, generate three marketing assets for ${workspace.display_name} about ${condition}. Use the blog post as your source of truth.
${patientContext ? `\n${patientContext}\n` : ''}
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

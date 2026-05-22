# Phase 0 Prelaunch Bundle — Ready-to-Paste Package

**Generated 2026-05-21.** Companion to `project_narraterx_revenue_roadmap.md` Phase 0 checklist.

Total time budget across the bundle: ~10 hrs over the 6 weeks of Phase 0. Each section below has the copy/structure ready so you're pasting into dashboards, not writing from scratch.

---

## 1. LinkedIn Company Page (~30 min)

**Where:** https://www.linkedin.com/company/setup/new/ (logged in as Michael)

**Fields — paste these:**

| Field | Value |
|---|---|
| Name | NarrateRx |
| LinkedIn URL | `narraterx` (or `narraterx-ai` if taken) |
| Website | `https://narraterx.ai` |
| Industry (primary) | Software Development |
| Industry (secondary) | Health, Wellness & Fitness |
| Company size | 2–10 employees |
| Company type | Privately held |
| Tagline | Voice-true content for hands-on clinicians. One short interview → weeks of writing your patients actually recognize as yours. |
| Logo | `public/brand/narraterx-icon-512.png` |
| Cover image | `public/brand/narraterx-linkedin-cover-1128x191.png` |

**About section (paste verbatim, 3 paragraphs):**

> NarrateRx is the content engine built for hands-on, integrative providers — chiropractors, PTs, OTs, naturopaths, massage therapists, acupuncturists — the practices that share patients and referrals but get ignored by tools built for surgeons and hospital systems.
>
> The premise is simple: you already know what to say. You just don't have time to write it down. NarrateRx interviews you for 12 minutes, then drafts the blog post, the newsletter, the LinkedIn caption, and the social pieces in your actual voice — phrases, cadence, opinions, and all. You approve. It publishes. You stay in clinic.
>
> Built by a chiropractor for clinics like his own. Move Better — three clinics across people, equine, and animals — runs on NarrateRx. So does the company itself. If it can't carry our own voice, it has no business carrying yours.

**Admins:** add Michael (`drq@movebetter.co`).

**First content to pin:** the founder story already live at `narraterx.ai/blog/the-four-year-silence-why-clinicians-don-t-write-and-why-that-s-not-their-fault` — cross-post manually as a Page article and pin to the top of the Page feed.

---

## 2. Site analytics on narraterx.ai (~30 min)

**Recommendation: Vercel Analytics.** Free tier covers Phase 0/1 traffic. Plausible only wins if you specifically want per-page funnel views later — defer.

**Important — NarrateRx is a Vite SPA, not Next.js.** The Vercel dashboard "Enable Analytics" toggle alone does NOT send events on Vite. You need both the dashboard toggle AND the `@vercel/analytics` package mounted in the React tree. Wiring shipped in the analytics-fix PR: `npm i @vercel/analytics` + `<Analytics />` in `src/App.jsx` next to `<Toaster />`.

**Steps:**

1. Open https://vercel.com/movebetter/narraterx/analytics
2. Confirm "Analytics" is enabled on the project (toggle on the project overview)
3. Verify the analytics-fix PR is merged + prod-deployed (check `vercel inspect <latest-prod-dpl>`)
4. Hit `https://narraterx.ai/blog` from a private/incognito window with no ad blocker
5. Wait 60–90s, refresh the Analytics tab, confirm the page view registered
6. Bookmark the dashboard URL as `Vercel Analytics — NarrateRx` for the Sunday operating cadence

**After enabling, paste this into `project_narraterx_revenue_roadmap.md` Phase 0 row:**
- `✅ Vercel Analytics enabled YYYY-MM-DD — https://vercel.com/movebetter/narraterx/analytics`

**If you want to switch to Plausible later:** sign up at plausible.io, add `narraterx.ai`, drop the script tag in the marketing site `<head>`, set custom goals `Newsletter Subscribe` and `Demo Booked`. ~$9/mo. Worth it only if Vercel Analytics' aggregation isn't deep enough by end of Phase 1.

---

## 3. Senja testimonial collection (~30 min)

**Where:** https://senja.io (signup with `drq@movebetter.co`)

**Account setup:**
- Free tier — covers Phase 0/1 (5 testimonials, video included)
- Workspace name: NarrateRx

**Create a new Collection form. Paste these settings:**

| Field | Value |
|---|---|
| Form title | NarrateRx clinician testimonials |
| Form subtitle | Share what changed for you and your practice. We may feature your words on narraterx.ai or LinkedIn — only with your permission below. |
| Type | Text + video (let testifiers choose) |

**Form questions (add in this order):**

1. **Your name** — short text, required
2. **Your role and practice** — short text, required. Placeholder: `Chiropractor at Move Better, Asheville NC`
3. **What did NarrateRx change for you?** — long text, required. Placeholder: `Before NarrateRx, our blog hadn't been updated in… (be specific — time saved, pieces published, patient/client response)`
4. **One sentence we could use as a pull-quote** — short text, optional. Placeholder: `In your own voice — the line you'd want a peer to see first.`
5. **Permission to publish** — checkbox, required. Label: `Yes — NarrateRx may quote me by name on narraterx.ai, LinkedIn, and marketing emails. (I can withdraw permission anytime by emailing drq@narraterx.ai.)`
6. **Headshot upload** — image upload, optional. Helper text: `Square works best (1080×1080). Skip if you'd rather we ask later.`
7. **Email** — short text, required (Senja auto-asks for follow-up)

**After creation:** grab the public collection URL (looks like `https://senja.io/p/narraterx/...`) and paste into `project_narraterx_revenue_roadmap.md` Phase 0 row:
- `✅ Senja collection live YYYY-MM-DD — <URL>`

This URL goes to friend dogfood testers in the June 23 outreach and to every paid customer's onboarding email in Phase 1+.

---

## 4. LinkedIn ads creative library (2–3 hrs — best done Week 4–5 of Phase 0)

**Do NOT run these yet.** They fire July 1. Goal of this prep is "creative ready, just press go."

**UTM convention** (mirrors the Folk + Calendly chip):
- Base: `https://calendly.com/<your-handle>/narraterx-demo`
- Variant tags: `?utm_source=linkedin_ads&utm_medium=paid_social&utm_campaign=phase1_launch&utm_content=<variant>`
- Variants: `v1_founder`, `v2_casestudy`, `v3_painpoint`, `v4_demo`

**Folder for assets:** create `public/marketing/ads/` in the repo (or a `NarrateRx / Marketing / Ads` Drive folder — pick whichever you'll actually open, then commit the path here).

---

### V1 — Founder POV

**Visual:** 1080×1080 square. Michael headshot left, quote text right on cream background using the brand cream/warm-tint from the rest of the marketing site. Logo bottom-right corner.

**Primary headline (on creative):**
> "I'm a chiropractor. I built NarrateRx because the writing kept not happening."

**Body copy (ad caption, paste into LinkedIn Ads Manager):**

> Four years. That's how long our clinic blog sat untouched. Not because we had nothing to say — we say it to patients every day. But sitting down to write it? It kept losing to everything else in clinic.
>
> I built NarrateRx so the writing stops losing. 12-minute interview. Voice-true drafts in your actual cadence. You approve, it publishes.
>
> If you run a hands-on or integrative practice and your content has gone quiet, let's talk. 30 min, no pitch deck.

**CTA button:** Book a demo
**Destination:** `<calendly>?utm_source=linkedin_ads&utm_medium=paid_social&utm_campaign=phase1_launch&utm_content=v1_founder`

**Alt headlines for A/B (Week 2 of Phase 1):**
- "The writing kept losing to the clinic day. So I built a fix."
- "A chiropractor's tool for the writing chiropractors never do."

---

### V2 — Case study (Move Better)

**Visual:** 1080×1080 square. Move Better logo / clinic photo top half, pull-quote bottom half on warm background. Stat callout in corner: `8 weeks of content from 1 12-min interview`.

**Primary headline (on creative):**
> "8 weeks of content. From a 12-minute interview."

**Body copy:**

> Move Better — three clinics, people / equine / animals — went from a 4-year blog silence to weekly publishing in under a month.
>
> No copywriter. No content team. One short interview per cycle, drafted by NarrateRx in the clinician's actual voice, reviewed by them, published.
>
> If your practice has the expertise but not the time, this is the missing piece.

**CTA button:** See how it works
**Destination:** `<calendly>?utm_source=linkedin_ads&utm_medium=paid_social&utm_campaign=phase1_launch&utm_content=v2_casestudy`

**Alt headlines:**
- "From silent blog to weekly newsletter — one clinic's 30-day flip"
- "Three clinics, one team, zero copywriters. Here's the stack."

> **Pull-quote slot for the case-study creative** — fill from item 6 below once the Move Better case study is written. Drop the headline pull-quote here so the ad and the case study match word-for-word.

---

### V3 — Pain point

**Visual:** 1080×1080. Calendar grid with "Write blog post" repeatedly crossed out / pushed forward across multiple weeks. Headline overlay.

**Primary headline (on creative):**
> "Why your team isn't writing — and why it's not their fault."

**Body copy:**

> Every clinician you hired is great at clinic. None of them were hired to write. So the blog stays empty and the newsletter goes out twice a year — not because anyone's slacking, but because writing was never the job.
>
> NarrateRx changes the job. Talk for 12 minutes. We draft. You approve. The content gets out the door without anyone pretending to be a writer.

**CTA button:** Show me how
**Destination:** `<calendly>?utm_source=linkedin_ads&utm_medium=paid_social&utm_campaign=phase1_launch&utm_content=v3_painpoint`

**Alt headlines:**
- "Your clinic isn't a writing team. It shouldn't have to be."
- "Stop hiring your clinicians for a second job."

---

### V4 — Product demo

**Visual:** 15-second Loom screen recording. Show: (1) hit Start Interview, (2) 2-3 seconds of question + speaking, (3) cut to draft appearing, (4) cut to publish button + live post on narraterx.ai/blog. End frame: NarrateRx logo + "12 minutes. From your voice."

**Primary headline (overlay last frame):**
> "12 minutes. From your voice."

**Body copy:**

> Watch a blog post go from spoken to scheduled in one take.
>
> NarrateRx interviews you, drafts in your real cadence, and publishes when you approve. No copywriter, no template feel.

**CTA button:** Try it
**Destination:** `<calendly>?utm_source=linkedin_ads&utm_medium=paid_social&utm_campaign=phase1_launch&utm_content=v4_demo`

**Alt headlines:**
- "Spoken to scheduled in one take — watch it run."
- "What 'voice-true AI writing' actually looks like."

---

**Asset checklist for the folder:**
- [ ] `v1_founder_1080.png` — square image
- [ ] `v1_founder_copy.md` — body copy + alt headlines (drop this section's V1 block in)
- [ ] `v2_casestudy_1080.png`
- [ ] `v2_casestudy_copy.md`
- [ ] `v3_painpoint_1080.png`
- [ ] `v3_painpoint_copy.md`
- [ ] `v4_demo_15s.mp4`
- [ ] `v4_demo_copy.md`
- [ ] `README.md` — UTM convention + which variant fires which week

---

## 5. Bank 4–6 blog posts via Studio (4–5 hrs across Phase 0)

**Important:** these MUST go through Studio so the voice-fidelity premise holds. Don't let me or anyone else generate synthetic posts — the whole product thesis fails if the founder's own content isn't drafted from real interviews. Each post = one 15-min Studio interview + your review.

**Suggested topics with interview seed questions** (use the seed as your interview prompt; pick whichever ordering fits your week):

### Post 1 — "What 'voice-fidelity' actually means and why most AI writing tools fail at it"
**Interview seed:**
- When you read AI-generated content that's supposed to sound like you, what's the first thing that gives it away?
- Walk me through the specific phrases or cadence patterns that are uniquely yours.
- What's the moment in NarrateRx's pipeline where voice is most likely to be lost, and what protects it there?
- If a competitor copied every NarrateRx feature except the voice work, what would their output sound like?

### Post 2 — Move Better case study (= item 6 below; do this one as part of the bank)

### Post 3 — "The interview is the moat: why we don't have a 'write a blog post' button"
**Interview seed:**
- Why did you reject the "give me a blog about X" prompt model?
- What did you learn about clinicians who actually know what to say but can't write it down?
- What's the lift the interview format does that a chat prompt can't?
- Where will this premise break if the company ever forgets it?

### Post 4 — "Clinical content compliance without losing voice"
**Interview seed:**
- What does compliance actually look like for a hands-on clinic posting on the open web?
- What lines should never be crossed regardless of voice — and how does NarrateRx enforce them?
- Where do clinicians most often self-censor unnecessarily? Where do they not censor enough?
- How do you balance "this is my opinion as a clinician" with "this is not medical advice for any specific patient"?

### Post 5 — "From one interview to 10 pieces: the multiplier that justifies the time"
**Interview seed:**
- Walk me through everything a single 12-minute interview becomes in NarrateRx's pipeline.
- What's the hourly-rate math for a clinic owner who switches from "I'll write it this weekend" to NarrateRx?
- What are the pieces clinicians forget they're getting (e.g. social, email subject lines)?
- Where does the multiplier break down — when is one interview NOT enough?

### Post 6 — Founder POV: why hands-on integrative providers are the right starting audience
**Interview seed:**
- Why this audience, not surgeons or hospital-employed clinicians?
- What do chiro / PT / OT / naturopath / massage / acu have in common that the rest of healthcare doesn't?
- What did you learn from inside Move Better's three different clinics (people, equine, animals) that proved this audience cuts across species?
- Where does this audience end — who's NOT a NarrateRx customer?

---

**Scheduling pattern:**
- Run interviews across Phase 0 (1/week is comfortable, 2/week is tight)
- In Studio, set each piece's publish date one week apart starting July 1
- That puts auto-pilot blog content from July 1 through mid-August while Phase 1 demo cadence ramps

**End-of-section checkbox for the roadmap row:**
- `✅ 6 blog posts banked YYYY-MM-DD — drip schedule set Jul 1 → Aug 12`

---

## 6. Case study #1 — Move Better (2–3 hrs)

Anchor content for Phase 1. This one is high-leverage: the Move Better case study becomes the V2 ad creative pull-quote, the LinkedIn intro post for any cold prospect, and the "social proof" answer when a friend dogfooder asks "but is anyone actually using this?"

**Structure (paste this scaffold into a Studio interview, then talk through each section):**

### Hook (1 paragraph)
The exact moment Move Better's content went silent and how long it stayed silent before NarrateRx.

### Problem (2–3 paragraphs)
- Why a thriving clinical practice still couldn't publish
- What you tried before (copywriter? template? batch days?) and why none of it stuck
- The downstream effect: patient acquisition, referral conversations, brand drift

### Tool — NarrateRx (1 paragraph)
Plain-language: what it is, what it does, why it exists. 3–4 sentences max — this section should feel almost incidental, like introducing the wrench in a story about fixing the engine.

### Process (3–4 paragraphs, the bulk of the piece)
- The 12-minute interview itself — what it actually feels like
- What happens after — synthesis, draft, review
- How approval and publish flow without anyone pretending to be a copywriter
- The honest friction points (where you still spend time, what you wish were faster)

### Outcome (real numbers — pull from analytics before writing)
| Metric | Before NarrateRx | After (4 weeks) |
|---|---|---|
| Blog posts published / month | _ | _ |
| Newsletter sends | _ | _ |
| Newsletter subscribers added | _ | _ |
| Avg time from idea → published | _ | _ |
| Patient inquiries citing content | _ | _ |

**Pull from:**
- Move Better Astro / WordPress publish history (count posts shipped since first NarrateRx publish)
- Beehiiv dashboard for newsletter metrics on the equine/people brands
- Vercel Analytics for blog traffic delta
- Folk / CRM tags for any "saw your post" patient inquiries

### Pull-quote (1 sentence, bold at the top of the piece)
This is the line that becomes the V2 ad creative. Examples to spark yours:
- "We went from a 4-year content silence to weekly publishing in 30 days — without hiring a single writer."
- "NarrateRx didn't make us writers. It made writing stop blocking us."
- "Three clinics, one team, zero copywriters."

### Close (1 paragraph)
Honest forward-look: what's still hard, what's getting better, who should consider running the same play.

---

**After writing, save the pull-quote here so the V2 ad creative can use the exact wording:**

```
PULL_QUOTE_FOR_V2_AD = "<paste here once the case study is approved>"
```

And drop this row into `project_narraterx_revenue_roadmap.md` Phase 0 checklist:
- `✅ Move Better case study published YYYY-MM-DD — narraterx.ai/blog/<slug> — pull-quote: "<...>"`

---

## End-of-chip runbook checklist

Paste into `project_narraterx_revenue_roadmap.md` Phase 0 row when complete:

- [ ] LinkedIn Company Page live, founder story pinned — `linkedin.com/company/narraterx`
- [ ] Vercel Analytics firing, dashboard bookmarked — `https://vercel.com/movebetter/narraterx/analytics`
- [ ] Senja collection URL — `<URL>`
- [ ] 4 LinkedIn ad creatives + 2 alt headlines each in `public/marketing/ads/`
- [ ] 6 blog posts drafted in Studio, scheduled Jul 1 → Aug 12
- [ ] Move Better case study published or scheduled for July 1 — pull-quote captured

## Time budget tracking

| Item | Est | Actual | Notes |
|---|---|---|---|
| LinkedIn Company Page | 30 min | | |
| Vercel Analytics | 30 min | | |
| Senja form | 30 min | | |
| Ad creatives × 4 | 2–3 hrs | | |
| Blog post bank × 6 | 4–5 hrs | | |
| Move Better case study | 2–3 hrs (overlaps with blog bank) | | |
| **Total cap** | **~10 hrs across 6 weeks** | | |

If any single item passes its estimate by >50%, pause and reassess scope before continuing.

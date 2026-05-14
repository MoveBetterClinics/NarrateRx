# NarrateRx — Development Roadmap
_Created 2026-05-13. Source: competitive landscape + UI research synthesis._

## North Star
The only end-to-end staff storytelling → clinical content pipeline. Not a general content tool. Not a research tool. The specific intersection of structured prompted capture + voice-faithful AI drafting + vertical context depth — for healthcare and professional clinical settings.

## Competitive Advantages to Defend
1. **Cross-staff contrasting-opinion mechanic** — real-time, mid-interview. No competitor does this.
2. **Practice vs. personal voice distinction** — no competitor makes this separation.
3. **End-to-end pipeline** in one login — topic → interview → content → GBP/Instagram.
4. **Diff view (AI draft vs. human edit)** — ahead of every comparable (PR #360).
5. **Vertical context depth** — patient archetypes, condition banks, workspace JSONB config.

## What NOT to Build
| Thing | Reason |
|-------|--------|
| Scheduling/analytics infrastructure | Buffer Analyze does this. Building it is 6 months to land behind an established product. |
| AI avatar or talking face | Outset's own research: 69% prefer no avatar. Bernard persona is correct. |
| Patient testimonial capture | Different consent workflow, different positioning, different sales motion. |
| Native mobile app | High cost, low early leverage. Responsive web for now; revisit at 50+ tenants. |
| Compete on interview engine depth vs. Outset | They have $30M Series B. The moat is the pipeline + vertical, not the interview engine alone. |
| General-purpose content tool features | Every step toward general-purpose is a step away from the defensible vertical position. |

---

## Phase 1 — Revenue Foundation (5–7 weeks)
**Thesis:** You can't validate a SaaS without charging for it. Ship the prerequisites for real commercial relationships first.

### Billing
- Stripe integration with 2–3 tiers (solo clinician, small practice, multi-location)
- Self-serve upgrade/downgrade from workspace settings
- Usage gates that nudge rather than hard-block
- Seat-based expansion built in — approval workflow creates natural pressure for a second seat

### Content Approval Workflow
- Role-split views: staff see "my drafts"; approvers see "needs review" and "scheduled"
- Two-click approve, one-click reject with optional comment
- Approved posts route directly to Buffer queue, no extra step
- Lightweight audit trail: who approved what and when

### UX: Collapse Pre-Interview Config
- Default everything to "Smart" — tone, voice mode, patient prototype all pre-selected
- Single "Adjust" disclosure for anyone who wants control
- Zero-config should be the path for 80% of sessions
- Pre-interview device/mic check screen before session starts (Strella pattern)

### UX: Interview → Output Inline Transition
- When `INTERVIEW_COMPLETE` fires, slide output panel in from the right — no page navigation
- Conversation stays left; blog/social tabs appear right
- URL updates (`/interview/:id/output`) without a full page transition
- Eliminates the hardest context break in the current flow

### UX: New IA — 2-item nav + task-queue Home + Stories surface
- **Promoted from Phase 2** because it's the chassis Phase 1 approval workflow + billing settings need to live in. Building those into the old Dashboard/Settings means rebuilding them when the IA lands. Ship the chassis once.
- Primary nav collapses from 4 items (Interviews / Content Hub / Media / Strategy) to 2 (Home / Stories). Library + Settings become header icons. Strategy page deleted; topic backlog surfaces inline on Home.
- **Home** = task queue ("Ready for content / Awaiting your review / Hasn't interviewed in a while" + right rail with Scheduled / Topic suggestions / Bernard nudges). Replaces the current clinician-list Dashboard.
- **Stories** = unified surface with view-mode toggle (Cards default · Pipeline · Calendar · Themes later). Same dataset, different lens. Replaces Content Hub, /review/*, /calendar/*.
- **Story Detail page** consolidates /output/:id and /review/:itemId into a single page (transcript left, every derived asset + ask-Bernard panel right). Supersedes the "drawer-based review" idea from the prior P2 plan — same intent, better surface.
- Persistent "+ New Interview" CTA in the header.

### Interview Pause/Resume
- State persists server-side; staff can close the browser and return
- Clinical settings mean constant interruptions — a session that can't be paused gets abandoned

**Success metric:** First external tenant pays and completes ≥2 interviews in 30 days.

---

## Phase 2 — The Clinical Moat (6–8 weeks)
**Thesis:** Features that require the vertical context layer or the cross-staff mechanic — neither of which any competitor has. This is what makes NarrateRx impossible to replicate with Castmagic + Buffer.

### Transcript Highlight → Route-to-Format
- In the interview transcript, select any text span → one-click route to a specific output format
- Options: "Add to social post / Add to GBP / Flag as verbatim quote"
- Replaces batch generation from full interview with selective, editorial curation
- No competitor has this in a live interview context

### Cross-Staff Synthesis — "Themes" view on Stories
- Aggregate view across sessions: "3 staff mentioned recovery time this month — here are the contrasting perspectives"
- Builds on the `[CONTRAST]` mechanic but surfaces it at the workspace level, not just mid-interview
- **Implemented as a 4th view-mode toggle on the Stories page** (Cards · Pipeline · Calendar · Themes) — same dataset, lens-grouped by theme/topic rather than by clinician or time
- Each theme card shows: the topic, which staff have spoken to it, contrasting views surfaced, and a "Build content from this theme" CTA
- Makes monthly content planning take 20 minutes instead of 2 hours

### Geo-Local Topic Intelligence
- "Here are 5 questions your local patients are asking this month" rather than generic prompts
- Requires a data source (Semrush API or DataForSEO); evaluate cost vs. build
- Closes the gap between topic discovery and interview prompt generation

### Stories — Pipeline view toggle
- Second view-mode on the Stories page: horizontal Kanban (Capture → Drafting → Review → Scheduled → Published) showing the same dataset as the default Cards view
- Best lens for tracking many stories in flight across multiple clinicians
- Drag cards across stages

### Stories — Calendar view toggle
- Third view-mode on Stories: week / month grid with publish slots
- Drag drafts from an "Unscheduled" rail onto date cells
- Best lens for cadence planning

### Media Library redesign
- Visual grid (Apple Photos / Figma assets feel) replacing the current MediaHub layout
- Every interview-derived asset shows source clinician + "used ×N" badge linking back to the Story Detail page that consumed it
- Filter chips for type/purpose/clinician; bulk selection bar for tagging/deletion
- Media becomes a header-icon utility, not primary nav (already moved in P1 IA refactor — this is the polish pass)

### Transcript Export
- Downloadable PDF/text artifact of any interview
- Table stakes — every comparable offers this

**Success metric:** External tenants publish ≥4 pieces of content per month; admin retention at 60 days ≥70%.

---

## 60-Day Validation Gate (between Phase 1 and 2)
Before committing to Phase 2, answer with real data:
1. Do external tenants complete ≥2 interviews in the first 30 days?
2. Do they publish content from those interviews?
3. Do they renew after month 1?

If no to any of these, something earlier in the funnel is the problem — not missing Phase 2 features.

---

## Phase 3 — Retention & Expansion (6–8 weeks)
**Thesis:** The analytics closed loop is the slow-burn churn risk. Admins who can't see whether the content is working will go find that answer somewhere else.

### Buffer Analyze Integration
- Pull published post performance back into NarrateRx (reach, engagement, clicks)
- Show it on the content card alongside the post — no separate tab, no separate login
- Do NOT rebuild this. Integrate Buffer Analyze API.

### Performance → Topic Suggestions Feedback Loop
- Posts that perform well feed back into the topic suggestion layer
- "Your posts about recovery timelines get 3x the engagement — here are 5 more angles"
- The flywheel: publish → learn → interview → publish better

### Self-Serve Onboarding + Trial
- In-context AI coaching on first session (blank canvas shows contextual prompts, not an empty state)
- 14-day trial with real credit card capture — no free tier
- Activation checklist on first login: complete profile → run first interview → generate post → publish
- Checklist completion is the single best predictor of 90-day retention in B2B SaaS

### Multi-Location Support
- Single admin view across multiple clinic locations
- Per-location cross-staff synthesis
- The expansion revenue lever — practices that grow don't leave, they upgrade

**Success metric:** Net Revenue Retention ≥100% (expansion revenue offsets churn).

---

## Pricing Direction
| Tier | Price | Who |
|------|-------|-----|
| Solo / small practice (1–3 staff) | $149/mo | Single-location, small team |
| Practice (4–10 staff) | $299/mo | Includes approval workflow + cross-staff synthesis |
| Multi-location | $499+/mo | Per-location pricing, aggregate dashboard |

Outset/Listen Labs are at $3K+/mo for enterprise. NarrateRx isn't competing there yet — but the pricing architecture should leave room to move up.

---

## Gap Resolution Summary
| Gap | Phase |
|-----|-------|
| No billing/payments | 1 |
| No content approval workflow | 1 |
| Fragmented UX (5 page navigations for one content piece) | 1 |
| No pause/resume mid-session | 1 |
| No analytics closed loop | 3 |
| No self-serve trial/onboarding | 3 |
| Dashboard organized around data not tasks | **1** (promoted — chassis for approval workflow + billing) |
| Review requires page round-trip | **1** (Story Detail page supersedes drawer review) |
| No transcript export | 2 |
| No geo-local topic intelligence | 2 |
| Stories needs lens variety (Pipeline / Calendar / Themes) | 2 |
| Media library feels orphaned | 2 |

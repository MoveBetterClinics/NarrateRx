# Folk CRM + Calendly Setup Runbook

**Goal:** Demo-booking infrastructure live and tested before July 1, 2026 (Phase 1 launch).
**Owner:** Michael. **Est. time:** ~3–4 hrs end-to-end, mostly clicks in dashboards.
**Status:** scaffolded 2026-05-21 by Claude (this doc). Setup tasks below are **for Michael** — they require his auth into Calendly, Folk, Google Calendar, LinkedIn.

---

## Why this exists

[Revenue roadmap](../../.claude/development-roadmap.md) commits to **10 DMs/wk + LinkedIn ads in Phase 1**, both funneling to a "30-min demo with Michael" CTA. Without Folk + Calendly wired together:
- Demos don't book on their own
- UTM attribution is impossible (ad spend = flying blind)
- DM follow-ups slip through the cracks

This is **Phase 0 infra** — Phase 1 starts day-one on July 1 with this loop working.

---

## Part 1 — Calendly

### Setup steps (Michael, ~30 min)

1. **Sign in / sign up** at https://calendly.com using **drq@narraterx.ai** (decision below).
   - **Email choice:** use `drq@narraterx.ai` (not `drq@movebetter.co`). Reason: the demo is for NarrateRx, the confirmation email + Zoom invite shows the sender domain, and we want prospects to see the NarrateRx brand at every touchpoint — not Move Better. `drq@narraterx.ai` forwards to `narraterx@gmail.com` per [[reference_platform_ownership]], so replies still land in Michael's inbox.
   - Free tier covers this use case.

2. **Connect calendar:** Google Calendar (the one Michael actually checks for clinic + life). Required for conflict detection.

3. **Create event type:** `NarrateRx Demo · 30 min`
   - **URL slug:** `narraterx-demo`
   - **Final shareable URL:** `https://calendly.com/<calendly-username>/narraterx-demo`
   - Single-session, 30 min, 1-on-1
   - Video: Zoom or Google Meet (whichever Michael uses for clinic telehealth — fewer logins)
   - Location field: "Web conferencing details provided upon confirmation"

4. **Availability:** 3 slots/wk, Tue–Thu afternoons.
   - Recommended block: **Tue/Wed/Thu, 2:00pm – 4:00pm ET**, 30-min slots, max 1 booking per slot, max 3 per week.
   - Buffer: 15 min before + 15 min after (reset between calls).
   - Minimum scheduling notice: 24 hrs (no same-day surprises).
   - Date range: rolling 4 weeks out.

5. **Booking-form qualifying questions** (in this exact order — ordering matters for the demo-prep glance):

   | # | Question | Field type | Required |
   |---|---|---|---|
   | 1 | Full name | Single line | Yes (default) |
   | 2 | Email | Email | Yes (default) |
   | 3 | Practice name + your role | Single line | Yes |
   | 4 | How many clinicians (incl. yourself) currently work in your practice? | Single select: `Just me`, `2–4`, `5–10`, `11+` | Yes |
   | 5 | In one sentence, what do you hope NarrateRx does for you? | Paragraph | Yes |

   *Why #4 is multiple choice:* maps cleanly to pricing tiers (Solo / Practice / Multi-location) so Michael can pre-segment before the call.

6. **Confirmation email** — edit the default to add:
   > Quick note: I record demos (Loom) to refine how I run these. Just for my own review — never shared. If you'd rather I didn't, hit reply and let me know. — Michael

   *Why:* the roadmap explicitly calls out "review demos to refine the script." Loom auto-records when Michael clicks Start; no Calendly integration needed.

7. **Reminders:** 24-hour reminder email = ON. 1-hour reminder = ON. Both default templates fine.

8. **Reschedule / cancel:** allow up to 4 hrs before the meeting. Calendly handles this natively.

9. **UTM passthrough:** Calendly automatically captures `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` from query params on the booking URL and exposes them in the booking payload + integrations. **No config needed**, but **verify in the end-to-end test** (Part 4).

---

## Part 2 — Folk CRM

### Setup steps (Michael, ~60 min)

1. **Sign up** at https://folk.app using **drq@narraterx.ai**. Free tier ("Folk Free") supports up to 2 workspaces, 1,000 contacts, 1 user — more than enough for Phase 1.

2. **Create workspace:** `NarrateRx`.

3. **Create three pipelines** (Folk calls these "Groups" with custom pipeline views):

   **Pipeline 1 — Outreach**
   Stages, left to right:
   `Identified` → `Researched` → `DM Sent` → `Responded` → `Demo Booked`

   **Pipeline 2 — Demos**
   `Demo Booked` → `Demo Held` → `Trial Started` → `Trial Active` → `Decision`

   **Pipeline 3 — Customers**
   `Paid` → `Active` → `At Risk` → `Churned`

   *Why three pipelines instead of one:* keeps the weekly review honest — Michael can see at a glance "outreach is healthy but demos are stalling" or vice versa. Single-pipeline blurs the diagnosis.

4. **Custom fields on every contact** (Folk: Settings → Custom fields):
   - `Practice name` (text)
   - `Role` (text)
   - `Clinician count` (single select: `Just me` / `2–4` / `5–10` / `11+`)
   - `Goal` (long text — the answer to qualifying question #5)
   - `utm_source` (text)
   - `utm_medium` (text)
   - `utm_campaign` (text)
   - `utm_content` (text)
   - `First touch date` (date)
   - `Last touch date` (date, auto-updated by Folk on any logged activity)

5. **Install Folk's LinkedIn extension** (Chrome): https://folk.app/chrome-extension
   - Used to one-click-add LinkedIn profiles into the Outreach pipeline at the `Identified` stage.
   - **Don't bulk-import the whole network** — only add prospects as Michael decides to reach out. Bulk imports rot fast and make the pipeline noisy. Per-week pulls are healthier.

6. **Wire Calendly → Folk:**
   - **Preferred path:** Folk's native Calendly integration. Settings → Integrations → Calendly → Connect → authorize with the same `drq@narraterx.ai` account.
   - **If native integration is missing/broken:** fall back to **Zapier**. Zap shape: *Calendly "Invitee Created"* → *Folk "Create or update contact"* + *Folk "Add to group: Demos / stage: Demo Booked"*. Map all 5 booking-form fields + 4 UTM fields. Zapier free tier (100 tasks/mo) is plenty for 3 demos/wk.
   - **Auto-move rule:** when a contact in the Outreach pipeline books a demo, Folk should move them to Demo Booked in the Demos pipeline (Folk's automation tab handles this; if not, just leave the contact in both — Folk supports multi-group membership).

---

## Part 3 — UTM convention (lock now, don't drift)

Every NarrateRx outbound link gets UTM tags. Calendly passes them through to Folk. **Use lowercase, snake_case, no spaces.**

### Parameter values

| Param | Allowed values | When |
|---|---|---|
| `utm_source` | `linkedin_organic` | Posts from Michael's LinkedIn personal feed |
| | `linkedin_company` | Posts from NarrateRx Company Page |
| | `linkedin_ads` | Paid LinkedIn campaigns |
| | `newsletter` | Beehiiv issue links |
| | `dm` | Personalized DMs (LinkedIn, email, SMS) |
| | `blog` | narraterx.ai blog post CTAs |
| | `referral` | Existing-customer referrals |
| | `podcast` | Podcast guesting (Phase 2+) |
| `utm_medium` | `social` | LinkedIn organic / company page |
| | `cpc` | Paid ads (LinkedIn, Meta) |
| | `email` | Newsletter, DM via email |
| | `direct` | DMs sent inside a platform (LinkedIn DM) |
| | `web` | Blog / landing-page CTAs |
| `utm_campaign` | `founder_story_w<N>` | Founder-POV LinkedIn series (W1, W2…) |
| | `case_study_<tenant_slug>` | A specific tenant case study (`case_study_movebetter`) |
| | `phase1_launch` | Catch-all for July 1 push content |
| | `newsletter_<YYYYMMDD>` | Specific newsletter issue |
| | `dm_outreach_<YYYYMM>` | Monthly cohort of DM outreach |
| `utm_content` | `v1_founder`, `v2_casestudy`, `v3_product`, etc. | Ad creative variants — required for paid only |

### Example links

```
https://calendly.com/<user>/narraterx-demo?utm_source=linkedin_ads&utm_medium=cpc&utm_campaign=phase1_launch&utm_content=v1_founder
```

```
https://calendly.com/<user>/narraterx-demo?utm_source=newsletter&utm_medium=email&utm_campaign=newsletter_20260708
```

```
https://calendly.com/<user>/narraterx-demo?utm_source=dm&utm_medium=direct&utm_campaign=dm_outreach_202607
```

### Where to keep this table

This runbook is the source of truth. If a new source/medium/campaign type comes up (e.g. podcast guesting in Phase 2), **add the row here in the same PR as the first link that uses it** so the convention doesn't fork.

---

## Part 4 — End-to-end test (do not skip)

Before declaring this done, run this exact test:

1. On Michael's phone (not the laptop he set Calendly up on — different network, different cache), open:
   ```
   https://calendly.com/<calendly-username>/narraterx-demo?utm_source=dm&utm_medium=direct&utm_campaign=test_e2e&utm_content=v0_test
   ```
2. Book the earliest available slot. Use a throwaway email (or `narraterx+e2etest@gmail.com`) so it doesn't pollute Michael's contact list.
3. Fill the qualifying questions with obvious test data (`Practice name: TEST DELETE ME`).
4. **Verify within 5 min:**
   - [ ] Calendar invite landed in Michael's `drq@narraterx.ai` inbox (forwards to narraterx@gmail.com).
   - [ ] Invite body shows the 5 qualifying-question answers.
   - [ ] Confirmation email to the booker mentions the Loom recording.
   - [ ] Contact appears in Folk → Demos pipeline → Demo Booked stage.
   - [ ] Folk contact has `utm_source=dm`, `utm_medium=direct`, `utm_campaign=test_e2e`, `utm_content=v0_test` on the custom fields.
   - [ ] Folk contact has `Practice name`, `Role`, `Clinician count`, `Goal` populated.
5. Cancel the test booking from Michael's side (Calendly → Scheduled events → Cancel) **and** delete the test contact from Folk.

If any checkbox fails, fix before launch — partial attribution is worse than none because it lies to you in the weekly review.

---

## Operating cadence (where this fits in Michael's week)

Per [[project_narraterx_revenue_roadmap]] Phase 1 weekly cadence:

- **Mondays, 30 min — outreach batch:** review LinkedIn / referrals from last week, use Folk LinkedIn extension to add ~10 new prospects at `Identified`, research each (move to `Researched`), draft + send 10 DMs (move to `DM Sent`). Each DM includes the UTM-tagged Calendly link (`utm_source=dm`).
- **Throughout the week:** when a prospect replies, move to `Responded` and reply 1:1. When they book, Folk auto-moves to Demos / Demo Booked.
- **Tue/Wed/Thu afternoons:** demos happen. After each, manually move Demos / Demo Held and add notes in Folk.
- **Sundays, 30 min weekly review:** count Outreach → Responded conversion, Demo Booked → Demo Held no-show rate, Demo Held → Trial Started rate. Log against the funnel targets in the roadmap.

---

## What Michael owes future-Michael

After running the test in Part 4, fill in these blanks at the top of this file (or in [[project_narraterx_revenue_roadmap]]) so the URLs are findable cold:

- [ ] **Calendly URL to share:** `https://calendly.com/__________/narraterx-demo`
- [ ] **Folk workspace URL:** `https://app.folk.app/__________`
- [ ] **Calendly account email:** `drq@narraterx.ai` (confirmed)
- [ ] **Folk account email:** `drq@narraterx.ai` (confirmed)
- [ ] **Calendly→Folk wiring:** native integration / Zapier (circle one)
- [ ] **End-to-end test:** passed on YYYY-MM-DD by Michael

---

## Out of scope (do NOT build)

- ❌ Custom CRM features inside NarrateRx — Folk is the buy
- ❌ Automated email sequences in Folk — Phase 1 demos are personalized 1:1
- ❌ Multi-rep sales setup — single-founder pipeline
- ❌ LinkedIn ads — separate task, fires after this lands

If the setup hits a wall and starts pulling Claude/Michael toward building something custom, **stop and reassess** — almost certainly the right move is a different Folk/Calendly config, not code.

---

Related: [[project_narraterx_revenue_roadmap]], [[project_narraterx_marketing_strategy]], [[project_clinician_first_framing]], [[reference_platform_ownership]].

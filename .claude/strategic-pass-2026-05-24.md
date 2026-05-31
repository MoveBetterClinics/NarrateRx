# NarrateRx — Strategic pass, 2026-05-24

_Successor to `memory/project_strategic_review_2026_05_22.md`. Revised after Michael's answers to the four questions below — see §5 for the final direction._

---

## 1. What's true now

**Product state.** The full Phase 5 moat stack is in `main`:

- **Live Interview** (real-time duplex voice, OpenAI Realtime, WebRTC) — shipped behind a workspace flag; polish task spawned for iOS, reconnect, daily-minute cap, quality dot.
- **Practice memory** — hot tier (PRs #789/#794/#796) plus RAG layer (#803/#804/#806). Clinician's prior interviews, blog posts, and voice phrases are now visible to every generation prompt.
- **Voice clone** — schema + ElevenLabs IVC lib + Voice tab UI + read-aloud preview on content pieces all shipped (#807/#808/#809/#816). First caller is the content-piece preview button.
- **URL import lane** — Jina-Reader-backed `text_import` capture mode (#770/#787/#791), so an existing blog post can become a NarrateRx keystone without re-interviewing.
- **Onboarding interview** — voice-based wizard that writes brand_voice / patient_context / topic_suggestions / clinician_voice_phrases on completion.
- **Stripe billing** — a step-by-step setup runbook landed (#818), but billing is NOT wired into the product yet. Wiring it is now in scope (see §5).

**What's actually used vs. shelf-ware** (Move Better, the dogfood workspace):

- **Daily / weekly:** interview → blog → atom batch → Buffer push. URL import for repurposing older posts. Live Interview when Michael wants the "feels like a phone call" texture.
- **Used but bounded:** voice clone read-aloud preview (one caller). Practice memory injection runs on every generation but is invisible to the user.
- **Never (or barely):** patient handouts (dormant behind `patient_handouts_enabled=false`), outcome case studies (shelved by principle), general-mode interview (deferred).

**Realistic ceiling of the existing product, zero new features.** Two-clinician Move Better workspace + 1–2 friendly external tenants, ~3–10 finished pieces/clinician/week, distributed via Buffer/WordPress/Astro. The constraint is attention, not throughput. The product is already a 100x+ multiplier on the prior baseline.

---

## 2. What changed since May 22

**Phase 5 closed in 12 days, not 8 weeks.** F#1+F#2+F#3 shipped May 22–24, F#4 PR1 shipped + paused, F#5 shelved by principle.

**Build cost collapsed.** Bottleneck moved from "can we build it" to "should we, given the maintenance + attention tax." Estimate in Michael days, not Claude days.

**A new durable principle: no patient-facing AI content** (`principle_no_patient_facing_ai_content.md`). Closes F#4 + F#5 as a category, not as feature decisions. Hard filter on any future "AI generates content directed at a specific identified patient" proposal.

**Roadmap doc lag.** `.claude/development-roadmap-phase-5.md` is stale relative to `main` — F#2 marked "in progress" but shipped, F#4 marked "queued" but PR1 landed + paused.

---

## 3. What constraints still apply

1. **No patient-facing AI content.** Hard category line.
2. **No third-party content mining.** Own content fine; others' YouTube/podcasts/courses off-limits.
3. **Honor the individual clinician.** Per-clinician beats per-workspace.
4. **FREE-UP-TIME filter.** New features must clear "saves clinician time AND maintenance tax less than time saved." "Don't build, use it harder" is a valid option.
5. **Narrow-clinical vertical, no broadening.** Hands-on + integrative providers only.
6. **Funnel-not-relationship boundary.** NarrateRx amplifies voice; in-clinic experience is the relationship; software doesn't fabricate warmth.

---

## 4. The next decision space (initial framing)

Six shapes were considered. Each costed in **Michael's calendar time** (build cost is near-zero unless flagged).

| Option | Description | Est. Days (Michael's time) | Est. Claude Cost |
|---|---|---|---|
| A. **Use-it-harder** | 4 weeks of disciplined dogfooding. Log friction. Decide next from real usage. | ~3–5 days over 4 weeks | $0–10 |
| B. **Distribution / GTM** | Marketing-to-clinicians as the next mountain. Seminar capture, case studies, paid acquisition tests. | 15–25 days over 6–8 weeks | $20–60 |
| C. **Promote + harden** | Live Interview out of Beta after 5-session gate. Polish chip. Decide turn-based fate. | 3–6 days over 2 weeks | $15–30 |
| D. **Vertical probe** | 2-week experiment with one adjacent vertical to test JTBD without clinical texture. | 6–10 days | $30–80 |
| E. **External-tenant push** | Recruit 1–2 paying external clinical tenants. Validate SaaS thesis. | 10–18 days over 4 weeks | $20–50 |
| F. **Ship-and-stop** | Declare v1 done. Maintenance-only. Reclaimed attention → clinic. | 0–2 days | $0 |

**Initial recommendation was A (use-it-harder).** Michael's answers shifted this — see §5.

---

## 5. Final direction (post-Michael)

**C → E, with light dogfooding as a byproduct, not an activity.**

Michael's answers reframed the read:

- (1) Polish for testers IS the activity — not Option A's open-ended "sit in the user seat."
- (2) Energy order: building > clinic > users. Polish is still building.
- (3) Yes to Beta pill removal after 5-session gate. C is a real commitment, not background.
- (4) Mild active prospecting to chiro friends. E is a real lane, not on-demand.

### Shape

| Week | Primary | Secondary |
|---|---|---|
| 1–2 | **C — promote + harden.** Live Interview polish chip (iOS, reconnect, minute cap, quality dot). Hit Move Better's 5-session gate. Remove Beta pill. **Keep turn-based interview tile as fallback** (Live must be 100% before retiring the safety net). | Light dogfooding through normal Move Better workflow. Log only friction that surprises. |
| 3–4 | **E — first paying chiro friend.** **Wire Stripe billing into the product before the first signup** so the friend feels like a customer, not a beta. Onboard one chiro friend. | Triage what the first tenant breaks. Fix as encountered. |

### Decisions locked

- **Turn-based interview tile: keep as fallback.** Live Interview must be 100% solid before retiring the safety net. Removing it stays a future decision, gated on iOS validation passing cleanly.
- **Stripe billing: wire up BEFORE the first chiro friend signs up.** Friend feels like a customer; you avoid migration work later. Pulls billing wiring into the C→E gap as a small bridge project.

### What this is deliberately NOT

- **Not a Phase 6 build doc.** The next mountain is "first paying external tenant," not another moat feature.
- **Not Option B (distribution).** Distribution ranked last in Michael's energy. It would feel grindy now. Defer until at least one paying tenant has gone through onboarding.
- **Not Option D (vertical probe).** Stays deferred. Narrow-clinical commitment intact.

### Re-decide point: ~June 21 (4 weeks out)

By then we'll know: did the Beta pill come off cleanly, did Stripe wiring go smoothly, did the first chiro friend onboard, and did the friction list surface anything above the maintenance tax. If yes-yes-yes-yes: scope chiro-friend #2 and begin a soft B (distribution) pass. If any leg fails: stop and re-decide from data, not a fresh plan.

-- Sonnet, Medium (C polish + Stripe wiring + tenant onboarding)

---

## 6. Original questions for Michael (with answers, for the record)

1. **A or idling?** → "A little bit like idling, but trying to get real polish before testers."
2. **Where's your energy?** → "Building, then clinic work, then users."
3. **Retire turn-based after 5-session gate?** → "Yes" (but keep as fallback until Live is 100% — see §5 locked decision).
4. **External-tenant appetite?** → "Mild active prospective. I have a few chiro friends I'll be pushing this to."

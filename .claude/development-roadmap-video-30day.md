# NarrateRx — 30-day Video Output Build

_Started 2026-05-26 by Q. Strategic basis: `.claude/strategic-pass-2026-05-25.md` Shape B (distribution-layer) + Shape D (productize dogfood). This doc supersedes the token-amnesty experiment appendix at the end of `development-roadmap-phase-5.md` — those experiments completed and are wrapped._

## North star

> *"Your clinic is the content. We capture it. You approve the cuts. Your next patient is already watching."*

NarrateRx becomes the **clinic showrunner** — capture once on iPhone, AI brain does editorial work, daily story slate ships per-channel packages. Clinician time stays at ~20–30 min/day. Producer (Philip) absorbs 10 hr/week of operational work. Single-surface principle binding: NarrateRx is the only app the team opens.

## Constraints

| Lever | Value |
|---|---|
| Build window | 30 days (started 2026-05-26) |
| Model strategy | Mixed Opus 4.5 (architecture, prompts, emergencies) + Sonnet 4.6 (implementation, UI, tests) |
| Effort level | Max |
| Daily Claude spend cap | $150 (auto-alert above) |
| Hardware budget | $5,000 single-purchase (kit ordered Phase 0) |
| Software budget | $290–460/mo recurring, all backend-only (no clinician-facing logins) |
| Production state | LIVE — Move Better People + Equine + Animals workspaces in active use, Stripe in test mode, auto-deploy on merge to main |
| Decision review cadence | Q approves at 9 named decision points (D1–D9); audit gates G1–G6 run automatically between |
| Parallel tracks | C→E direction (Live Interview polish + Stripe live-key + first paying chiro friend) continues on `main` |

## Locked principles for this build

- **Single-surface**: NarrateRx is the only app. Frame.io / Submagic / Artgrid are CUT. Backend services (ElevenLabs, HeyGen, Runway, image gens) are API-only — no separate logins for the team.
- **Team-as-talent** (`memory/principle_team_as_talent.md`): all team members interviewable; staff_type is a content-lane filter, not an interview gate.
- **No patient-facing AI content** (`memory/principle_no_patient_facing_ai_content.md`): still binds. Patient-facing surfaces stay human-authored.
- **Production safety**: every feature behind `workspaces.video_pipeline_enabled` flag, default false. Additive migrations only. Per-phase worktrees. Audit gates between phases.

## Roles introduced

| Role | Permission tier | Holder at Move Better | Daily time |
|---|---|---|---|
| **Owner** | `owner` | Q (Michael Quasney) — implicit today, formalized Phase 0 | n/a (governance only) |
| **Clinician** | `clinician` | Q, Dr. Cullen, Dr. Sophie, others | ~20–30 min |
| **Producer** | `producer` | Philip Abraham III | ~1.5 hr/day weekday + 2.5 hr block weekly |
| **Viewer** (defined, unused at Move Better) | `viewer` | — | — |

## Phase sequencing

| Phase | Days | Worktree | Output | Audit gate |
|---|---|---|---|---|
| 0 — Setup + safety scaffolding | 1 | `video-phase-0-setup` | Migrations 083–085, owner/producer backfill, kit ordered, roadmap doc | (none — Phase 0 itself) |
| 1 — Capture Companion + ingest | 2–4 | `video-phase-1-capture` | iOS Shortcut, blob ingest, vision auto-tagging, visual practice memory schema active | G1 |
| 1.5 — Non-clinical interview mode + Team UI rename | 5–7 | `video-phase-1.5-team-as-talent` | Non-clinical staff prompt mode, new content lanes, Team tab UI | (folded into G2) |
| 2 — Editorial brain | 5–9 | `video-phase-2-editorial` | Vercel AI Gateway migration, clip-pull AI, caption + per-channel render pipeline, brand visual identity extraction | G2 |
| 3 — Clinician + Producer surfaces | 10–15 | `video-phase-3-surfaces` | Daily Story Slate, Producer Slate, Triage Queue, Consent Dashboard, Capture Coverage Dashboard, in-app inbox | G3 |
| 4 — Producer tier features | 16–19 | `video-phase-4-producer` | Permission middleware, Weekly Engagement Digest cron, Tentpole Planner, Brand QC tools | G4 |
| 5 — Integration + auto-publish | 20–23 | `video-phase-5-integration` | Wire packages into existing generation, auto-publish confidence gate, UTM engagement loop | G5 |
| 6 — Launch + productize | 24–30 | `video-phase-6-launch` | iOS polish, kit productized as tenant artifact, onboarding wizard integration, final chaos harness | G6 |

## Decision points (Q's input required)

| ID | Trigger | What I show | What you decide |
|---|---|---|---|
| D1 | End of Phase 0 | Migration SQL + backfill SQL + buy list + Philip Clerk linkage question | Approve migrations + backfill + kit order; provide Philip's Clerk user_id |
| D2 | End of Day 3 | iOS Shortcut working, 5–10 test clips captured | Sanity check auto-tagging quality before Phase 2 builds on top |
| D3 | End of Day 7 | 20 sample packages with confidence scores | Pick auto-publish threshold (calibrates rest of build) |
| D4 | End of Day 9 | Per-channel render previews | Confirm 6-format list (or trim/add) |
| D5 | End of Day 11 | Producer Slate UX walkthrough | Sign off with Philip before Phases 4–5 build on top |
| D6 | End of Day 18 | Philip's workflow walkthrough | Confirm Producer features match his actual 10 hr/wk role |
| D7 | End of Day 22 | Auto-publish ready for first channel | Approve channel-by-channel rollout sequence (GBP first) |
| D8 | End of Day 27 | Kit productization branch ready | Ship to first paying chiro friend or hold for more Move Better validation |
| D9 | End of Day 30 | Phase 7 input | Next-mountain direction (Shape A vs B vs broaden) |

## Audit gates (automated, between phases)

| ID | Trigger | Agents | Pass criteria |
|---|---|---|---|
| G1 | End of Phase 1 | bug-hunter, tenant-isolation-auditor | No P0 issues on new ingest handlers, isolation enforced |
| G2 | End of Phase 2 | bug-hunter, ui-reviewer (render output) | ffmpeg pipeline produces brand-faithful output on 5 real Move Better clips |
| G3 | End of Phase 3 | ui-reviewer, tenant-isolation-auditor | All 5 new surfaces usable; Philip can only see Move Better People |
| G4 | End of Phase 4 | tenant-isolation-auditor (Producer scope), bug-hunter | Producer cannot access settings/billing/integrations; cron + digest reliable |
| G5 | End of Phase 5 | `/auditfull` (all three agents) | Lint ratchet still 0; auto-publish gate passes prod smoke |
| G6 | End of Phase 6 | `/auditfull` + tenant chaos harness | Synthetic onboarding flows include video-enabled tenants; all green |

Plus: **nightly `/audit`** scoped to last 24 hrs of commits, **weekly Friday `/checkup full`**.

## What stays on `main` in parallel (the C→E track)

- Live Interview polish: iOS Safari, disconnect/reconnect, minute cap, quality dot
- Stripe live-key swap (when Stripe identity verification clears)
- First paying chiro friend onboarding (when ready)
- Routine bug fixes from `/audit` runs

The video build worktrees rebase against `origin/main` daily to absorb any C→E landings cleanly.

## Cost ceiling alerts

- Daily Claude API spend > $150 → auto-pause + ping Q
- Vercel function invocations > 2× current baseline → ping Q
- Vercel Blob storage > +50GB in 24 hours → ping Q (capture pipeline running wild)
- Any production 5xx rate change > 0.5% → emergency pause + Opus debug

## Memory references

- `memory/principle_team_as_talent.md` — locks the staff_type principle
- `memory/owner_identity_q.md` — Q ↔ Michael Quasney naming rules
- `memory/principle_no_patient_facing_ai_content.md` — what NOT to build
- `memory/project_post_phase5_direction.md` — strategic basis (C→E)
- `.claude/strategic-pass-2026-05-25.md` — outside-in landscape that informed this build
- `.claude/overnight-results-2026-05-26.md` — voice fidelity baseline, chaos onboarding gate, competitor positioning

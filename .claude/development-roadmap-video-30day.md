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

| Phase | Planned days | Actual / projected | Worktree | Output | Audit gate |
|---|---|---|---|---|---|
| 0 — Setup + safety scaffolding | 1 | **✅ Day 1** (2026-05-27) | `video-phase-0-setup` | Migrations 083–085, owner/producer backfill, kit ordered, roadmap doc — shipped via PR #871 | (none — Phase 0 itself) |
| 1 — Capture Companion + ingest | 2–4 | **✅ Day 1–2** | `video-phase-1-capture` + `video-pwa-capture` + `video-wire-vmi-into-upload` | Capture endpoint + visual memory index (#872), PWA universal upload (#879), buy-list+token UI (#880), VMI wiring (#881). **Distribution change: iOS Shortcut path retired (#890), PWA Add-to-Home-Screen is the universal pathway.** | G1 |
| 1.5 — Non-clinical interview mode + Team UI rename | 5–7 | **🔜 Day 3 (projected)** | `video-phase-1.5-team-as-talent` | Non-clinical staff prompt mode, new content lanes, Team tab UI | (folded into G2) |
| 2 — Editorial brain | 5–9 | **✅ Day 2** | `video-phase-2-*` series | AI Gateway migration, clip-pull AI, caption + per-channel render (#882), story packages (#883), brand visual identity via Claude Vision (#884), render-quality fixes (#885 / #888 / #892 / #895) | G2 |
| 3 — Clinician + Producer surfaces | 10–15 | **✅ Day 2** | `phase3-story-director` + `phase3-slate-clean` | Story Director Slate (#893), Approve → Drafts + Edit-in-place (#894), Triage + Consent + Coverage tabs (#899). **Distribution change: per-source-asset consent is now a first-class gate on auto-publish, not just confidence.** | G3 |
| 4 — Producer tier features | 16–19 | **🔜 Day 4–5 (projected)** | `video-phase-4-producer` | Permission middleware, Weekly Engagement Digest cron, Tentpole Planner, Brand QC tools | G4 |
| 5 — Integration + auto-publish | 20–23 | **🔜 Day 6–8 (projected)** | `video-phase-5-integration` | Wire packages into existing generation, auto-publish confidence gate (paired w/ consent gate from Phase 3), UTM engagement loop | G5 |
| 6 — Launch + productize | 24–30 | **🔜 Day 9–13 (projected)** | `video-phase-6-launch` | PWA polish, kit productized as tenant artifact, onboarding wizard integration, final chaos harness | G6 |

### Empirical velocity recalibration (2026-05-27)

**Phases 0–3 shipped in 2 calendar days against a planned 13–15.** Velocity is ~7× the planned estimate. This isn't an outlier — it's the new baseline for this build. The remaining phases re-time accordingly (Phase 6 likely closes ~Day 13 vs Day 30), leaving **~13–18 days of velocity surplus** inside the 30-day window.

The surplus is deliberately spent on the **"Deepen the video build" extension set (V-series)** below — extending the existing pipeline against the same constraints (single-surface, brand-faithful, consent-gated, no patient-facing AI). Not a new direction; depth over breadth.

## V-series extensions (post-Phase-6 surplus capacity)

Decision 2026-05-27: spend the velocity surplus deepening the video pipeline before widening to more tenants. Mix is **"deepen, then invite"** — V1 + V3 + V5 + V6 + V10 first, widen to the chiro-friend cohort after the pipeline is dramatically better.

| # | Extension | Why | Worktree | Days | Status |
|---|---|---|---|---|---|
| **V1** | Caption + thumbnail title voice-fidelity CI gate | Captions are now the highest-volume text output. Must pass the same voice bar as blog/atom or "sounds like you" breaks at widest distribution. Load-bearing for D7. | `video-v1-caption-fidelity-gate` | 1 | **✅ Shipped 2026-05-27** — see V1 section below |
| V3 | AI b-roll generation (Runway/Veo) for visual memory gaps | Story packages fail when visual memory is thin. Brand-faithful synthetic b-roll keeps the pipeline running on sparse-capture clinics. | `video-v3-ai-broll` | 3 | Queued |
| V5 | UTM engagement loop closing — per-channel performance back into the Slate | Phase 5 sketched it; make it the post-D7 priority so auto-publish learns from what worked. | `video-v5-engagement-loop` | 2 | Queued |
| V6 | Practice memory RAG layer feeding clip-pull AI | Replace hot-tier injection with pgvector embeddings. Clip-pull gets dramatically sharper on "the clip about X." | `video-v6-rag-clip-pull` | 3 | Queued |
| V10 | Live "shooting director" guided capture | Slate reads coverage gaps → tells the clinician what to capture next. Closes the loop between distribution demand and capture supply. | `video-v10-shooting-director` | 2 | Queued |

**Sequence:** V1 → V6 → V3 → V5 → V10. V1 first because it's load-bearing for D7's auto-publish decision. V6 next because the RAG layer makes V3 + V5 + V10 sharper. V3 before V5 because b-roll fills gaps the engagement loop is otherwise measuring as failures. V10 last because it depends on both V6 (semantic gap detection) and V3 (offering synthetic alternatives when capture isn't possible).

**Not in this set (deliberately deferred):**
- V2 (cross-tenant cohort onboarding — 5 chiro friends in parallel) → after the pipeline is deepened
- V4 (voice clone for off-camera narration) → patient-facing surface concerns; revisit after V6
- V7 (patient handout rehoming per ideas.md L138) → not in the video lane
- V8 (outcome case study pipeline) → not in the video lane
- V9 (Shape C anonymized topic intelligence) → June 21 re-decide territory

## V1 — Caption + thumbnail title voice-fidelity CI gate (shipped 2026-05-27)

**Why it's load-bearing for D7:** captions are now the highest-volume text the pipeline emits — every package burns subtitles into video + lands as the social caption + thumbnail title. If auto-publish ships at D7 without a fidelity gate, the worst caption regression cascades to the widest audience before anyone sees it.

**Shape of V1:**

1. **Migration 092** — `voice_fidelity_score numeric` + `voice_fidelity_breakdown jsonb` on `story_packages`, with `GRANT … TO service_role`. Partial index on rows that have a score (badge query + gate query both hit this path).
2. **Scorer** (`scripts/voice-fidelity-captions.mjs`) — short-form caption analog of `voice-fidelity-score.mjs`. Same 5 dimensions (voice_fidelity / clinical_texture / redundancy / specificity / brand_fit) so dashboards are comparable, but the evaluator prompt is tuned for the title + caption pair specifically. Writes a CI fixture via `--fixture-out=`.
3. **Shared helper** (`api/_lib/captionFidelity.js`) — `scoreCaptionFidelity({ packageId, workspaceId, … })`. Called via `waitUntil()` from `generate-package`, `rerender-package`, and `packages/[id]` PATCH so any path that changes `caption_text` triggers a re-score in the background (no added user-facing latency).
4. **CI gate** (`scripts/verify-caption-fidelity.mjs`, wired into `.github/workflows/pr.yml`) — reads the committed fixture, fails the build if `avg < baseline × (1 - tolerance)`. Credential-free: no live DB / LLM call in CI. Skips with exit 0 if the fixture is missing so first-run / opt-out is unblocked.
5. **Slate badge** — `VoiceFidelityBadge` inside `PackageCard.jsx`, next to the existing `SimilarityBadge` in the top-left thumbnail overlay. Green ≥ 7.0, amber 5.5–7.0, red < 5.5. `title` attribute carries the full per-dimension breakdown for hover inspection.

**Baseline + threshold:**

| Setting | Value | Source |
|---|---|---|
| `VOICE_FIDELITY_GATE_BASELINE` | `5.5` | Observed avg of n=6 first scored packages was **5.97/10**. Default sits below today's actual so the gate ratchets regressions, not improvements. |
| `VOICE_FIDELITY_GATE_PCT` | `0.05` | 5% allowed dip below baseline. Floor = 5.225. |
| `VOICE_FIDELITY_GATE_MIN_SAMPLE` | `5` | Refuse to gate on fewer than 5 scored samples. |
| `VOICE_FIDELITY_GATE_MAX_AGE_D` | `30` | Fail if the committed fixture is older than 30 days — forces a refresh cadence. |

**The 5.5 baseline is honest, not aspirational.** Captions are currently scoring well below the 7.27 long-form baseline — exactly the bug the gate was built to surface. The right rhythm: improve the caption prompt (next iteration), refresh the fixture, raise the baseline. Ratchet down. Repeat.

**Rollback if the gate gets too noisy:**

- **First lever:** raise `VOICE_FIDELITY_GATE_PCT` (e.g. 0.10) to widen tolerance without lowering the bar.
- **Second lever:** set `VOICE_FIDELITY_GATE_DISABLED=1` in the workflow env to skip the gate (exits 0). Cheaper than reverting code while we triage.
- **Third lever:** if `waitUntil` scoring proves to be a cost or latency drag in prod, gate the auto-score behind a `WORKSPACE.video_pipeline_enabled` + workspace-flag combo. (Not implemented today — the score call is ~$0.001 per package via Haiku 4.5, so cost was not justification enough to add a flag.)

**Refresh cadence:** the fixture lives at `.claude/voice-fidelity-captions-fixture.json` and should be regenerated when:
- Caption generation logic changes (`generateCaption` in `api/editorial/generate-package.js`).
- Voice phrase corpus shifts meaningfully (a new clinician onboards, or voice-extraction reruns).
- More than ~3 weeks have elapsed (the gate enforces 30d via `MAX_AGE_D`).

Refresh command (from worktree or project root):

```
cd "/Users/qbook/Claude Projects/NarrateRx" && node scripts/voice-fidelity-captions.mjs --limit=30 --fixture-out=.claude/voice-fidelity-captions-fixture.json
```

Needs `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `AI_GATEWAY_API_KEY` in `.env.local`. Costs ≈ $0.01 for a 30-package run on Haiku 4.5.

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

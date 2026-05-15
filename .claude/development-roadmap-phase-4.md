# NarrateRx — Phase 4 Roadmap: The Defensible Wedge
_Created 2026-05-14. Successor to `.claude/development-roadmap.md` (Phases 1–3 shipped)._

## Project orientation (clinician-first, SaaS-optional)
**Primary purpose:** serve the user's own clinical practice (Move Better — People, Equine, Animals workspaces). Every feature priority is judged first by **how much clinician effort it removes for the user personally**, then by external-tenant viability.

**Implications for scope:**
- A feature that saves the user 30 minutes a week of high-effort work (review, voice tuning, topic ideation) is **worth shipping even if no external tenant ever asks for it**. The user is the first customer and the most expensive one to please because their time has the highest opportunity cost.
- SaaS polish (onboarding glossiness, billing edge cases, marketing-page CRO) ships only when it costs little or is the same code path as a clinician-ROI feature.
- "Would I, as a clinician, pay $X/month to skip this manual step?" is the qualifier. If yes, build. If only an external tenant would care, defer.
- External-tenant validation gate (60 days, 2+ interviews, retention) still applies for **revenue claims**, but does not block features whose value is the user's own time.

## North Star (unchanged)
The only end-to-end staff storytelling → clinical content pipeline. Structured prompted capture + voice-faithful AI drafting + vertical context depth — for healthcare/clinical settings.

## Defensible wedge (the only three things competitors can't fast-follow)
Per 2026-05-13 competitive research:

1. **Live cross-staff synthesis** — agreement clusters + gaps surfaced mid-interview, not post-hoc.
2. **Voice-faithful output loop** — per-clinician voice profile visibly applied to drafts, auto-tuned from every accept/reject.
3. **Self-deepening vertical context** — workspace knowledge graph that compounds with use, replacing today's static JSONB.

Everything outside this wedge (scheduling, analytics, approval polish) integrates rather than builds.

---

## What already ships toward these objectives (do not rebuild)
| Capability | Where it lives | Limitation |
|---|---|---|
| Voice memory (per-clinician edit summary) | `clinicians.voice_notes`, `content_items.ai_original_content`, `/api/clinicians/refresh-voice-notes`, `VoiceNotesPanel` | Free-text whole-tone summary; manual refresh only; no per-span proof |
| Themes view (cross-staff topic clustering) | `src/components/stories/StoriesThemesView.jsx` | String-match `groupByTopic` only; no concept graph, no agreement/gap detection, no in-interview hooks |
| Workspace context (paradigm content) | `workspaces.patient_context`, `workspaces.interview_context`, `workspaces.topic_suggestions` JSONB | Manually edited; doesn't deepen with use; no per-topic retrieval |
| Brand guidelines extraction | `workspaces.brand_guidelines` (mig 038) | Workspace-level only; already auto-extracts from brand book PDF |
| Engagement → topic feedback | `/api/topic-suggestions` reads `buffer_metrics` | Closed loop on topics, not on concepts or voice |
| Contrast probe (Bernard, mid-interview) | `[CONTRAST]` token in interview prompt | Keyword overlap only — no concept-level alignment, no agreement/gap variants |

The Phase 4 plan **layers on top** of these — the concept graph in Phase A is the substrate that turns each of the above from local heuristic into compounding asset.

---

## Phase A — Self-deepening vertical context (build first)
**Goal:** turn the workspace from a static JSONB config into a knowledge graph that auto-deepens from every approved piece of content and every completed interview. Replaces the manually-edited `patient_context`/`interview_context`/`topic_suggestions` reads at prompt-assembly time with a per-topic retrieval call.

**Clinician-first justification:** the user currently edits paradigm content by hand in workspace settings. Auto-deepening removes that recurring chore entirely and makes every interview/draft prompt smarter without any manual upkeep.

### A.1 Schema
- New table `workspace_concepts` — durable, weighted concept records.
  - Columns: `id uuid`, `workspace_id uuid → workspaces`, `kind text` (`archetype`/`condition`/`paradigm`/`value`/`objection`), `label text`, `aliases text[]`, `evidence_count int`, `weight numeric`, `embedding vector(1536)` (pgvector if available — fall back to JSONB array if not), `first_seen_at timestamptz`, `last_seen_at timestamptz`, `last_reinforced_at timestamptz`.
  - Unique `(workspace_id, kind, label)` (case-insensitive via expression index).
- New table `concept_mentions` — every observation of a concept.
  - Columns: `id uuid`, `concept_id uuid → workspace_concepts on delete cascade`, `workspace_id uuid` (denormalized for cheap filtering), `source_kind text` (`interview_turn`/`content_item`/`approved_edit`/`rejected_edit`), `source_id uuid`, `clinician_id uuid → clinicians`, `weight_delta numeric`, `excerpt text`, `created_at timestamptz`.
- Self-sufficient grants: `GRANT … TO service_role` for both tables + their sequences (per CLAUDE.md migration rule).
- Migration file: `supabase/multitenant/migrations/039_workspace_concepts.sql`.

### A.2 Extraction worker
- New module `api/_lib/conceptExtractor.js` — pure function `extractConcepts({ workspaceId, sourceKind, sourceId, text, clinicianId })`.
  - One Sonnet 4.6 call per source. Prompt asks for `{kind, label, excerpt}` triples grounded only in the input text.
  - Dedupes against existing `workspace_concepts` by label fuzzy match (Postgres `similarity()` from `pg_trgm`).
  - Inserts new concepts (weight = 1.0), inserts mentions, bumps `evidence_count` and `last_seen_at` on existing.
- Trigger points (fire-and-forget, no user-facing latency):
  - Interview completion → walk all clinician turns from `interviews.cleaned_messages`.
  - Content item approval (existing approval webhook) → extract from final approved text.
  - Content item rejection / change request → extract with negative weight delta on phrasings.
- Idempotency: each `(source_kind, source_id)` extraction is run at most once; re-runs are safe (UPSERT semantics on mentions).

### A.3 Retrieval helper
- New module `api/_lib/conceptRetrieval.js` — `getRelevantContext({ workspaceId, topic, clinicianId?, limit = 8 })`.
  - Returns top-N concepts by weight × recency, filtered by topic via embedding similarity (or trgm fallback).
  - Output shape designed to drop into existing prompt builders: `{ archetypes: [...], conditions: [...], paradigm: [...], values: [...] }` — matches the JSONB shape the prompt code expects today, so call-site changes are minimal.
- Wire into `api/content-plan/draft.js`, interview probe assembly, `/api/topic-suggestions`. Static JSONB stays as the seed/fallback when the graph is empty.

### A.4 Context bank UI
- New section in `/settings/workspace` → "Knowledge bank" panel.
- Read-only counts by kind (archetypes / conditions / paradigm phrases / values / objections), top-10 by weight, last-reinforced timestamp.
- "Re-extract from history" button — re-runs the worker against the last 50 approved pieces + 20 most recent interviews. One-shot, rate-limited.
- This is the **proof artifact** for the user that the system is learning — and the upsell artifact for external tenants on the Practice plan.

### A.5 Eval guardrail
- New script `scripts/eval-concept-extraction.mjs` — fixture of 5 hand-labeled transcripts → run extractor → score against expected concept set.
- Runs locally before any prompt change to the extractor. Not in CI yet; revisit if extractor regressions ever ship.

**Phase A gate:** retrieval helper is live in interview + draft prompt assembly, concept counts visibly grow after the next 5 approved pieces / 3 interviews, user reports "knowledge bank" matches their actual practice vocabulary.

---

## Phase B — Live cross-staff synthesis
**Depends on Phase A.** Turns the concept graph into mid-interview probes and an admin-facing synthesis matrix.

**Clinician-first justification:** today the user has to *remember* what other staff said on a given topic. Live agreement/gap chips offload that mental load and surface gaps in coverage automatically — saves the user's planning effort and improves content variety.

### B.1 Per-turn concept tagging
- Extend the extraction worker to run on interview turns *during* a session (not only on completion).
- Cache per-turn concept tags on the message row (extend `interviews.cleaned_messages` shape or add a `interview_turn_concepts` join table).

### B.2 Agreement / gap detector
- New helper `getStaffStanceForConcept({ workspaceId, conceptId })` → returns clinician-by-stance breakdown derived from past mentions.
- New probe tokens in `src/lib/prompts.js`:
  - `[AGREEMENT]` — "N clinicians at the practice have said X about this — is that your experience too?"
  - `[GAP]` — "no one here has told the story of Y yet — can you?"
- Tone/budget integration: extend the existing `probe_goal` config per tone.

### B.3 In-interview chip UI
- Extend the existing ↔ contrast badge to render variants: `↔ contrast`, `≡ agreement`, `○ gap`.
- Tooltip shows the count and one-line summary ("3 clinicians, 1 dissent").
- File: `src/components/interview/InterviewerChip.jsx` (or wherever the contrast chip currently lives).

### B.4 Admin synthesis view
- New page `/synthesis` (Practice plan gated) — concept × stance matrix, gap list, "Build content from this theme →" CTA per row.
- This is the **standalone value prop** that's shippable even if B.2/B.3 are still in flight.

**Phase B gate:** during a 20-minute interview, Bernard surfaces at least one agreement and one gap probe drawn from real prior interviews, both rated useful by the user.

---

## Phase C — Voice-faithful output loop
**Depends on Phase A; can run in parallel with B.**

**Clinician-first justification:** the biggest recurring drain is rewriting AI drafts to sound right. Per-span "kept your phrasing" annotations + auto-tuning voice profile shrinks the edit gap over time — direct, measurable time savings for the user.

### C.1 Per-clinician voice profile (richer than `voice_notes`)
- New table `clinician_voice_phrases` — preserved phrasings, rhythm stats, vocabulary fingerprint, all weight-tracked.
- Populated initially by walking existing `content_items` where `ai_original_content !== content` (same source as today's `voice_notes` refresh).
- Keep `clinicians.voice_notes` as the human-readable distillation; the new table is the structured substrate.

### C.2 Span-level "kept your phrasing" annotations
- Extend draft generator to mark spans traceable to the speaker's transcript or prior approved content.
- Render in the existing diff view (PR #360) as subtle highlights with hover-source.

### C.3 Auto-tune (no manual refresh button)
- Hook into approval / rejection events: feed accepted phrases into `clinician_voice_phrases` with positive weight, rejected phrasings with negative weight.
- Drop the manual "Refresh voice notes" button once auto-tune is steady.

### C.4 Voice freshness UI
- Per-clinician card in workspace settings: "Voice model trained on N pieces, last updated X, top phrasings shown."
- Surface "kept your phrasings" coverage stat per draft (e.g. "67% of this draft uses phrasings traceable to your prior work").

**Phase C gate:** for the user's own writing, ≥50% of generated drafts ship with no edit beyond a 1-2 word tweak; for newer staff, the coverage stat trends upward across 5 consecutive pieces.

---

## Cross-cutting

### Migration discipline (per CLAUDE.md)
- Every new table ships with `GRANT … TO service_role` in the same file.
- Sequential numeric prefixes; pre-apply before merging code that depends on the schema.
- Quick schema checks in Supabase SQL Editor before declaring a phase done.

### Lint ratchet
- Net-zero or downward on every PR. The Phase A migration alone touches no JS — easy first PR.

### Sentry
- Per memory, Sentry is deferred. The new background workers (extraction, retrieval) log to `vercel logs` with a `[concepts/*]` prefix using the existing `dbErr` pattern.

### Cost discipline
- Sonnet 4.6 for all extraction calls. One call per artifact, not per turn.
- 7-day TTL on retrieval results per `(workspace_id, topic)` key, cached on `workspaces.concept_retrieval_cache` JSONB.

---

## Estimated Claude cost (for context)
Per the 2026-05-14 estimate: ~$760 mid-case, $550–$1,100 range, across 6.5 calendar weeks of focused build. Phase A standalone: ~$150. If validation gate kills B/C, the user keeps a self-deepening knowledge bank — the most clinician-ROI piece of the three.

---

## Decision log
| Date | Decision | Why |
|---|---|---|
| 2026-05-14 | Phase A first, B/C after | Concept graph is the substrate; building B or C first means rework. |
| 2026-05-14 | Keep existing `voice_notes` + Themes view in place | Working tools today; Phase 4 layers on, doesn't replace. |
| 2026-05-14 | Clinician-first ROI is the priority lens | User is the first customer; their time savings justifies features regardless of external-tenant demand. |

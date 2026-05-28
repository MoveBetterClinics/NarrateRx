# Interview Output Voice Fidelity — Design

**Status:** Draft, 2026-05-28
**Lane:** Architecture
**Trigger:** Running interview blog drifted from clinician voice (vocab swap, imposed structure, smoothed opinions). Existing per-interview filters (tone, audience) are doing more harm than good.

---

## North star

The interview captures rambling thinking in the clinician's voice. The output system organizes that rambling without translating it. **Voice fidelity is the only thing that matters.** Audience targeting belongs at topic selection, not at interview time. Tone is not a filter — it leaks out of how the clinician actually talks.

---

## Decisions

### 1. Lane: We vs I

- Decided **at interview start.** "Clinic story (We)" vs "Personal story (I)."
- One lane per interview. Whole transcript tagged.
- Drives downstream choices (e.g. We-lane outputs get practice-memory checks in the voice audit; I-lane does not).

### 2. Kill list (per-interview filters that go away)

- **Tone modifiers** — warmth, formality, energy sliders or prompt language.
- **Per-interview audience targeting** — "who is this for" at interview launch. Topic-level audience targeting stays.
- **Fixed section templates** — intro/body/conclusion, "3 takeaways," outline-fill shapes.
- **Softening / balance / hedging** — "balanced perspective," "consider both sides," reflexive disclaimers, any nudge to soften strong claims the clinician made.

### 3. Blog output

- **Job:** faithful reorder of the transcript with minimal connective bridges.
- Same words, same thoughts, regrouped and sequenced so a reader can follow.
- Bridges allowed but must read as minimal connective tissue, not new argument.
- **Multi-piece extract** when length + distinct threads warrant. System auto-detects, proposes a split (e.g. "this interview has 3 threads — split into 3 posts?"), user confirms or overrides. Default = one blog.

### 4. Atom architecture

- **Core = a single point** (idea + reasoning) in the clinician's voice. Not a quote, not a paragraph — a claim plus the why behind it, expressed in their phrasing.
- **Surface = per-platform.** Hook, intro, CTA, formatting — full freedom to flex for the channel (Instagram punchier, LinkedIn longer, etc.).
- Surface drift doesn't matter; **the voice audit catches drift at the end either way.**

### 5. Generation order (now)

- **Independent paths from transcript.** Blog generator reads the transcript directly; atom generator extracts points from the transcript directly. No shared intermediate.
- **Revisit hybrid later** once we see what each output misses — points might benefit from blog's flow awareness, blog might benefit from points' coverage discipline.

### 6. Voice fidelity guard — two-pass

- **Pass 1:** generate (with stripped, quote-first prompt).
- **Pass 2:** audit the output against three sources:
  - **The original transcript** — catches vocab swap and imposed structure for THIS interview.
  - **Clinician voice profile** — running phrase library built from prior interviews; catches drift from the clinician's overall voice, not just today's words.
  - **Practice memory (We-lane only)** — catches fabricated clinic claims, positioning drift, or contradictions with prior clinic facts.
- Audit reverts vocab swaps and flags structural drift / smoothed opinions for human review (or auto-revert if confidence is high).

### 7. Specific drift types the audit must catch

From the running blog post-mortem:

- **Vocabulary swap** — generic health/fitness terms in place of clinician's actual words.
- **Imposed structure** — tidy intro/body/conclusion that flattens how the clinician thinks.
- **Smoothed opinions** — softened or "balanced" framing where the clinician took a stance.

---

## Non-goals

- Per-interview tone control. (Killed.)
- Per-interview audience targeting. (Killed.)
- Section-template choices. (Killed.)
- SEO-optimized core text. (Engagement/SEO live in atom surface layer only.)
- Disclaimers / "consult your doctor" auto-insertion. (Killed.)

---

## Current state (from audit, 2026-05-28)

### Blog generation path

- **Handler:** `src/pages/InterviewSession.jsx:1090-1100` calls `getBlogPostSystemPrompt()`.
- **Prompt builder:** `src/lib/prompts.js:589` — `getBlogPostSystemPrompt(workspace, clinicianName, condition, tone, voiceMode, prototypeId, voiceNotes, voicePhrases, audienceSlot, storyTypeSlot, lengthPreset, ownHistoryBlock)`.
- **System prompt:** lines 589-658.
- **Model call:** `src/lib/claude.js:generateContent()` → `/api/generate`.

### Atom generation path

- **Live prompt builder:** `api/_lib/atomPrompts.js:27` — `getAtomSystemPrompt(workspace, clinicianName, condition, platform, angle, voiceMode, tone, voiceNotes, brandGuidelines, voicePhrases, audienceLabel, storyTypeLabel, campaignContext, ownHistoryBlock)`.
- **Call sites:**
  - `api/content-items/regenerate.js:176-191` — regenerate from approved atoms.
  - `api/content-plan/draft.js:142-159` and `272-290` — draft new atoms from interview.
- **Dead code (confirmed):**
  - `src/lib/prompts.js:756` `getSocialBatchSystemPrompt` — unreferenced.
  - `src/lib/prompts.js:816` `getVideoScriptBatchSystemPrompt` — unreferenced.
  - `src/lib/prompts.js:863` `getMarketingBatchSystemPrompt` — unreferenced.

### Filters to remove

- **Tone modifier injection** — `src/lib/prompts.js:227-231` (`getToneModifier()`, reads `workspace.tone_modifiers[tone]`). Applied in blog at line 658, in atoms at `api/_lib/atomPrompts.js`.
- **Per-interview audience** —
  - `src/lib/prompts.js:594` (blog: `audienceSlot.label` or `workspace.region + " readers"`).
  - `src/pages/InterviewSession.jsx:627-628` (UI: audience/storyType selected at interview launch).
  - `api/_lib/atomPrompts.js:27` accepts `audienceLabel` + `storyTypeLabel`; used at lines 213-216.
- **Fixed section template** — `src/lib/prompts.js:610-656`. Hardcoded 4-act blog shape: "What's Really Going On" → "The [Clinic] Approach" → "What [Patients] Experience" → "The Insight..." → CTA footer. **This is the smoothed-opinion culprit** even though no explicit hedging instruction exists.
- **Softening / hedging / balance** — _not found in prompts._ Confident tone explicitly opts out ("Strong opinions, contrarian takes — confident, quotable, no hedging"). No "consult your doctor" boilerplate. Smoothed opinions trace to the section template, not a softening instruction.

### Lane (We vs I) — already exists as `voiceMode`

- `src/lib/prompts.js:90-104` — `getVoiceModes()` returns `practice` (We) and `personal` (I).
- Implemented in:
  - Interview prompt: `getFramingRule()` lines 319-331 (I → we for practice mode).
  - Blog prompt: `isPersonal` switch at line 593, flips section headers and CTA signature.
  - Atom prompt: voiceMode check at `api/_lib/atomPrompts.js:29`, adjusts per-platform voice (IG line 47, LI line 59, etc.).
- **Gap to close:** confirm `voiceMode` is set **at interview start** as an explicit user choice and persisted on the interview row — not defaulted from workspace and not flippable per output. (To verify during PR 2.)

### Voice profile — pieces already exist, no formal profile

- `clinician.voice_notes` (`src/lib/prompts.js:238-246`) — patterns learned from edits.
- `voicePhrases[]` (`src/lib/prompts.js:248-262`) — top 8 prior-shipped sentences injected as anchors. Applied to blog (line 601), atoms (`atomPrompts.js:214`), minimal edits.
- `workspace.tone_modifiers` — being killed.
- **No standalone "voice profile" object.** The two-pass audit (PR 3) can use the existing `voicePhrases[]` + `voice_notes` without new schema. A formal profile (embeddings index over all transcripts) is an optional later step if these two prove insufficient.

### Practice memory access

- `src/lib/practiceMemory.js:81-120` — `buildOwnHistoryBlock()` fetches recent prior interviews + RAG-retrieved related snippets.
- `buildRagQuery()` (same file) used by `regenerate.js:153` and `draft.js:127`.
- Currently injected into the **interview prompt** as `ownHistoryBlock` (shapes interview questions). For PR 3, we'll re-query at output-audit time for We-lane outputs.

### Topic-level audience — separate path, leave alone

- `api/topic-suggestions.js:80-130` — `buildPrompt()` uses `workspace.audience_description` (line 118) for topic suggestions. Workspace-global, not per-topic.
- Topic suggestions do NOT consume `interview.audience`. The two paths are orthogonal — killing per-interview audience does not touch topic suggestions.

---

## Rollout

Three PRs, smallest first.

### PR 1 — Strip filters + quote-first prompt (smallest change)

**Blog prompt (`src/lib/prompts.js:589-658`):**
- Remove `audienceSlot` and `audiencePhrase` (line 594).
- Remove the fixed section template (lines 610-656) — replace with: "Organize the transcript into a flowing post. Don't impose a fixed structure. Lead with the clinician's actual phrasing; bridges between ideas must be minimal and never paraphrase a sentence the clinician said. Group related thoughts; sequence so a reader can follow; otherwise stay out of the way."
- Remove tone modifier injection at line 658.

**Atom prompt (`api/_lib/atomPrompts.js`):**
- Remove `audienceLabel` and `storyTypeLabel` parameters and their usage (lines 213-216).
- Remove tone modifier injection.
- Add core-vs-surface framing: "The core of this atom is a single point — a claim plus the why behind it, in the clinician's voice. The surface (hook, intro, CTA, formatting) can flex for the platform. Never paraphrase a core sentence the clinician said."

**Interview launch UI (`src/pages/InterviewSession.jsx:627-628`):**
- Remove the audience selector and the story-type selector from the interview-launch screen. (Topic-level audience targeting in `/api/topic-suggestions` is untouched.)
- Leave voiceMode (We/I) selection in place — PR 2 makes it explicit and required.

**Callers:**
- Update every call site of `getBlogPostSystemPrompt` and `getAtomSystemPrompt` to drop the removed parameters.
- Delete dead `getSocialBatchSystemPrompt` / `getVideoScriptBatchSystemPrompt` / `getMarketingBatchSystemPrompt` (lines 756, 816, 863).

**Smoke test:**
- Re-run the running interview through the blog generator on the preview deploy. Compare output against the original drift-y blog and against the transcript.

**Out of scope for PR 1:**
- Two-pass voice audit (PR 3).
- Multi-piece extract (PR 4).
- Lane-at-interview-start enforcement (PR 2 — the existing voiceMode default behavior is fine for the smoke test).

### PR 2 — Lane (We/I) at interview start

- Add lane chooser to interview launch.
- Persist lane on interview row.
- Plumb to blog + atom generation prompts.
- Branch voice-audit sourcing on lane (We pulls practice memory, I does not).

### PR 3 — Two-pass voice audit

- Audit pass against transcript + voice profile + practice memory (We-lane).
- Revert vocab swaps; flag structural / opinion drift.
- Add `voice_fidelity_score` or similar to outputs for visibility.

### PR 4 — Multi-piece extract proposal

- Length + thread-detection heuristic.
- "Split into N posts?" UI on long interviews.
- Default = one blog; user confirms split.

### PR 5 (deferred) — Hybrid generation order

- Once PRs 1–4 are live and we've seen drift patterns, decide whether blog should consume points (or vice versa) instead of running fully independent paths.

---

## Open questions

- **Voice profile:** does one exist today, or do we build it from scratch? (Audit will answer.) If new: scope is per-clinician phrase library extracted from all their prior interview transcripts; small embeddings index per clinician.
- **Multi-piece threshold:** what word count + thread count proposes a split? Tune empirically against past long interviews.
- **Auto-revert vs. flag for review:** the two-pass audit's vocab-swap reverts are probably safe to auto-apply; the structural / opinion-drift flags probably need human review. Confirm UX in PR 3.
- **Atom platform set:** which platforms get atoms today (IG, LinkedIn, video script, newsletter, etc.) and which need bespoke surface treatment vs. shared. Audit + a follow-up scope.

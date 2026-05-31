# Overnight Experiment Results — 2026-05-26

> Token-amnesty session. Ran while you slept.
> All 4 token-amnesty experiments from the roadmap appendix attempted.
> 3 fully complete. Prompt eval still running (finishes ~7am).

---

## 1. Voice Fidelity Dashboard ✅ COMPLETE

**Script:** `scripts/voice-fidelity-score.mjs`
**Output:** `.claude/voice-fidelity-dashboard-2026-05-26.md` + `.claude/voice-fidelity-raw-2026-05-26.json`
**Scope:** All workspaces, all time, 11 content items scored against clinician voice phrase corpuses

### What it found

**Global average: 7.27 / 10** — "acceptable" across the board, but room to move.

| Type | Score | Verdict |
|---|---|---|
| Blog | 7.52 | ✓ Strongest format |
| LinkedIn | 7.30 | → Acceptable |
| Facebook | 7.30 | → Acceptable |
| Instagram | 7.20 | → Acceptable |
| **GBP** | **6.00** | **⚠️ Needs attention** |

GBP is the weakest format — and it's the most local, so it costs the most when it sounds generic.

### The red flag pattern (Dr. Q specifically)

The LLM evaluator flagged the same issue across 5 of 9 Dr. Q items: **missing the mechanistic "how" explanations** that define his authentic voice. Specific phrases the model knows he uses but didn't find in the content:

- `"The question is *how*"`
- `"stress accumulates faster than your body can keep up with"`
- `"that's the tricky part" / "that's also why"` (connective rhythm)
- The stabilization strategy / passive tissue compression framing

These phrases are in his voice corpus (128 phrases) but aren't getting surfaced in the prompts reliably. This is a prompt-tuning opportunity — the phrase injection block might need to weight his diagnostic-frame phrases more heavily.

### Truncation problem (separate from prompt quality)

3 of 11 items were truncated mid-sentence in the `content` column (the content cut off before finishing). The evaluator marked them down for this. Worth checking if those are generation truncation artifacts (maxOutputTokens too low during creation) or a storage issue.

### Per-clinician

| Clinician | Score | Phrases | Note |
|---|---|---|---|
| Dr. Cullen | 7.60 | 53 | Fewer phrases, higher score — may have more distinctive phrase signal |
| Dr. Whitney Phillips | 7.60 | 37 | Equine content scores well; truncation flag |
| Dr. Q | 7.20 | 128 | Most content, lowest relative score — mechanistic depth is the gap |

**Counter-intuitive:** Dr. Q has the largest phrase library but scores lowest. More phrases ≠ more fidelity if the prompts aren't injecting the right ones.

---

## 2. Chaos Onboarding Harness ✅ COMPLETE

**Script:** `scripts/synthetic-onboarding-harness.mjs`
**Output:** `.claude/chaos-onboarding-report-2026-05-26.md`
**Scope:** 53 synthetic tenant profiles validated against real claim.js logic + real Supabase state

### Gate works correctly

**44/53 pass. All 9 failures are intentional bad inputs** (malformed slugs, empty display_name, no outputs selected). The validation logic is correct — bad slugs get rejected, reserved words get rejected, missing required fields get rejected.

**Current capacity:** 2/10 external workspaces filled. 8 spots for first chiro friends. ✅

### The big discovery: `instagram` is silently dropped

This is a real UX bug, not a test artifact:

> **30 out of 53 profiles** requested `instagram` as a channel and got it silently dropped — because the correct registered key is `instagram_post`, not `instagram`.

If a prospective tenant fills out the wizard and checks "Instagram," and the wizard sends the key `instagram`, the `pickEnabledOutputs()` function will silently discard it and they'll onboard without Instagram enabled. They'll notice it's missing only after they're inside the app trying to generate Instagram content.

**Fix needed:** Audit the onboarding wizard's channel-ID payload against `OUTPUT_CHANNELS` in `src/lib/outputChannels.js`. Every channel checkbox needs to submit the exact registered key (`instagram_post`, `instagram_reel`, etc.), not a human-readable alias.

### Other P1 patterns

- **Veterinary tenants** (4 tested): system would onboard them in `clinical` prompt mode, which assumes human patients. Need a `prompt_mode='general'` flag on vet workspaces. Currently manual — wizard doesn't ask for this.
- **Mental health tenants** (2 tested): patient-facing AI content principle applies. No automated gate for this — manual check required at onboarding.
- **Multi-location tenants** (3 tested): 6-location workspace inserts correctly, no problems.
- **International** (Toronto, London): slug + location validation works fine — no US-specific assumptions.

---

## 3. Competitor Content Audit ✅ COMPLETE

**Agent:** Background competitive research agent (115k tokens, 107 tool calls, ~13 min)
**Output:** `.claude/competitor-content-audit-2026-05-25.md` (471 lines)
**Scope:** 22 clinic websites — 10 agency-served, 10 independent strong-content, 2 reference

### The most important finding: the winning quadrant is empty

There is a 2×2 matrix here:

|  | Low cadence | High cadence |
|---|---|---|
| **High voice quality** | 4 independents (Dr. Pond, Dr. Ferguson, etc.) — publish 1-12x/year | **EMPTY** |
| **Low voice quality** | Most agency-served sites | Camarata, Premier Care Portland (5-40+ posts/mo) |

**NarrateRx's pitch lives in the empty quadrant.** Nobody is doing consistent, distinctly-voiced content at volume. The agencies can do volume; the independents who care can do voice. No one has both.

### Why agency content fails

Every agency-served site reviewed (Perfect Patients, Hibu, Grow Gonstead, ChiroPlanet, Real FiG) produces:
- Grammatically correct, SEO-optimized copy
- Zero practitioner identity — the clinician's name doesn't appear in their own blog posts
- Find-and-replace city/condition templating across hundreds of clients
- Content the clinician themselves would have trouble identifying as theirs

Dr. Lincoln Kamell's CCSP credentials: **nowhere in his blog.** Dr. Arturo Espinoza: **not bylined on a single post.** The clinician is absent from their own marketing.

### The CTA gap (low-hanging differentiator)

**Not one site in the sample** connected the blog topic to the appointment CTA. Every post ends with the same "Book now" button regardless of whether the post was about postpartum back pain, Medicare reform, or pickleball injuries.

NarrateRx-generated content has a structural advantage here — it comes from the clinician's clinical reasoning about a specific patient type, so the CTA can be tailored to exactly that population. This is a prompt feature worth making explicit.

### The pitch that lands

> "Content that sounds like you, because it starts with you talking."

The contrast isn't AI vs. human-written. It's **voice-sourced** (starts with the clinician speaking) vs. **ghost-written** (starts with an agency template). Every alternative requires the clinician to either surrender their voice or spend time writing. NarrateRx is the only path that preserves both fidelity and clinician time.

Full audit with per-site scoring at `.claude/competitor-content-audit-2026-05-25.md`.

---

## 4. Prompt Eval Harness 🔄 STILL RUNNING (~7am finish)

**Script:** `scripts/prompt-eval-harness.mjs` (PID 34874)
**Output (when done):** `.claude/prompt-eval-results-2026-05-26.md`
**Scope:** 39 variants across 3 Move Better People interviews

### What it's testing

5 variable groups, each with 2-4 options:
- **Tone sweep**: Smart / Active / Clinical / Warm
- **Voice phrases on vs. off**: Does the phrase injection move the score?
- **Length preset**: Tight / Standard / Expansive
- **Voice mode**: Practice (we/our clinic) vs. Personal (I/me)
- **Voice notes on vs. off**: Do the learned edit-pattern notes add signal?

### Known issue: eval JSON truncation

The eval model (Haiku 4.5) is hitting the 300-token `maxOutputTokens` cap partway through the JSON response — truncating before `cta_naturalness`. When the parse fails, the variant gets `overallScore: null`. This reduces data coverage in the final report but doesn't corrupt results that do parse.

**Fix for next run:** In `prompt-eval-harness.mjs` line 280, change `maxOutputTokens: 300` → `maxOutputTokens: 500`. The eval JSON has 7 fields + a notes string and often comes back in a markdown code block — 300 tokens is borderline.

---

## Action Items (Morning)

### Fix now (pre-first-tenant)
1. **`instagram` channel ID bug** — audit wizard channel payload against `OUTPUT_CHANNELS` enum. Likely a one-liner fix in the onboarding wizard's channel checkbox values. This blocks clean onboarding.

### Prompt tuning (this week)
2. **GBP prompt needs work** — 6.0/10 is the weakest format. The GBP prompt may not be including enough voice phrase signal. Check `getGbpSystemPrompt()` (or equivalent) for phrase injection.
3. **Dr. Q's mechanistic-frame phrases** — consider adding a `[SIGNATURE PHRASES — inject verbatim when relevant]` subsection to the phrase block for phrases with weight > 0.8, so the model doesn't just skim them as examples.

### Nice to have
4. **Re-run voice fidelity with `--since` after any prompt changes** — baseline is now set (7.27/10). Any prompt tuning can be measured against it.
5. **Re-run chaos harness after fixing the instagram channel ID** — verify 44→45+ profiles now pass.

### When prompt eval finishes
6. **Read `.claude/prompt-eval-results-2026-05-26.md`** — the winner in each group will tell us which tone/voice-mode/length defaults to set in `src/lib/prompts.js`.

---

## Files Written Overnight

| File | Location |
|---|---|
| Strategic pass (v2) | `.claude/strategic-pass-2026-05-25.md` |
| Roadmap (token-amnesty appendix) | `.claude/development-roadmap-phase-5.md` |
| Competitor content audit | `.claude/competitor-content-audit-2026-05-25.md` |
| Voice fidelity dashboard | `overnight-experiments/.claude/voice-fidelity-dashboard-2026-05-26.md` |
| Voice fidelity raw JSON | `overnight-experiments/.claude/voice-fidelity-raw-2026-05-26.json` |
| Chaos onboarding report | `overnight-experiments/.claude/chaos-onboarding-report-2026-05-26.md` |
| Prompt eval results (when done) | `overnight-experiments/.claude/prompt-eval-results-2026-05-26.md` |

All scripts committed to branch `overnight-experiments` → PR at:
https://github.com/Move-Better/NarrateRx/pull/new/overnight-experiments

_Prompt eval PID 34874 still running — check `/tmp/prompt-eval.log` for status._

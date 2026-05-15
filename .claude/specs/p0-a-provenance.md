# P0-A Substrate Design — Content Provenance

**Status:** Design doc, pending sign-off. No code lands until approved.
**Authored:** 2026-05-15 (PR1 of the voice-fidelity wedge, ultrathink checkpoint #1)
**Reference:** [`~/.claude/plans/ui-review-visual-warm-lamport.md`](../../../.claude/plans/ui-review-visual-warm-lamport.md) (P0-A), [`~/.claude/plans/ui-review-mockups.html`](../../../.claude/plans/ui-review-mockups.html) (sections 1–2, 3)

---

## What this design covers

Every generated content piece (blog, IG, FB, LI, GBP, email, etc.) is currently a black box: we know which interview produced it, but we don't know **which words in the transcript produced which sentences in the output**. The voice-fidelity POV says that's the missing primitive — every generated sentence should trace back to its source.

This design defines how that mapping gets created, stored, validated, and surfaced.

## The architectural insight (the reason for the ultrathink checkpoint)

Don't think of provenance as a feature for P0-A. Think of it as the **voice-fidelity substrate** that powers three findings on one storage shape:

| Finding | Reads | Substrate column |
|---|---|---|
| **P0-A** transcript ↔ asset highlighting on Story Detail | per-paragraph block + source span | `provenance.blocks[]` |
| **P0-C** voice-drift scorecard in ApprovalPanel | aggregate verbatim/paraphrase/synthesis percentages | `provenance.summary` |
| **P0-G** Themes verbatim contrasting quotes | spans with high pickup across content_items on the same topic | `provenance.blocks[]` cross-row query via GIN |

**One substrate, three surfaces, plus a feeder for Phase 4-C voice-loop training data.** This is why P0-A.1 is the ultrathink call — getting the shape wrong cascades into three downstream PRs.

## How provenance gets created — hybrid (model emission + algorithmic fallback)

I considered five approaches; this is the recommendation and the alternatives are at the bottom.

```
                ┌─────────────────────────┐
  Generation ──▶│  Stream content + tail  │──▶ User sees content
   request     │  <PROVENANCE> block      │
                └────────────┬────────────┘
                             │
                ┌────────────▼─────────────┐
                │  Detect & buffer trailer │
                └────────────┬─────────────┘
                             │
                ┌────────────▼─────────────┐         ┌──────────────────────┐
                │  Parse + validate JSON   │── fail ▶│ Algorithmic matcher  │
                └────────────┬─────────────┘         │ (similarity diff)    │
                             │ pass                  └──────────┬───────────┘
                             ▼                                  │
                ┌──────────────────────────┐                    │
                │ Store on content_items   │◀───────────────────┘
                │ .provenance (JSONB)      │
                └──────────────────────────┘
```

**Walking the path:**

1. After the existing content body, the system prompt instructs Claude to emit a single `<PROVENANCE>...</PROVENANCE>` JSON block.
2. The streaming layer detects the opening tag, stops forwarding tokens to the visible content area, and buffers the trailer for parse.
3. We validate the parsed JSON against the actual content body (every claimed block must match a real paragraph; every source message index must exist in the transcript).
4. **Validation passes** → store with `source: "model_emit_validated"`.
5. **Validation fails OR no `<PROVENANCE>` tag emitted** → run algorithmic similarity matching (the same engine used by P0-A.2 voice-drift compute) → store with `source: "algorithmic_fallback"`.

The feature works whether or not the model is reliable. The fallback is the safety net.

## Storage shape — JSONB on `content_items.provenance`

```json
{
  "version": 1,
  "granularity": "paragraph",
  "blocks": [
    {
      "ordinal": 0,
      "text_prefix": "Most returning runners struggle when…",
      "source_type": "close_paraphrase",
      "source_msg_index": 3,
      "source_span": [44, 187],
      "confidence": 0.84
    },
    {
      "ordinal": 1,
      "text_prefix": "A thirty-second barefoot walking assessment…",
      "source_type": "verbatim",
      "source_msg_index": 3,
      "source_span": [220, 296],
      "confidence": 0.97
    },
    {
      "ordinal": 2,
      "text_prefix": "Patients often expect a rigid timeline…",
      "source_type": "synthesis",
      "source_msg_index": null,
      "source_span": null,
      "confidence": null
    }
  ],
  "summary": {
    "verbatim_pct": 12,
    "paraphrase_pct": 28,
    "synthesis_pct": 60,
    "computed_at": "2026-05-15T18:24:00Z",
    "source": "model_emit_validated"
  }
}
```

**Why JSONB on the row, not a separate table:**

| Pros (JSONB on `content_items`) | Cons (separate provenance table) |
|---|---|
| Tightly coupled to one content_item — never queried independently | Adds JOIN to every Story Detail render |
| Read pattern is "load content_item + show provenance" — zero JOINs | Extra GRANT, extra migration overhead |
| v0 → v1 schema evolution (paragraph → sentence) is data-shape only, no migration | Separate table doesn't help the read pattern |
| GIN-indexable for reverse queries (P0-G) — Supabase supports this fully | Marginal write-path simplification, not worth it |

Reverse-direction query ("which content_items quote span X of interview I?") is supported via:

```sql
SELECT * FROM content_items
WHERE provenance @> '{"blocks":[{"source_msg_index": 3}]}'
  AND interview_id = $1;
```

GIN index handles this efficiently. If the access pattern eventually demands sharper queries, we lift `blocks` into rows in a follow-up — the shape stays compatible.

## Migration

`supabase/multitenant/migrations/043_content_item_provenance.sql`:

```sql
ALTER TABLE public.content_items
  ADD COLUMN IF NOT EXISTS provenance jsonb;

CREATE INDEX IF NOT EXISTS content_items_provenance_gin
  ON public.content_items USING gin (provenance);

-- service_role already has rights on content_items from earlier migrations,
-- but re-granting per CLAUDE.md rule that migrations be self-sufficient
GRANT SELECT, UPDATE ON public.content_items TO service_role;
```

Last migration on prod is `042_clinician_voice_phrases.sql` — this slots in as 043. Applies via `node scripts/apply-multitenant-migrations.mjs supabase/multitenant/migrations/043_content_item_provenance.sql`.

## Prompt-side change

Add ~80 tokens to the system prompt for generation (modifies `getBlogPostSystemPrompt` and `getMinimalEditSystemPrompt` in [`src/lib/prompts.js`](../../src/lib/prompts.js)). The atom-generation prompts in the Words pipeline get the same instruction injected.

Appended to the existing system prompt:

```
After the content body, emit a single JSON block in this exact shape:

<PROVENANCE>
{"blocks":[{"text_prefix":"First 80 chars of paragraph...","msg":3,"type":"paraphrase","span":[44,187]}]}
</PROVENANCE>

For each paragraph in the content body, identify:
- text_prefix: first 80 characters of the paragraph (used to match later)
- msg: index of the user message inspiring it (0-indexed), or null if synthesis
- type: "verbatim" if quoted exactly | "paraphrase" if reworded | "synthesis" if drawn from workspace context, exemplars, or your own knowledge
- span: [start, end] character offsets in that user message; omit when type is "synthesis"

Emit ONLY the JSON block, no markdown fence, no commentary. Do not include the <PROVENANCE> markers in the content body above.
```

**Token cost:** ~80 tokens in (prompt addition) + ~150 tokens out (JSON trailer per generation). On a 50k-token blog generation: 0.5% overhead. Negligible.

## Streaming layer change

Today's [`src/lib/claude.js`](../../src/lib/claude.js) `streamMessage` forwards every token to the consumer. We need to teach the consumer (in `InterviewSession.jsx` blog generation handler + the Words atom-generation handlers) to:

1. Watch for `<PROVENANCE>` substring in the accumulating stream
2. When detected: split the buffer there, freeze the visible content at that point, start a side-buffer for the trailer
3. On stream end: parse the side-buffer, validate, persist provenance via a new endpoint (or via the existing content_items PATCH path)

If `<PROVENANCE>` is never detected (model didn't emit), we kick off algorithmic fallback as a fire-and-forget post-stream job — the user sees the content immediately, provenance lands a second or two later.

## Validation rules

Each `block` in emitted JSON must satisfy:

1. `text_prefix` fuzzy-matches the first 80 chars of paragraph N in the content body (Levenshtein distance ≤ 5)
2. `msg` is a valid index into the transcript's user messages, OR null
3. If `span` is provided, both bounds fall within the bounds of that user message's text length
4. `type` ∈ `{"verbatim", "paraphrase", "synthesis"}`
5. The full set of blocks covers every paragraph in the content body (no orphan paragraphs)

**Failure mode:** if ANY block fails validation, discard the entire emitted JSON and fall back to algorithmic compute for the whole content piece. We do NOT try to selectively trust some blocks — that's how silent corruption gets in.

Validation lives in `api/_lib/provenanceValidator.js` — testable in isolation, no DB dependency.

## Algorithmic fallback

Shared with P0-A.2 (verbatim-density compute lib) — same engine, exposed through two functions:

- `computeProvenance(content, transcript)` — produces the full provenance object including blocks and summary
- `classifyParagraph(paragraph, transcript)` — produces one block

Algorithm shape:

```
for each paragraph P in content_body:
  for each user_message M in transcript:
    diff = wordDiff(P, M.text)
    score = 1 - (diff.length / max(P.length, M.text.length))
    track best (M, score, matchedSpan)
  if best.score >= 0.8: type = "verbatim", confidence = best.score
  elif best.score >= 0.45: type = "close_paraphrase", confidence = best.score
  else: type = "synthesis", confidence = null
```

Thresholds (0.8 / 0.45) are placeholders — P0-A.2 (next ultrathink checkpoint) tunes them against real data.

## Backfill

For the ~900 existing content_items: one-time idempotent script.

`scripts/backfill-provenance.mjs`:
- Loads content_items where `provenance IS NULL`
- For each: fetch the originating interview's user messages
- Run algorithmic compute (no model call)
- PATCH content_items row with computed provenance, `source: "algorithmic_backfill"`

Runtime estimate: ~3 ms per item (in-memory diff), ~3 seconds total per 1000 items. Negligible.

## What ships in PR1 (after sign-off)

- `supabase/multitenant/migrations/043_content_item_provenance.sql`
- `src/lib/prompts.js` — `<PROVENANCE>` instruction appended to blog + minimal-edits + atom prompts
- `src/lib/claude.js` — streaming-layer tag detection + buffer split
- `api/_lib/provenanceValidator.js` — JSON schema + fuzzy-match validation
- `api/_lib/provenanceMatcher.js` — algorithmic fallback engine (the shared substrate for P0-A.2, P0-C, P0-G)
- `api/content-pieces/provenance.js` — POST endpoint to validate-and-store, called by streaming consumers post-completion
- `scripts/backfill-provenance.mjs` — one-time backfill
- Generation handlers in `src/pages/InterviewSession.jsx` + Words pipeline updated to call the validate-and-store endpoint after stream end

## What does NOT ship in PR1

- UI changes (no Story Detail highlighting, no ApprovalPanel scorecard, no Themes change) — those come in later PRs
- Sentence-level granularity (deferred to v1)
- Multi-source attribution (one source per block in v0)
- Concept-graph integration (waits for Phase 4-A maturity)
- Reverse-index queries in UI (the GIN index supports them; no UI yet)

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| Model emits `<PROVENANCE>` JSON unreliably | Algorithmic fallback is the safety net — feature works regardless. Telemetry on `source` distribution after first 50 generations tells us if model emission is worth keeping. |
| Validation thresholds wrong (too strict → fall back when we shouldn't; too lax → store garbage) | Validation lives in `provenanceValidator.js` as pure functions — testable in isolation. Calibrate over the first 50 real generations. |
| GIN index payload growth | ~1–3 KB JSONB per content_item × ~3000 expected long-term rows × 3 (GIN overhead) = ~25 MB max. Trivial. |
| Streaming tag detection misses edge cases (model emits markers inside content body, partial buffering at chunk boundaries) | Tag detection runs on the accumulated buffer, not per-chunk. Worst case: malformed model output → algorithmic fallback fires → feature still works. |
| Backfill load on prod DB | Script paginates 50 rows at a time, sleeps 100ms between batches. ~10 seconds total for 900 rows. Run off-hours just in case. |
| Token cost in generation prompt | ~0.5% overhead per generation. Confirmed negligible. |

## Verification (after PR1 lands)

1. **Migration applied to prod** — confirm column + GIN index exist via Supabase Studio:
   ```sql
   SELECT column_name, data_type FROM information_schema.columns
   WHERE table_name = 'content_items' AND column_name = 'provenance';
   ```
2. **Backfill ran** — check sample row distribution:
   ```sql
   SELECT provenance->'summary'->>'source' AS src, count(*)
   FROM content_items WHERE provenance IS NOT NULL GROUP BY 1;
   ```
   Expected: all rows show `algorithmic_backfill` immediately post-backfill.
3. **New generation produces provenance** — trigger a fresh blog generation, inspect the resulting row:
   ```sql
   SELECT id, provenance->'summary' FROM content_items
   ORDER BY created_at DESC LIMIT 1;
   ```
   Expected: `source: "model_emit_validated"` ideally; `algorithmic_fallback` acceptable.
4. **Model emission quality telemetry** — over first 50 fresh generations, target ≥70% `model_emit_validated`. If <50%, prompt needs revision (track in P0-A.2's PR).
5. **No UI regressions** — Story Detail and ApprovalPanel render identically (no UI consuming provenance yet).

## What I'm asking you to sign off on

Five decisions. Each is reversible at marginal cost but reversing later costs more than reversing now.

| # | Decision | Lock-in level |
|---|---|---|
| 1 | **Hybrid approach** (model emission + algorithmic fallback) over the four alternatives below | High — defines the whole pipeline shape |
| 2 | **JSONB on `content_items.provenance`** vs separate table | Medium — migratable but ~1 day of work |
| 3 | **One substrate for P0-A + P0-C + P0-G** (provenance + summary) | High — reverses each finding's design if changed |
| 4 | **v0 = paragraph-level** granularity; sentence-level deferred to v1 | Low — schema supports both via `granularity` field |
| 5 | **Algorithmic-only backfill** (no model calls during backfill) | Low — can re-run with model later if needed |

## Alternatives considered (why hybrid won)

| Approach | Mechanism | Why not |
|---|---|---|
| **1. In-line markers** | Model emits `[src:msg3:44-120]` inline in content | Pollutes content; brittle if model hallucinates IDs; ~10× more tokens than trailer |
| **2. Second-pass annotation** | Generate content, then second Claude call to annotate | Doubles latency (blog generation already 30s+); two failure modes |
| **3. Structured JSON output** | Whole content emitted as `{sentences:[...]}` | Disrupts streaming UX; model resists rigid JSON for long-form |
| **4. Pure algorithmic** | No model emission; similarity match everything | Discards model's intent; weaker signal for paraphrase vs synthesis |
| **5. Hybrid (recommended)** | Model emits trailer; algorithm catches misses | Best of both: low latency, graceful degradation, shared substrate |

## Open questions for you

These don't block sign-off but I want your read before I code them up:

1. **Verbatim-vs-paraphrase threshold (0.8 / 0.45 placeholders).** Should we be aggressive about claiming "verbatim" (more orange-bar in the scorecard but occasional misclassification) or conservative (less orange, more "synthesis" fallback)? Default: aggressive. I'll calibrate against your top 20 published pieces in PR4.
2. **What counts as the "source" for verbatim_flags?** The interview's `verbatim_flags` array already tracks user-flagged quotes. Should a content block matching a verbatim_flag get `source_type: "verbatim_flagged"` (a richer fourth category) or stay `verbatim`? Default: stay `verbatim` — we surface "verbatim_flag matched" in the UI via cross-reference, not via a new type.
3. **Atom-generation pipeline parity.** Words pipeline generates 12 platform atoms (IG, FB, LI, etc.) from one source. Do we want provenance per atom, or one provenance computed against the source blog post? Default: per atom — each atom is its own content_item so it gets its own provenance row.

---

**Ready for sign-off.** Once you green-light the five decisions, I'll write code (migration + prompt edit + streaming layer + validator + matcher + endpoint + backfill script) in a single PR. No further checkpoints until PR4 (verbatim-density algorithm calibration).

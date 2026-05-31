# V6 — Practice Memory RAG Layer Feeding Clip-Pull AI

_Architecture sketch, 2026-05-27. Status: design draft, not yet greenlit. Build target: ~3 days at observed video-build velocity. Reference: `.claude/development-roadmap-video-30day.md` V-series._

## Why V6 exists

Two retrieval pipelines exist today and don't talk to each other:

1. **Practice-memory RAG** (`api/_lib/practiceMemoryRag.js`, mig 073/074) — embeds interview summaries + approved content item paragraphs into `practice_memory_chunks`. Retrieved at generation time by topic, fed into prompts as "YOUR PRIOR THINKING."
2. **Visual-memory RAG** (`api/_lib/clipSearch.js`, mig 085/087) — embeds clip auto-tags + visual narratives into `visual_memory_chunks`. Retrieved by topic in `generate-package.js` to pick best-matching clip.

**The gap:** both embed *the bare topic string*. Neither uses the clinician's prior framing of the topic to shape the query. When Dr. Q says "postpartum back pain," he means something specific — load-management failure, stabilization strategy, passive tissue compression. The current pipeline retrieves clips by literal-topic match, not by that framing.

V6 closes the gap by making **clip retrieval framing-aware**: the clinician's prior thinking on a topic shapes the visual query before it hits visual memory.

## What's already shipped (do not rebuild)

| Component | Where | What it does |
|---|---|---|
| pgvector extension | mig 073 | Installed; cosine ops available |
| `practice_memory_chunks` table | mig 073 | Text embeddings of interview summaries + content paragraphs |
| `match_practice_memory_chunks` RPC | mig 074 | Cosine search wrapper |
| `practiceMemoryRag.js` indexer | `api/_lib/` | Chunks + embeds + upserts on content writes |
| `searchPracticeMemory()` | `api/_lib/practiceMemoryRag.js` | Topic → text chunk retrieval |
| `visual_memory_chunks` table | mig 085 | Visual embeddings + auto-tags + quality + story_role |
| `match_visual_memory_chunks` RPC | mig 087 | Cosine search joined to `media_assets` |
| `searchClips()` | `api/_lib/clipSearch.js` | Topic → clip retrieval (currently shallow) |
| `embeddings.js` shared wrapper | `api/_lib/` | text-embedding-3-small, 1536d, batched, retry-safe |
| Story package generator | `api/editorial/generate-package.js` | Calls `searchClips()` already; pipeline ready for upgrade |
| Hot-tier injection | `src/lib/practiceMemory.js` + server `api/_lib/practiceMemory.js` | Recent interviews → prompt block |

The infrastructure is solid. V6 is the **fusion layer** + **prompt-side replacement** of the hot tier with proper RAG.

## V6 thesis — what gets sharper

Three concrete behaviors change:

1. **Framing-aware clip search.** Before embedding the topic for visual lookup, expand it with the clinician's prior framing of that topic via `searchPracticeMemory()`. The clinician's last 6 chunks on "postpartum back pain" rewrite the visual query, so we retrieve clips that fit *their* mental model, not the generic topic.
2. **Cross-modal coherence per story package.** A story package has one topic and many atoms (caption, thumbnail title, per-channel renders). All currently do independent retrievals. V6 retrieves *once* per package, caches the practice-memory + visual-memory context, and shares it across all atoms. Same brain, all atoms.
3. **Hot tier replaced with topic-scoped RAG in every generation prompt.** `buildOwnHistoryBlock()` currently injects the latest N interviews regardless of relevance. V6 calls `searchPracticeMemory()` scoped to the topic at hand. Smaller prompts, sharper relevance, lower token cost.

## Schema deltas (additive only)

No destructive changes. Two new migrations:

```sql
-- 090_story_package_context.sql
-- Cache the RAG context for a story package so atoms share it.
ALTER TABLE public.story_packages
  ADD COLUMN IF NOT EXISTS rag_context jsonb;
    -- { practice_chunks: [{chunk_id, score, text_preview}, ...],
    --   visual_chunks:   [{chunk_id, score, asset_id}, ...],
    --   query_expansion: 'text used to embed visual search',
    --   retrieved_at:    iso8601 }
GRANT SELECT, INSERT, UPDATE, DELETE ON public.story_packages TO service_role;
```

```sql
-- 091_practice_memory_chunks_topic_tag.sql
-- Optional: add a 'topic_tags' jsonb so we can pre-filter chunks by topic
-- before vector search (huge speedup on big corpora). Backfill via async job.
ALTER TABLE public.practice_memory_chunks
  ADD COLUMN IF NOT EXISTS topic_tags jsonb DEFAULT '[]'::jsonb;
CREATE INDEX IF NOT EXISTS practice_memory_chunks_topic_tags_gin
  ON public.practice_memory_chunks USING gin (topic_tags);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.practice_memory_chunks TO service_role;
```

That's it. No new tables. The fusion happens in code, not schema.

## Module deltas

### New: `api/_lib/ragFusion.js`

The fusion entry point. One function the rest of the codebase calls.

```js
// Fetch fused RAG context for a topic + clinician scope.
// Used by both clip search (visual) and generation (text).
//
// Returns:
//   {
//     practiceChunks: [{ chunkId, score, text, sourceType, sourceId, ... }],
//     visualChunks:   [{ chunkId, score, assetId, blobUrl, kind, ... }],
//     queryExpansion: string,   // rewritten visual query, derived from practiceChunks
//     timing: { practiceMs, expansionMs, visualMs, totalMs }
//   }
//
// Idempotent within a request. Caller is responsible for caching across
// requests (we cache on story_packages.rag_context).
export async function fetchFusedRagContext({
  topic,
  workspaceId,
  clinicianId = null,
  practiceK = 6,
  visualK = 8,
  visualKind = null,    // 'photo' | 'video' | null
  minPracticeScore = 0.5,
  minVisualScore = 0.5,
}) { /* ... */ }
```

Implementation order inside `fetchFusedRagContext`:

1. **practiceChunks ← searchPracticeMemory(topic, workspaceId, clinicianId)** — gets the clinician's prior thinking.
2. **queryExpansion ← composeVisualQuery(topic, practiceChunks)** — small Haiku call (≤200 tokens), rewrites the visual query using practiceChunk text. Cached in `rag_context.query_expansion`.
3. **visualChunks ← searchClips({ query: queryExpansion, ... })** — uses the *expanded* query for visual retrieval.
4. Return all of it, with timing.

### Updated: `api/_lib/clipSearch.js`

Add an optional `queryEmbedding` param to `searchClips()` so callers can pass a pre-computed embedding (avoids re-embedding when fusion already has it). Existing callers untouched.

### Updated: `api/editorial/generate-package.js`

Replace the bare `searchClips({ query: topic, ... })` call with `fetchFusedRagContext({ topic, ... })`. Persist `rag_context` on the package row at insert time. Caption generation now receives both the clip context AND the practice-chunk text, so the caption can echo the clinician's actual framing.

### Updated: every generation handler that uses `buildOwnHistoryBlock`

Today: `buildOwnHistoryBlock(interviews)` injects the latest N interview summaries indiscriminately.

V6: `buildTopicScopedHistoryBlock(topic, workspaceId, clinicianId)` calls `searchPracticeMemory()` and formats the top-K chunks as the YOUR PRIOR THINKING block. Shorter, sharper, topic-scoped.

Behind a flag: `workspaces.rag_hot_tier_enabled` (default false → on for Move Better Day 1 → on for all after one week of clean Move Better runs).

### Updated: `api/_lib/practiceMemoryRag.js`

Add `topic_tags` extraction at chunk time — a small Haiku call extracts 2–4 topic tags per chunk during indexing. Populated on new content automatically; backfill script for the existing corpus runs once.

## Retrieval flow (story package, V6 wired)

```
                ┌──────────────────────────────────────────────┐
                │ POST /api/editorial/generate-package         │
                │ body: { topic, clinicianId, kind, ... }      │
                └──────────────────────────────────────────────┘
                                    │
                                    ▼
              ┌─────────────────────────────────────────┐
              │ fetchFusedRagContext(topic, ...)        │
              └─────────────────────────────────────────┘
                                    │
              ┌────────────────────┼────────────────────┐
              ▼                    ▼                    ▼
   ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
   │ searchPractice   │  │ composeVisualQuery│  │ searchClips      │
   │ Memory(topic)    │→ │  (Haiku, ~150t)   │→ │ (expanded query) │
   │ → practiceChunks │  │ → queryExpansion  │  │ → visualChunks   │
   └──────────────────┘  └──────────────────┘  └──────────────────┘
                                    │
                                    ▼
                      ┌─────────────────────────┐
                      │ Persist rag_context     │
                      │  on story_packages      │
                      └─────────────────────────┘
                                    │
              ┌────────────────────┼────────────────────┐
              ▼                    ▼                    ▼
   ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
   │ generateCaption  │  │ pickClip(visual  │  │ generateThumbnail│
   │ (uses practice + │  │  Chunks)          │  │ Title (uses      │
   │  visual context) │  │                   │  │  practice + clip)│
   └──────────────────┘  └──────────────────┘  └──────────────────┘
                                    │
                                    ▼
                          ┌──────────────────┐
                          │ Render per chan  │
                          └──────────────────┘
```

## Eval methodology

V6 isn't worth shipping if it doesn't measurably move output quality. Three measurements:

1. **Clip relevance@1** — for 50 held-out topics from real Move Better interviews, blind-pick: does the V6 top-1 clip beat the pre-V6 top-1 clip? Target: ≥60% V6 wins.
2. **Caption voice fidelity** — V1's CI gate already scores caption text against the voice corpus. Run V6 captions through it. Target: ≥0.5 point uplift over pre-V6 baseline (currently 7.27 global avg).
3. **Token budget** — average prompt tokens per generation (across all generation handlers). Target: ≥20% reduction by replacing hot-tier indiscriminate injection with topic-scoped retrieval.

All three measured by a `scripts/eval-v6.mjs` runner that exists from Day 1 of the V6 build. Numbers ship in the PR description.

## Rollout

Behind two flags, both default false:

- `workspaces.rag_fusion_enabled` — turns on `fetchFusedRagContext()` in `generate-package.js`
- `workspaces.rag_hot_tier_enabled` — turns on topic-scoped retrieval in generation prompts

Flag lifecycle:
- **Day 1**: Move Better People only, both flags on. Smoke for 24h.
- **Day 2**: Equine + Animals on if eval looks clean.
- **Day 3**: Default-true in `/api/onboarding/claim`, existing tenants migrated via one-shot SQL.
- **Day 4–7**: Watch voice-fidelity dashboard for regressions. If any clinician's score drops >0.5 points, flag back to off for them and re-tune.

## Cost shape

- **Embedding cost**: new content already embeds on write (existing path). V6 adds: 1 query embed per generation (was already happening for `searchClips`), 1 Haiku call (~200 tokens) per generation for query expansion. **Net delta: ~$0.0001/generation.** Negligible.
- **Storage**: `rag_context` jsonb on `story_packages` ~5KB/row. 1k packages = 5MB. Negligible.
- **Latency**: +1 Haiku roundtrip (~600ms) per package generation. Acceptable for an async pipeline; not in any critical user-facing path.

## Decisions (locked 2026-05-27)

The five open questions from the original sketch were answered by Q. V6 builds against these.

1. **Query expansion: Haiku rewrite.** A small Haiku call rewrites the topic + practiceChunk text into a sharper visual query string. ~600ms + ~$0.0001 per generation. Catches framing nuance that bare concatenation misses. Adds a model dep on the critical path — acceptable; the path is already async.
2. **Topic tag extraction: index time.** Haiku extracts 2-4 topic tags per chunk during indexing (one call per chunk write). Stored in `practice_memory_chunks.topic_tags` with a GIN index for pre-filtering. Locks the taxonomy at index time; a re-tag pass becomes a one-shot backfill if the taxonomy evolves.
3. **`rag_context` persistence: persist + refresh button.** Cache `rag_context` on the package row at first generation. All atoms read from the same context. Slate UI shows a "refresh context" button — surfaces explicit control over when context changes. Refresh button copy: "Re-read prior thinking" (matches existing Slate verbiage).
4. **Multi-clinician topic blending: blend top-3 from each clinician.** When the story package's clinician scope spans multiple clinicians (joint piece), retrieve top-3 practiceChunks per clinician on the topic, merge into one expansion. Fair, balanced — joint pieces sound like the actual collaboration. If signature framings clash, the Haiku rewrite step resolves the blend.
5. **Visual-only topic fallback: graceful degrade to bare `searchClips()`.** When there's no practice-memory content (brand-new topic, non-clinical workspace, or `topic_tags` GIN pre-filter returns zero), `fetchFusedRagContext()` falls back to today's behavior. The `query_expansion` field is set to the original topic, and the package row's `rag_context.fallback_reason` is logged so we can measure how often this path fires.

## Implications of the locked decisions

A few things the decisions tighten that weren't fully spec'd in the original sketch:

- **`composeVisualQuery()` Haiku call must be cached.** Same (topic, clinicianId, top-N practiceChunk IDs) → same expansion. Memoize in-process; persist on `rag_context.query_expansion` so subsequent atoms reuse it without re-calling Haiku.
- **`practice_memory_chunks.topic_tags` backfill is mandatory before flag flip.** `scripts/backfill-topic-tags.mjs` Haiku-tags every existing chunk in batches of 50. Move Better People has ~400 chunks today; ~$2 of Haiku spend total. Runs once, then incremental on every new chunk write via `practiceMemoryRag.js`.
- **The "Re-read prior thinking" button is its own small surface.** Posts to `POST /api/editorial/refresh-context` (new handler) with `{ package_id }`, returns the updated `rag_context`. Story Director Slate's package detail drawer renders a timestamped "Context as of YYYY-MM-DD" line with the button.
- **Multi-clinician blending changes the function signature.** `fetchFusedRagContext({ clinicianIds: [] })` accepts an array, not a single id. Single-clinician callers pass `[clinicianId]` for backward compat. The retrieval logic does `Promise.all` over `searchPracticeMemory` calls per clinician, then merges + dedupes before query expansion.
- **The fallback path needs a metric.** `rag_context.fallback_reason` is one of: `'no_practice_chunks'`, `'topic_tags_miss'`, `'embedding_error'`, `null`. Weekly dashboard checks the % of packages on the fallback path. If it spikes above 20%, the indexing pipeline has a gap.

## What V6 deliberately doesn't do

- **No hybrid (vector + BM25) retrieval.** pgvector cosine is enough at this corpus size (<100k chunks per workspace for the foreseeable). Revisit if recall@K plateaus.
- **No reranking model.** Haiku query expansion is cheaper than a cross-encoder rerank, and gets most of the gain.
- **No cross-tenant retrieval.** That's V9 (Shape C probe) territory. Strict workspace_id filter on every query.
- **No fine-tuned embeddings.** text-embedding-3-small is fine; the lift from fine-tuning would be marginal at our scale.
- **No always-on background re-indexing.** Indexing happens on write (already does). One backfill script for the existing corpus. After that, incremental.

## Build sequence (3 days at observed velocity)

| Day | What |
|---|---|
| 1 | Migrations 090 + 091. `ragFusion.js` skeleton + `fetchFusedRagContext()`. `composeVisualQuery()` Haiku call. `topic_tags` extraction at index time. Backfill script. |
| 2 | Wire `fetchFusedRagContext` into `generate-package.js`. Persist `rag_context`. Update `generateCaption` to use fused context. Update other atom generators (thumbnail title, channel-specific rewrites) to share the context. |
| 3 | Replace `buildOwnHistoryBlock` with `buildTopicScopedHistoryBlock` in every generation handler behind the second flag. Run `scripts/eval-v6.mjs` against the 50 held-out topics. Roll Move Better on. |

## Dependencies on V1

V1 (caption voice-fidelity CI gate) needs to ship first because:
- V6's caption changes will move the fidelity score; we need the gate to detect regressions
- The eval methodology above uses V1's scoring infrastructure

So sequence stays: V1 → V6.

## Memory references

- `[[project_practice_memory_shipped]]` — hot-tier practice memory shipped 2026-05-24
- `[[feedback_ai_gateway_inline_data_cap]]` — keep embeds + caption Haiku calls under the inline-data cap
- CLAUDE.md → "Supabase migrations" — additive only, explicit grants in same file
- CLAUDE.md → "Multi-tenant SaaS" — every query filters by workspace_id

# Phase 2 — Editorial Brain (Architecture)

_Drafted 2026-05-27. Phase 2 of the 30-day video output build. Days 5–9 per `.claude/development-roadmap-video-30day.md`. Builds on Phase 1's `visual_memory_chunks` + `media_assets` infrastructure._

## Goal

Turn a topic / blog post / atom into a **story package**: cover image + per-channel video cuts + captions + brand-consistent treatment. Pull the right clips from Move Better's visual memory automatically. The clinician/Producer never opens a video editor; they just approve from a daily slate.

## Architecture (end-to-end)

```
                          ┌──────────────────────────────┐
                          │ Story trigger:               │
                          │  • New content_item created  │
                          │  • Manual: "Make a package"  │
                          │  • Cron: daily slate compose │
                          └──────────────┬───────────────┘
                                         │
                                         ▼
                          ┌──────────────────────────────┐
                          │ api/editorial/compose.js     │
                          │ Orchestrator                 │
                          └──────────────┬───────────────┘
                                         │
        ┌────────────────────┬───────────┴────────┬──────────────────────┐
        ▼                    ▼                    ▼                      ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐    ┌─────────────────┐
│ Clip-pull AI  │    │ Cover-image  │    │ Caption AI    │    │ Brand visual    │
│ (Day 6)       │    │  generator   │    │ (auto)        │    │  identity       │
│ Vector search │    │ (Day 7-8)    │    │ Whisper +     │    │ (Day 9)         │
│ on visual_    │    │ Ideogram/Flux│    │  voice clone  │    │ Palette, font   │
│ memory_chunks │    │ + brand id   │    │  styling      │    │ rules, motion   │
└───────┬───────┘    └───────┬──────┘    └───────┬───────┘    └────────┬────────┘
        │                    │                   │                     │
        └────────────────────┴───────┬───────────┴─────────────────────┘
                                     ▼
                          ┌──────────────────────────────┐
                          │ Render farm                  │
                          │ ffmpeg + Sharp + brand layer │
                          │ 6 output channels:           │
                          │  LinkedIn 1:1 • IG reel 9:16 │
                          │  TikTok 9:16 • FB feed       │
                          │  YouTube short • blog hero   │
                          └──────────────┬───────────────┘
                                         │
                                         ▼
                          ┌──────────────────────────────┐
                          │ story_packages table         │
                          │ (Phase 3 surfaces consume)   │
                          └──────────────────────────────┘
```

## Sub-features and days

### Day 5 — Vercel AI Gateway migration

Switch the model layer from direct Anthropic/OpenAI keys to plain `"provider/model"` strings via Vercel AI Gateway. Benefits: unified billing, multi-provider fallback, observability, zero data retention.

**Scope**: ALL new editorial AI calls in Phase 2 go through AI Gateway. Existing handlers stay on direct keys (don't refactor until forced).

**Implementation**:
- Add `AI_GATEWAY_API_KEY` to Vercel env if not already present (existing scripts use it — confirmed)
- New helper `api/_lib/aiGateway.js` wraps the AI SDK's `generateText`/`generateObject` with default model fallbacks
- New code reaches for `aiGateway.generate({ model: 'openai/gpt-4o', ... })`

**Note**: Existing `api/_lib/embeddings.js` calls OpenAI direct. Phase 2 keeps it that way — embeddings are stable, no need to route them through Gateway.

### Day 6 — Clip-pull AI

Given a topic / blog title / atom prompt, retrieve the top-K matching clips from `visual_memory_chunks`.

**API**: `api/editorial/pull-clips.js`
- Input: `{ workspaceId, query, k=8, kind?='video' | 'photo' | 'any' }`
- Steps:
  1. Embed the query with `text-embedding-3-small`
  2. SQL: `SELECT … FROM visual_memory_chunks ORDER BY embedding <=> query_vec LIMIT k` (cosine distance)
  3. Join to `media_assets` for blob URLs + kind + duration
  4. Filter by kind if specified
  5. Return ranked list with similarity score + provenance

**Performance**: pgvector `ivfflat` index from migration 085 keeps this <100ms for thousands of chunks.

**Re-ranking**: optional LLM re-ranker for the top 20 → top K. Use `openai/gpt-4o-mini` via Gateway. Adds ~$0.01/query but improves relevance materially. Configurable per workspace.

### Day 7 — Caption + per-channel render pipeline

For each clip, produce captioned + brand-styled output in 6 formats.

**Pipeline**:
1. **Transcribe** the audio using existing Whisper integration (audio extracted via ffmpeg)
2. **Refine captions** using clinician's voice clone style guide — fix obvious STT errors, format for sound-off scrolling
3. **Render** with ffmpeg:
   - Resize/crop to target aspect ratio
   - Burn in captions (or output as separate SRT, depending on channel)
   - Lower-third overlay: clinician name + credentials + brand color
   - Brand intro/outro (2s in, 1s out)
   - Output codec: H.264 for broad compat (channels handle their own re-encoding)
4. **Upload** rendered MP4 to Vercel Blob with deterministic path: `media/packages/<package_id>/<channel>.mp4`

**Channels and specs**:

| Channel | Aspect | Max length | Caption style | Output path |
|---|---|---|---|---|
| LinkedIn feed | 1:1 (1080×1080) | 60s | Burn-in, top-third | `linkedin.mp4` |
| Instagram reel | 9:16 (1080×1920) | 60s | Burn-in, bottom-third | `instagram_reel.mp4` |
| TikTok | 9:16 (1080×1920) | 90s | Burn-in, top-center | `tiktok.mp4` |
| Facebook feed | 4:5 (1080×1350) | 60s | Burn-in, bottom-third | `facebook.mp4` |
| YouTube Short | 9:16 (1080×1920) | 60s | SRT only | `youtube_short.mp4` |
| Blog hero | 16:9 (1920×1080) | 30s | None | `blog_hero.mp4` |

**Cost** (Vercel Functions Active CPU + Blob storage):
- Render: ~$0.02 per clip × 6 channels = $0.12 per package
- Storage: ~50MB × 6 = 300MB per package × $0.023/GB-month = $0.007/month
- Negligible at Move Better scale (5-10 packages/day)

### Day 8 — Story package generator

Ties it all together. Each "story" = a blog post / atom / topic. The package generator:
1. Reads the source content_item
2. Calls clip-pull AI for matching clips
3. Calls cover-image generator (Ideogram via Gateway) for a hero still
4. Composes the package: which clips go where, caption text, hero image
5. Triggers render farm via `waitUntil`
6. Inserts row into new `story_packages` table

**New table** (Phase 2 migration 087):
```sql
CREATE TABLE story_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  content_item_id uuid,  -- the source piece (nullable for ad-hoc packages)
  clinician_id uuid,
  status text NOT NULL DEFAULT 'composing',
    -- composing | rendering | ready | failed | published | archived
  confidence real,  -- 0-1 from clip-pull re-ranker
  cover_image_url text,
  channel_renders jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- { linkedin: { url, status, duration_s }, ... per channel }
  clip_provenance jsonb,
    -- [{ media_asset_id, similarity, used_for_channels: [] }, ...]
  caption_text text,
  brand_style_snapshot jsonb,  -- the brand visual identity at compose time
  approved_at timestamptz,
  approved_by uuid REFERENCES clinicians(id),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

### Day 9 — Brand visual identity extraction

One-time analysis of each workspace's existing media to learn its visual brand.

**Process**:
1. Sample 100 highest-engagement photos from media_assets
2. Extract palette (Sharp color analysis)
3. Identify font/text treatment in existing branded content
4. Detect composition tendencies (centered subjects? rule of thirds? top-down?)
5. Identify motion graphics patterns from existing video clips

**Output**: `workspaces.brand_visual_identity jsonb`:
```json
{
  "palette": { "primary": "#…", "secondary": "#…", "neutrals": [...] },
  "typography": { "title_font": "...", "body_font": "...", "case": "sentence|title|upper" },
  "composition": { "subject_position": "center|left|rule_of_thirds", "framing": "wide|medium|close" },
  "motion": { "intro_style": "fade|slide|none", "duration_s": 2 },
  "learned_at": "2026-05-XX",
  "samples_used": 100
}
```

**Render farm reads from this on every package generation** so output is brand-consistent without per-call prompting.

## Implementation order

I'll likely interleave Days 5–9 since dependencies aren't strictly linear:

| Day | Build target | Depends on |
|---|---|---|
| 5 | AI Gateway helper | (none) |
| 5–6 | Clip-pull AI | AI Gateway + visual_memory_chunks populated |
| 7 | Caption + render pipeline | Clip-pull working |
| 7–8 | Cover-image generator | AI Gateway |
| 8 | Package generator + table | All of above |
| 9 | Brand identity extraction | (parallel — runs once per workspace) |

## Production safety

- Every new endpoint behind `workspaces.video_pipeline_enabled` flag (same gate as Phase 1)
- New table `story_packages` is additive; existing content flows unchanged
- Render farm runs server-side on Vercel Functions; no client-side renders
- No auto-publish in Phase 2 (that's Phase 5) — packages land in `status='ready'`, manual approval required
- Phase 2 PR splits naturally: PR A = AI Gateway + clip-pull, PR B = render farm + package generator, PR C = brand identity

## Cost estimate

| Item | Per package | Move Better monthly (assume 10 packages/day) |
|---|---|---|
| Embedding (already paid in Phase 1) | $0.0001 | — |
| Clip-pull re-ranker (gpt-4o-mini) | $0.01 | $3 |
| Cover image (Ideogram via Gateway) | $0.04 | $12 |
| Caption refinement (gpt-4o-mini) | $0.005 | $1.50 |
| Render farm (Vercel CPU) | $0.12 | $36 |
| Blob storage (incremental) | $0.007/mo | $2 |
| **Total** | **~$0.18** | **~$55/mo** |

Easily inside the $290–460/mo software ceiling from the budget.

## Decision points

- **D3** (end of Day 7): 20 sample packages produced. Review confidence scores. You pick the auto-publish threshold (calibrates Phase 5).
- **D4** (end of Day 9): per-channel render formats locked. Confirm 6 channels are right (cut TikTok? add Threads?). Then Phase 2 PRs land.

## What Phase 2 does NOT do

- **No Story Director UI** — that's Phase 3. Phase 2 produces packages that Phase 3's daily slate consumes.
- **No auto-publish** — Phase 5 wires `story_packages.approved_at` to Buffer push.
- **No engagement attribution** — Phase 5.
- **No UTM tracking back to NarrateRx** — Phase 5.
- **No lip-sync / talking-head video** — deferred. If we A/B that in W3, it lands as a separate feature toggle.

## What I want to know before Day 5 starts

- (already answered) **AI Gateway**: AI_GATEWAY_API_KEY is already in env per existing scripts → green light
- **Re-ranker model preference**: `openai/gpt-4o-mini` (cheaper, faster) vs. `anthropic/claude-haiku-4-5` (matches voice eval harness)? Default to gpt-4o-mini unless you say otherwise.
- **Render farm budget**: cap monthly Vercel CPU spend at $X? Default: no cap (track and alert at $200/mo).

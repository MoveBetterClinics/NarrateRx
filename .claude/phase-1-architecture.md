# Phase 1 — Capture Companion + Ingest Pipeline

_Drafted 2026-05-27. Phase 1 of the 30-day video output build. See `.claude/development-roadmap-video-30day.md` for the full roadmap._

## Goal

Get continuous iPhone-based capture (photos + videos) flowing from Move Better's clinic into NarrateRx's blob store, auto-tagged, indexed in visual practice memory, and ready for Phase 2's editorial AI to retrieve. Clinician/Producer touchpoint: open Shortcut → tap mic/camera → done. Everything else automatic.

## Build philosophy

**Reuse the existing media pipeline, don't rebuild it.** `api/media/upload.js` already does Blob upload + auto-tag (`tagAndPersist`) + thumbnail generation + Mux for video. Phase 1 adds a **token-auth wrapper** for iOS Shortcut access + a **new visual memory indexing step** that lands data into `visual_memory_chunks` (the table from migration 085). No fork of the existing pipeline.

## Architecture (end-to-end)

```
┌─────────────────────┐
│ iOS Shortcut        │
│ on Move Better      │
│ team iPhones        │
└──────────┬──────────┘
           │ POST /api/capture/upload
           │ Authorization: Bearer <capture_upload_token>
           │ Content-Type: image/jpeg | video/mp4 | ...
           │ Body: <raw binary>
           │ Query: ?filename=...&capturedAt=...&locationHint=...
           │
           ▼
┌─────────────────────────────────────────────┐
│ api/capture/upload.js (NEW, Node runtime)   │
│  1. Validate Bearer token → clinician row   │
│  2. Stream body to Vercel Blob              │
│  3. Insert media_assets row                 │
│     source='capture_companion'              │
│     clinician_id, workspace_id, captured_at │
│     asset_purpose='capture_moment'          │
│  4. waitUntil(tagAndPersist + visualIndex)  │
│  5. Return { assetId, blobUrl, status }     │
└────────────┬────────────────────────────────┘
             │
             │ (async background work via waitUntil)
             │
   ┌─────────┴──────────────┐
   ▼                        ▼
┌──────────────┐  ┌──────────────────────┐
│tagAndPersist │  │ visualMemoryIndex   │
│(EXISTING)    │  │ (NEW)               │
│• ai_tags     │  │ • Embed: tags +     │
│• kind/duration│  │   filename + voice  │
│• transcode   │  │ • Insert into       │
│  for video   │  │   visual_memory_    │
└──────────────┘  │   chunks            │
                  │ • upsert by source  │
                  └──────────────────────┘
```

## API endpoints

### POST /api/capture/upload (NEW)

**Auth**: Bearer `<capture_upload_token>` (from `clinicians.capture_upload_token`).
**Body**: raw binary of image or video.
**Query params**:
- `filename` — original filename (used for blob path + mime hint)
- `capturedAt` — ISO timestamp of when the moment happened (iPhone provides via Shortcut)
- `locationHint` (optional) — free-text room/area label
- `caption` (optional) — clinician's quick note about what's in the clip

**Response (201)**:
```json
{
  "assetId": "uuid",
  "blobUrl": "https://...",
  "status": "uploaded",
  "kind": "photo" | "video"
}
```

**Errors**:
- 401 if Bearer missing/invalid/expired
- 413 if body exceeds limit (TBD by dogfood)
- 415 if mime type unsupported
- 500 on Blob or Supabase failure (logged via existing dbErr pattern)

### GET / POST / DELETE /api/capture/token (NEW)

**Auth**: Clerk JWT, must match the clinician's owner OR be a Producer in same workspace.
**GET**: Returns `{ token, expiresAt, lastUsedAt }` or `{ token: null }` if not set / revoked.
**POST**: Generates a new token (rotates if existing), 90-day expiry. Returns the new token (display once).
**DELETE**: Revokes current token by clearing the column.

The token is plaintext base32(24-byte random) — `cct_<24 chars>` prefix for grep-ability. Stored as-is in the column (no hashing) since the only consumer is this single endpoint and rotation is cheap.

## Schema additions (Migration 086)

Already drafted in `supabase/multitenant/migrations/086_capture_upload_token.sql`:

```sql
ALTER TABLE public.clinicians
  ADD COLUMN IF NOT EXISTS capture_upload_token text,
  ADD COLUMN IF NOT EXISTS capture_upload_token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS capture_upload_token_last_used_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS clinicians_capture_upload_token_uniq
  ON public.clinicians(capture_upload_token)
  WHERE capture_upload_token IS NOT NULL;
```

No new media_assets columns needed — the existing schema already has every field Phase 1 wants (`source`, `clinician_id`, `captured_at`, `ai_tags jsonb`, `visual_narrative`, `kind`, `mux_*`).

## Visual memory indexing (NEW lib)

`api/_lib/visualMemoryIndex.js` — exposes `indexMediaAsset({ assetId, supabase })`.

**What it does**: takes a media_asset that has already been auto-tagged, builds an embedding from its tags + filename + visual_narrative + clinician's voice phrase context, inserts (or upserts) a row into `visual_memory_chunks`.

**Embedding source text** (composed from media_asset fields):
```
[capture] <filename> (kind=<photo|video>, captured by <clinician name>)
Visual: <visual_narrative or auto-generated description>
Tags: <ai_tags joined>
Caption: <caption from upload query if present>
Location: <locationHint if present>
```

**Model**: OpenAI `text-embedding-3-small` (1536 dims) — already in use via `api/_lib/embeddings.js`, matches the `vector(1536)` column type on `visual_memory_chunks`.

**Idempotency**: upsert keyed on `(source_type='media_asset', source_id=assetId)`. Re-running is safe.

**story_role classification** (Phase 1 stub, Phase 2 enhancement): for now, all capture_companion assets get `story_role=NULL`. Phase 2 adds a lightweight LLM classifier that reads ai_tags + visual_narrative and picks among `intro / demo / punchline / transition / broll`. Cheaper than a per-clip LLM call at ingest; Phase 2 can batch.

## iOS Shortcut spec (build doc separate)

See `.claude/runbooks/capture-companion-ios-shortcut.md` for the click-by-click build instructions.

## What Phase 1 does NOT do

- **No new UI in NarrateRx app yet.** That's Phase 3. For now, Capture Companion uploads → media library → Producer can see them via existing media library UI.
- **No backfill of historical media into visual_memory_chunks.** That's a separate one-off script (Day 4 in the roadmap). Will be `scripts/backfill-visual-memory.mjs`.
- **No Story Director surface.** That's Phase 3.
- **No editorial AI / clip-pull.** That's Phase 2.

## Production safety

- Behind `workspaces.video_pipeline_enabled` flag (default false from Phase 0). Token rotation endpoint refuses if flag is off.
- Token endpoint requires Clerk auth + workspace match.
- Upload endpoint requires valid + non-expired token.
- New code in NEW files only — no edits to `api/media/upload.js`.
- New visualMemoryIndex helper does NOT modify media_assets — it only writes to visual_memory_chunks.

## Decision points (Q reviews)

- **D2** (~end of Day 3): you (or Philip) capture 5–10 test clips via the Shortcut. We verify:
  - Upload succeeds
  - Blob URL is reachable
  - media_assets row has correct source, clinician_id, captured_at
  - ai_tags is populated (existing tagAndPersist works)
  - visual_memory_chunks has corresponding row(s)
  - Embedding is non-null and well-shaped (1536 dims)

If anything looks off, we fix before Phase 2 builds on top.

## Next phase preview

Phase 2 (Editorial Brain, Days 5–9): uses visual_memory_chunks for the clip-pull AI. When a blog post generates, it queries visual_memory_chunks via cosine similarity on the topic, returns top-K matching clips, and the auto-edit pipeline assembles them with brand template + captions.

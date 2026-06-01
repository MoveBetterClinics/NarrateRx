# Handoff: Slate → Storyboard video contract (2 sessions)

**Date:** 2026-06-01
**From:** Pipeline-UX session (Storyboard/Publish consumer side, branch `feat/pipeline-ux-phase2`)
**To:** Slate session (currently on `fix/slate-video-audio-subtitle-size`)

Q's reframe (verbatim intent): **Slate is a video editing area, independent of any one social post — a way to manage video clips.** It just needs more output options. From a clip you get two outputs:

1. **As a post** — caption + text overlay, **both editable**. It should drop **directly into Storyboard** as a post that already has its video attached, then go to the normal publish-with-media screen, editable like any other media-attached post.
2. **As Library b-roll** — just the **spoken-word (audio) text overlay**. Reusable in other posts. Text **size + position must be adjustable**.

Both outputs: text overlay **size and location adjustable**.

---

## The agreed architecture (decided this session)

**One source of truth = `media_assets`.** An approved Slate clip is a first-class `media_assets` video row (your #1115 already does this for the Library path: `source='slate'`, `asset_purpose='broll'`, pre-rendered `.mp4`). The Storyboard *consumer* needs no special clip handling — a Slate clip is just a normal video asset. (The earlier `video_segments` live-cut path was dropped — PR #1107 closed.)

## The ONE thing the consumer needs from the producer side

`approve → library` (your `api/editorial/approve-package.js`, `destination === 'library'` branch) inserts the `media_assets` broll row but **does NOT index it into `visual_memory_chunks`** — so the clip will NOT appear in Storyboard's ranked **"Suggested media"**, only in **"Browse Library"** (manual pick).

**Fix (producer-side, your file):** after the `media_assets` insert succeeds, index each new asset so it's searchable. Reuse the existing helper — no new code needed:

```js
import { indexMediaAsset } from '../_lib/visualMemoryIndex.js'
import { waitUntil } from '@vercel/functions'

// …after `const assets = await assetInsertRes.json()` (the library branch):
// Index each new broll asset into visual_memory_chunks so it shows up in
// Storyboard's ranked Suggested media (not just Browse Library). Best-effort
// and backgrounded — a failed index must not fail the approve. waitUntil keeps
// the instance alive past the response (per CLAUDE.md: a bare floating promise
// is dropped when the function freezes).
waitUntil(Promise.allSettled(
  assets.map((a) => indexMediaAsset({ assetId: a.id }))
))
```

Notes:
- `indexMediaAsset` embeds from `filename` + `notes` + (if present) `ai_tags`/`visual_narrative`. Your insert sets `notes = "<topic> · <channel> render from Slate package <id>"`, which clears the helper's `text_too_sparse` (<16 chars) guard — so indexing will succeed on real text (the package topic). Not as rich as a fully AI-tagged asset, but real and relevant.
- It's idempotent (delete-then-insert by `source_id`), so re-approving is safe.
- `waitUntil` is required — `indexMediaAsset` runs after the HTTP response, and a bare promise would be dropped when the Vercel instance freezes (CLAUDE.md "fire-and-forget must use waitUntil").

## What the Storyboard/Publish session (me) is building in parallel

- Compose-in-Storyboard (Choose media → Compose → Publish).
- **Video as a carousel slide with an editable text overlay** (Option B: brand caption band via `brandRenderVideo`, which already takes `startSec`/`durationSec`/`captionText`/`subtitles`). This is the "edit the text overlay, size + position" surface for a clip-as-post on the Storyboard side.
- The "clip-as-post drops into Storyboard" receiver — a Slate post-output should land as a `content_items` draft with the video in `media_urls`, then open in Storyboard. **If you build the Slate "As a post" button, the cleanest contract is: create a `content_items` row (status `draft`, platform = chosen, `media_urls = [{url,type:'video',kind:'video',mediaAssetId}]`) and redirect to `/storyboard/<id>` (or `/storyboard/<id>/publish`).** Let's confirm that shape together before either of us hard-wires it.

## Open coordination question
The **text-overlay size/position editing** appears on BOTH sides (Slate b-roll + Storyboard post). Decide whether that control is:
- (a) one shared component used in both places, or
- (b) Slate edits the burned-in overlay at render time; Storyboard edits via the carousel composer's caption band.

Currently leaning (b) — they're different render paths (Slate burns at clip-render; Storyboard burns at publish via `brandRenderVideo`). Flag if you see it differently.

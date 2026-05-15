# NarrateRx — Idea Parking Lot

Append-only list of out-of-scope ideas that surfaced during sessions. Not a roadmap (that's [`development-roadmap.md`](development-roadmap.md)) and not a commitment — just "we could also do this someday, here's enough context to evaluate when the time comes."

**How to add:** invoke `/idea` in a session (with or without a one-liner). Claude appends here with the structure below.

**How to groom:** skim periodically. Promote ideas with a clear trigger to the roadmap or to a GitHub issue. Tombstone ideas you've decided against ("Killed: <reason>"). Delete tombstones older than 3 months.

**Status legend:** `Parked` (default), `Promoted` (now on roadmap/issue), `Done`, `Killed`.

---

## Idea: AI variants picker (Option 2 from overlay-design session)
- **Surfaced:** 2026-05-13 (overlay-design session)
- **Area:** `src/pages/ReviewPost.jsx`, `api/content-plan/pick-overlay-design.js`
- **TLDR:** After Compose, render 3 design variants instead of 1; show as thumbnail grid, clinician picks one. Modify picker prompt to return 3 distinct variant arrays (different templates/colors); render each, store all 3 temporarily, the chosen one wins.
- **Effort:** ~2–3 hours
- **Cost impact:** 3x canvas render + 3x Blob upload per compose
- **Trigger to revisit:** Clinicians report "Claude's picks all feel samey" *and* the existing `Sparkles` per-slide regen isn't sufficient escape hatch.
- **Status:** Parked

## Idea: In-app overlay editor (Option 3 from overlay-design session)
- **Surfaced:** 2026-05-13
- **Area:** `src/pages/ReviewPost.jsx`
- **TLDR:** Free-form editor (Fabric.js / Konva in-house, or embed Bannerbear's iframe) for cases where the AI's pick + Customize panel still aren't enough. Drag text, move elements, change fonts.
- **Effort:** Fabric.js custom ~2–3 days; Bannerbear iframe ~4 hours + $50/mo plan
- **Trigger to revisit:** Anchor content (blog hero, monthly newsletter) consistently needs hand-polish that exceeds what the Customize panel can do. Or clinicians ask for it explicitly.
- **Status:** Parked

## Idea: FFmpeg video text overlay
- **Surfaced:** 2026-05-13
- **Area:** new `api/_lib/videoOverlay.js`, would wire into TikTok/Reels atom flow
- **TLDR:** Use `@ffmpeg-installer/ffmpeg` on Vercel Functions to bake hook/CTA text onto short videos via the `drawtext` filter. Today we punt to CapCut via `[ON SCREEN TEXT: ...]` markers in atomPrompts.
- **Effort:** ~1 day (drawtext, font handling, Vercel function size constraints)
- **Trigger to revisit:** Clinicians actually start producing video at meaningful volume and the CapCut handoff becomes a bottleneck.
- **Status:** Parked (canonical pattern per CLAUDE.md is to keep video out of app and use CapCut)

## Idea: Cloudinary as overlay render engine
- **Surfaced:** 2026-05-13
- **Area:** would replace `src/lib/overlayTemplates.js` `renderSlide()`
- **TLDR:** Cloudinary supports image AND video text overlay via URL params (`l_text:font_60_bold:HOOK,co_white`). Has a real Vercel Marketplace integration so billing/provisioning is unified. Cheaper than Bannerbear; less design flexibility.
- **Effort:** ~3–4 hours (URL builder, replace `renderSlide`)
- **Trigger to revisit:** If we want video overlay AND simple-uniform layouts AND we don't want Bannerbear's monthly fee.
- **Status:** Parked (Bannerbear is the preferred swap path — see [project_image_overlay_strategy.md memory](/Users/qbook/.claude/projects/-Users-qbook-Claude-Projects-NarrateRx/memory/project_image_overlay_strategy.md))

## Idea: Canva Connect API — push drafts to Canva for clinician finalize
- **Surfaced:** 2026-05-13
- **Area:** new `api/publish/canva-draft.js` + ReviewPost button
- **TLDR:** Generate text + suggest photo, push as Canva design via Connect API, clinician finalizes in Canva (where they already live). Best design quality + meets clinicians where they are. Tradeoff: OAuth flow per workspace, no end-to-end automation.
- **Effort:** ~1–2 days (OAuth per workspace, design push, asset upload)
- **Trigger to revisit:** Clinicians say "I wish I could tweak this in Canva" repeatedly, AND we're willing to break the one-click automated workflow.
- **Status:** Parked

## Idea: Captions.ai / Submagic integration for video subtitles + b-roll
- **Surfaced:** 2026-05-13
- **Area:** new video post-processing step in atom flow
- **TLDR:** Auto-generate animated captions and AI b-roll for short-form video. $9–16/mo. Different category than the static-overlay tools.
- **Effort:** ~half day if their API is good
- **Trigger to revisit:** Same as FFmpeg overlay — when video volume justifies it.
- **Status:** Parked

## Idea: AB testing for overlay templates — track engagement per template_id
- **Surfaced:** 2026-05-13
- **Area:** would need `content_items.overlay_spec` (already there!), engagement events feedback loop
- **TLDR:** Once engagement metrics flow back in (post-launch), tag each post with its `overlay_spec.template` and analyze engagement per template. Feed back into the picker prompt as "templates that perform well for this workspace."
- **Effort:** ~1 day (assuming engagement data is already flowing)
- **Trigger to revisit:** Engagement API access unblocks (see [engagement_api_access memory](/Users/qbook/.claude/projects/-Users-qbook-Claude-Projects-NarrateRx/memory/project_engagement_api_access.md)). Currently inert.
- **Status:** Parked (blocked on engagement data, not on build effort)

## Idea: AI-extract brand kit from logo/website during onboarding
- **Surfaced:** 2026-05-13
- **Area:** `api/onboarding/*`, `workspaces.brand_style`
- **TLDR:** During the `/onboard` wizard, ask for logo URL or marketing site URL. Run Claude vision over it to extract: primary color, secondary palette, heading font (matched against common fonts), body font. Pre-fill `workspaces.brand_style` so the overlay picker has a real brand kit from day one.
- **Effort:** ~3–4 hours
- **Trigger to revisit:** Once external tenants start onboarding and we see them shipping ugly overlays because brand_style is empty.
- **Status:** Parked

## Idea: Tier overlay effort by post importance
- **Surfaced:** 2026-05-13
- **Area:** would need a `tier` field on `content_plan_atoms` or content_items
- **TLDR:** 95% of posts (daily IG, GBP) auto-compose with no editor option. 5% of posts (blog hero, newsletter) get the Customize panel or Bannerbear-quality treatment. AI flags the tier in the Plan based on platform + angle.
- **Effort:** ~half day
- **Trigger to revisit:** If we ever add an in-app editor (Idea: In-app overlay editor above) — gate it by tier so it doesn't become "obligatory" for every post.
- **Status:** Parked

## Idea: Template picker preview thumbnails before Compose
- **Surfaced:** 2026-05-13
- **Area:** `src/pages/ReviewPost.jsx`
- **TLDR:** Before clicking Compose, show small thumbnail previews of how each template would render with the current photo + overlay text. Lets clinician set expectations.
- **Effort:** ~3–4 hours (would pre-render thumbnails for each compatible template at lower resolution)
- **Trigger to revisit:** If clinicians complain about not knowing what they're going to get before clicking Compose.
- **Status:** Parked (likely unnecessary — Customize panel + Regenerate covers the post-hoc case)

## Idea: `mcp__ccd_session__spawn_task` chips for small actionable ideas
- **Surfaced:** 2026-05-13 (meta — about idea-capture workflow)
- **Area:** Claude-tooling workflow, not codebase
- **TLDR:** For ideas that are small enough to be a session of their own AND ready to act on, Claude proactively offers a `spawn_task` chip at end-of-session instead of just appending here. This file is for parking; spawn_task is for shipping.
- **Effort:** Behavioral, not code
- **Trigger to revisit:** Once we have a few sessions worth of grooming, we'll see which ideas keep coming back without being acted on — those are good `spawn_task` candidates.
- **Status:** Parked (behavioral guideline, not a build)

## Idea: Upload-time video normalize via streaming pipe
- **Surfaced:** 2026-05-15 (rotate-bug follow-up — what's missing from media management)
- **Area:** `api/media/upload.js`, new `api/_lib/videoNormalize.js`, optional `media_assets.is_faststart` column
- **TLDR:** For uploads where `probeFaststart` returns `'tail'` (logged but not acted on as of PRs #453/#456/#458), re-mux the blob into a faststart-equivalent fragmented MP4 using a `fetch(blob) → ffmpeg-stdin → ffmpeg-stdout → blob-put` pipeline. No `/tmp` staging → works for any file size. Replaces the master with a fresh-pathname blob (same cache-bust pattern the edit endpoint uses), deletes the old. Optional: persist `is_faststart` so the UI can show a "normalizing…" badge while it's in flight. If the codec isn't H264/AAC, full re-encode through the same pipe.
- **Effort:** ~1 day
- **Trigger to revisit:** (a) external tenants start uploading non-faststart sources at volume, OR (b) crop operations on long clips start failing in the wild (currently mitigated by dropping `+faststart` from the edit path in #458), OR (c) playback start-latency complaints on long videos hosted from Blob.
- **Status:** Parked

# Repurpose A2 — campaign-bundle the master + clips (+ drip)

**Status:** DESIGNED, not built. Prep written 2026-05-30 after shipping A1 (PR #1048).
**Gate:** Build A2 only *after* the long-form chunked lane is validated end-to-end
on a real 30–60 min talk — A2 refactors `render-longform` (the path under test).

## Recap

A1 (shipped, PR #1048) = one-click "Full video + social clips": the
`RepurposeAction` card fires the two existing endpoints from the client
(`renderWholeVideo` + `findClips`). Master → Story Slate; proposed clips →
Find-clips panel for review. **No grouping, no scheduling** — that's A2.

A2 = tie the master + the clips it spawned into **one tracked unit** (a
"Repurpose" campaign) and let the clips **trickle out behind the master**.

## Key finding: the "drip" is mostly Buffer's job, not ours

NarrateRx has **no per-item scheduled-publish column**. `content_items` are
created `status='approved'` (approve-package.js) and the auto-publish cron
(`api/cron/auto-publish.js`) dispatches them via the Buffer **queue**
(`useQueue=true`). Buffer then spaces queued posts across the workspace's
configured posting slots and returns a `dueAt`. So the "trickle" is already
delegated to Buffer's queue scheduler.

Implication: **v1 drip = control ORDER, not explicit times.** Queue the master
first, then the clips, and Buffer spreads them over its slots naturally. A true
NarrateRx-side "1 clip/day for a week" scheduler is a *later* enhancement that
needs a new `content_items.scheduled_for` column + a release cron + Buffer's
`scheduledAt` — out of scope for A2 v1; noted under "Future" below.

## A2 scope (v1)

1. **Create a campaign per repurpose action.** When the user clicks Repurpose,
   create (or reuse) an `active` campaign named `Repurpose: <clean filename>`
   via the existing `campaigns/upsert` logic. `content_style='clinical'`
   default (or inherit the workspace default). Reuse if one already exists for
   this source (idempotent on re-click).

2. **Tag the master with the campaign.** `render-longform` accepts an optional
   `campaignId` and sets `story_packages.campaign_id` on the package it inserts.
   (`story_packages.campaign_id` already exists — migration 096.)

3. **Tag the clips with the campaign — across the propose→render gap.** The clip
   lane is `find-clips` (propose `video_segments`) → review → `render-segments`
   (render kept segments into packages). The campaign must survive that gap.
   `video_segments` has **no** campaign column today → **needs a migration**
   (below). `find-clips`/`segmentDetect` accept `campaignId` and store it on the
   `video_segments` rows; `render-segments` reads it and sets
   `story_packages.campaign_id` on each rendered clip package.

4. **Move the combo to a backend endpoint.** Replace A1's client double-call with
   `POST /api/editorial/repurpose-video { assetId, maxSegments? }` that: creates
   the campaign once, then kicks the master render (with `campaignId`) and clip
   detection (with `campaignId`) — one auth check, one campaign, atomic intent.
   `RepurposeAction` calls this one endpoint instead of two.

5. **Order for the drip.** The master is queued/published first; clips, approved
   later from the Slate, queue behind it. With everything tagged to the same
   campaign, the Slate's existing campaign chip groups them visually, and the
   auto-publish path queues them to Buffer in approval order → Buffer spaces
   them. No new scheduler needed for v1.

## The migration (author when A2 is built — NOT a real migration file yet)

Promote this to `supabase/multitenant/migrations/111_video_segments_campaign_id.sql`
when A2 starts, and apply to prod *before* merging the A2 code. Kept here (not in
the migrations dir) so it isn't mistaken for an applied migration.

```sql
-- 111_video_segments_campaign_id.sql
-- Carry the repurpose campaign from clip PROPOSAL (find-clips) through to RENDER
-- (render-segments), which sets it on the resulting story_packages row. Lets the
-- master + all its social clips share one "Repurpose" campaign.
ALTER TABLE public.video_segments
  ADD COLUMN IF NOT EXISTS campaign_id uuid REFERENCES public.campaigns(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_video_segments_campaign
  ON public.video_segments (campaign_id);

-- Self-sufficient grants (REST runs as service_role).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.video_segments TO service_role;
```

## Files A2 touches

- **NEW** `api/editorial/repurpose-video.js` — combined endpoint (campaign + both kicks).
- `api/editorial/render-longform.js` — accept `campaignId`, set on the package insert. ⚠️ test-path file.
- `api/_lib/segmentDetect.js` (+ `find-clips.js`) — accept `campaignId`, store on `video_segments`.
- `api/editorial/render-segments.js` — read `video_segments.campaign_id`, set on each clip package.
- `src/components/RepurposeAction.jsx` — call the new single endpoint.
- `src/lib/clipsLib.js` — add `repurposeVideo(assetId, maxSegments)`.
- Migration 111 (above).

To avoid duplicating `render-longform`'s package-create + caption + duration
branch logic in the new endpoint, extract that into `api/_lib/kickLongformRender.js`
({ ws, asset, baseUrl, campaignId }) → { packageId, mode } and call it from BOTH
`render-longform.js` and `repurpose-video.js`. **This extraction is the part that
touches the validated path — do it only after validation, and re-smoke long-form.**

## Risk / sequencing notes

- A2 modifies `render-longform` (campaignId + the kick-helper extraction). That's
  why it's gated behind the long-form validation. Re-run a real long-talk smoke
  after the refactor.
- Campaign idempotency: re-clicking Repurpose on the same source must reuse the
  existing campaign (look up by a stable key — e.g. name `Repurpose: <file>` +
  source asset id in `theme_notes`/provenance) rather than spawning duplicates.
- Clip campaign tagging only takes effect for clips rendered AFTER A2 ships;
  clips proposed pre-A2 won't have a campaign (acceptable).

## Future (beyond A2 v1)

- **Explicit NarrateRx-side drip schedule:** `content_items.scheduled_for` +
  a release cron + Buffer `scheduledAt`, for "N clips/day for a week behind the
  master" control instead of relying on Buffer's queue spacing.
- **Auto-approve a curated subset of clips** (e.g. top-N by model confidence)
  so the trickle is truly hands-off, vs the current propose-for-review model.

## Open questions for Q

1. v1 drip via Buffer queue spacing (cheap, ships with A2) vs an explicit
   NarrateRx scheduler (more control, bigger build) — start with Buffer queue?
2. Clips stay **propose-for-review** (current model, safer) vs auto-approve a
   top-N subset for a fully hands-off trickle?
3. Campaign naming/grouping: one campaign per source video (`Repurpose: <file>`),
   or per time-period, or user-named at click time?

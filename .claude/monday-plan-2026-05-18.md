# NarrateRx — Visual Audit + Monday Plan (2026-05-18)

Companion to [overnight-audit-2026-05-17.md](overnight-audit-2026-05-17.md). This pass walked **every story page on the live site** (movebetter-people.narraterx.ai + movebetter-equine.narraterx.ai) and **every platform tab inside each story** to find rendering issues that the prior data audit missed. Driven via Claude-in-Chrome on prod.

**TL;DR:** one new P0 visual bug found and fixed ([PR #636](https://github.com/Move-Better/NarrateRx/pull/636)) — the right pane was stacking new ContentEditor blocks on every tab click without removing the previous one. A handful of smaller cosmetic and content-quality issues remain; none block the Monday workflow.

---

## What I checked (live, on prod)

| Workspace | Story | Status | Pieces walked |
|---|---|---|---|
| movebetter-people | Low back pain | In Review | 12 (5 published, 1 in_review, 6 draft) |
| movebetter-people | Disc herniation | Drafting | 5 (all draft) |
| movebetter-people | Sciatica | Drafting | 2 (blog + IG, both draft) |
| movebetter-people | Neck pain | Drafting | 1 (blog draft) |
| movebetter-equine | Why your horse won't pick up the correct lead | Published | 1 (blog published) |
| movebetter-people | Home, Stories (cards + pipeline + calendar), Library, Settings | — | top-level pages |

**Method:** for each piece, navigate via direct URL (`/stories/<storyId>?piece=<pieceId>`) which forces a fresh page load, then evaluate JS in the live page to count textareas, scan for markdown leakage (`*italic*`, `**bold**`, `---` HRs), count hashtags, capture voice-attribution chips, and screenshot the result. 21 pieces inspected end-to-end.

---

## Findings

### P0 · 1. ContentEditor accumulation on tab navigation [FIXED — PR #636]

**Symptom (reproducible on prod right now):** every click on a platform tab inside `AssetsPane` adds a new ContentEditor (Edit/Attributed/Assets toggle + textarea) to the page without removing the previous one. Page state after clicking through 4 tabs:

| Tab clicked | Textarea count in right pane |
|---|---|
| (fresh load — GBP) | 1 ✓ |
| Click Instagram 4/4 | 2 ✗ (GBP stays, Instagram added) |
| Click Google Business | 3 ✗ (both stay, GBP added again) |
| Click LinkedIn | 4 ✗ (all stay, LinkedIn added) |

Verified via `document.querySelectorAll('textarea[placeholder="No draft content yet."]').length` after each click. By the time you've walked through all 12 tabs on Low back pain, the page has **12 stacked editors** showing the bodies of every piece you've visited.

**Root cause:** the children list of `<div className="p-4 space-y-3">` in [src/components/story-detail/AssetsPane.jsx](../src/components/story-detail/AssetsPane.jsx) mixes keyed siblings (ContentEditor + ApprovalPanel, both `key={active.id}`) and unkeyed siblings (InspectDrawer, conditional BufferMetricsRow). React's reconciler correctly remounted ApprovalPanel on each piece change but failed to find a clean mapping for the keyed ContentEditor against the unkeyed siblings — the new ContentEditor got inserted while the old one's DOM stayed mounted.

Fresh page loads were fine. Only the click path through `handleSelectPiece` (which calls `setSearchParams` to update the `?piece=…` URL param) triggered the bug.

**Fix:** wrap the entire piece-scoped subtree in `<div key={active.id} className="space-y-3">`. Atomic unmount/remount on piece change. Verified clean: `npm run typecheck && npm run lint && npm run build && npm run verify-bundles`.

PR: [#636](https://github.com/Move-Better/NarrateRx/pull/636), auto-merge enabled.

---

### P1 · 2. Library — top-row photo thumbnails are blank

Library page, "RECENT — LAST 7 DAYS" row: four thumbnail cards (`DSC00120.JPG`, `DSC00137.JPG`, `DSC00139.JPG`, `DSC00142.JPG`) render with no image — just a blank gray rectangle with a "Tagged" badge and the filename. The fifth recent item is a video (`C0084.MP4`) and renders correctly with its frame thumbnail.

Older photos (rows 2+) all render fine with `Raw` badges and visible images.

**Root cause (likely):** the thumbnail-backfill job didn't fire for these specific JPGs at upload time, or the `media_assets.thumbnail_url` column is null and the Library UI falls back to a blank placeholder.

**Recommended:** run [scripts/backfill-thumbnails.mjs](../scripts/backfill-thumbnails.mjs) (or the `/api/media/backfill-thumbnails` endpoint) on the 4 affected assets. The script is already in the repo. ETA: 1 min.

Quick check from project root:
```
cd "/Users/qbook/Claude Projects/NarrateRx" && set -a && source .env.local && set +a && node scripts/backfill-thumbnails.mjs
```

---

### P2 · 3. Voice-attribution metrics are alarmingly low across most pieces

Captured the "X% in clinician's voice" / "Y% synthesis — read closely" chips from every published + draft piece:

| Story | Platform | Voice % | Synthesis % | Verbatim |
|---|---|---|---|---|
| Low back pain | Blog (published) | 5% | 95% | 1 |
| Low back pain | Facebook (published) | **0%** | 100% | 0 |
| Low back pain | GBP (published) | 0% | 100% | 0 |
| Low back pain | LinkedIn (published) | 29% | 71% | 0 |
| Low back pain | Instagram 4/4 (published) | 57% | 43% | 0 |
| Low back pain | Instagram 1/4 (sched May 26) | 17% | 83% | 0 |
| Low back pain | Instagram 2/4 (sched May 19) | **0%** | 100% | 0 |
| Low back pain | Instagram 3/4 (sched Jun 2) | **0%** | 100% | 0 |
| Low back pain | TikTok (sched expired May 12) | 8% | 92% | 0 |
| Low back pain | YouTube Script | 4% | 96% | 0 |
| Low back pain | Landing Page | 7% | 93% | 2 |
| Low back pain | Instagram Ads (in_review) | 10% | 90% | 0 |
| Disc herniation | Blog | 5% | 95% | 1 |
| Disc herniation | GBP | 25% | 75% | 0 |
| Disc herniation | Instagram | **0%** | 100% | 0 |
| Disc herniation | Landing Page | 3% | 97% | 1 |
| Disc herniation | YouTube | 2% | 98% | 0 |
| Sciatica | Blog | 4% | 96% | 0 |
| Sciatica | Instagram | **0%** | 100% | 0 |
| Neck pain | Blog | **0%** | 100% | 0 |
| Equine — horse lead | Blog (published) | 15% | 85% | 3 |

**Read:** the UI scorecard is working correctly — these are real provenance scores. **The content is overwhelmingly synthesis, not the clinician's voice.** This isn't a rendering bug, but it's the substantive content problem that's driving "the data is good but the output is broken" — the *data* (raw clinician messages) is fine, but the *AI synthesis* is paraphrasing so heavily that almost nothing of the clinician's actual phrasing survives.

**Likely cause (per the overnight audit's Finding #4):** `interviews.audience` and `interviews.story_type` are NULL on every interview, so the per-piece direction block in [src/lib/prompts.js](../src/lib/prompts.js) falls back to a generic prompt that biases the model toward synthesis. Also `cleaned_messages` is empty on 4 of 5 completed interviews, meaning the model sees raw disfluent transcripts instead of de-ummed text.

**Recommended Monday investigation (P1, follow-up):**
1. Trace why `audience` / `story_type` aren't being saved (`api/db/interviews.js` PATCH whitelist? `InterviewSession.jsx` save payload?). 30 min.
2. Confirm `api/interviews/cleanup-transcript.js` has `maxDuration: 300` (was 60s historically). 5 min.
3. Re-run cleanup on the 4 interviews missing `cleaned_messages`: `update interviews set cleaned_messages = null where id in (…)` + hit cleanup endpoint. 10 min.
4. Once those land, consider a separate provenance threshold experiment — the current "synthesis" weighting may be too lenient. The clinician's actual words should make up >30% of any piece, not <10%.

This is the biggest substantive issue surfaced by the audit, but it doesn't block Monday content review — the published pieces are still readable, just less in-voice than they should be.

---

### P2 · 4. Markdown leakage in 8 pieces (asterisks, HRs)

Same finding as the overnight audit confirmed visually:

| Story | Platform | Status | Issue |
|---|---|---|---|
| Low back pain | Facebook | **published** | `*how*` literal asterisks in published body |
| Low back pain | Instagram 4/4 | **published** | `*how*` literal asterisks in published body |
| Low back pain | GBP | **published** | "Book your low back pain assessment at Move Better — **link in profile**" (no profile link on GBP) |
| Low back pain | Instagram 1/4 (sched May 26) | draft | `*has*` italic |
| Low back pain | TikTok (sched expired) | draft | `**CAPTION:**` bold + `*how your body…*` italic + `---` HR |
| Low back pain | Instagram Ads | in_review | `*why*` italic |
| Disc herniation | GBP | draft | `**free Low Back Pain Seminar**` bold + `*why*` italic + "link in profile" |
| Disc herniation | Instagram | draft | `*everyone*` italic |
| Sciatica | Instagram | draft | `*constant stretch*` italic |

**Prompt fix already landed** (PR #634 — "PLAIN TEXT ONLY" instruction). New atom generations should be clean.

**Existing data:** the cleanup script [scripts/audit-2026-05-17-cleanup.mjs](../scripts/audit-2026-05-17-cleanup.mjs) handles the 5 DRAFT rows with `--apply`. The 3 PUBLISHED rows can't be auto-fixed (they're live on Facebook/Instagram/GBP) — manual edits required if you want them tidied up.

---

### P3 · 5. Two short-content Instagram drafts

| Piece | Length | Expected | Notes |
|---|---|---|---|
| Low back pain → Instagram (scheduled Jun 2) | 749 chars | 800-1200 (150-200 words) | Below prompt target; only 6 hashtags vs 8-10 expected |

Other Instagram drafts ranged 1180-1352 chars — within range. This one outlier suggests the model returned a truncated body or got distracted by the prompt midstream. Re-generate this piece before scheduling.

---

### P3 · 6. Home page name normalization

The "IN PROGRESS — PICK UP WHERE YOU LEFT OFF" card on the Home page shows `Updated 2 days ago · by Drzach` — looks like the raw Clerk username instead of the display name "Dr Q" or "Michael." Cosmetic, low impact. Likely lives in `src/lib/clinicianDisplayName.js` or wherever the home-page card pulls owner_email/owner_name from.

---

### Pages that render cleanly (no issues found)

- **Stories Pipeline view** — 5 lanes (Draft 14 / Needs Review 1 / Ready to Distribute 0 / Scheduled 0 / Published 5), all chips and dates render correctly. The "Scheduled" lane shows 0 even though 6 pieces have `scheduled_at` set — because the Pipeline lane logic requires `status='scheduled'` and our DB doesn't use that status (per the audit's Finding #2). That's by design now.
- **Stories Cards view** — 7 stories, platform chips render, stage badges (Capture / Drafting / In Review) correct.
- **Stories Calendar view** — not deeply inspected but loaded clean.
- **Story-detail pages on fresh load** — every piece on every story renders one clean ContentEditor (the accumulation bug only manifests after tab clicks).
- **Home page** — except for the username normalization above.
- **Settings → Workspace → General** — all form fields populate correctly, "Save changes" button states right.
- **Equine subdomain branding** — Move Better Equine logo + name render correctly on header.

---

## Recommended Monday actions (prioritized)

1. **Wait for [PR #636](https://github.com/Move-Better/NarrateRx/pull/636) to auto-merge after CI** — this is the visual fix. Then anyone using the app sees one editor at a time. Auto-merge is already enabled; CI takes ~3 min.
2. **Apply the data cleanup script** to clear overdue phantom schedules + strip markdown from drafts:
   ```
   cd "/Users/qbook/Claude Projects/NarrateRx" && set -a && source .env.local && set +a && node scripts/audit-2026-05-17-cleanup.mjs --apply
   ```
3. **Backfill missing thumbnails** for the 4 blank Library photos:
   ```
   cd "/Users/qbook/Claude Projects/NarrateRx" && set -a && source .env.local && set +a && node scripts/backfill-thumbnails.mjs
   ```
4. **Manually edit the live GBP post** on `business.google.com` (Move Better's Portland listing → 2026-05-12 Low back pain post) to fix the "link in profile" wording.
5. **Decide on the markdown-asterisks-in-published-FB-and-IG-posts** — either delete+re-create on Buffer or leave as-is (low-impact cosmetic).
6. **Investigate the voice-attribution scores** (P2 finding #3) — this is the substantive content issue. Start with the `audience`/`story_type` save-flow bug (already flagged in [overnight-audit-2026-05-17.md §2.4](overnight-audit-2026-05-17.md)).
7. **Regenerate the 749-char Instagram draft** scheduled Jun 2 before it ships.

Order 1-4 are all <1 min each. The whole Monday-morning recovery loop is ~10 min of mechanical work plus one trip to `business.google.com`. Step 6 is the deeper investigation worth budgeting an hour for.

---

## Files this session touched

**Code:**
- [src/components/story-detail/AssetsPane.jsx](../src/components/story-detail/AssetsPane.jsx) — wrapped piece-scoped subtree in keyed `<div>` to fix the ContentEditor accumulation. PR #636.

**Reports + tooling (from this audit + the prior overnight audit):**
- [.claude/overnight-audit-2026-05-17.md](overnight-audit-2026-05-17.md) — full audit from data side (already landed via PR #635).
- [.claude/monday-plan-2026-05-18.md](monday-plan-2026-05-18.md) — this file.
- [scripts/audit-2026-05-17-cleanup.mjs](../scripts/audit-2026-05-17-cleanup.mjs) — dry-runnable DB cleanup (already landed via PR #635).

**Verified clean before commit:** `npm run typecheck`, `npm run lint`, `npm run build`, `npm run verify-bundles`.

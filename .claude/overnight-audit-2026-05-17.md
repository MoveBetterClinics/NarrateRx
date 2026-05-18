# NarrateRx — Overnight Audit (2026-05-17)

**Scope:** every interview ("story") in prod, every content_item (platform output), every publish/schedule state, every error class in vercel logs over the past 7 days. Drives a fix plan for the recent rash of generation + publish bugs.

**TL;DR:** four distinct issues are at play. One is a code-level GraphQL bug that I patched on this branch (Buffer analytics endpoint 502-spamming). One is a data-cleanup task that I staged a script for but did not auto-apply. Two are follow-ups that need UI/save-flow investigation outside the scope of this audit. The Now/Schedule toggle scare in my first read-through turned out to be a misdiagnosis — see Section 5.

---

## 1. State of the world

**Workspaces:** 3 (movebetter-equine, movebetter-animals, movebetter-people)
**Interviews:** 9 (5 completed, 4 in_progress)
**Content items:** 21 (8 published, 12 draft, 1 in_review)

Interviews + their platform outputs:

| Workspace | Topic | Status | Outputs (content_items) |
|---|---|---|---|
| movebetter-equine | Why your horse won't pick up the correct lead | completed | blog (published) |
| movebetter-people | Neck pain | completed | blog (draft) |
| movebetter-people | Sciatica | completed | blog (draft), instagram (draft) |
| movebetter-people | Disc herniation | completed | blog, gbp, instagram, landing_page, youtube — all draft |
| movebetter-people | Low back pain | completed | blog, facebook, gbp, instagram (×3), instagram_ads, landing_page, linkedin, tiktok, youtube — 12 items, 5 published |
| 4 others | various | in_progress | none |

---

## 2. Findings — ranked by impact

### P0 · 1. `/api/buffer-analytics` is 502'ing on every fetch [PARTIAL FIX on this branch]

**Symptom:** 128 errors over the past 7 days, every Buffer-analytics fetch failing. Engagement data for published posts has not been ingested. Still firing as recently as 21:27 tonight (35 minutes before this audit ran).

```
[bufferPostStats] GraphQL error 400 [
  {"message":"Unknown argument \"id\" on field \"Query.post\""},
  {"message":"Cannot query field \"statistics\" on type \"Post\""},
  {"message":"Field \"post\" argument \"input\" of type \"PostInput!\" is required"}
]
```

**Root cause:** [api/_lib/bufferPostStats.js](../api/_lib/bufferPostStats.js) shipped in PR #609 with a guessed GraphQL shape that doesn't match Buffer's schema. Two problems:
- `post(id: $id)` — wrong arg. Buffer requires `post(input: PostInput!)` where `PostInput = { id }`.
- `statistics { … }` — wrong field name. The Post type has no `statistics` field; the autosuggest in the error reply is hidden.

**Fix in this branch:** patched the input argument (high confidence — error message is explicit). Dropped the `statistics` block from the query so it stops generating 400s; the helper now returns `statistics: {}` and callers' existing `?? {}` fallback degrades the analytics UI to zeroed metrics instead of 502. This stops the log spam tonight; the actual metrics restoration needs introspection in the morning.

**TODO (for tomorrow):** introspect Buffer's Post type to find the correct metrics field. The introspection query is documented inline in the helper. Likely candidates: `metrics`, `analytics`, `insights`. Re-add the field block once confirmed.

Per memory note `feedback_buffer_graphql_schema.md`: **"Always introspect before assuming field names."** PR #609 violated this rule and PR #611–#613 spent a chain of failures relearning it.

---

### P1 · 2. Phantom-scheduled rows from atom-plan auto-fill that never got published [STAGED CLEANUP]

**Symptom:** six content_items have `scheduled_at` set on Buffer-eligible platforms but no `buffer_update_id` and no `published_at`. They appear "scheduled" in the UI calendar/dashboard but no actual Buffer post exists. Three are already past their scheduled date and will never publish:

| id | platform | scheduled_at | topic | state |
|---|---|---|---|---|
| `1b3bc11b…` | instagram | 2026-05-15 09:00 UTC | Sciatica | **OVERDUE** |
| `4a3de443…` | instagram | 2026-05-12 09:00 UTC | Disc herniation | **OVERDUE** |
| `eb795cae…` | tiktok | 2026-05-12 09:00 UTC | Low back pain | **OVERDUE** |
| `f7ca9dba…` | instagram | 2026-05-19 09:00 UTC | Low back pain | future |
| `ec1a5f8e…` | instagram | 2026-05-26 09:00 UTC | Low back pain | future |
| `be107954…` | instagram | 2026-06-02 09:00 UTC | Low back pain | future |

**Root cause:** the atom-plan draft endpoint pre-fills `scheduled_at` on each generated content_item using `suggestedScheduledAt(interview.created_at, atom.slot)` (see [api/content-plan/draft.js:190](../api/content-plan/draft.js)). That gives every draft a calendar-ready timestamp before the reviewer has approved anything. Approval + Publish are still required before the row reaches Buffer. The Now/Schedule toggle in `ApprovalPanel` (PR #628, currently live) honors the prefilled time when the reviewer clicks Schedule. But the reviewer hasn't approved + published these six rows yet — and three of them missed their auto-filled date in the meantime.

There is **no backend cron** that walks draft rows with past `scheduled_at` and auto-publishes them. That's by design — Buffer is the scheduler (we pass `dueAt` at create time and Buffer fires the post when the time arrives). But it means atom-plan-suggested dates that the reviewer never acts on become silent stale timestamps.

**Data cleanup (staged, not applied):** see [scripts/audit-2026-05-17-cleanup.mjs](../scripts/audit-2026-05-17-cleanup.mjs). On `--apply`, the script:
- Clears `scheduled_at` on the 3 overdue rows + stamps an audit note so the reviewer knows to re-pick a time.
- Leaves the 3 future-dated rows alone — the reviewer can still approve + use the Now/Schedule toggle to actually push them to Buffer at the suggested time.

**Optional product follow-up:** the "Schedule expired ⚠" badge in [src/components/story-detail/AssetsPane.jsx:927](../src/components/story-detail/AssetsPane.jsx) already warns the reviewer on the per-piece view, but the dashboard calendar still shows the row as scheduled. Consider:
- A daily nudge cron that emails the reviewer "you have N pieces with expired auto-fill schedules — repick or clear."
- Or: filter out expired auto-fill `scheduled_at` from the calendar (using a `scheduled_by_user: bool` column) so only intentional schedules survive past their date.

---

### P1 · 3. Markdown leakage in social bodies [PROMPT FIXED, DATA STAGED]

**Symptom:** 5 draft + 3 published social posts contain markdown that the destination platform renders literally:

- `**bold**` asterisks in tiktok ("**CAPTION:**") and gbp ("**free Low Back Pain Seminar**")
- `*italic*` asterisks in 5 platforms (sciatica IG, disc-herniation IG/GBP, low-back-pain FB/IG/IG-draft/tiktok)
- `---` horizontal rules in tiktok ("Low back pain")
- The published `Low back pain` GBP post says **"Book your low back pain assessment at Move Better — link in profile"** which makes no sense on Google Business Profile (no profile link exists).

**Root cause:** [api/_lib/atomPrompts.js](../api/_lib/atomPrompts.js) didn't tell the model to suppress markdown for social channels. The Instagram/Facebook prompts used asterisks for emphasis in their instructions, which the model echoed back into the body. The GBP `local_authority` and `patient_outcome` angles literally said `Close with: "Book your … — link in profile"` — copy-pasted from the Instagram prompt template.

**Prompt fix:** already landed in PR #634 (`794b6aa`, today 21:40):
- Added explicit `PLAIN TEXT ONLY` instruction to the shared atom system prompt preamble.
- Fixed GBP CTAs to use the workspace's actual `website` URL.
- One broken hashtag (`#MovementIsM edicine`) was already fixed in piece `ec1a5f8e` directly.

**Data cleanup (staged, not applied):** [scripts/audit-2026-05-17-cleanup.mjs](../scripts/audit-2026-05-17-cleanup.mjs) on `--apply` strips asterisk emphasis and HR lines from the 5 DRAFT rows and stamps an audit note. Published rows are **left alone** — the leaked content is already live on Buffer/Facebook/Instagram/GBP and editing the DB doesn't reach back into the platform. The user should:
1. Edit the live GBP post on `business.google.com` to fix the "link in profile" → "movebetter.co" wording (customers searching for "movement therapy Portland" will see it).
2. Decide whether to delete + re-create the Low back pain published Facebook/Instagram posts to remove the `*how*` literal asterisks (low-impact; users probably skim past it).

---

### P1 · 4. `audience` + `story_type` columns never get set on interviews

**Symptom:** every interview in prod (9/9) has `audience = NULL` and `story_type = NULL`. Both columns were added by migration 048 (`048_interview_audience_story_type.sql`) to drive the audience/story-type slot pickers in the interview UI.

**Root cause (likely):** the UI captures the slots but the save flow doesn't persist them to the interview row. Either:
- The interview-creation/update endpoint at [api/db/interviews.js](../api/db/interviews.js) doesn't accept `audience` or `story_type` in its PATCH body, OR
- The client-side code in [src/pages/InterviewSession.jsx](../src/pages/InterviewSession.jsx) (or the New Interview flow) doesn't include them in the update payload.

**Impact:** the per-piece direction block in [src/lib/prompts.js#buildPieceDirectionBlock](../src/lib/prompts.js) gets `audienceSlot = null, storyTypeSlot = null` for every generation. The "smart" tone heuristics that normally branch on audience (existing-patients vs new-prospects) fall back to a generic prompt. Content quality is currently a coin-flip on whose voice it sounds like.

**Recommended fix (P1, follow-up PR):** trace the InterviewSession save flow, add the two fields to the PATCH body and the `api/db/interviews.js` PATCH whitelist, and verify in browser. Not fixed in this branch — needs UI work outside the scope of "what's making content/publish bad right now."

---

### P1 · 5. `cleaned_messages` is empty on 4/5 completed interviews

**Symptom:** `interviews.cleaned_messages` is empty (`[]`) on every completed interview except "Neck pain" (which has 8 cleaned messages matching its 8 raw messages).

**Root cause:** [/api/interviews/cleanup-transcript](../api/interviews/cleanup-transcript.js) timed out 8 times in the past 7 days with `Vercel Runtime Timeout Error: Task timed out after 60 seconds`. That endpoint was on the 60s default before the runtime flip to 300s; the failures here are on `May 15` (movebetter-people, movebetter-equine), which lines up with the `Sciatica` and the equine `Why your horse won't pick up the correct lead` interviews — both of which have `cleaned_messages = 0`.

**Impact:** every downstream prompt that asks "the conversation transcript is your primary source" gets the raw messages instead of the de-ummed/punctuated version. Quality is slightly lower; voice patterns are messier. Not catastrophic (the model handles disfluency), but it's the difference between "this sounds like Dr Q after editing" and "this sounds like an unedited Zoom transcript."

**Recommended fix:** confirm [api/interviews/cleanup-transcript.js](../api/interviews/cleanup-transcript.js) has `maxDuration: 300` (it should, per memory `feedback_vercel_node_runtime_handler_shape.md`). If yes, this is already self-healing for new interviews. Backfilling the 4 existing interviews is optional — a one-shot `update interviews set cleaned_messages = null where id in (…)` + a hit to the cleanup endpoint for each.

---

### P2 · 6. Historical noise that's already self-healed

Listed for completeness so a future audit doesn't re-investigate:

| Symptom | When | Root cause | Status |
|---|---|---|---|
| 136× `GET /api/db/clinicians` returning 500 with `PGRST200 — Could not find a relationship between 'interviews' and 'campaigns' in the schema cache` | May 15 23:00 – May 16 08:00 | Migration 045 applied but PostgREST schema cache hadn't picked up the FK. Cleared on its own after PostgREST's auto-refresh interval. | RESOLVED — last error May 16 08:57 |
| 36× `POST /api/publish/buffer` returning 500 with `ERR_INTERNAL_ASSERTION: Unexpected status of a module that is imported again after being required` | May 16 18:32 – 20:09 | Bad Node module bundle on a transient deployment (same class as PR #575 — see memory `feedback_node_err_internal_assertion_misleading.md`). A subsequent deploy fixed it. | RESOLVED — last error May 16 20:09 |
| 12× `POST /api/stream` timing out at 60s | May 12 | Stream endpoint was still on 60s `maxDuration` before the 300s upgrade. | RESOLVED — `api/stream.js` is now `maxDuration: 300`. |
| Multiple Buffer GBP `BAD_USER_INPUT` errors: missing `button`, uppercase `LEARN_MORE`, unexpected `summary` field | May 16 14–20 + May 17 19 | The Buffer GraphQL schema for `GoogleBusinessWhatsNewMetaDataInput` was relearned across PRs #609/#611/#612/#613. Final shape (lowercase `learn_more`, no `summary`, button required) is in [api/publish/buffer.js#buildMetadata](../api/publish/buffer.js). | RESOLVED — no errors since the May 17 19:48 burst on a since-replaced deployment. |
| 4× WordPress hero-image upload failing (503 / "WordPress temporarily unavailable") for movebetter-equine | May 16 12:11 – 12:34 | WordPress upstream flake; resize-before-upload was already shipped in PR #544 (memory `feedback_wp_hero_image_upload.md`). | RESOLVED — single bad afternoon for WP. Add explicit "retry once on 503" if it becomes a pattern. |
| 1× Instagram image rejected — 5472px exceeds 5000px max | May 16 18:16 | `prepareMediaForBuffer` doesn't downscale wide images. | OPEN — follow-up: cap image width at 1920 in [api/_lib/prepareMediaForBuffer.js](../api/_lib/prepareMediaForBuffer.js) (or 5000 for IG). |

---

## 3. Changes on this branch (`claude/friendly-mclean-33b753`)

**Code:**
- [api/_lib/bufferPostStats.js](../api/_lib/bufferPostStats.js) — patched GraphQL `input` shape; dropped `statistics` block to stop the 400s. Inline TODO documents the introspection query for the metrics field name.

**Tooling:**
- [scripts/audit-2026-05-17-cleanup.mjs](../scripts/audit-2026-05-17-cleanup.mjs) — dry-runnable cleanup that (a) clears scheduled_at on 3 overdue phantom rows, (b) strips markdown leakage from 5 draft social rows, (c) reports published rows with content issues without touching them.

**Verified:** `npm run typecheck`, `npm run lint`, `npm run build`, `npm run verify-bundles` all clean on the post-edit state.

**Not changed (deliberately):**
- The published GBP "link in profile" content_item — already live on Google. Editing the DB doesn't update the platform. Needs a manual edit in `business.google.com`.
- The 3 future-dated phantom-schedule rows — once the reviewer approves them, the existing Now/Schedule toggle will pick up the prefilled time.
- The `audience`/`story_type` save-flow bug — needs UI investigation that's outside this audit's scope.

---

## 4. Recommended next steps (in priority order)

1. **Review + merge this branch's PR.** Stops the buffer-analytics log spam tonight. ETA: 2 min review.
2. **Apply the cleanup script** with `--apply` to clear overdue phantom schedules + strip markdown leakage from drafts. ETA: 10 sec.
3. **Fix the GBP "link in profile" published post** in `business.google.com` (Move Better's Portland listing → 2026-05-12 post → edit). ETA: 2 min.
4. **Introspect the Buffer Post type** to find the right metrics field name, then re-add the stats block to `bufferPostStats.js`. Command in the file's TODO. ETA: 5 min once token is in hand.
5. **Investigate the audience/story_type save flow** — likely either the PATCH whitelist or the InterviewSession save payload. ETA: 30 min.
6. **Add a retry-on-503 wrapper** around WordPress media uploads if WP flakes again. ETA: 30 min, only if it recurs.

---

## 5. Process notes

- **My first read-through misdiagnosed PR #628 as reverted.** I was inspecting the project root (`/Users/qbook/Claude Projects/NarrateRx`, on `fix/kanban-view-only` — 11 commits behind main) rather than the worktree (which is on `origin/main`). PR #628's Now/Schedule toggle is intact on main and working correctly. The phantom-scheduled rows are atom-plan auto-fills that the reviewer never approved + published; nothing in the code is currently broken in the publish-timing path. Lesson recorded inline as a reminder to always confirm `git rev-parse HEAD` matches `origin/main` before drawing conclusions about regressions on `main`.
- **The buffer-analytics endpoint has been silently 502'ing for over a day.** The UI just renders zeroed metrics, which looks plausible — there's no client surface that fails loudly. Worth wiring a "no metrics in 24h on any published post" check into the daily cron or the weekly backup-reminder routine.
- **Migration 045 → schema-cache stale on PostgREST → 136 errors over 9 hours.** CLAUDE.md already says "verify the relevant migration is applied to prod before merging a PR that references a new column." Worth extending: after applying a migration that adds a FK on a table PostgREST reads, send `NOTIFY pgrst, 'reload schema'` from `apply-multitenant-migrations.mjs` to short-circuit the cache delay.

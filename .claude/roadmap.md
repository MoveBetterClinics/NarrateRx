# NarrateRx — Roadmap (single source of truth)

> **This is the only roadmap.** It replaces the previous five (`development-roadmap.md`,
> `development-roadmap-phase-4.md`, `development-roadmap-phase-5.md`,
> `development-roadmap-video-30day.md`, `plan-media-content-20day.md`). Forward plan
> first, shipped history condensed at the bottom.
>
> _Consolidated + fact-checked against live prod (Supabase `wrqfrjhevkbbheymzezy`) on
> 2026-05-30. Every number in "State of the world" was re-queried that day._
>
> **Scope:** Move Better in-house only (People + Equine + Animals). Tenant onboarding /
> growth to other businesses is explicitly **out of scope** for this plan.

---

## The one-sentence problem

> **Capturing photo/video and getting *relevant media attached to words* efficiently is
> the stall.** Q can bury the producer in interviews and words; if relevant media can't be
> attached, it's dead in the water. This is the slowest part of the process by far.

Voice fidelity, team adoption, and the declining-usage trend are all real, but they are
*symptoms or multipliers* of this one join failing.

---

## State of the world (verified live, 2026-05-30)

1. **The media↔content join is at ~0%.** Move Better holds **948 active media assets**
   (695 photos + 253 videos; 1,016 including 68 archived). The number ever attached to a
   content piece: **0** — `content_item_ids` is empty on every asset across all three
   workspaces. Yet **14 of 15** published/scheduled People pieces *have* media and **most of
   the 19 drafts don't**. Media attached → it ships. No media → it rots.

2. **The video segmentation pipeline has never run.** **0 `video_segments` ever created;**
   `segment_status` is null on all but 1 video. The "one long talk → many clips" engine has
   produced nothing in production — the long sources were never put on the conveyor.

3. **The knowledge base is FULL but only half-consulted.** Q has **146 voice phrases, 64
   practice-memory chunks**; the People workspace has **590 visual-memory chunks** (960
   across all workspaces). Dr. Cullen has 53 phrases / 17 practice chunks. Root cause in
   code: `captionGen.js:70` looks up phrases by `staff_id`, but **~92% of Move Better media
   has `staff_id = null`** (People photos ~96%, People videos ~78%), and **no clip
   transcript is passed into caption generation** — so the two richest signals (the
   clinician's phrases + what's actually said in the clip) are both bypassed.

4. **Voice-phrase learning is gated on APPROVAL, not capture.** Confirmed in code:
   `api/db/content.js:188` fires `extractVoicePhrases()` **only when a content item's status
   transitions to `approved`**. Result — clinicians who gave real interviews but had no
   content approved have **0 voice phrases**:

   | Clinician | Interviews | Voice phrases | Practice chunks |
   |---|---|---|---|
   | Dr. Q | 5 | **146** | 64 |
   | Dr. Cullen | 3 | **53** | 17 |
   | Dr. Sophie | 2 | **0** | 14 |
   | Whitney | 1 | **0** | 13 |
   | Dr. Tyler | 1 | **0** | 7 |

   _(Note: `approved` is a transient trigger state, not a stored status — current
   `content_items` statuses are draft 19 / published 8 / scheduled 7 / in_review 1, so an
   "approved count" isn't reconstructable from the row today.)_

5. **Practice-memory capture-indexing IS working** (corrected 2026-05-30 — a prior draft of
   this plan flagged a "live regression" here; live data refutes it). The 3 most recent
   completed interviews each produced practice chunks: **Tyler (05-30): 7, Whitney (05-29):
   13, Q (05-28): 9.** So the gap is **narrower than "they learned nothing"**: completing an
   interview *does* feed practice memory; it just **does not yet feed voice phrases**. The
   generic-caption problem traces specifically to missing **voice phrases + transcript**, not
   missing practice memory. _(Indexing path is unguarded, though — see F3.)_

6. **The edit-learning loop has never run** (`voice_notes` edit analysis is a manual button
   nobody clicks). Every edit the team makes currently teaches the system nothing.

### The smoke proof (run live, 2026-05-30)

Same clinic-intro clip (`Move Better v2.mov`, real 3,163-char Q transcript), caption written
three ways against Q's 146 real phrases:

- **A — today's path** (no phrases [staff_id null], no transcript): _"Movement isn't just
  about the body — it's about getting back to the life you love…"_ → generic, any clinic.
- **B — phrases wired in:** _"Your body isn't broken — it's doing exactly what it learned to
  do, and that strategy is something we can actually change."_ → unmistakably Q.
- **C — phrases + the clip's own transcript + practice memory:** _"…what works isn't what we
  *think* should work, it's what actually works for *you*. Watching that sense of hope come
  back is the part of this work that never gets old."_ → Q's voice **and** anchored to what
  he actually said in this clip.

**Conclusion: the moat is real and sitting unused in the database.** The bet is not "buy a
clipper" and not "build a better clipper" — it's **plug the brain into the join.**

---

## The one rail

> **The brain learns from everything, and feeds everything.**
> Every bet is either **FEED THE BRAIN** (capture/completion/edits teach it) or **USE THE
> BRAIN** (selection + captions + attachment consume it). The media↔content join is where
> "use" lives; the learn-on-capture work is where "feed" lives. Same moat, up- and downstream.

| Layer | Moat? | Approach |
|---|---|---|
| Mechanics (transcribe, reframe, caption-burn, encode) | No | Commodity — libraries / ffmpeg / Whisper are fine. |
| **Selection** (which 18 seconds, for which point) | **Yes** | Build, fed by the knowledge base. Outsourcing = building the anti-moat. |
| **Voice** (the caption in *this* clinician's words) | **Yes** | Build, fed by phrases + transcript + practice memory. |

---

## The bets

> ### Sprint update — 2026-05-31 (code shipped; human-attach gates still govern "done")
>
> Days 1–4 work largely landed. Per this plan's own verification bar, **code-merged ≠ done** —
> the human-attach gates still decide whether a bet truly advanced.
>
> - **F3** ✅ code shipped — [#1077](https://github.com/Move-Better/NarrateRx/pull/1077). Hard cap + retry on the summary model call, PATCH, and the shared embeddings HTTP call. No human gate (resilience).
> - **F1** ✅ code shipped — [#1078](https://github.com/Move-Better/NarrateRx/pull/1078). Extracts on interview *completion* at provisional weight 0.5. Proven on Dr. Tyler's real transcript (0→25 phrases). **Gate pending:** confirm a non-Q clinician's *next* live completion lands phrases.
> - **F4** ✅ COMPLETE — the code (claim-by-email + access-matrix reconciliation surface) was already on `main`; Part A prod reconciliation **verified done** 2026-05-31 via a live child-count audit (every clinician bound, learning intact; the "unclaimed proxies" were e2e smoke fixtures). Open flags resolved: Whitney already `org:admin` ×3, e2e kept admin (Playwright role-tolerant), AJ confirmed interviewable talent. Only the *optional* Clerk invite-accept webhook is unbuilt. **No prod writes were needed.**
> - **Caption grader** ✅ SHIPPED — [#1081](https://github.com/Move-Better/NarrateRx/pull/1081) merged. The
>   `captionFidelity` scorer was the wrong instrument: it **never received the clip transcript** and two of
>   its five dimensions rewarded clinical register ("real anatomy, technique names"), so it penalized
>   faithful warm/personal captions. Rewrote it to `faithfulness-v2` (single shared rubric
>   `api/_lib/captionFidelityRubric.js`): grades **said_fidelity** against the transcript + **register-neutral
>   voice_match**. Baseline recalibrated 5.5→4.8. This was the keystone unblock for U1.
> - **P0 (media→content matching) ⚙️ ENGINE SHIPPED, UX gate blocked on redesign.**
>   [#1084](https://github.com/Move-Better/NarrateRx/pull/1084) + [#1091](https://github.com/Move-Better/NarrateRx/pull/1091) merged.
>   `POST /api/content-items/suggest-media` (whole-asset, draft→media direction of `searchClips`); `/needs-media`
>   worklist + nav item; `MediaSuggestions` one-click strip in the Assets panel. 579/579 People assets re-indexed.
>   Platform-kind filter (#1091): youtube/tiktok→video-only, blog/landing→photo-only. Verified on real drafts.
>   **Gate blocked:** Q's gate run hit a hard UX wall — the in-editor Assets tab (80–128px thumbnails, no video
>   playback) is built for reading text, not evaluating media. Gate paused; **media-approval UI redesign spawned
>   as a separate task** (ask-before-build). Gate resumes once the redesigned full-size media-approval page lands
>   (gate = Philip/Q attaches ≥10 drafts in one sitting + draft-with-media rate moves off ~50% floor).
>
> - **U1** ✅ **ADVANCED — human gate cleared 2026-05-31.** [#1079](https://github.com/Move-Better/NarrateRx/pull/1079)
>   merged. The −0.68 "regression" was the *grader's* fault; under the fixed grader transcript-grounding wins
>   **+1.74 overall / +2.62 said_fidelity, C beats A 7/7**. Human-attach gate now done: **Q ran the Zach/Cullen
>   clip live** (Library → "Use whole video" → Slate → Edit-to-read → Approve→draft), voice fidelity **7.3
>   (green)**, verdict **"Caption is great. Sounds exactly like Zach."** A named human used it on real data and
>   the metric is good → bet advanced. Cosmetic follow-up only: the Slate card `object-cover`-crops the 16:9
>   long-form render so the burned caption band *looks* side-clipped in the preview (published file isn't), and
>   a ~300-char caption is too long to burn onto the band so the overlay ellipsis-truncates (full caption is
>   preserved as the draft post copy). Not a U1 issue. Distribution gap confirmed (no clip→caption→attach
>   button; it's buried under "Use whole video") — the U3/U4 target.
>
> State-of-the-world items 4 (approval-gated phrases) and 5 (capture-indexing) above are the
> gaps F1 and F3 just closed — read them as the pre-sprint baseline.

### FEED THE BRAIN (the learning rail)

| # | Bet | What it does | Est. Days | Est. Claude Cost |
|---|---|---|---|---|
| **F1** ✅ #1078 | Learn voice phrases on capture | Extract voice phrases from the interview transcript **at completion**, not only on approval (`content.js:188`). Gives every clinician a real voice substrate from day one — closes the gap that leaves Sophie/Tyler/Whitney at 0 phrases. _Shipped (provisional weight 0.5); live phrase-on-completion gate pending._ | 1–2d | $6–12 (Sonnet) |
| **F2** | Auto edit-loop | When a draft is edited + approved, auto-analyze the diff into `voice_notes`. Every edit becomes learning, no manual button. | 1–2d | $5–10 (Sonnet) |
| **F3** ✅ #1077 | Harden capture-indexing | The summary→practice-memory `waitUntil` path **currently works** but is unguarded (no retry / hard cap / log). Protect the one feed mechanism that already fires on completion so it can't silently strand. _Shipped: AbortSignal hard caps + retry on summary call, PATCH, embeddings._ | 0.5d | $2–4 (Sonnet) |
| **F4** ✅ identity DONE | Roster de-dup + attribution | Reconcile Clerk members ↔ `staff` rows; backfill `staff_id` on existing media (null on ~92%). Prereq for F1 *and* U1. **Execution runbook inline below.** _Code + Part A reconciliation complete 2026-05-31 (see banner below). Media `staff_id` backfill still belongs to U1's attach work._ | 1–2d | $4–10 (Sonnet) |

### USE THE BRAIN (the media↔content join — the bottleneck)

| # | Bet | What it does | Est. Days | Est. Claude Cost |
|---|---|---|---|---|
| **P0** ⚙️ engine ✅ #1084/#1091, UX gate pending redesign | Whole-asset media→content matcher | `POST /api/content-items/suggest-media` (draft→media, `searchClips`); `/needs-media` worklist; `MediaSuggestions` strip; platform-kind filter (video-only/photo-only). Engine validated on real data. Gate blocked on cramped in-editor UX → media-approval UI redesign task spawned (ask-before-build). Gate = attach ≥10 drafts in one sitting + link-rate moves. | 3–5d done | $12–22 done |
| **U1** ✅ ADVANCED | Wire the brain into captions (keystone) | Set `staff_id` on media at capture + thread the clip's transcript into `generateCaption`; load the phrases that already exist (`captionGen.js`). This is Caption A→C from the smoke. Smallest change, biggest measurable lift. _Dropped-param fix correct + CI-green. The early −0.68 "regression" was the broken grader, now fixed (#1081); re-measured **+1.74 overall / +2.62 said_fidelity, 7/7**. Human-attach gate cleared 2026-05-31 (Q, Zach/Cullen clip, fidelity 7.3, "sounds exactly like Zach")._ | 1–2d | $6–14 (Opus prompt + Sonnet) |
| **U2** | Knowledge-fed clip selection | Feed phrases + practice memory into `segmentDetect` so it picks moments that sound like the clinician. | 2–3d | $10–20 (Opus + Sonnet) |
| **U3** | Assisted pick→edit→attach loop | Propose 3–5 clips → human picks → light in-app trim / crop-to-vertical / caption → **attach to the draft.** Adds the missing human-pick gate (`render-segments` renders all today). | 3–5d | $15–30 (Sonnet, some Opus) |
| **U4** | Daily short-clip lane (highest frequency) | The *most common* capture: drop a short clip → knowledge-fed caption → pick → attach. Includes the **no-audio path** (caption from visual + topic + phrases when audio is lost). | 2–4d | $10–20 (Sonnet) |
| **U5** | Photo→compose bridge | Surface 3–5 candidate photos from the 695-photo graveyard onto blog-hero / IG drafts at compose time. Same propose-pick pattern, easier than video. | 2–3d | $8–16 (Sonnet) |

### ENDGAME (only if the rail holds under real load)

| # | Bet | What it does | Est. Days | Est. Claude Cost |
|---|---|---|---|---|
| **E1** | Video-interview capture | Record video *during* the live interview → one session yields words + attributed clips + media inserts. The natural fusion of the interview engine + the clip lane. | 4–6d | $20–40 (Opus + Sonnet) |
| **E2** | One talk → a month (repurpose A2) | The monthly long-capture: master + social clips bundled as one campaign. Spec: `feature-repurpose-a2.md`. | 3–5d | $15–30 (Sonnet) |

---

## F4 detail — staff identity reconciliation (execution runbook)

> **✅ EXECUTED — verified complete 2026-05-31.** Live child-count audit confirmed every
> target row exists, bound to the correct Clerk `user_id`, learning intact (Cullen 53 phrases,
> Whitney-Equine 37, Q 146; Tyler split merged, orphan `5a252b47` gone; Animals empty Q proxy
> `c4cce5c2` gone without touching its 1-interview sibling). All Part-A claims/renames/merges
> below are DONE. Open flags resolved: Whitney already `org:admin` in all 3 orgs; Alli kept
> effective-owner (intended); e2e kept admin (Playwright specs are role-tolerant); AJ confirmed
> interviewable talent. **No prod writes were required at execution — the work was already
> applied.** The runbook is retained as the audit trail. _Not yet done: the media `staff_id`
> backfill (~92% null) — that rides with U1's attach work, not this identity pass._

_Folded in from the former `plan-staff-integration.md`. All UUIDs/user_ids verified live
against prod (Supabase `wrqfrjhevkbbheymzezy` + Clerk API) on 2026-05-30._

**⚠️ Security action (do first): ✅ DONE — `CLERK_SECRET_KEY` rotated 2026-05-31** (new
`sk_live_…` confirmed working against the Clerk API). It had been exposed in a Claude session
transcript 2026-05-30; the new key is in 1Password (`narraterx-local`) + Vercel `narraterx`
prod env. Old key dead on roll.

**Root cause (one bug → all splits):** `api/staff/ensure-self.js:127` claims a clinician's
pre-existing proxy row by **name match** (`name=ilike`). On login Clerk supplies a profile
name (`drtyler`, `Michael Quasney`, `Zach Cullen`) that ≠ the admin-set display name
(`Dr. Tyler`, `Dr. Q`, `Dr. Zachary Cullen`) → no match → a fresh EMPTY row is created,
orphaning the learning. **Fix: match on email** (`created_by_email` == Clerk primary email),
which is stable.

**Target state (decided 2026-05-30):**

| Person | Email | Workspaces | staff_type | Notes |
|---|---|---|---|---|
| Q | drq@ | People (owner), Equine, Animals | clinician | display `Dr. Q`, legal `Michael Quasney` |
| Whitney | drwhitney@ | People, **Equine (lead)**, **Animals (lead)** | clinician | claim Equine proxy; CREATE Animals row |
| Cullen | drzach@ | People | clinician | claim proxy (53 phrases) |
| Sophie | drsophie@ | People | clinician | claim proxy |
| Tyler | drtyler@ | People | clinician | MERGE split (keep proxy w/ learning) |
| AJ Adams | aj@ | People | clinician (talent) | CREATE row |
| Alli Madsen | alli@ | People | non_clinical_staff (producer) | CREATE row; ⚠️ Clerk admin |
| Philip | philip@ | People | non_clinical_staff (producer) | ✅ already correct |
| e2e | e2e@ | People | clinician | KEEP — intentional E2E runner |

**Part A — one-time cleanup (prod identity writes).** All workspace-scoped. The MERGE is the
delicate one: `staff_id` is an FK in **12 tables** (`concept_mentions, content_items,
interviews, media_assets, practice_memory_chunks, staff_corpus_documents, staff_recipes,
staff_voice_phrases, story_packages, video_segments, visual_memory_chunks,
workspace_onboarding_interviews`) — a merge MUST repoint all 12 or it silently drops learning.
Helpers: `scripts/merge-duplicate-staff.mjs`, `scripts/merge-drq-rows.mjs` (read + extend first).

- **People** (`76faa447-b1f4-4038-babc-4d86536b049d`):
  1. Claim Cullen — staff `4dc8770f-fde4-43b5-8095-70412ecd8506` → `user_id = user_3Dg9rAvtFYjZoUx1xE1oIyJARqT` (53 phrases preserved).
  2. Claim Sophie — staff `943b7dc3-1aed-4d06-94b3-6129155f3be2` → `user_id = user_3DuKCpQDQIcnvmk2w1Tgkhh7HSh`.
  3. Merge Tyler — keep proxy `9ad92a24-34ab-42cc-8cf4-74f582a2e504` (1 interview, 1 content, 2 concept_mentions); set `user_id = user_3EPMVyGr7nr3Vv1K4EsuiymsFq9`; repoint any FK rows from empty login `5a252b47-cce1-412a-85ab-9518ed3c5160` → proxy (check all 12 tables), then DELETE `5a252b47`.
  4. Create AJ — clinician, `user_id = user_3DaM77u4L0T8AXJRiZNwwCGHDAF`, name `AJ Adams`, created_by_email `aj@movebetter.co`.
  5. Create Alli — non_clinical_staff, tier `producer`, `user_id = user_3EJanw8N7Z3Z5OX6uuGtnrHyFDK`, name `Alli Madsen`.
  6. Leave `e2e` (`44b369a6`) + the two null-user `E2E Smoke *` fixtures (`2234d376`, `2d9a6c18`).
- **Equine** (`c871533c-7055-40aa-8aac-cf32a6a0db60`):
  7. Claim Whitney — staff `1dda338f-032b-41d5-9a95-b662ccc4a0c9` (37 phrases) → `user_id = user_3DWEe2NFl2XZLNTSAX3uQHlcL5g`.
  8. Rename Q — staff `c3afc82c-625a-4cc0-9a20-c499cb886b08`: name → `Dr. Q`, legal_name → `Michael Quasney`.
- **Animals** (`d7527281-d0e6-49e3-8bfd-2cca1a5fb25d`):
  9. Rename Q (real, bound) — staff `7d80b811-e95f-40e1-b0d8-acfaf2ffdcb9`: name → `Dr. Q`, legal → `Michael Quasney`.
  10. Delete empty Q proxy — staff `c4cce5c2-853f-4f1e-8c44-bc7e4731eb3f` (user_id null, 0 of everything; confirm zero FK rows first).
  11. Create Whitney (Animals lead) — clinician, `user_id = user_3DWEe2NFl2XZLNTSAX3uQHlcL5g`, name `Dr. Whitney Phillips`.

**Part B — durable fix (so it never regresses):**
1. `ensure-self.js`: claim by email, not name (case-insensitive `created_by_email` match before name fallback before create; keep the conditional-claim race guard).
2. Reconciliation surface: extend `/api/workspace/access-matrix` to flag (a) Clerk members with no staff row, (b) >1 staff row per email in a workspace, (c) bound rows whose email has an unclaimed proxy sibling — surface in `/settings/access` with one-click claim/merge for the owner.
3. (Optional) Member→staff on invite-accept via Clerk webhook so future Alli/AJ gaps can't open.

**Open flags to confirm at execution:**
- Alli is a Clerk ORG ADMIN but slated for `producer` tier — `/api/workspace/me` elevates org admins to `owner` via `isOrgAdmin` short-circuit, so her *effective* permission is owner regardless. Downgrade her Clerk role to `member` if she should only have producer powers. (Q to decide.)
- `e2e@` is a Clerk admin in the live People org — kept as the E2E runner; consider least-privilege (member) if the smoke suite allows.
- AJ as interviewable clinician — confirm he's on-camera/voice talent before investing capture/voice-clone.

**Done = both:** (a) every real Clerk member has exactly one bound staff row per workspace, no unclaimed proxies for active logins, no duplicate-per-email; (b) each merged/claimed clinician's learning still attached (phrase/chunk/media counts unchanged pre/post across the 12 FK tables). Then update `memory/workspace_clinician_roster.md`.

---

## The capture reality (drives sequencing)

- **Daily, most common:** short in-the-moment clips → **U4 is the highest-frequency value.**
  The pipeline that was *built* (long-form segmentation, U2/U3) targets the *monthly* case;
  the *daily* case is underserved. Front-load U4.
- **~Monthly:** one long capture (seminar/talk) → U2/U3/E2 territory. Raw material already
  exists (`Move Better v2.mov` 1GB w/ full transcript, `Testimonial Gary`, etc.; 32 videos
  >500MB) — it was just never put on the conveyor.
- **Endgame:** video-interview capture (E1) merges the two — the richest single session.

---

## The 20-day shape

A scoreboard of **clips/photos attached to content the team stands behind**, not PRs merged.
Each phase ends on a gate requiring **both a named human action AND a measurable fidelity
lift**.

### Days 1–4 — Keystone + floor
- **F4** roster de-dup + `staff_id` backfill (unblocks everything).
- **U1** wire the brain into captions (staff_id lookup + transcript param).
- **F3** harden the capture-indexing path.
- **Gate:** ✅ **CLEARED 2026-05-31.** Q ran the Zach/Cullen clip live (Library → "Use whole video"
  → Slate → Approve→draft); voice fidelity 7.3, verdict "sounds exactly like Zach." Caption-C
  out-scores Caption-A on the faithfulness-v2 grader (+1.74 overall, 7/7). Both halves met.

### Days 5–10 — The daily lane + learn-on-capture
- **U4** daily short-clip lane (drop → caption → pick → attach; no-audio path).
- **F1** learn voice phrases on interview completion.
- **Gate:** **Philip attaches 10 clips to drafts in one sitting** without leaving NarrateRx;
  media-link rate moves off 0%; AND **≥1 non-Q clinician gains voice phrases from an
  interview alone** (no approval needed) — proving the phrase doom-loop is broken.

### Days 11–16 — The long-form clip studio + photo bridge + edit loop
- **U2 + U3** knowledge-fed selection + assisted pick/edit/attach; drive `Move Better v2.mov`
  + a testimonial all the way through.
- **U5** photo→compose bridge.
- **F2** auto edit-loop.
- **Gate:** one real long talk → proposed clips → **Q picks → edited → attached**;
  draft-with-media rate **20% → 80%**; AND an edit auto-updates `voice_notes` for the first
  time, with the next generation measurably closer to the clinician.

### Days 17–20 — Endgame or harden
- **E1** video-interview capture *if* the studio held under real load; else **E2** repurpose,
  or buffer/harden U1–U5.
- **Gate:** depends on pick — same bar (a human used it + a score moved).

---

## Pipeline UX redesign — smoothing interview → publish (design approved 2026-05-31)

> **Status: design LOCKED, build NOT started.** The P0 media-matcher engine works but its gate
> was blocked on cramped in-editor UX (see the P0 bet). The redesign that unblocks it grew —
> with Q, iteratively, through a clickable mockup — from "a media-approval page" into a **full
> interview→publish flow + information-architecture redesign**. The visual spec is the clickable
> prototype **`.claude/storyboard-flow-mockup.html`** (open in a browser — it IS the build
> contract). Each phase ships as one PR, no auto-merge, Q drives merge/deploy, full DoD.

**The shape.** A four-stage producer spine — **Interview → Words → Media → Publish** — made to
feel like one flow via a persistent **pipeline stepper** on every stage + a reorganized sidebar
that mirrors it.

**Locked design decisions (Q-approved):**
- **Storyboard = the producer's media stage**, edge-to-edge: gate "Continue to publish" on ≥1
  attachment; platform-aware kind toggle (hide photo on video-only channels; warn on mismatched
  Library picks via `isKindMismatch`); 4–5-col candidate grid; per-card photo/video badge; queue
  uses an **age signal** (not uniform amber); publish step gets a **"Next up" loop-close** (no
  dead-end); one consistent "Back to Storyboard" label.
- **Compose moves INTO Storyboard** (Choose media → **Compose** → Publish). The carousel +
  text-over-image composer (WYSIWYG canvas, slide filmstrip, per-slide text/position/template,
  global theme) lives here, not on Publish. **Held at the mocked shape** — Q wants real-use trials
  before adding font/colour/drag controls. Publish shrinks to preview + schedule.
- **Words (Stories detail)**: approve→handoff promoted to a single primary "Add media in
  Storyboard →"; **transcript drawer** to compare drafts against what was actually said; keep
  remove-platform / delete / export.
- **Interview Setup rationalized**: required = **who · topic · Practice/Personal**; **Tone
  dropped** (fights the voice-faithful engine, barely wired); **Audience demoted** to an optional
  hint; Draft-style kept as a simple toggle. Rule: *ask up front only what you can't change
  later.* Completion screen leads with **"See your story →"** + voice %; video-attach optional,
  not a gate.
- **Nav reorg** (`Layout.jsx`): **Home · Overview** / **Produce**(Stories · Storyboard) /
  **Library**(Library · Capture) / **Tools**(Book · Write · Pre-Visit). Active item tracks the flow.
- **Three scopes, separated** (the key IA insight): **Home = me** (personal) · **Stories /
  Storyboard = my work** (producer) · **Overview = the whole clinic** (top-down).
- **Overview** = a new **role-gated** (owner/producer/director) clinic-wide board holding the
  three top-down lenses **Pipeline** (by stage) · **Calendar** (by ship date) · **Themes** (by
  topic + gaps) — relocated OFF the producer's Stories list, where they didn't belong.
- **Stories → Cards only** (the view toggle moves to Overview; light filters replace it).
- **Library slimmed**: drop the purpose filter ("B-roll" etc. — auto-tagging handles it), the
  workflow-lifecycle grouping, and the admin backfill; keep search · kind · **Collections** ·
  **Drive import** · upload · date grouping. Now that Storyboard does the picking, the Library is
  just a tidy pool.

**Build phases** (each a shippable, trial-able PR; ~12–18 focused days total):

| Phase | Ships | Est. Days | Est. Claude Cost |
|---|---|---|---|
| **1 · Storyboard core** | gate Continue, honest toggle, edge-to-edge + grid, publish loop-close, back-nav | 2–3d | $10–18 (Sonnet) |
| **2 · Compose-in-Storyboard** | carousel + overlay composer into the media stage; Publish→preview+schedule | 3–4d | $15–25 |
| **3 · Words + interview entry** | approve→handoff, Stories→Cards, rationalized Setup, "See your story" | 2–4d | $12–22 |
| **4 · Nav reorg + stepper** | `Layout.jsx` nav + Overview item; pipeline stepper across stages; mobile/collapsed | 2–3d | $10–18 |
| **5 · Overview + Library slim** | role-gated Overview route (relocate Pipeline/Calendar/Themes); Library cleanup | 3–4d | $15–25 |

Recommended start: **Phase 1** (most-validated P0s). A parked `storyboard-ui-audit` worktree
already has `Layout.jsx` edge-to-edge, `src/components/ui/BackLink.jsx`, and the
gated/honest-toggle `StoryboardPiece.jsx` started.

**Files in play:** `src/components/Layout.jsx` (nav + edge-to-edge), `src/pages/Storyboard*.jsx`,
`src/components/storyboard/*`, `src/components/story-detail/{AssetsPane,SlideEditor}.jsx`
(ApprovalPanel + composer; extract `publish/PublishPanel.jsx`), `src/pages/Stories.jsx` +
`src/components/stories/*` (Cards-only; relocate Pipeline/Calendar/Themes to a new Overview
route), `src/pages/MediaHub.jsx` (Library slim), `src/pages/NewInterview.jsx` +
`InterviewSession.jsx` (Setup + completion). Origin of this work: the P0 bet's spawned
"media-approval UI redesign (ask-before-build)" task.

---

## The verification bar (why this won't become 4 months of merged-but-dead PRs)

The prior video build "shipped in 4 days" yet delivered ~0 in-house value because **done was
declared at merge, not at "a named human used it and the output was good."** Every "shipped"
feature silently became validation-and-fix debt; the next floor got built on an unpoured
foundation (0 segments, a 2/10 caption, an unconsulted corpus).

> No bet advances until a **named Move Better human** (Q or Philip) has used it on **real**
> data in the live app **and** the relevant metric moved (fidelity score, media-link rate, or
> phrases-learned). One bet validated before the next starts. This is already in the
> Definition of Done ("feature used in-browser at least once") — the video lane skipped it.

**Corollary — the metric itself can be the bug (learned on U1, 2026-05-31).** "The relevant
metric moved" only works if the metric measures the right thing. U1 looked like a −0.68
*regression* — but the `captionFidelity` grader was broken: it never received the clip
transcript and rewarded clinical register, so it penalized faithful warm/personal captions.
After the grader was rewritten (#1081), the same change measured **+1.74**. So: **hold on a red
metric (correct — don't declare green when it isn't), AND audit the metric when it contradicts a
strong human read.** Before trusting an LLM-judge score to gate a bet, confirm it (a) receives
the reference it claims to compare against, (b) isn't rewarding a proxy (clinical jargon ≠
faithfulness), and (c) is averaged over ≥3 samples (single-shot scoring swings ±2 and flips
signs). Validate the grader with controlled probes; never tune the generator to game it. Full
write-up: `memory/feedback_validate_the_validator.md`.

---

## What this plan deliberately is NOT

- **Not buying a clipper.** Selection + voice are the moat; outsourcing builds the anti-moat.
  Mechanics (ffmpeg / Whisper) stay commodity.
- **Not tenant onboarding / growth.** Out of scope per Q.
- **Not "make the autonomous pipeline work."** The autonomous render bar is what produced
  2/10. The shape is **assisted** — propose, human picks, attach.
- **Not new voice features before the corpus is fed.** "Sounds like me" has no fuel until
  F1/F4 wire learning to capture.

---

## Open decisions to lock (think → build)

- **F1 weighting:** do interview-extracted phrases start at full weight or provisional
  (promoted on approval)? (Leaning provisional, so approval still refines.)
- **U3 in-app edit depth:** trim + crop-to-vertical + caption is v1. Is per-frame text
  overlay in, or deferred to the existing canvas path?
- **U4 no-audio caption:** caption from visual narrative + topic + phrases — acceptable, or
  require a one-line human topic first?
- **E1 vs E2 for days 17–20:** decide at the day-16 gate based on whether the studio held.

---

## References

- `feature-repurpose-a2.md` — E2 spec.
- `design-interview-output-voice-fidelity.md` — voice-fidelity redesign (overlaps F1/U1).
- `v6-rag-architecture-sketch.md` — the fusion layer U2 extends.
- Key files: `api/_lib/captionGen.js` (U1), `api/_lib/segmentDetect.js` (U2),
  `api/editorial/render-segments.js` (U3 pick-gate),
  `api/_lib/voicePhraseExtractor.js` + `api/db/content.js:188` (F1 trigger),
  `api/staff/refresh-voice-notes.js` (F2), `api/_lib/interviewSummarizer.js` (F3),
  `api/staff/ensure-self.js` (F4 claim-by-email).

---

# Appendix — Shipped foundation (condensed history)

Everything below is **already built and live**. Kept as a compact ledger so the forward plan
above doesn't have to relitigate what exists. "Shipped" = code merged; per the verification
bar, trust live output over any ✅.

## Product foundation — Phases 1–3 + Billing (2026-05-14)

- **Phase 1 — Revenue foundation:** IA refactor (2-item nav Home/Stories, PRs #370–376),
  content approval workflow (#377), New-Interview smart defaults + mic-check gate (#369/#374),
  interview pause/resume (#378).
- **Phase 2 — Clinical moat:** transcript highlight→route-to-format (#380), transcript export
  (#379), cross-staff Themes view (#381), geo-local topic intelligence (#382), Media Library
  redesign (#383).
- **Phase 3 — Retention:** Buffer Analyze integration (#384), performance→topic feedback loop
  (#385), self-serve onboarding + trial (#386), multi-location support (#388). Plus the
  exemplar feedback loop (Tiers 1–3, #274/#281/#282/#283/#291).
- **Billing (#391):** Stripe 3-tier (Solo $149 / Practice $299 / Multi $499), self-serve
  checkout + portal + webhook. _(Test mode; live-key swap pending Stripe verification.)_
- **Known loose end:** engagement-systems reconciliation — two engagement stores
  (`engagement_snapshots` vs `content_items.buffer_metrics`) shipped in parallel and were
  never unified; GA4 snapshots aren't yet read by "What's working." Not urgent.

## Multi-tenant pivot (complete)

Single shared `narraterx` deployment serving workspaces by subdomain; `/onboard` wizard;
per-tenant publish creds in `workspace_credentials`; 3 live workspaces. Legacy per-brand
overlay + `VITE_BRAND` retired. (See `memory/project_multitenant_pivot.md`.)

## Phase 4 — Producer tier (#933–936)

Permission middleware / capability gates, Weekly Engagement Digest cron (Mon→Fri), Tentpole
producer access, Brand QC tab. Per-staff capability matrix at `/settings/access` (#996,
mig 107).

## Phase 5 — Live + voice (shipped)

Live Interview (realtime duplex voice, OpenAI Realtime + WebRTC) at `/new/live-interview`;
practice memory hot-tier; onboarding interview → workspace voice synthesis; Workspace Book
auto-synthesis; URL-import lane. Clerk Core 3 upgrade (#878).

## Video output build — Phases 0–6 + V-series (the prior 30-day plan)

> ⚠️ **All of this merged but the in-house pipeline produced ~0 usable output** — which is
> exactly why the forward plan above exists. Treat as build history, not delivered value.

| Phase | Output | PRs |
|---|---|---|
| 0 — Setup + safety | migrations 083–085, owner/producer backfill | #871 |
| 1 — Capture + ingest | capture endpoint + visual memory index; PWA universal upload | #872/#879/#880/#881 |
| 1.5 — Non-clinical interview + Team UI rename | staff prompt mode, Clinician→Staff rename | #943 |
| 2 — Editorial brain | AI Gateway, clip-pull AI, caption + per-channel render, story packages, brand visual identity | #882–#888/#892/#895 |
| 3 — Clinician + Producer surfaces | Story Director Slate, Approve→Drafts, Triage/Consent/Coverage | #893/#894/#899 |
| 4 — Producer tier | (see Phase 4 above) | #933–936 |
| 5 — Integration + auto-publish | auto-publish GBP-first, per-channel opt-in, UTM loop; migs 100–102 | #914–918 |
| 6 — Launch | video pipeline default-on + onboarding capture, PWA manifest, chaos smoke | #950–952 |

**V-series extensions (all shipped):** V1 caption-fidelity CI gate (#— , baseline 5.5, scorer
`scripts/voice-fidelity-captions.mjs`, gate `scripts/verify-caption-fidelity.mjs`), V3 AI
b-roll (#953/#954), V5 UTM engagement loop (#955), V6 practice-memory RAG fusion (#907,
migs 097–099), V10 live shooting-director (#956). Multi-clip video v1 (#979/#981/#982,
mig 105) — *not verified end-to-end on a real long source.*

**Video-pipeline hardening (2026-05-29):** `pending_broll` status constraint fix (mig 104),
large-source downscale-on-ingest (#967), async render + 202/polling (#969), 60s render cap
(#972) + ultrafast proxy (#973), OrgGate PWA false-"No access" fix (#965).

### Why the video build's "✅ shipped" ≠ done

A 2026-05-30 grounding pass found 0 `video_segments` ever created, 1 story package reached
`complete` and it scored 2/10, captions ignored the (full) knowledge base, and per-clinician
voice-learning fired only on approval. The real bottleneck was **attaching relevant media to
words**, not "widening to more tenants." That correction *is* the forward plan above.

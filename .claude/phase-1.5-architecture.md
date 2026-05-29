# Phase 1.5 — Team-as-Talent (Non-Clinical Staff Interview Mode)

_Drafted 2026-05-27. Phase 1.5 of the 30-day video output build. Implements the team-as-talent principle (`memory/principle_team_as_talent.md`) at the interview-prompt layer._

## Goal

Make non-clinical staff (front desk, MA, scheduler, billing — anyone with `clinicians.staff_type='non_clinical_staff'`) interviewable using a prompt that probes THEIR view of the clinic, not clinical authority claims. Clinical interviews remain byte-identical.

First applied user: Philip Abraham III (Move Better People Producer, `staff_type='non_clinical_staff'`).

## Scope of this PR

**In:**
- New `getNonClinicalStaffInterviewSystemPrompt()` in `src/lib/prompts.js`
- Branch in `getInterviewSystemPrompt()` on `opts.staffType === 'non_clinical_staff'`
- Both interview callers (`InterviewSession.jsx`, `PhoneCall.jsx`) pass `staffType` from the clinician row
- This architecture doc

**Out (deferred):**
- Non-clinical blog post prompt — Phase 1.5 follow-up after Philip's first interview produces real material
- Non-clinical atom prompts (social/video script/marketing batch)
- Team UI label rename ("Clinicians" → "Team" in sidebar / settings)
- Downstream content-lane filtering (clinical authority lanes stay clinician-only — enforced by the upstream prompt, not by a separate filter for now)

## Prompt design

The non-clinical staff interview probes **6 areas** (vs. the clinical interview's 7):

1. **What patients ask you** — recurring questions, exact phrasings
2. **What you notice over time** — observed shifts in returning patients
3. **What makes this clinic feel different** — culture, rituals, specifics
4. **Your own story** — how they got here, what they care about
5. **What you see the clinicians doing well** — cross-role appreciation
6. **A patient moment that stuck with you** — the trust-signal heart

Hard rules baked into the prompt:
- **CRITICAL** block forbids clinical opinions, treatment recommendations, diagnosis takes
- When the interviewee starts giving clinical opinions, the interviewer redirects to observation
- "NEVER ask for clinical recommendations" is repeated in the RULES section

## Branching point

`src/lib/prompts.js` — at the top of `getInterviewSystemPrompt`:

```js
if (isGeneralMode(workspace)) {
  return getGeneralInterviewSystemPrompt(...)
}
if (opts.staffType === 'non_clinical_staff') {
  return getNonClinicalStaffInterviewSystemPrompt(...)
}
// existing clinical flow continues unchanged
```

When `staffType` is undefined, falsy, or `'clinician'` — existing clinical prompt runs **byte-identical** to before this change.

## Why no separate feature flag

The migration 084 default for `clinicians.staff_type` is `'clinician'`. Only rows explicitly set to `'non_clinical_staff'` get the new path. Currently that's **Philip only** (verified via the Phase 0 backfill). Even if the non-clinical prompt has bugs, it can only affect Philip's interviews.

If Q wants belt-and-suspenders, we can gate on `workspaces.video_pipeline_enabled` as well — but that flag is conceptually about the video pipeline, not interview modes. Keeping it un-gated keeps the team-as-talent principle's reach broader than just the video build.

## Validation

Once Philip generates a `clinicians.capture_upload_token` and uses the iOS Shortcut to send a capture (Phase 1 D2), he can ALSO be invited to do a live interview via `/new/live-interview` or a turn-based interview via `/new/interview`. The interview will:

1. Look up his `clinicians` row → sees `staff_type='non_clinical_staff'`
2. Pass `staffType` in opts to `getInterviewSystemPrompt`
3. Branch to `getNonClinicalStaffInterviewSystemPrompt`
4. Bernard probes the 6 non-clinical areas
5. Transcript saves to `interviews` table as usual

The clinical → blog generation pipeline will currently try to extract clinical content from his transcript and produce something off-key. **That's expected for this PR.** Phase 1.5 follow-up adds non-clinical content lane prompts (patient FAQ, clinic culture, "who I am") so the transcript becomes useful content.

## Downstream content lane mapping (target state, not yet implemented)

Per `memory/principle_team_as_talent.md`:

| Content lane | `clinician` | `non_clinical_staff` |
|---|---|---|
| Clinical authority blog | ✓ | ✗ |
| Condition explainer | ✓ | ✗ |
| Patient FAQ | ✓ | ✓ |
| Clinic culture / team story | ✓ | ✓ |
| Testimonial-style observations | ✓ | ✓ |
| "Who I am" personal story | ✓ | ✓ |

Enforcement: at content-generation time, the UI surfaces only lanes appropriate to the transcript's clinician's staff_type. (Phase 1.5 follow-up.)

## Production safety

- Existing clinical interviews unchanged (byte-identical when staff_type is 'clinician' or undefined)
- New prompt only activates for explicitly-flagged non-clinical staff rows
- No new API endpoints, no new schema changes (uses existing migration 084 columns)
- No edits to existing helper functions (`formatInterviewContextForPrompt`, `buildPieceDirectionBlock`, etc.)

## D2-adjacent acceptance test (when Philip is ready)

Either Q or Philip:
1. Sign in to `movebetter-people.narraterx.ai` as Philip
2. Start a turn-based interview at `/new/interview` with topic like "What patients ask at the front desk"
3. Verify Bernard's first message frames the conversation around Philip's observations, not clinical advice
4. Verify Bernard never asks for treatment recommendations
5. Generate transcript, save

Expected first-message vibe (paraphrased):
> "Hey Philip, Bernard here — thanks for making the time. So, you're up front every day — patients are coming through, calling in, all kinds of moments. What are the recurring questions you hear at the front desk that maybe don't make it to the treatment room?"

If Bernard ever asks "what would you recommend for back pain" → the prompt is failing and we tighten the CRITICAL block.

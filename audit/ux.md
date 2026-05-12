# UX Audit — NarrateRx Pre-Launch

## User Journeys

### Primary
**New interview → AI generation → review/edit → publish**
`NewInterview` → `InterviewSession` → `InterviewOutput` → `ReviewPost`

### Secondary
1. Onboarding wizard (`/onboard` → `Onboarding.jsx`)
2. Media Hub: upload → tag → use in post (`MediaHub.jsx` → `MediaPicker`)
3. Settings: workspace config, integrations, members
4. Content Hub / Content Calendar browsing
5. Strategy page review
6. Dashboard (GettingStarted checklist, ResumeStrip, ClinicianTiles)

---

## Findings

### LOADING STATES

| # | Severity | File | Finding | Status |
|---|---|---|---|---|
| L1 | medium | `src/pages/NewInterview.jsx:414` | Topic suggestions show spinner text but no layout skeleton — blank white space while loading | needs decision |
| L2 | medium | `src/pages/InterviewSession.jsx:409` | Full-screen spinner blocks entire UI during initial load; no progressive rendering | needs decision |
| L3 | medium | `src/pages/InterviewOutput.jsx:403` | Generation feedback has no time estimate; "15-30 seconds" text is small/buried | needs decision |
| L4 | low | `src/pages/ReviewPost.jsx:169` | Artificial 100ms `setTimeout` before setting `isFirstLoad.current = false` — race if user navigates fast | **AUTO-FIXED** |
| L5 | low | `src/pages/Dashboard.jsx:110` | GettingStarted checklist flashes in after main spinner; no skeleton | needs decision |

### ERROR STATES

| # | Severity | File | Finding | Status |
|---|---|---|---|---|
| E1 | high | `src/pages/NewInterview.jsx:96` | Interview creation error shown at top of page as generic message; no contextual hint about which step failed | needs decision |
| E2 | medium | `src/pages/InterviewSession.jsx:286` | Microphone error shown in small gray text — easy to miss mid-interview | needs decision |
| E3 | medium | `src/pages/InterviewOutput.jsx:163` | Generation error has no Retry button — user must navigate away and back | needs decision |
| E4 | medium | `src/pages/ReviewPost.jsx:126` | Autosave error clears after 2s — user may miss it and think changes were saved | **AUTO-FIXED** |
| E5 | medium | `src/pages/Dashboard.jsx:118` | Clinician load failure shows error text but no Retry button | needs decision |
| E6 | medium | `src/pages/Onboarding.jsx:486` | Website scan failure shows no specific error reason; no Retry affordance | needs decision |
| E7 | high | `src/pages/WorkspaceSettings.jsx:175` | Invalid JSON in topic_suggestions_json shows parse error but no "Use defaults" escape hatch | needs decision |
| E8 | medium | `src/pages/Integrations.jsx:115` | Credential save failure is generic; field-specific error paths not surfaced | needs decision |

### EMPTY STATES

| # | Severity | File | Finding | Status |
|---|---|---|---|---|
| ES1 | low | `src/pages/Dashboard.jsx:184` | If all in-progress interviews fall outside the 14-day resume window, nothing renders — no explanation | needs decision |
| ES2 | medium | `src/pages/InterviewOutput.jsx:75` | Social tab doesn't explain blog must be generated first; `generateGroup('social')` silently returns if blog missing | **AUTO-FIXED** (error message) |
| ES3 | low | `src/pages/ContentHub.jsx` | Verify empty state copy guides user to create first interview | punt (verify in Phase 9) |
| ES4 | low | `src/pages/MediaHub.jsx` | Verify empty state includes upload CTA | punt (verify in Phase 9) |

### ACTION FEEDBACK

| # | Severity | File | Finding | Status |
|---|---|---|---|---|
| AF1 | medium | `src/pages/NewInterview.jsx:127` | "Add to suggestions" success feedback is subtle; user might not notice chip was added | needs decision |
| AF2 | low | `src/pages/InterviewSession.jsx:490` | Save status uses tiny inline text; "⚠ Save failed" is easy to miss | needs decision |
| AF3 | low | `src/pages/InterviewOutput.jsx:432` | Copy button "Copied!" feedback resets after 2s — might be too fast | **AUTO-FIXED** (3s) |
| AF4 | high | `src/pages/ReviewPost.jsx:748` | Disabled Publish button gives no explanation of why it's disabled (media required, no GBP locations) | **AUTO-FIXED** (title attr) |
| AF5 | medium | `src/pages/ReviewPost.jsx:356` | After regeneration, user stays in Preview mode and may not notice new content | **AUTO-FIXED** (switch to edit) |
| AF6 | medium | `src/pages/ReviewPost.jsx:257` | Publish success navigates after 1.5s with no "Redirecting…" message | **AUTO-FIXED** (explicit message) |
| AF7 | low | `src/pages/InterviewOutput.jsx:738` | Slug-taken error doesn't auto-focus the slug input field | needs decision |
| AF8 | low | `src/pages/Onboarding.jsx:801` | Available slug shows green checkmark but input doesn't change border color | needs decision |

### DEAD ENDS

| # | Severity | File | Finding | Status |
|---|---|---|---|---|
| DE1 | high | `src/pages/InterviewSession.jsx:499` | "Finish" button active even with 0 messages — creates empty interview with nothing to generate | needs decision (UX change) |
| DE2 | high | `src/pages/InterviewOutput.jsx:75` | `generateGroup('social')` silently returns if blog missing — user sees no response | **AUTO-FIXED** (show error) |
| DE3 | high | `src/pages/ReviewPost.jsx:179` | fetch failure navigates to /hub silently with no toast explaining what happened | **AUTO-FIXED** (toast before navigate) |
| DE4 | medium | `src/pages/Dashboard.jsx:702` | ClinicianTile not wrapped in error boundary; corrupt clinician data crashes the row | needs decision |
| DE5 | medium | `src/pages/Onboarding.jsx:947` | If subdomain provisioning hangs past 30s, user sees "Setting up…" forever with no timeout error | needs decision |
| DE6 | medium | `src/pages/ReviewPost.jsx:719` | GBP publish with no locations: warning link to settings, but publish attempt still silently fails | needs decision |

### COPY ISSUES

| # | Severity | File | Finding | Status |
|---|---|---|---|---|
| C1 | low | `src/pages/InterviewSession.jsx:499` | "Finish" button ambiguous — sounds like "finish this answer" not "end interview" | needs decision (copy change) |
| C2 | low | `src/pages/NewInterview.jsx:491` | "Start Interview" on step 2 — could be "Begin Recording" | needs decision (copy change) |
| C3 | low | `src/pages/ReviewPost.jsx:804` | "Mark as performed well" vague; action result not clear without hover | needs decision (copy change) |
| C4 | low | `src/pages/Dashboard.jsx:497` | "Resume →" is ambiguous; could be "Continue interview →" | needs decision (copy change) |
| C5 | low | `src/pages/InterviewOutput.jsx:212` | Emoji-only tab labels ("📍 GBP Post") announced by screen reader as symbol names | fixed in Phase 5 (Accessibility) |
| C6 | medium | `src/pages/WorkspaceSettings.jsx:57` | JSON field labels use raw DB column names (patient_context_json) — confusing to non-technical users | needs decision (copy change) |

### DATA LOSS RISK

| # | Severity | File | Finding | Status |
|---|---|---|---|---|
| DL1 | high | `src/pages/ReviewPost.jsx:115` | Autosave error clears after 2s — user may navigate away thinking changes were saved | **AUTO-FIXED** |
| DL2 | high | `src/pages/ReviewPost.jsx:494` | Verify `useUnsavedChanges` is actually blocking navigation before leaving with unsaved edits | punt (verify in Phase 7 Forms) |
| DL3 | medium | `src/pages/InterviewSession.jsx:89` | Message save failure swallowed — no user notification | needs decision |
| DL4 | low | `src/pages/Dashboard.jsx:294` | GettingStarted dismissal Clerk metadata write fails silently | intentional (best-effort) |
| DL5 | medium | `src/pages/Onboarding.jsx:34` | Form state in useState; refresh mid-flow loses all data | needs decision |

---

## Auto-fixed in this phase

| Fix | File | Commit |
|---|---|---|
| Remove 100ms setTimeout in ReviewPost initial load | `ReviewPost.jsx:169` | TBD |
| Autosave error stays visible until next successful save | `ReviewPost.jsx:126` | TBD |
| Copy button resets after 3s instead of 2s | `InterviewOutput.jsx:435` | TBD |
| Disabled publish button gets title attr explaining why | `ReviewPost.jsx:748` | TBD |
| After regeneration, auto-switch to Edit mode | `ReviewPost.jsx:356` | TBD |
| Show "Redirecting…" text on publish success | `ReviewPost.jsx:257` | TBD |
| Show error when social generation attempted with no blog | `InterviewOutput.jsx:75` | TBD |
| Toast before navigating away on fetch failure | `ReviewPost.jsx:179` | TBD |

---

## Needs decision (with recommendation)

| # | Recommendation |
|---|---|
| DE1 | Disable "Finish" until ≥ 2 messages exchanged |
| DE5 | Show error after 30s timeout in Onboarding LaunchingScreen |
| E3 | Add inline Retry button in InterviewOutput generation error |
| E5 | Add Retry button on Dashboard error state (use React Query refetch) |
| DL5 | Persist Onboarding form to localStorage (restore on mount) |
| DE4 | Wrap ClinicianTile in ErrorBoundary |
| AF7 | Auto-focus slug field on error in WebsitePublishPanel |

---

## Punted

- ES3, ES4: Verify ContentHub/MediaHub empty states in Phase 9 (Functionality)
- DL2: Verify useUnsavedChanges in Phase 7 (Forms)
- C5: Emoji ARIA labels fixed in Phase 5 (Accessibility)
- All "needs decision" copy changes (C1–C6): defer to user

# Phase 5 — Accessibility Audit

**Date:** 2026-05-11  
**Branch:** audit/accessibility  
**Standard:** WCAG 2.1 AA  
**Scope:** All `src/pages/*.jsx` and `src/components/*.jsx`

---

## Summary

| Severity | Count | Auto-fixed | Needs decision |
|---|---|---|---|
| Critical (WCAG A) | 4 | 4 | 0 |
| High (WCAG AA) | 5 | 4 | 1 |
| Low / Best Practice | 2 | 1 | 1 |
| Clean (no violations) | 6 areas | — | — |

---

## Findings

### A11Y-01 — Microphone button lacks aria-label and aria-pressed
**Severity:** Critical — WCAG 4.1.2 Name, Role, Value  
**File:** `src/pages/InterviewSession.jsx:620`  
**Status:** ✅ Auto-fixed

The primary recording button showed only a `<Mic>` / `<MicOff>` icon switch with no accessible name or state indication. Screen reader users could not identify the button purpose or perceive when recording was active.

**Fix applied:**
- Added `aria-label={isListening ? 'Stop recording' : 'Start recording'}`
- Added `aria-pressed={isListening}` for toggle state
- Added `aria-hidden="true"` to icon children (name now comes from aria-label)

---

### A11Y-02 — Recording status not announced to screen readers
**Severity:** Critical — WCAG 4.1.3 Status Messages  
**File:** `src/pages/InterviewSession.jsx:608`  
**Status:** ✅ Auto-fixed

The status text cycle ("Tap to speak" → "Listening…" → "Speaking…") updated visually but had no `aria-live` region. Screen reader users in the interview recording flow had no way to perceive recording state transitions.

**Fix applied:** Added `role="status" aria-live="polite"` to the status `<p>` element. Icons inside the status spans marked `aria-hidden="true"`.

---

### A11Y-03 — Transcript display not announced
**Severity:** Critical — WCAG 4.1.3 Status Messages  
**File:** `src/pages/InterviewSession.jsx:602`  
**Status:** ✅ Auto-fixed

The interim transcript div updated in real-time as the user spoke but had no `aria-live` region. Screen reader users could not perceive transcript updates without navigating to the element manually.

**Fix applied:** Added `aria-live="polite" aria-label="Transcript"` to the transcript container.

---

### A11Y-04 — Blog post generation progress not announced
**Severity:** Critical — WCAG 4.1.3 Status Messages  
**File:** `src/pages/InterviewSession.jsx:581`  
**Status:** ✅ Auto-fixed

The "Writing blog post…" progress indicator (including the token-count stream) had no `aria-live` region. Long-running operation feedback was invisible to screen readers.

**Fix applied:** Added `role="status" aria-live="polite"` to the progress container div. Spinner icon marked `aria-hidden="true"`.

---

### A11Y-05 — Carousel navigation buttons lack accessible names
**Severity:** High — WCAG 4.1.2 Name, Role, Value  
**File:** `src/components/PostPreview.jsx:85, 93, 108–114`  
**Status:** ✅ Auto-fixed

The media carousel's Previous/Next arrow buttons had no `aria-label`. Dot indicator buttons had no accessible text at all.

**Fix applied:**
- Previous button: `aria-label="Previous slide"`
- Next button: `aria-label="Next slide"`
- Slide counter `<div>` marked `aria-hidden="true"` (decorative)
- Dot indicators: `role="tab" aria-label="Slide {i+1}" aria-selected={i === idx}` within a `role="tablist" aria-label="Slides"` container
- Arrow icons marked `aria-hidden="true"`

---

### A11Y-06 — Topic table rows not keyboard accessible
**Severity:** High — WCAG 2.1.1 Keyboard  
**File:** `src/pages/Dashboard.jsx:601`  
**Status:** ✅ Auto-fixed

`<tr onClick={...}>` rows in the TopicView table could not be activated via keyboard — only mouse click. Tab-stop and keyboard activation were both missing.

**Fix applied:**
- Added `tabIndex={0}` to make each row focusable
- Added `role="button" aria-expanded={selected === topic}` 
- Added `aria-label` with topic name and interview count
- Added `onKeyDown` handler for Enter and Space key activation

---

### A11Y-07 — Schedule date/time input lacks programmatic label association
**Severity:** High — WCAG 4.1.2 Name, Role, Value  
**File:** `src/pages/ReviewPost.jsx:676, 687`  
**Status:** ✅ Auto-fixed

The "Schedule for" label element had no `htmlFor` attribute and the datetime input had no `id`, making the association visual-only (not programmatic). Screen readers may not announce the field name.

**Fix applied:** Added `htmlFor="schedule-datetime"` to the label and `id="schedule-datetime"` to the input.

---

### A11Y-08 — Status filter select missing accessible name (MediaHub)
**Severity:** High — WCAG 4.1.2 Name, Role, Value  
**File:** `src/pages/MediaHub.jsx:296`  
**Status:** ✅ Auto-fixed

The media library's status filter `<select>` had no label element or `aria-label`. Screen readers announced it as "unlabeled select box."

**Fix applied:** Added `aria-label="Filter by status"`.

---

### A11Y-09 — Hover-reveal action icons not keyboard-visible
**Severity:** Low — Best Practice (Focus Visibility)  
**File:** `src/pages/Dashboard.jsx:365`  
**Status:** 🔴 Needs decision

Cards with `opacity-0 group-hover:opacity-100` action buttons become visible on mouse hover but not necessarily on keyboard focus. The `focus-visible:opacity-100` equivalent may be missing.

**Decision needed:** Add `group-focus-within:opacity-100` to these containers so keyboard-focused child buttons reveal the parent controls. This is a one-line Tailwind addition but requires verifying each affected card.

---

### A11Y-10 — Color contrast on muted text (suspected)
**Severity:** Low — WCAG 1.4.3 Contrast (AA requires 4.5:1 for body text)  
**File:** `src/pages/Dashboard.jsx:356` (`text-muted-foreground/40`)  
**Status:** 🔴 Needs decision (requires browser testing)

`text-muted-foreground/40` applies 40% opacity to already-muted text on `bg-background`. This likely fails the 4.5:1 contrast ratio requirement. Cannot verify ratio without rendered output.

**Decision needed:** Run the rendered UI through a contrast checker (browser DevTools color picker + axe extension). If failing, remove the `/40` opacity modifier.

---

## Already Compliant (Notable)

| Area | Status |
|---|---|
| Alt text on all `<img>` elements | ✅ All images have appropriate alt text |
| Modal / Dialog focus management | ✅ shadcn/ui `<Dialog>` handles focus trap + return correctly |
| MediaGrid keyboard navigation | ✅ Excellent roving tabindex with full arrow key support |
| Landmark roles | ✅ `<header>`, `<nav>`, `<main>` used correctly in Layout |
| BrandedLoader | ✅ `role="status" aria-live="polite"` already present |
| Most form labels | ✅ shadcn/ui `<Label>` used consistently in NewInterview, Onboarding, WorkspaceSettings |

---

## Auto-fixes Applied

| ID | Files | Change |
|---|---|---|
| A11Y-01 | `InterviewSession.jsx:620` | `aria-label`, `aria-pressed` on microphone button |
| A11Y-02 | `InterviewSession.jsx:608` | `role="status" aria-live="polite"` on status `<p>` |
| A11Y-03 | `InterviewSession.jsx:602` | `aria-live="polite"` on transcript container |
| A11Y-04 | `InterviewSession.jsx:581` | `role="status" aria-live="polite"` on generation progress |
| A11Y-05 | `PostPreview.jsx:85–114` | aria-labels on carousel nav + tablist pattern for dots |
| A11Y-06 | `Dashboard.jsx:601` | `tabIndex`, `role="button"`, `aria-expanded`, `onKeyDown` on topic rows |
| A11Y-07 | `ReviewPost.jsx:676, 687` | `htmlFor`/`id` pairing for schedule datetime input |
| A11Y-08 | `MediaHub.jsx:296` | `aria-label="Filter by status"` |

## Items Awaiting Decision

| ID | Priority | Description |
|---|---|---|
| A11Y-09 | Low | Add `group-focus-within:opacity-100` to hover-reveal action cards in Dashboard |
| A11Y-10 | Low | Run contrast check on `text-muted-foreground/40` — remove opacity modifier if failing 4.5:1 |

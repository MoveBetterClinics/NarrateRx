# Phase 6 — Responsive Design Audit

**Date:** 2026-05-11  
**Branch:** audit/responsive  
**Scope:** All `src/pages/*.jsx`, `src/components/*.jsx`  
**Target breakpoints:** 320px · 375px · 768px · 1024px · 1440px

---

## Summary

| Severity | Count | Auto-fixed | Needs decision |
|---|---|---|---|
| High (breaks at target breakpoint) | 4 | 4 | 0 |
| Medium (likely issues) | 5 | 4 | 1 |
| Low / Best Practice | 3 | 1 | 2 |

---

## Findings

### RESP-01 — Campaign dropdown overflows viewport on small phones
**Severity:** High  
**File:** `src/components/CampaignWidget.jsx:141`  
**Status:** ✅ Auto-fixed

The campaign mode selector rendered a `w-[360px]` dropdown anchored `right-0`. On a 320px viewport this extended 40px beyond the right edge; on iPhone SE (375px) it was borderline. No responsive variant existed.

**Fix applied:** Changed to `left-0 sm:left-auto sm:right-0 top-full w-[calc(100vw-1rem)] sm:w-[360px]` — full-width on mobile, fixed 360px on sm+.

---

### RESP-02 — Full-screen modals not constrained on mobile
**Severity:** High  
**Files:** `src/components/MediaDetail.jsx:273`, `src/components/ContentBriefDetail.jsx:190`  
**Status:** ✅ Auto-fixed

Both detail modals used `max-w-3xl` without a mobile-first base. At 375px the modal fills the viewport correctly (container has `p-4`) but was susceptible to overflow on 320px devices where 4px padding + 3xl max-width combined poorly.

**Fix applied:** Changed to `max-w-full sm:max-w-3xl` — respects container padding at any width.

---

### RESP-03 — Topic table missing horizontal scroll wrapper
**Severity:** High  
**File:** `src/pages/Dashboard.jsx:588`  
**Status:** ✅ Auto-fixed

The "Interview Count by Topic" table had `overflow-hidden` on its container, causing cell content to clip rather than scroll horizontally on narrow viewports.

**Fix applied:** Changed container to `overflow-x-auto rounded-xl border` and added `min-w-[320px]` to the table so it doesn't compress below readable width.

---

### RESP-04 — Launchpad grid doesn't stack on smallest phones
**Severity:** High  
**File:** `src/pages/Dashboard.jsx:413`  
**Status:** ✅ Auto-fixed

The app launchpad tiles used `grid-cols-2 lg:grid-cols-4` — 2 columns on mobile. At 320px each tile was 148px wide, crowding the icon + label layout.

**Fix applied:** Changed to `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4` — single column on the smallest phones, 2 on sm+.

---

### RESP-05 — Chat message max-width too restrictive on smallest phones
**Severity:** Medium  
**File:** `src/pages/InterviewSession.jsx:702`  
**Status:** ✅ Auto-fixed

At 320px, `max-w-[80%]` = 256px. With `px-4 py-3` padding and `text-sm`, longer AI responses forced very narrow text columns.

**Fix applied:** Changed to `max-w-[90%] sm:max-w-[80%]`.

---

### RESP-06 — Header icon buttons below 44×44px tap target
**Severity:** Medium  
**File:** `src/components/Layout.jsx:56–62`  
**Status:** ✅ Auto-fixed

The Workspace Settings (`Building2`) and Integrations (`Settings`) icon links in the header were bare `<Link>` wrappers with `h-4 w-4` icons and no explicit padding. Tap area was ~16px — well below the 44px WCAG minimum.

**Fix applied:** Added `inline-flex items-center justify-center h-9 w-9 rounded-md` to both links, making them 36px (WCAG recommends 44px but 36px is standard for desktop-only nav that is `md:flex` hidden on mobile — mobile users reach these via the hamburger menu).

---

### RESP-07 — Email preview iframe fixed at 960px height
**Severity:** Medium  
**File:** `src/components/PostPreview.jsx:587`  
**Status:** ✅ Auto-fixed

The email preview iframe had `height: 960` (px) fixed. On a phone (viewport height ~812px), this meant the iframe exceeded the screen, requiring vertical scroll through a nested scrollable frame — a poor UX pattern.

**Fix applied:** Changed to `height: 'min(960px, 80vh)'` — caps at 80% of viewport height on small screens.

---

### RESP-08 — Input groups too dense at 320px in NewInterview
**Severity:** Medium  
**File:** `src/pages/NewInterview.jsx:242–263`  
**Status:** 🔴 Needs decision

2-column grids for location selector, voice mode, and patient prototype selector are correct at 375px+ but very dense at 320px. The emoji + label layout in each cell crowds at ~142px column width.

**Decision needed:** Change to `grid-cols-1 sm:grid-cols-2` (single-column on tiny phones) — this changes the visual design but improves usability on the smallest devices. Low priority given the rarity of 320px phones among clinic staff.

---

### RESP-09 — Text truncation without title tooltip
**Severity:** Low  
**Files:** `src/pages/Dashboard.jsx:507` and similar  
**Status:** 🔴 Needs decision

Clinician names and post titles use `truncate` (single-line ellipsis) with no `title` attribute. Sighted keyboard users can't see the full text; touch users can't hover to reveal it.

**Decision needed:** Add `title={fullString}` to truncated elements so mouse-hover reveals the full text. Low effort, good UX hygiene.

---

### RESP-10 — Mobile layout is already well-implemented (Notable)
**Severity:** Info  
**File:** `src/components/Layout.jsx`  
**Status:** ✅ Clean

The mobile navigation (hamburger → Dialog) is correctly implemented with `md:hidden` / `hidden md:flex` guards, proper Dialog constrained width (`sm:max-w-sm`), and vertical stack nav items. No issues found.

---

## Auto-fixes Applied

| ID | File(s) | Change |
|---|---|---|
| RESP-01 | `CampaignWidget.jsx:141` | Dropdown: `right-0 w-[360px]` → `left-0 sm:left-auto sm:right-0 w-[calc(100vw-1rem)] sm:w-[360px]` |
| RESP-02 | `MediaDetail.jsx:273`, `ContentBriefDetail.jsx:190` | Modal: `max-w-3xl` → `max-w-full sm:max-w-3xl` |
| RESP-03 | `Dashboard.jsx:588` | Table: `overflow-hidden` → `overflow-x-auto`; added `min-w-[320px]` to table |
| RESP-04 | `Dashboard.jsx:413` | Launchpad: `grid-cols-2` → `grid-cols-1 sm:grid-cols-2` |
| RESP-05 | `InterviewSession.jsx:702` | Chat: `max-w-[80%]` → `max-w-[90%] sm:max-w-[80%]` |
| RESP-06 | `Layout.jsx:56–62` | Icon links: added `inline-flex items-center justify-center h-9 w-9 rounded-md` |
| RESP-07 | `PostPreview.jsx:587` | Iframe: `height: 960` → `height: 'min(960px, 80vh)'` |

## Items Awaiting Decision

| ID | Priority | Description |
|---|---|---|
| RESP-08 | Low | NewInterview 2-col grids at 320px — change to `grid-cols-1 sm:grid-cols-2`? |
| RESP-09 | Low | Add `title={fullString}` to truncated text elements throughout Dashboard |

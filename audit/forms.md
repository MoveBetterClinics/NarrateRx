# Phase 7 — Forms Audit

**Date:** 2026-05-11  
**Branch:** audit/forms  
**Scope:** `src/pages/Onboarding.jsx`, `WorkspaceSettings.jsx`, `NewInterview.jsx`, `ClinicianProfile.jsx`, `Members.jsx`, `Account.jsx`, `src/components/CredentialForm.jsx`

---

## Summary

| Category | Status | Findings |
|---|---|---|
| Disabled-on-submit | ✅ Clean | 0 violations |
| Double-submit prevention | ✅ Clean | 0 violations |
| Error display | ✅ Clean | All inline, recoverable |
| Form structure (Enter key) | ⚠️ Partial | NewInterview: Enter wired on 2 inputs; others button-click-only |
| useUnsavedChanges | ⚠️ Partial | WorkspaceSettings uses it; NewInterview does not |
| Autocomplete attributes | 🔴 Missing | 12 inputs fixed |
| Input types | 🔴 Missing | 4 URL inputs fixed |

---

## Findings

### FORM-01 — Missing `autoComplete` attributes on text inputs
**Severity:** Medium — impacts browser autofill UX, password manager warnings  
**Files:** 5 files  
**Status:** ✅ Auto-fixed

Inputs that browsers can autofill (organization names, URLs, addresses) lacked `autoComplete` attributes. The credential form's password input also lacked `autoComplete="new-password"`, which can cause password managers to incorrectly treat API keys as login passwords.

**Fixes applied:**

| File | Input | autoComplete added |
|---|---|---|
| `Onboarding.jsx:517` | Business name | `organization` |
| `Onboarding.jsx:520` | Website | `url` |
| `Onboarding.jsx:532` | Location city | `address-level2` |
| `Onboarding.jsx:543` | Location state/region | `address-level1` |
| `WorkspaceSettings.jsx:286` | Website | `url` |
| `WorkspaceSettings.jsx:359` | Brandbook URL | `off` |
| `WorkspaceSettings.jsx:387` | Booking URL | `off` |
| `WorkspaceSettings.jsx:1142` | Location city | `address-level2` |
| `WorkspaceSettings.jsx:1146` | Location state | `address-level1` |
| `WorkspaceSettings.jsx:1177` | Visit URL | `off` |
| `NewInterview.jsx:204` | Clinician name | `name` |
| `CredentialForm.jsx:196` | API secret | `new-password` |

Also: Updated the `Field` helper component in WorkspaceSettings to accept and pass through `type` and `autoComplete` props so future fields get these attributes without requiring a component refactor.

---

### FORM-02 — Missing `type="url"` on URL input fields
**Severity:** Medium — mobile browsers show numeric keyboard instead of URL keyboard  
**Files:** `Onboarding.jsx`, `WorkspaceSettings.jsx`  
**Status:** ✅ Auto-fixed

URL fields lacked `type="url"`, which tells mobile browsers to show a URL-appropriate keyboard (with `.com` button, forward slash, etc.) and enables browser-side URL validation.

**Fixes applied:**

| File | Field | Fix |
|---|---|---|
| `Onboarding.jsx:520` | Website | Added `type="url"` |
| `WorkspaceSettings.jsx:286` | Website | Added `type="url"` via Field `type` prop |
| `WorkspaceSettings.jsx:359` | Brandbook URL | Added `type="url"` via Field `type` prop |
| `WorkspaceSettings.jsx:387` | Booking URL | Added `type="url"` via Field `type` prop |
| `WorkspaceSettings.jsx:1177` | Visit URL (LocationFields) | Added `type="url"` |

---

### FORM-03 — Disabled-on-submit (all forms clean)
**Severity:** Info — verified clean  
**Status:** ✅ Clean

All submit/action buttons disable during async operations via state flags:
- `Onboarding.jsx`: `disabled={submitting}` on final submit button
- `WorkspaceSettings.jsx`: `disabled={saving}` on save button; `disabled={!matches || archiving}` on danger-zone button
- `NewInterview.jsx`: `disabled={!condition.trim() || loading}` on Start Interview
- `CredentialForm.jsx`: `disabled={disabled || saving}` on Save; `disabled={disabled || testing || saving}` on Test

---

### FORM-04 — Double-submit prevention (all forms clean)
**Severity:** Info — verified clean  
**Status:** ✅ Clean

All forms set a loading/saving state at the start of the async operation, which disables the button before the first response arrives. No race conditions identified.

---

### FORM-05 — Error display (all forms clean)
**Severity:** Info — verified clean  
**Status:** ✅ Clean

All forms display errors inline near the triggering action, not as floating toasts. Recovery paths are clear — users can edit and re-submit without page reload.

---

### FORM-06 — useUnsavedChanges guard partially applied
**Severity:** Medium — data loss risk on navigation  
**Status:** 🔴 Needs decision

`src/lib/useUnsavedChanges.js` exists and implements a `beforeunload` guard. **WorkspaceSettings.jsx** uses it correctly (`useUnsavedChanges(isDirty)` at line 165). However:

**NewInterview.jsx** has a multi-step wizard (clinician selection → topic/condition selection → interview start) with state accumulated across steps. If a user navigates away mid-wizard, they lose their progress silently.

**Decision needed:** Add `useUnsavedChanges(step > 0 && !loading)` to NewInterview to warn users who navigate away after completing Step 1 but before completing the form. This is a 2-line addition.

---

### FORM-07 — No HTML `<form>` elements; partial Enter key support
**Severity:** Low — non-standard but intentional  
**Status:** 🔴 Needs decision

All forms are implemented with React controlled components and button `onClick` handlers rather than `<form onSubmit>`. This means:
- Enter key doesn't naturally submit — must be wired per-input
- No browser-level form validation hooks
- NewInterview manually wires Enter on 2 inputs; other pages have no Enter support

This is a pattern choice that's consistent across the codebase. Converting to `<form>` elements is an architectural change beyond audit scope.

**Decision needed:** Accept current pattern and document it, or refactor forms progressively to use `<form onSubmit>` for improved keyboard UX.

---

## Auto-fixes Applied

| ID | Files | Change |
|---|---|---|
| FORM-01 | 5 files | `autoComplete` attributes on 12 inputs |
| FORM-02 | 2 files | `type="url"` on 5 URL inputs |
| — | `WorkspaceSettings.jsx` | `Field` component updated to accept `type` and `autoComplete` props |

## Items Awaiting Decision

| ID | Priority | Description |
|---|---|---|
| FORM-06 | Medium | Add `useUnsavedChanges` to NewInterview to prevent silent data loss mid-wizard |
| FORM-07 | Low | Architectural decision: `<form onSubmit>` vs current button-click pattern |

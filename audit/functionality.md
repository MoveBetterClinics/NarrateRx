# Phase 9 — Functionality Audit

**Date:** 2026-05-11  
**Branch:** audit/functionality  
**Scope:** `src/lib/`, `api/`, `src/App.jsx` — error paths, unhandled rejections, dead route coverage

---

## Summary

| Area | Status | Findings |
|---|---|---|
| Route coverage | ✅ Clean | All routes in App.jsx map to existing page components |
| API fetch error handling | ✅ Fixed | Success-path JSON parse now throws a typed error |
| AI response null guard | ✅ Fixed | `data.content[0].text` guarded against empty array |
| Dead links | ✅ Clean | No broken `<Link to=…>` or `<a href=…>` found |
| Unhandled rejections in pages | ✅ Clean | All major async calls wrapped in try/catch or React Query |
| Console.log calls | ✅ Clean | Cleared in Phase 2 |

---

## Findings

### FUNC-01 — `apiFetch` success path swallowed JSON parse errors
**Severity:** Medium  
**File:** `src/lib/api.js`  
**Status:** ✅ Auto-fixed

`apiFetch` parsed error responses defensively (`.catch(() => ({}))`), but the success path returned `res.json()` without a `.catch`. Any malformed success response from the server would cause an uncaught `SyntaxError` to bubble up to every React Query call site — showing a generic crash rather than a typed error message.

**Fix applied:**
```js
return res.json().catch(() => { throw new Error(`Invalid JSON from ${path}`) })
```

---

### FUNC-02 — `generateContent` would crash on empty AI response
**Severity:** Medium  
**File:** `src/lib/claude.js:65`  
**Status:** ✅ Auto-fixed

`data.content[0].text` was read without any null guard. If the `/api/generate` endpoint returned an unexpected shape (e.g. empty `content` array, rate-limit body, or an error slip-through), this line would throw `TypeError: Cannot read properties of undefined`. Callers in `InterviewOutput.jsx` and `ReviewPost.jsx` would surface a blank crash rather than an actionable message.

**Fix applied:**
```js
const text = data?.content?.[0]?.text
if (!text) throw new Error('Empty response from AI')
return text
```

---

### FUNC-03 — All App.jsx routes resolve to existing components
**Severity:** Info  
**Status:** ✅ Clean

Traced every `<Route path=…>` in `App.jsx` against the `src/pages/` directory. All 16 routes resolve to components that exist. The `*` catch-all routes (404 for main app and Onboarding shell) are both present.

---

### FUNC-04 — No dead `<a href>` or `<Link to>` targets
**Severity:** Info  
**Status:** ✅ Clean

Spot-checked cross-page links in Layout.jsx, Dashboard.jsx, ContentHub.jsx, and MediaHub.jsx. All `<Link to="…">` values correspond to routes registered in App.jsx. External `<a href>` values in emails and help text are hardcoded strings pointing to expected public URLs.

---

### FUNC-05 — `ReviewPost.jsx` try/catch wraps all outbound calls
**Severity:** Info  
**Status:** ✅ Clean

The agent initially flagged `r.json()` at line 895 as unguarded. On review, the call is inside a `try { … } catch (e) { setErr(…) }` block. No fix needed.

---

## Auto-fixes Applied

| ID | File(s) | Change |
|---|---|---|
| FUNC-01 | `src/lib/api.js` | `.catch` on success-path `res.json()` |
| FUNC-02 | `src/lib/claude.js` | Optional chaining + typed throw on empty AI response |

## Items Awaiting Decision

None. All functionality issues found were auto-fixable.

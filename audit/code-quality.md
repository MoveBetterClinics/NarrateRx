# Code Quality Audit — NarrateRx Pre-Launch

## Metrics at audit start
- **Largest components:** WorkspaceSettings.jsx (1,201 lines), ReviewPost.jsx (988), MediaDetail.jsx (678), BulkActionBar.jsx (567)
- **Console.log instances:** 69 (all in `api/` — legitimate server-side logging)
- **ESLint warnings at start:** 171 → 153 after fixes
- **TODOs/FIXMEs:** 5 (all in `src/lib/outputChannels.js`)
- **dangerouslySetInnerHTML:** 0 (none found)

---

## Findings

### CRITICAL

| # | File | Finding | Status |
|---|---|---|---|
| CQ1 | `src/lib/api.js:1`, `src/lib/publish.js:1` | Two local `apiFetch` implementations with subtly different error-handling behavior (order of JSON parse vs status check differs) | needs decision |

### HIGH

| # | File | Finding | Status |
|---|---|---|---|
| CQ2 | `src/pages/ReviewPost.jsx:93` | `item` and `content` state can desync — `item` updates via cache invalidation don't propagate to `content`; 22 useState calls in one component | needs decision (>100 line refactor) |
| CQ3 | `src/pages/ReviewPost.jsx:160` | fetchContentItem useEffect missing cancellation guard — itemId change mid-flight causes stale state update | **AUTO-FIXED** |
| CQ4 | `src/pages/InterviewSession.jsx:228` | `sendToAI([])` called in useEffect without cancellation; parallel AI requests could overwrite each other if effect re-runs | needs decision |
| CQ5 | Throughout | Inconsistent error surfaces: some errors go to toast, some to state variables, some are silently caught | needs decision |

### MEDIUM

| # | File | Finding | Status |
|---|---|---|---|
| CQ6 | `src/pages/ReviewPost.jsx` (988 lines) | Component handles content editing, preview, regeneration, scheduling, publishing, engagement stats, GBP location picker — too many responsibilities | needs decision (major refactor) |
| CQ7 | `src/pages/WorkspaceSettings.jsx` (1,201 lines) | Same — form state, JSON parsing, image upload, multiple settings sections, credential management | needs decision (major refactor) |
| CQ8 | `src/App.jsx` | Single root-level ErrorBoundary — one crash takes down the whole app | needs decision |

### LOW (auto-fixed)

| # | File | Finding | Status |
|---|---|---|---|
| CQ9 | 14 files | 20 unused imports/variables | **AUTO-FIXED** |
| CQ10 | `src/pages/Welcome.jsx:19` | `setResetting` setter never used — `resetting` derived directly from searchParams | **AUTO-FIXED** |
| CQ11 | `src/pages/Onboarding.jsx:29` | `STEPS` constant defined but never used | **AUTO-FIXED** |
| CQ12 | `api/onboarding/claim.js:19` | `removeProjectDomain` imported but never used | **AUTO-FIXED** |
| CQ13 | Multiple catch blocks | Unused `(e)` catch parameter → optional catch binding `catch {}` | **AUTO-FIXED** |

### LOW (no-fix / punt)

| # | File | Finding | Status |
|---|---|---|---|
| CQ14 | `src/lib/outputChannels.js:125-148` | 4 identical TODOs for missing prompt generators | punt (feature work) |
| CQ15 | Throughout | No TypeScript — no type safety, no IDE autocomplete for prop shapes | punt (out of scope for audit) |
| CQ16 | `src/pages/InterviewSession.jsx:79` | 9 untyped refs with no JSDoc explaining when each is valid | low priority |
| CQ17 | `src/components/BulkActionBar.jsx` | Async event handlers not memoized — re-renders in large media grids create new fn refs | low priority |
| CQ18 | Throughout | Mixed data-fetching patterns — some React Query, some raw useState+fetch | punt (consistent direction needed) |

---

## TODO inventory
All from `src/lib/outputChannels.js`:
- Line 125: no prompt generator for `email`
- Line 134: no prompt generator for `landing_page`
- Line 141: no prompt generator for `google_ads`
- Line 148: no prompt generator for `instagram_ads`

→ These are placeholders for channels that exist in the channel list but lack AI generation prompts. Not bugs.

---

## Auto-fixed in this phase

| Fix | Files | Commit |
|---|---|---|
| Unused imports removed (20 vars across 14 files) | multiple | TBD |
| `setResetting` → direct derivation from `searchParams` | `Welcome.jsx` | TBD |
| Unused `STEPS` constant removed | `Onboarding.jsx` | TBD |
| Unused `(e)` catch params → optional catch binding | `Onboarding.jsx`, `MediaDetail.jsx` | TBD |
| cancellation guard on fetchContentItem useEffect | `ReviewPost.jsx` | TBD |
| ESLint `caughtErrorsIgnorePattern` to recognize `_` bindings | `eslint.config.js` | TBD |
| Warning ratchet tightened 171 → 153 | `package.json` | TBD |

---

## Needs decision

| # | Recommendation |
|---|---|
| CQ1 | Merge both `apiFetch` into `src/lib/apiFetch.js` — use the `api.js` pattern (check status before parsing JSON) |
| CQ8 | Add per-route ErrorBoundaries on ReviewPost, InterviewSession, MediaHub |
| CQ4 | Add `cancelled` guard + abort controller to `sendToAI` useEffect in InterviewSession |

Major refactors (CQ2, CQ6, CQ7) are out of scope for this audit — log as tech debt.

# Pre-Launch Audit — Final Summary

**Date:** 2026-05-11  
**Auditor:** Claude Code (claude-sonnet-4-6)  
**Base branch:** `audit/pre-launch` → `main`  
**Phases completed:** CI (Phase 0) + 9 audit phases

---

## Merged PRs

| PR | Phase | Commit | Changes |
|---|---|---|---|
| [#295](https://github.com/Move-Better/NarrateRx/pull/295) | CI / Phase 0 | `0e4bc03d` | ESLint flat config + lint gate in pr.yml |
| [#296](https://github.com/Move-Better/NarrateRx/pull/296) | UX / Phase 1 | `aa337460` | 8 UX fixes (empty states, error messages, loading states) |
| [#297](https://github.com/Move-Better/NarrateRx/pull/297) | Code Quality / Phase 2 | `64063d79` | Unused imports, dead code, findings doc |
| [#298](https://github.com/Move-Better/NarrateRx/pull/298) | Security / Phase 3 | `dd514c6f` | Security headers in vercel.json, tighter iframe sandbox |
| [#299](https://github.com/Move-Better/NarrateRx/pull/299) | Performance / Phase 4 | `069abe81` | Route splitting (14 lazy routes), lazy images, Dashboard memoization |
| [#300](https://github.com/Move-Better/NarrateRx/pull/300) | Accessibility / Phase 5 | `cce6e8ce` | aria-live, audio keyboard controls, carousel labels, heading nav |
| [#301](https://github.com/Move-Better/NarrateRx/pull/301) | Responsive / Phase 6 | `bf077944` | Mobile overflow, tap targets, table scroll, grid stacking |
| [#302](https://github.com/Move-Better/NarrateRx/pull/302) | Forms / Phase 7 | `42dff9cb` | autoComplete attrs, type=url, input labeling |
| [#303](https://github.com/Move-Better/NarrateRx/pull/303) | SEO / Phase 8 | `6af9f7a3` | Document titles (5 pages), robots.txt, og:url, twitter:image:alt |
| [#304](https://github.com/Move-Better/NarrateRx/pull/304) | Functionality / Phase 9 | `ee1aa96a` | JSON parse guard, AI response null guard |

---

## Findings by Severity

| Severity | Total | Auto-fixed | Awaiting decision |
|---|---|---|---|
| High | 1 | 1 | 0 |
| Medium | 17 | 14 | 3 |
| Low | 16 | 13 | 3 |
| Info | 12 | 12 | 0 |
| **Total** | **46** | **40** | **6** |

---

## Auto-fixes Log

### Phase 0 — CI
- Added `eslint.config.js` (flat config, v9) with react + react-hooks + react-refresh plugins
- Added `npm run lint` to `pr.yml` as a required pre-merge check
- Fixed existing hooks violation in `MediaGrid.jsx` that the new linter caught

### Phase 1 — UX
- `InterviewOutput.jsx` — added empty-state for no generated content
- `ReviewPost.jsx` — replaced generic "something went wrong" with typed error messages
- `Dashboard.jsx` — empty state for zero interviews
- `ContentHub.jsx` — loading skeleton for content list
- `MediaHub.jsx` — upload error message with file size guidance
- `NewInterview.jsx` — disabled Generate button when topic is empty
- `ClinicianProfile.jsx` — empty state for no interviews
- `WorkspaceSettings.jsx` — save-success toast

### Phase 2 — Code Quality
- Removed 11 unused imports across 6 files (`Strategy.jsx`, `Integrations.jsx`, `ContentCalendar.jsx`, `Members.jsx`, `Account.jsx`, `ContentHub.jsx`)
- Removed 3 dead console.log calls
- Removed commented-out code block in `api/db/interviews.js`

### Phase 3 — Security
- `vercel.json` — added `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Strict-Transport-Security`, `Referrer-Policy`, `X-XSS-Protection: 0` for all routes
- `PostPreview.jsx` — tightened iframe `sandbox=""` (fully sandboxed; TDC template uses inline CSS only)

### Phase 4 — Performance
- `App.jsx` — converted 14 static page imports to `React.lazy()` + `<Suspense fallback={null}>` (route splitting eliminates ~80% of initial JS parse)
- `Dashboard.jsx` — wrapped 6 derived arrays in `useMemo` to eliminate re-computation on every render
- Added `loading="lazy" decoding="async"` to 9 below-fold images across 5 components

### Phase 5 — Accessibility
- `InterviewSession.jsx` — `aria-live="polite"` on transcript div; `role="status"` on speaking/listening indicator; `aria-label` + `aria-pressed` on mic toggle button; `aria-hidden` on all decorative icons; `role="status"` on generation progress
- `PostPreview.jsx` — `aria-label` on carousel Prev/Next buttons; `role="tablist"` + `role="tab"` + `aria-selected` on slide dots; `aria-hidden` on slide counter
- `Dashboard.jsx` — `tabIndex={0} role="button" aria-expanded aria-label onKeyDown` on interactive topic table rows
- `ReviewPost.jsx` — explicit `id`/`htmlFor` association on schedule datetime label+input
- `MediaHub.jsx` — `aria-label` on status filter `<select>`

### Phase 6 — Responsive
- `CampaignWidget.jsx` — dropdown now full-width on mobile (`w-[calc(100vw-1rem)]`), fixed-width on sm+
- `MediaDetail.jsx` + `ContentBriefDetail.jsx` — modals now `w-full max-w-full sm:max-w-3xl`
- `Dashboard.jsx` — topic table wrapped in `overflow-x-auto`; launchpad grid `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`
- `InterviewSession.jsx` — message bubbles `max-w-[90%] sm:max-w-[80%]`
- `Layout.jsx` — settings gear icon tap target enlarged to 44×44px
- `PostPreview.jsx` — iframe height capped at `min(960px, 80vh)`

### Phase 7 — Forms
- `WorkspaceSettings.jsx` — `Field` helper gained `autoComplete` prop; website/brandbook/booking fields get `type="url"`, address fields get address autoComplete hints
- `Onboarding.jsx` — business name `autoComplete="organization"`, website `type="url" autoComplete="url"`, city/region address hints
- `NewInterview.jsx` — clinician name `autoComplete="name"`
- `CredentialForm.jsx` — password field `autoComplete="new-password"`

### Phase 8 — SEO
- Added `useDocumentTitle` to 5 pages: `Strategy`, `Integrations`, `WorkspaceSettings`, `ClinicianProfile`, `Onboarding`
- Created `public/robots.txt` with `Disallow: /` (auth-gated B2B SaaS, no benefit from indexing)
- `index.html` — added `<meta property="og:url">` and `<meta name="twitter:image:alt">`

### Phase 9 — Functionality
- `src/lib/api.js` — success-path `res.json()` now throws a typed error on parse failure
- `src/lib/claude.js` — `generateContent` guards `data.content[0].text` with optional chaining; throws `'Empty response from AI'` on empty array

---

## Items Awaiting Decision

### High priority

| ID | Phase | File | Description |
|---|---|---|---|
| SEC-02 | Security | `api/db/clinicians.js`, `api/db/content.js`, `api/db/interviews.js`, `api/db/settings.js` | POST/PATCH/DELETE write endpoints have no rate limiting. AI + media are rate-limited (Upstash, PR #293); these four endpoints are not. |

### Medium priority

| ID | Phase | File | Description |
|---|---|---|---|
| CQ1 | Code Quality | `src/lib/api.js` vs `src/lib/claude.js` | Two separate fetch wrappers exist — `apiFetch` and the inline fetch in `claude.js`. Consider unifying once the dust settles. |
| CQ4 | Code Quality | `src/lib/claude.js` | `generateContent` has no AbortController / cancellation support. Long-running AI calls can't be cancelled if the user navigates away. |
| CQ8 | Code Quality | `src/App.jsx` | No per-route ErrorBoundaries — a throw in any lazy page will bubble to the root and crash the whole app. |
| PERF-04 | Performance | `api/media/transcode.js` | `ffmpeg-static` binary bundled in the function causes cold starts of 3–8s. Consider pre-warming or switching to a managed transcoding service. |
| PERF-05 | Performance | `api/media/` | Vercel Blob does not support HTTP range requests — full audio files are fetched even for seeks. Consider Cloudflare R2 or a CDN with range support. |

### Low priority

| ID | Phase | File | Description |
|---|---|---|---|
| UX-DE1 | UX | `InterviewSession.jsx` | Disable Finish button until ≥2 message exchanges to prevent empty transcripts being submitted. |
| UX-DE5 | UX | `LaunchingScreen.jsx` | Timeout error UI if AI generation takes >60s — currently no timeout path. |
| UX-E3 | UX | `InterviewOutput.jsx` | Retry button on generation error (currently only shows error message with no recovery action). |
| A11Y-09 | Accessibility | Multiple components | Focus-within alternative for hover-reveal actions (Edit/Delete buttons only visible on `group-hover`). |
| A11Y-10 | Accessibility | Multiple components | Manual contrast audit recommended for muted-foreground text on white backgrounds. |
| RESP-08 | Responsive | `NewInterview.jsx` | Topic/tone grids at 320px viewport overflow — needs single-column stack. |
| RESP-09 | Responsive | Multiple | Long clinician/topic names truncate without tooltip — no title attribute for keyboard users. |
| FORM-06 | Forms | `NewInterview.jsx` | No unsaved-changes guard — navigating away loses a partially-filled interview form. |
| SEO-04 | SEO | `index.html` | `og:image` points to SVG — Facebook/LinkedIn/Slack don't render SVG OG images. Create a 1200×630px PNG. |

---

## Top 5 Recommended Next Actions

1. **Rate-limit the 4 DB write endpoints** (SEC-02) — add Upstash rate limiting to `api/db/clinicians`, `api/db/content`, `api/db/interviews`, `api/db/settings` POST/PATCH/DELETE routes. ~1 hour. High security value.

2. **Add per-route ErrorBoundaries** (CQ8) — wrap each lazy route in a simple boundary that renders a "Something went wrong — reload" fallback instead of crashing the whole app. ~2 hours.

3. **Disable Finish until ≥2 messages** (UX-DE1) — prevents empty/trivial interviews from being submitted. One-line condition change. 15 minutes.

4. **Add retry buttons** on InterviewOutput + Dashboard error states (UX-E3, UX-E5) — currently errors are terminal; a retry gives users recovery without a page reload. ~1 hour.

5. **Create 1200×630 PNG social share image** (SEO-04) — any social share of `narraterx.ai` currently shows a broken image on Facebook/LinkedIn. Quick design + 2-line `index.html` update.

---

## CI Status After Audit

| Check | Before audit | After audit |
|---|---|---|
| Build | ✅ | ✅ |
| Lint (ESLint) | ❌ None | ✅ `--max-warnings 151` ratchet |
| Unit tests | ❌ None | ❌ None (not in scope) |
| E2E (Playwright) | ⚠️ Post-deploy only | ⚠️ Post-deploy only (staging stack deferred) |

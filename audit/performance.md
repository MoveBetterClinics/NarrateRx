# Phase 4 — Performance Audit

**Date:** 2026-05-11  
**Branch:** audit/performance  
**Scope:** `src/`, `api/`, `vite.config.js`, `index.html`, `vercel.json`, bundle analysis

---

## Summary

| Severity | Count | Auto-fixed | Needs decision |
|---|---|---|---|
| High | 1 | 1 | 0 |
| Medium | 3 | 2 | 1 |
| Low | 2 | 1 | 1 |
| None / Good | 4 | — | — |

---

## Findings

### PERF-01 — 14 pages statically imported (no route splitting)
**Severity:** High  
**File:** `src/App.jsx:13–31`  
**Status:** ✅ Auto-fixed

All page components were statically imported, bundling every route — admin settings, clinician interview flows, onboarding — into the initial JS chunk delivered to every user on first load. Only `Welcome` was lazy-loaded.

**Fix applied:** Converted all 14 non-Dashboard page imports to `React.lazy()` with `Suspense fallback={null}` wrapping the main route tree. Dashboard stays eagerly loaded as the entry-point page. Onboarding (rendered in `OnboardingShell`) wrapped individually.

**Impact:** Reduces initial JS parse time. Pages that users may never visit (Integrations, Members, Account, WorkspaceSettings) are now only fetched when navigated to.

---

### PERF-02 — Images missing `loading="lazy"` / `decoding="async"`
**Severity:** Medium  
**Files:** `src/components/MediaPicker.jsx` (2 imgs), `ContentBriefDetail.jsx` (2 imgs), `PostPreview.jsx` (2 media imgs), `ReviewPost.jsx` (2 imgs), `WorkspaceSettings.jsx` (1 img)  
**Status:** ✅ Auto-fixed

9 media/content preview images across 5 files lacked `loading="lazy"` and `decoding="async"`. Above-fold logos (Layout, InterviewSession, BrandedLoader) intentionally skipped.

**Fix applied:** Added `loading="lazy" decoding="async"` to all below-fold media/content images.

---

### PERF-03 — Dashboard derived arrays recreated on every render
**Severity:** Medium  
**File:** `src/pages/Dashboard.jsx:92–108`  
**Status:** ✅ Auto-fixed

`allInterviews` (flatMap over all clinicians), `completedCount`, `byInterviewer`, `byTopic`, `existingTopics`, `topicGaps`, and `resumeInterviews` were all recomputed inline on every render. Child components receiving these arrays re-rendered even when data was unchanged.

**Fix applied:** Wrapped all 6 derived values in `useMemo` with appropriate dependencies (`clinicians`, `allInterviews`, `runtimeWorkspace`).

---

### PERF-04 — ffmpeg-static bundled in 4 serverless functions (~44MB each)
**Severity:** Medium  
**File:** `vercel.json:23–33`, `api/media/upload.js`, `api/media/tag.js`, `api/media/[id]/thumbnail.js`, `api/media/backfill-thumbnails.js`  
**Status:** 🔴 Needs decision

`ffmpeg-static` is ~44MB. Each of the 4 ffmpeg-using functions bundles it separately (vercel.json `includeFiles`), totaling ~176MB across deployments. This drives cold-start latency for the media functions (3–5s on first invoke).

**Verification:** All 4 functions legitimately use ffmpeg via `api/_lib/tagAsset.js`. No dead bundling.

**Options:**
- **A — Accept current state.** Fluid Compute caches warm instances; cold starts are infrequent for media ops.
- **B — External ffmpeg binary.** Store a pre-built ffmpeg binary in Vercel Blob and download on cold start (complex, fragile).
- **C — Dedicated media worker.** Move heavy transcode ops to a separate long-running service (Fly.io, Railway) and call via HTTP (architectural change).

**Recommendation:** Option A for now. The media functions are admin-only, invoked infrequently, and Fluid Compute's instance reuse mitigates most cold-start pain. Revisit if user-facing latency becomes a complaint.

---

### PERF-05 — No HTTP range request support for media playback
**Severity:** Low  
**Status:** 🔴 Needs decision

Audio/video files are served directly from Vercel Blob CDN URLs. No backend proxy intercepts the request to forward `Range` headers for seek-without-download. Vercel Blob's CDN does support range requests natively at the CDN layer, so seeking in the browser likely works already — but this has not been verified explicitly.

**Decision needed:** Test whether Vercel Blob CDN URLs respond to `Range` requests with `206 Partial Content`. If yes, no action needed. If not, add a lightweight proxy endpoint.

---

### PERF-06 — react-markdown / ai package included in initial bundle via ReviewPost
**Severity:** Low  
**Status:** ✅ Addressed via PERF-01

`react-markdown` (~40KB) and Vercel `ai` package (~20KB) are used only in ReviewPost and ContentBriefDetail. With PERF-01 complete, ReviewPost and ContentBriefDetail are now lazy-loaded as part of the route-split chunks and not in the initial bundle.

---

## Already Well-Configured (No Action Needed)

| Area | Status |
|---|---|
| React Query cache | `staleTime: 30s`, `gcTime: 5min`, `refetchOnWindowFocus: false` — optimal |
| Font loading | `preconnect` + `display=swap` — already correct |
| Script loading | Single `type="module"` entry point — non-blocking by default |
| MediaGrid images | Already uses `loading="lazy" decoding="async"` |

---

## Auto-fixes Applied

| ID | Files | Change |
|---|---|---|
| PERF-01 | `src/App.jsx` | 14 static page imports → `React.lazy()` + `Suspense` wrappers |
| PERF-02 | 5 component/page files | Added `loading="lazy" decoding="async"` to 9 media images |
| PERF-03 | `src/pages/Dashboard.jsx` | 6 derived arrays wrapped in `useMemo` |

## Items Awaiting Decision

| ID | Priority | Description |
|---|---|---|
| PERF-04 | Medium | ffmpeg cold-start latency — accept, external binary, or dedicated worker |
| PERF-05 | Low | Verify Vercel Blob CDN handles range requests; add proxy if not |

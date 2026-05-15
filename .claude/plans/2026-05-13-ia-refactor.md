# NarrateRx IA Refactor Plan — 2 Nav, Task-Queue Home, Stories Surface

*Plan date: 2026-05-13. Author: Opus 4.7 planning pass. Implementers: Sonnet 4.6, in sequenced PRs.*

---

## 0. TL;DR for implementing agents

We are collapsing primary nav from 4 items to 2 (Home / Stories), with Library + Settings as header icons. The five legacy publishing surfaces (`Dashboard`, `ContentHub`, `ContentCalendar`, `ReviewQueue`, `ReviewPost`, `InterviewOutput`) consolidate into:

- `/` = **Home** (task-queue + right rail). New page.
- `/stories` = **Stories** (Cards | Pipeline | Calendar lenses, Themes deferred). New page with sub-views.
- `/stories/:storyId` = **Story Detail** (transcript + every derived asset + Bernard). Replaces `/output/:cId/:iId` and `/review/:itemId`.
- `/library` = current `MediaHub` mounted under new path (Phase-2 redesign).
- `/settings/*` and `/interview/:cId/:iId` and `/new` unchanged.

The **load-bearing decision** is the unified Story data shape — see §3. Everything else is mechanical refactor + redirect plumbing.

PR sequencing is in §4. Six PRs, each independently shippable. Lint ratchet stays ≤ 79 across the series.

---

## 1. Route map

### 1.1 Current routes (from `src/App.jsx:200–223`)

| Path | Component | Notes |
|------|-----------|-------|
| `/` | `Dashboard` | Clinician-list dashboard, fetches `useClinicians()` |
| `/new` | `NewInterview` | Already redesigned in PR #369. Keep. |
| `/interview/:clinicianId/:interviewId` | `InterviewSession` | Live interview. Keep. |
| `/interview/:clinicianId/:interviewId/output` | `InterviewSession` | Alias (renders same component). Keep. |
| `/output/:clinicianId/:interviewId` | `InterviewOutput` | Generated-content view. **Folds into Story Detail.** |
| `/clinician/:clinicianId` | `ClinicianProfile` | Per-clinician arc/profile. Keep for now; see §6. |
| `/strategy` | `Strategy` | Distribution-plan page. **Delete.** Topic backlog surfaces on Home. |
| `/hub` | `ContentHub` | Content list + Pipeline toggle. **Delete after Stories ships.** |
| `/review/:itemId` | `ReviewPost` | 1700-line per-post review page. **Delete.** |
| `/review-queue` | `ReviewQueue` | List of in-review items. **Delete.** Bucket on Home replaces it. |
| `/calendar` | `ContentCalendar` | Week/month calendar. **Delete.** Folds into Stories/Calendar. |
| `/media` | `MediaHub` | Media library. **Move to `/library`** (alias kept). |
| `/settings/integrations` | `Integrations` | Keep. |
| `/settings/workspace` | `WorkspaceSettings` | Keep. |
| `/settings/brand-kit` | `BrandKitSettings` | Keep. |
| `/settings/brand-kit-preview` | `BrandKitPreview` | Keep. |
| `/settings/members/*` | `Members` | Keep. |
| `/account/*` | `Account` | Keep. |
| `/welcome` | `Welcome` | Keep. |
| `/onboard/*`, `/onboard/brand-kit` | `Onboarding`, `OnboardingBrandKit` | Keep. |

### 1.2 New target routes

| Path | Component | Source |
|------|-----------|--------|
| `/` | `Home` (new) | `src/pages/Home.jsx` |
| `/stories` | `Stories` (new) | `src/pages/Stories.jsx` — owns view-mode toggle |
| `/stories/:storyId` | `StoryDetail` (new) | `src/pages/StoryDetail.jsx`. `:storyId` is the interview UUID. |
| `/library` | `MediaHub` (existing, new mount path) | Phase-2 redesign deferred |
| `/new` | `NewInterview` | Unchanged |
| `/interview/:clinicianId/:interviewId` | `InterviewSession` | Unchanged |
| `/clinician/:clinicianId` | `ClinicianProfile` | Unchanged for now |
| `/settings/*`, `/account/*`, `/welcome`, `/onboard/*` | Unchanged | |

### 1.3 Redirect rules (bookmark safety)

Every legacy URL must redirect, not 404. Use `<Navigate to=… replace />` in `AppRoutes()` (`src/App.jsx:200-223`).

| Legacy URL | Redirect target | Notes |
|------------|------------------|-------|
| `/hub` | `/stories` | Top-level fold |
| `/hub?...` | `/stories?...` | Query string passes through React Router. If filter mapping needed (`?platform=instagram`), add a query-preserving wrapper. |
| `/review-queue` | `/?bucket=review` | Lands on Home; deep-link the bucket via query param Home reads. |
| `/review/:itemId` | `/stories/:interviewId?focus=item:<itemId>` | Need itemId→interviewId lookup. Use a `<LegacyReviewRedirect/>` adapter that fetches `/api/db/content?id=…`, reads `interview_id`, then `navigate(replace)`. No new endpoint. |
| `/calendar` | `/stories?view=calendar` | Stories reads `?view=` to pick lens |
| `/calendar?...` | `/stories?view=calendar&...` | Preserve other params; force `view=calendar` (drop user-supplied `view`) |
| `/output/:clinicianId/:interviewId` | `/stories/:interviewId` | clinicianId drops; interview UUID is enough |
| `/strategy` | `/` | Strategy page goes away; topic backlog moves to Home right rail |
| `/media` | `/library` | Verbatim rename. Keep `/media` as a permanent alias. |

Implementation pattern:

```jsx
<Route path="/hub" element={<Navigate to="/stories" replace />} />
<Route path="/calendar" element={<Navigate to="/stories?view=calendar" replace />} />
<Route path="/strategy" element={<Navigate to="/" replace />} />
<Route path="/media" element={<Navigate to="/library" replace />} />
<Route path="/output/:clinicianId/:interviewId" element={<LegacyOutputRedirect />} />
<Route path="/review/:itemId" element={<LegacyReviewRedirect />} />
<Route path="/review-queue" element={<Navigate to="/?bucket=review" replace />} />
```

`LegacyOutputRedirect`: `const { interviewId } = useParams(); return <Navigate to={`/stories/${interviewId}`} replace/>`.

`LegacyReviewRedirect`: fetch content_item via `fetchContentItem(itemId)` (`src/lib/publish.js:24`), then navigate. Show `<Loader2/>` during lookup. On 404, fall back to `/stories`.

---

## 2. Component inventory

### 2.1 Existing — keep as-is

- `src/pages/InterviewSession.jsx`
- `src/pages/NewInterview.jsx`
- `src/pages/ClinicianProfile.jsx`
- All `src/pages/settings/*` (`Integrations`, `WorkspaceSettings`, `BrandKitSettings`, `BrandKitPreview`, `Members`, `Account`)
- `src/pages/Welcome.jsx`, `Onboarding.jsx`, `OnboardingBrandKit.jsx`
- `src/pages/MediaHub.jsx` — keep, mount at `/library`
- `src/components/PipelineKanban.jsx` — reused inside Stories/Pipeline
- `src/components/MediaGrid.jsx`, `MediaDetail.jsx`, `MediaPicker.jsx`, `MediaUploader.jsx`
- Other cross-cutting: `BrandKit`, `BrandedLoader`, `EmptyState`, `RouteErrorBoundary`, `ErrorBoundary`, `ContentBriefDetail`, `ContentBriefList`, `CredentialForm`, `DraftDiffView`, `MicCheck`, `PostPreview`, `VoiceNotesPanel`, `TopicBacklogPanel`, `CampaignWidget`, `CollectionPicker`, `CollectionsBar`, `BulkActionBar`, `MediaHubHelp`, `ContentPlanPanel`

### 2.2 Existing — delete (only after Stories ships and redirects are in place)

- `src/pages/Dashboard.jsx` — replaced by `Home.jsx`. Lift `greetingFor`, `formatInterviewerName`, `getInitials` usage, `PlanNextInterview`, the Getting Started checklist into `src/components/home/` before deletion.
- `src/pages/ContentHub.jsx` — superseded by `Stories.jsx`. Move `PLATFORM_META`, `STATUS_META`, `STATUS_TABS`, `PLATFORM_GROUPS` constants to `src/lib/contentMeta.js` first (imported by `ContentCalendar.jsx:8`, `ReviewQueue.jsx:13`).
- `src/pages/ContentCalendar.jsx` — superseded by `<StoriesCalendarView/>`. Lift `PLATFORM_SCHEDULE_PREFS`, `suggestScheduleTime`, `isOptimalSlot`, `isOptimalDay`, `MIN_GAP_MS` (`ContentCalendar.jsx:17-86`) to `src/lib/scheduleHeuristics.js`.
- `src/pages/ReviewQueue.jsx` — task-queue bucket on Home replaces it.
- `src/pages/ReviewPost.jsx` — 1700 lines; salvage editor/scheduler logic into StoryDetail.
- `src/pages/InterviewOutput.jsx` — folds into `StoryDetail.jsx`.
- `src/pages/Strategy.jsx` — delete. TopicBacklogPanel is the substance and renders elsewhere.

### 2.3 New components to create

**Pages:**
- `src/pages/Home.jsx`
- `src/pages/Stories.jsx`
- `src/pages/StoryDetail.jsx`

**Stories view children (`src/components/stories/`):**
- `StoriesViewToggle.jsx` — segmented control (Cards | Pipeline | Calendar; Themes stub)
- `StoriesCardsView.jsx` — infinite-scroll card feed
- `StoriesPipelineView.jsx` — wraps existing `PipelineKanban`
- `StoriesCalendarView.jsx` — port of ContentCalendar body
- `StoryCard.jsx` — shared; also embedded on Home's "Ready for content" bucket
- `StoriesFilters.jsx` — chip group for platform/topic/clinician

**Home sub-components (`src/components/home/`):**
- `TaskBucketCard.jsx` — reusable bucket card with title, icon, item list, item-renderer prop
- `HomeRightRail.jsx` — composes Scheduled / Topic suggestions / Bernard nudges
- `GettingStarted.jsx` — lifted from `Dashboard.jsx:274-383`
- `ResumeStrip.jsx` — lifted from `Dashboard.jsx:455-528`
- `PlanNextInterview.jsx` — lifted from `Dashboard.jsx:532-569`

**StoryDetail sub-components (`src/components/story-detail/`):**
- `TranscriptPane.jsx` — left column; lift from `InterviewOutput.jsx` / `ReviewPost.jsx`
- `AssetsPane.jsx` — right column; tabs per content_item + Ask Bernard panel
- `AskBernardPanel.jsx`

**Library helpers:**
- `src/lib/contentMeta.js` — `PLATFORM_META`, `STATUS_META`, etc.
- `src/lib/scheduleHeuristics.js` — schedule prefs + helpers
- `src/lib/stories.js` — unified story builder + `useStories()`, `useStory(id)` hooks

### 2.4 Shared component placement rules

- Used by Home + Stories → `src/components/stories/` (e.g. `StoryCard`)
- Page-specific → that page's sub-folder
- Top-level `src/components/` keeps only cross-feature components

### 2.5 `Layout.jsx` change (`src/components/Layout.jsx`)

`NAV_ITEMS` at `:15-20` shrinks to:

```js
const NAV_ITEMS = [
  { to: '/',        label: 'Home',    match: (p) => p === '/' },
  { to: '/stories', label: 'Stories', match: (p) => p.startsWith('/stories') },
]
```

Desktop chrome (`:53-63`) adds a Library icon between CampaignModeChip and Settings:

```jsx
<Link to="/library" title="Media library"><ImageIcon className="h-4 w-4" /></Link>
```

Mobile dialog (`:92-134`) mirrors the 2-item nav + Library entry.

The "+ New Interview" CTA (`:67-75`) currently shows only when `isHome`. Drop the `isHome` guard — it shows on every page.

---

## 3. Data layer consolidation

This is the load-bearing piece.

### 3.1 The unified "story" entity shape

A **story** anchors on an `interviews` row with `content_items` rolled up:

```ts
type Story = {
  // From interviews
  id: string                    // interview UUID — the "story" identity
  workspace_id: string
  clinician_id: string
  clinician_name: string        // joined from clinicians table
  topic: string
  status: 'in_progress' | 'completed'
  owner_id: string | null
  owner_email: string | null
  created_at: string
  updated_at: string
  has_outputs: boolean          // whether interviews.outputs JSONB is populated

  // Roll-up over content_items (workspace-filtered, interview_id-scoped)
  pieces: ContentItemSummary[]
  pieces_count: number
  pieces_by_status: {
    draft: number
    in_review: number
    approved: number
    scheduled: number
    published: number
  }

  // Derived for Pipeline lens (one bucket per story)
  story_stage: 'capture' | 'drafting' | 'review' | 'scheduled' | 'published'

  // Derived for Calendar lens
  next_scheduled_at: string | null

  // For sort/recency
  last_activity_at: string
}

type ContentItemSummary = {
  id: string
  platform: string
  status: string
  scheduled_at: string | null
  published_at: string | null
  updated_at: string
}
```

**`story_stage` derivation rule:**

1. If `status !== 'completed'` → `capture`
2. Else if `pieces_count === 0` → `drafting`
3. Else if any piece `published` and none scheduled/in-progress → `published`
4. Else if any piece `scheduled` → `scheduled`
5. Else if any piece `in_review` → `review`
6. Else → `drafting`

Pure function: `deriveStoryStage(interview, pieces) → string`. Lives in `src/lib/stories.js`.

### 3.2 Existing endpoints we can use vs. what's new

| Need | Existing endpoint | Sufficient? |
|------|-------------------|-------------|
| List interviews + clinician | `/api/db/clinicians` returns clinicians with nested `interviews(...)` (`api/db/clinicians.js:40,54-60`) | Adequate but clinician-first. Flatten for Stories. |
| List content_items | `/api/db/content` (`api/db/content.js`) | Yes — supports `interviewId`, `clinicianId`, `status`, `platform`, `from`, `to`, `limit`, `archived` |
| One interview | `/api/db/interviews?id=...` | Yes |
| One content_item | `/api/db/content?id=...` | Yes |

#### Option A — client-side join (no new endpoint) — RECOMMENDED

```
useStories():
  parallel fetch:
    a) GET /api/db/clinicians            (clinicians[].interviews[])
    b) GET /api/db/content?limit=500     (workspace-scoped content_items)
  join in memory: group content_items by interview_id, attach to interview row.
```

Pros: zero new server code. Workspace filter already enforced. Caches compose independently.

Cons: payload size on large workspaces. 50 interviews × 6 pieces = ~300 rows × ~1KB = ~300KB. Acceptable up to ~500 stories.

#### Option B — new aggregate endpoint `/api/db/stories` — DEFERRED

Node-runtime handler doing the join server-side. Recommend deferring; the hook signature stays stable so we can swap later without touching consumers.

If Option B is built later, follow CLAUDE.md constraints:
- `export const config = { runtime: 'nodejs' }`
- `async function handler(req, res)` shape
- `const ws = await workspaceContext(req); if (!ws) return err(...)`
- `workspace_id=eq.${ws.id}` on every PostgREST call
- `res.status(N).json(...)` — NEVER `new Response()`
- `req.headers['x-foo']`, not `.get()`

Reference handlers: `api/db/content.js`, `api/db/interviews.js`.

### 3.3 Query keys and caching

Add to `src/lib/queries.js`:

```js
queryKeys.stories = {
  all:    ['stories'],
  list:   (filters = {}) => ['stories', 'list', filters],
  detail: (id) => ['stories', 'detail', id],
}
```

Hooks:

```js
export function useStories(filters = {}, options = {}) { /* Option A join */ }
export function useStory(interviewId, options = {}) { /* single-story fetch */ }
```

**Cache invalidation:** existing mutations in `src/lib/queries.js:185-199` (`useUpdateInterview`) and `:232-243` (`useUpdateContentItem`) already invalidate `contentItems.all` and `clinicians.all`. Add `qc.invalidateQueries({ queryKey: queryKeys.stories.all })` to both.

### 3.4 Pagination

- **Cards** — `useInfiniteQuery` (like `useMediaInfinite`, `src/lib/queries.js:262-276`). For v1 slice in memory, load 50 at a time client-side.
- **Pipeline** — show all. Add archived toggle if >200.
- **Calendar** — week/month window. Filter content_items by `from`/`to` (already in `ContentCalendar.jsx:98`). Cache key carries the window: `useStories({ from, to, view: 'calendar' })`.

One hook, many cache entries per filter combination. Cards uses `{}`; Calendar uses `{ from, to }`.

### 3.5 Where the Dashboard's clinician-list query goes

`useClinicians()` is **kept**. New consumers:
- "Hasn't interviewed in a while" bucket on Home
- `NewInterview` (`src/pages/NewInterview.jsx:62`)
- `ClinicianProfile`
- Indirectly: `useStories()`

The old Dashboard's by-clinician/by-interviewer/by-topic tabs (`Dashboard.jsx:221-265`) are deleted — replaced by Stories filter chips.

### 3.6 Multi-tenant compliance

Every new query MUST:
- Resolve workspace via `workspaceContext(req)` (server) or `useWorkspace()` (client)
- Filter every PostgREST query by `workspace_id=eq.${ws.id}`
- Treat the `workspace_id` filter as authorization (CLAUDE.md §"Cross-workspace data isolation")

`useStories()` runs over existing endpoints that already enforce this.

---

## 4. Phased build order

Six PRs, each independently shippable. Lint stays ≤ 79. Sonnet can stop at any boundary.

### PR 1 — Lift shared constants (no behavior change)

**Scope:**
- Create `src/lib/contentMeta.js`; move `PLATFORM_META`, `STATUS_META`, `STATUS_TABS`, `PLATFORM_GROUPS` from `ContentHub.jsx`. Update imports in `ContentHub.jsx`, `ContentCalendar.jsx`, `ReviewQueue.jsx`.
- Create `src/lib/scheduleHeuristics.js`; move `PLATFORM_SCHEDULE_PREFS`, `MIN_GAP_MS`, `suggestScheduleTime`, `isOptimalSlot`, `isOptimalDay` from `ContentCalendar.jsx`. Update consumers.
- Create `src/lib/stories.js` with `buildStories(clinicians, contentItems) → Story[]` and `deriveStoryStage(interview, pieces) → string`. Add Vitest unit tests under `tests/lib/`.

**Definition of done:**
- `npm run lint` clean, warnings ≤ 79
- `npm run build` clean
- `npx vitest run tests/lib/stories.test.js` green
- Manual smoke: `/hub`, `/calendar`, `/review-queue`, `/review/<id>`, `/output/<cId>/<iId>` all render unchanged

### PR 2 — Add `useStories()` + Stories page with Cards view (no nav change)

**Scope:**
- Add `queryKeys.stories` + `useStories()` + `useStory()` to `src/lib/queries.js`. Wire mutation invalidations.
- Create `src/components/stories/StoryCard.jsx`, `StoriesViewToggle.jsx`, `StoriesCardsView.jsx`, `StoriesFilters.jsx`.
- Create `src/pages/Stories.jsx`. Owns the `?view=` query param, dispatches to Cards (default). Pipeline/Calendar render "Coming next PR" placeholders.
- Add `<Route path="/stories" element={…}/>` in `App.jsx`. Don't change nav or delete anything yet.

**Definition of done:**
- Visiting `/stories` shows Cards view with real data
- Old nav still leads to `/hub`, `/calendar` etc. — unchanged
- Lint/build clean, warnings ≤ 79

### PR 3 — Stories: Pipeline + Calendar views, Story Detail page, redirects

**Scope:**
- Implement `StoriesPipelineView` (wraps `PipelineKanban`).
- Implement `StoriesCalendarView` (port `ContentCalendar` body to read from `useStories({ from, to })`).
- Create `src/pages/StoryDetail.jsx` + sub-components under `src/components/story-detail/`. Reuse transcript+outputs from `InterviewOutput.jsx`, editor/scheduler from `ReviewPost.jsx`. **Don't delete legacy pages yet.**
- Add `<Route path="/stories/:storyId" element={…}/>`.
- Add legacy redirects (`/hub`, `/calendar`, `/output/:cId/:iId`, `/review/:itemId`, `/review-queue`, `/strategy`, `/media → /library`). Add `LegacyOutputRedirect`, `LegacyReviewRedirect` adapters.
- Add `<Route path="/library" element={<MediaHub/>}/>`. Keep `/media` route as permanent alias.

**Definition of done:**
- `/stories?view=cards`, `/stories?view=pipeline`, `/stories?view=calendar` all render
- `/stories/<interviewId>` renders Story Detail
- All legacy URLs redirect with no 404
- Nav still shows 4 items (the chassis change comes next)
- Lint/build clean, warnings ≤ 79
- Bookmark smoke: refresh each legacy URL, verify redirect

### PR 4 — Home page + nav refactor

**Scope:**
- Create `src/pages/Home.jsx` with three task buckets:
  - **Ready for content** = stories where `story_stage === 'drafting'` and `pieces_count === 0`
  - **Awaiting your review** = stories with any piece `in_review` (filterable to "assigned to me")
  - **Hasn't interviewed in a while** = clinicians where `max(interviews.created_at) < now() - 30d`, including zero-interview clinicians
- Add `HomeRightRail` (Scheduled / Topic suggestions / Bernard placeholders). Reuse `TopicBacklogPanel` + lifted `PlanNextInterview`.
- Lift `GettingStarted`, `ResumeStrip`, `PlanNextInterview`, `formatInterviewerName` from `Dashboard.jsx` into `src/components/home/`.
- Replace `<Route path="/" element={…<Dashboard/>}>` with `<Home/>`.
- Read `?bucket=review` query param to deep-link/scroll to the Review bucket.
- **Update `src/components/Layout.jsx` `NAV_ITEMS`** to the 2-item form. Add Library icon. Drop `isHome` guard on the "+ New Interview" CTA. Sync mobile menu.

**Definition of done:**
- `/` renders the new Home with real data
- Nav is 2 items: Home + Stories. Header icons: Library + Settings (+ Workspace for admins)
- "+ New Interview" CTA persists across pages
- `/review-queue` → `/?bucket=review` deep-link works
- Lint/build clean, warnings ≤ 79

### PR 5 — Delete legacy pages

**Scope:**
- Delete `Dashboard.jsx`, `ContentHub.jsx`, `ContentCalendar.jsx`, `ReviewPost.jsx`, `ReviewQueue.jsx`, `InterviewOutput.jsx`, `Strategy.jsx`.
- Drop the lazy `import()` lines in `App.jsx:13-25`.
- Drop the `/strategy` route entirely.
- Verify no orphan imports: `grep -r 'ContentHub\|ContentCalendar\|ReviewPost\|ReviewQueue\|InterviewOutput\|Strategy\|Dashboard' src/`

**Definition of done:**
- Lint/build clean
- Warnings count drops (we deleted ~3.5K lines). **Tighten `--max-warnings` in `package.json` to match new floor.** This is the only PR that moves the ratchet — moves it down.
- All redirects from PR 3 still work
- Smoke test full flow: Home → Stories (each view) → Story Detail → New Interview → Interview Session → Home

### PR 6 — Cleanup polish

**Scope:**
- `MediaHub.jsx`: rename `useDocumentTitle('Media')` → `useDocumentTitle('Library')`. Keep `/media` alias.
- Add `Library` (or `Images`) lucide-react icon to `Layout.jsx`.
- Audit `Welcome.jsx` and `getPendingAnnouncement` for old nav copy. Update.
- Sweep `tests/` for E2E paths referencing deleted routes. Update or delete.
- Confirm Playwright suite passes.

**Definition of done:**
- All references to deleted routes/pages eliminated
- Playwright suite green
- Warnings ≤ new floor; ratchet ceiling matches

---

## 5. Risk register

| Risk | Severity | Mitigation | Reversible? |
|------|----------|------------|-------------|
| Bookmarked legacy URLs 404 | High | Every legacy URL has explicit redirect (§1.3). Smoke-test before PR 5. Keep `/media` permanently. | Yes |
| `/review/:itemId` redirect requires itemId→interviewId lookup | Medium | `LegacyReviewRedirect` does one client fetch. On 404 falls back to `/stories`. Log failures. | Yes |
| In-progress interviews break from routing changes | High | `/interview/:cId/:iId` + `/output` alias preserved. Add smoke test in PR 4: start interview → Home → return → resume. | Yes |
| Role-gated views regress | Medium | `useUserRole()` (`src/lib/useUserRole.js`) drives reviewer affordances. Home review bucket + StoryDetail must respect `canReview`. Carry the same hook + button cluster into StoryDetail. | Yes |
| Data shape implemented inconsistently across the three views | High | `Story` type in §3.1 is the contract. All views read via `useStories()` — no view fetches separately. Builder in one file with unit tests in PR 1. | **Hard once shipped.** Why we nail it in PR 1. |
| Lint ratchet drift | Medium | Each PR's DoD requires warnings ≤ 79 (lower). PR 5 decreases the floor. | Yes |
| Lazy import / Suspense flashing during cutover | Low | Same lazy pattern as the rest (`App.jsx:189,201`). Suspense fallback `null`. | Yes |
| Cross-workspace data leak in `useStories` | Critical | Both upstream endpoints (`api/db/clinicians.js:46`, `api/db/content.js:46-48`) enforce workspace filtering. Add assertion in `buildStories()`: drop rows with mismatched `workspace_id` and Sentry-log. Defense in depth. | N/A — preventative |
| Future Option B endpoint with wrong handler shape | High (silent hang) | Follow `api/db/content.js` verbatim. DoD must call out: `req.headers['x-foo']`, `res.status().json()`, `runtime: 'nodejs'`, `workspaceContext(req)`, no `new Response()`. | Yes (expensive — 300s timeouts) |
| PR pileup | Medium | Per CLAUDE.md cap (3 unmerged). Merge each before next. No parallel branching. | N/A — preventative |

### Reversible vs. load-bearing summary

| Decision | Class | Why |
|----------|-------|-----|
| `Story` type and `buildStories` | **Load-bearing** | 3 views depend on its shape. Wrong shape = 3 rewrites. |
| Redirect rules | Reversible | Add/remove `<Navigate>` freely. |
| Component file structure | Reversible | Files move any time. |
| Deletion of legacy pages | Reversible (expensive) | Git history preserves them. Do in PR 5. |
| Adding `/api/db/stories` endpoint | Reversible (don't build yet) | Hook signature stable; backing swappable. |
| Lift `PLATFORM_META` to `src/lib/contentMeta.js` | Reversible | Pure constant move. |

---

## 6. Open questions

Defaults bracketed — implementing agents proceed with the default unless told otherwise.

1. **Does `/clinician/:clinicianId` survive?** ClinicianProfile is part of the old IA but the page is valuable (arc / quote / recent posts). **[Default: keep as a deep-link reached by clicking clinician avatar on a story card. No nav surface.]**

2. **Is "story" really an interview, or can a story exist without one?** `content_pieces` (media-derived briefs, `api/content-pieces/list.js`) are stories without interviews. **[Default for v1: story = interview. Briefs stay in Library only. Revisit when Media gets Phase-2 redesign.]**

3. **Does Story Detail render in-progress interviews too?** Today `/output/:cId/:iId` is completed-only. **[Default: `/stories/:storyId` works for both. Right pane shows "Interview in progress — finish to see derived content" for non-completed; `Resume interview` CTA links to `/interview/:cId/:iId`. URL stays stable across lifecycle.]**

4. **URL shape of Pipeline/Calendar lens — query or path?** **[Default: query param `?view=pipeline`. Simpler routing, simpler toggle component.]**

5. **Server aggregate endpoint now or later?** **[Default: later. Reassess at >100 stories per workspace.]**

6. **`/calendar?view=cards` conflict during redirect?** **[Default: `LegacyCalendarRedirect` forces `view=calendar`, drops user-supplied `view`. Other params pass through.]**

7. **Themes view UI placement.** **[Default: stub in `StoriesViewToggle` showing "Themes — coming soon" disabled tab. Toggle grid layout finalized in PR 3; Phase 2 fills it in.]**

8. **Bernard panel content source.** Roadmap mentions "Ask Bernard" and "Bernard nudges". **[Default: PR 3 stubs `AskBernardPanel` and the Home Bernard slot. Real implementation deferred to a separate Bernard session.]**

---

## 7. Critical files for implementation

Open first. Absolute paths:

- `src/App.jsx` — route table; touched in PRs 2, 3, 4, 5
- `src/lib/queries.js` — query key factory + hooks; gains stories hooks in PR 2
- `src/components/Layout.jsx` — `NAV_ITEMS` array and header chrome; rewritten in PR 4
- `api/db/content.js` and `api/db/interviews.js` — reference handlers + endpoints `useStories()` consumes
- `src/pages/Dashboard.jsx` — lift source for Home sub-components

Secondary:

- `src/pages/ContentHub.jsx` (PLATFORM_META lift; deletion source for Stories)
- `src/pages/ContentCalendar.jsx` (schedule heuristics lift; deletion source for StoriesCalendarView)
- `src/pages/ReviewPost.jsx` (deletion source for StoryDetail editor; heaviest salvage)
- `src/pages/InterviewOutput.jsx` (deletion source for StoryDetail right pane)
- `src/components/PipelineKanban.jsx` (reused in Stories/Pipeline)
- `CLAUDE.md` (constraints — workspace_id, runtime conventions, ratchet)

End of plan.

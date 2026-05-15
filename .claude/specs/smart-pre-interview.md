# Smart Pre-Interview & Lens Regeneration

**Status:** spec ready for implementation
**Drafted:** 2026-05-14 (planning session)
**Supersedes:** "Collapse Pre-Interview Config" in [.claude/development-roadmap.md:41](.claude/development-roadmap.md). Does not contradict the "zero-config 80% path" goal — makes "Smart" actually smart and moves tone/prototype/location tuning to where decisions are cheaper (post-interview with output visible).

---

## Context

The pre-interview screen ([src/pages/NewInterview.jsx](src/pages/NewInterview.jsx)) already collects four pieces of voice/audience signal — tone, voice mode, patient prototype, location — but the roadmap was about to collapse them all under a hidden "Adjust" disclosure, defaulting everything to `'smart'`. That preserves the zero-friction path but loses the signal: an interview about aging gracefully and an interview about labral tear pathology produce content with the same tone modifier (none), the same prototype context (none), and the same location voice (workspace primary).

This spec preserves the signal **without re-introducing a pre-interview form**, by:

1. **Inferring** tone/voice/prototype/location from the topic at Start time, and exposing the picks as tappable chips on the **interview page** (not the pre-interview screen).
2. **Lens regeneration** — letting users re-render individual content pieces through a different tone/prototype/location post-hoc, where the comparison is informed by actual output rather than label-guessing.
3. **Per-location voice modifier** — encoding regional voice once per location (Austin warmth, Portland understatement) instead of per interview.

Plus two small UX corrections to the pre-interview screen: rename "Clinician Name" → "Interviewee Name" (the product serves more than clinicians) and autofill from the logged-in user.

---

## Feature 1 — Infer-and-show: topic-driven auto-config with chip overrides

### Goal
Pre-interview screen has exactly one mandatory decision (topic). The system infers tone/voice/prototype/location from the topic when the user clicks **Start**, and exposes the picks as tappable chips on the interview page where the user can override mid-flow.

### UX

**Pre-interview screen ([src/pages/NewInterview.jsx](src/pages/NewInterview.jsx)):**
- Remove the entire "Adjust settings" disclosure (currently lines 365–516). The Patient archetype / Voice / Location / Tone selectors disappear from this screen.
- The `'smart'` tone option is removed from `TONES` in [src/lib/prompts.js](src/lib/prompts.js) — it was a placeholder for "haven't decided." Inference always produces a concrete pick.
- Local state `tone`, `voiceMode`, `prototype`, `locationId` is removed; the values are computed server-side at Start.

**Interview page (above the conversation):**
- A **chip strip** renders: `🎯 Clinical · 🏥 Practice voice · 🧓 Active retiree · 📍 Portland`.
- Each chip is tappable; tap opens a popover with the workspace's available alternatives (sourced from existing `TONES`, `getVoiceModes(workspace)`, `getPatientPrototypesUi(workspace)`, and `workspace.locations` arrays).
- Selecting an alternative calls `PATCH /api/interviews/[id]` with the new value and updates the chip. Subsequent asset generations use the new value.
- Prototype chip hidden when workspace has ≤1 prototype. Location chip hidden when workspace has ≤1 active location. Matches today's conditional rendering.

### Flow

`handleStart` in `NewInterview.jsx` runs three calls in **parallel** for latency, then navigates optimistically:

1. `getOrCreateClinician({ name: intervieweeName, ... })` — existing.
2. `createInterview({ ... })` — existing, called with **default** values (`tone: null`, `voiceMode: 'practice'`, `prototypeId: null`, `locationId: null`) so the page can navigate immediately without waiting on inference.
3. `POST /api/interviews/infer-config` with `{ topic, intervieweeName }` — fire-and-forget from the client; the endpoint resolves and writes the inferred values directly to the `interviews` row via the existing service-role connection.

Navigation to `/interview/:clinicianId/:interviewId` happens as soon as (1) and (2) resolve. The interview page chip strip renders a brief skeleton state until inference lands (~300ms after page paint), then fills in. Net user-perceived latency: same as today.

If inference fails (timeout, no AI key, rate-limited), defaults stand; chip strip renders with `Clinical / Practice / null / null` and a small "ⓘ couldn't auto-configure — pick manually" hint. Logged via the existing Sentry stub but does not block the interview.

### Data
No new schema. Existing columns receive inferred values:
- `interviews.tone text` (default `'smart'` today — will change to `'clinical'` as the new default for null cases)
- `interviews.voice_mode text default 'practice'`
- `interviews.prototype_id text default null`
- `interviews.location_id uuid default null`

### API: `POST /api/interviews/infer-config`

Runtime: `nodejs`. Rate-limit bucket: `'ai'` (see [api/_lib/ratelimit.js](api/_lib/ratelimit.js)).

**Request:**
```json
{ "interviewId": "<uuid>", "topic": "labral tear pathology", "intervieweeName": "Michael Quasney" }
```

**Response:**
```json
{
  "tone": "clinical",
  "voiceMode": "practice",
  "prototypeId": "active-adult-30-50",
  "locationId": null,
  "rationale": "Pathology focus — clinical depth, practice voice. Prototype matches typical hip-impingement demographic."
}
```

The endpoint:
1. Calls `workspaceContext(req)` (mandatory — every tenant-scoped route filters by workspace_id).
2. Loads available `TONES`, `workspace.patient_context.prototypes`, `workspace.locations` for context.
3. Makes a single Haiku call (`claude-haiku-4-5`) via [api/generate.js](api/generate.js) with a system prompt scoped to "pick one of each, return JSON only."
4. Writes the result to `interviews` (filtered by `workspace_id` + `id` for safety) via the Supabase REST helper.
5. Returns the picks so the client chip strip can render without a follow-up fetch.

**Inference system prompt** (lives in `api/_lib/inferConfig.js`):

> Given an interview topic and the available tones/archetypes/locations for this workspace, pick the single best match for each. Bias toward clinical tone for pathology/anatomy/mechanism topics, warm for recovery/aging/lifestyle, active for performance/athletic. Pick `voiceMode='personal'` only when the topic is clearly a personal-experience story (e.g. "my own ACL recovery"). Leave `locationId` null unless the topic explicitly references a city or neighborhood from the available list. Return JSON only with fields `tone`, `voiceMode`, `prototypeId`, `locationId`, `rationale`.

Rationale is surfaced as a tooltip on the chip strip ("Why these picks?") — not rendered inline.

### Cost
~1 Haiku call per interview start. At projected Phase 1 volume (~1000 interviews/month), well under $1/month.

### Sequencing
~3 days. Bundled with the rename+autofill changes below since both touch `NewInterview.jsx`.

---

## Feature 2 — Lens regeneration

### Goal
Move tone/prototype/location tuning from "guess upfront" to "compare outputs." After assets generate, the user can re-render any individual content piece through a different lens without re-doing the interview.

### UX
- Each content-piece detail view gets a **"Try another lens"** button next to existing Regenerate / Edit actions.
- Disabled with tooltip *"Un-approve this piece to try a different lens"* when `content_pieces.status ∈ {approved, published}`. User must un-approve first (existing action), regenerate, then re-approve.
- Clicking opens a side panel with three chip rows (Tone / Prototype / Location), pre-filled with the interview's current values. User taps chips to change, hits **Regenerate with these**.
- Result renders as a **new version** of the content piece (doesn't overwrite). Detail view gains a small version switcher in the header: `v1 (original) · v2 (clinical → warm) · ...`. Each version is independently editable, approvable, publishable.
- Version label is auto-generated client-side from the delta: `"warm → clinical"`, `"no prototype → active retiree"`, `"+ Austin location"`, etc.

### Data

New migration (next sequential prefix in `supabase/multitenant/migrations/`):

```sql
CREATE TABLE content_piece_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_piece_id uuid NOT NULL REFERENCES content_pieces(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  version_number int NOT NULL,
  tone text NOT NULL,
  voice_mode text NOT NULL,
  prototype_id text,
  location_id uuid REFERENCES workspace_locations(id),
  body text NOT NULL,
  body_format text NOT NULL DEFAULT 'markdown',
  generated_by_user_id text NOT NULL,
  label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (content_piece_id, version_number)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_piece_versions TO service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;

CREATE INDEX content_piece_versions_piece_idx ON content_piece_versions(content_piece_id);
CREATE INDEX content_piece_versions_workspace_idx ON content_piece_versions(workspace_id);

ALTER TABLE content_pieces
  ADD COLUMN IF NOT EXISTS active_version_id uuid REFERENCES content_piece_versions(id);
```

On first regeneration: snapshot the original `content_pieces.body` as `v1` and insert the new generation as `v2`. Future writes to `content_pieces.body` still represent the active version. `active_version_id` tracks which row publishing/preview reads from.

### API
- `POST /api/content-pieces/[id]/versions` — body `{ tone, voiceMode, prototypeId, locationId }`. Server reuses the existing per-asset prompt builder in `src/lib/prompts.js` with overrides, calls `/api/generate` internally, inserts the version row, returns it. Returns 409 if `content_pieces.status ∈ {approved, published}`.
- `PATCH /api/content-pieces/[id]` — accepts `active_version_id` so the switcher can change active version.
- `GET /api/content-pieces/[id]` — extended to include `versions: [{id, version_number, label, tone, voice_mode, prototype_id, location_id, created_at}]` so the switcher renders without a second call.

### Prompts wiring
Existing asset prompts in `prompts.js` already take `(workspace, clinicianName, condition, tone, voiceMode, prototype, ...)`. The regen endpoint passes overrides instead of interview-stored values. **Caveat:** `getToneModifier()` reads `workspace.tone_modifiers[tone]` — if a workspace hasn't filled in a modifier for a given tone, regen is a no-op. Surface an admin warning at `/settings/workspace` when any tone has an empty modifier — separate small PR, not blocking.

### Edge cases
- **User edited the original after generation:** edits live on `content_pieces.body`. On first regen, that edited text becomes `v1` so user work isn't lost. UI says "Saving current draft as v1…" before generating v2.
- **Atom-plan pieces (blog):** [api/_lib/atomPlan.js](api/_lib/atomPlan.js) re-runs the full atom plan with new modifiers — ~2x cost of a normal regen. Show a cost-tier badge in the side panel.
- **Storage:** ~2KB × 5 versions × 1000 pieces = 10MB. Negligible.

### Sequencing
~1.5 weeks. Ship in parallel with the Phase 1 approval workflow — shares its version-switcher UI vocabulary.

---

## Feature 3 — Per-location voice modifier

### Goal
Encode regional voice (Texas warmth, Pacific NW understatement, neighborhood references) **once per location**, not per interview. The clinician picking a location at the chip strip is just selecting "which physical clinic"; voice shaping happens automatically downstream.

### Data

New migration:

```sql
ALTER TABLE workspace_locations
  ADD COLUMN IF NOT EXISTS voice_modifier text;
-- workspace_locations already has service_role grants from migration 010.
```

Plain text, freeform, admin-edited at `/settings/workspace` in the existing locations editor. 2000-char soft limit.

Suggested placeholder copy in the textarea:

> Describe how content for this clinic should sound. Local idioms, neighborhood/landmark references to weave in naturally, vocabulary to favor or avoid, the kind of patient who walks through this door vs. your other clinics. Example: *"Austin staff are warm-Texan but not folksy — reference East Side / South Lamar landmarks; avoid 'y'all' (transplant clientele); lean toward outdoor/active framing."*

### Prompts wiring

In [src/lib/prompts.js](src/lib/prompts.js), add:

```js
function getLocationModifier(location) {
  if (!location?.voice_modifier) return ''
  return `\nLOCAL VOICE — for ${location.label} (${[location.city, location.region].filter(Boolean).join(', ')}):\n${location.voice_modifier.trim()}\n`
}
```

Called in each asset prompt **after** `getToneModifier(tone, workspace)` and **before** the framing rule. Order matters: tone is the umbrella ("clinical"); location is the regional flavor ("clinical the way Austin says it"). If outputs feel mushy in QA when tone and location pull in different directions, add an explicit "tone takes precedence over local voice when they conflict" instruction.

**Per-interview location resolution:** today's prompts interpolate `workspace.location_keyword`, `workspace.location_hashtag` (snapshot of the primary location). When `interviews.location_id` is set, the prompt builder must resolve to **that** location's `location_keyword` / `location_hashtag` / `visit_url`. Migration 010's header note ("PR B teaches prompts + GBP to use it per-post") suggests this was planned but may not be done — verify in code; if not, this feature includes that fix.

### UX
- `/settings/workspace` → Locations section. Each location row gets a new **Voice** textarea (8 rows, 2000 char limit).
- **AI-assist button** "Suggest based on city/region" — calls a Haiku endpoint that drafts a starting paragraph from `{label, city, region}`. User edits before saving. Don't auto-save the suggestion. The assist prompt explicitly avoids regional clichés and stereotypes.
- Single-location workspaces still get the field — useful even at one clinic for neighborhood-level voice.

### Edge cases
- **`locationId = null` ("all locations")**: no per-location modifier injected; today's behavior (use workspace's primary-location snapshot) preserved.
- **Empty `voice_modifier`**: injection is empty string. No regression for existing locations.
- **Stereotyping risk**: field is admin-authored. We ship no default region-stereotyped copy. The AI-assist suggestion uses generic framing and avoids clichés.

### Sequencing
~3 days. Ship first — independent of Features 1 and 2, immediately useful for the three live workspaces.

---

## Rename "Clinician Name" → "Interviewee Name" + autofill from login

### Scope: UI-only
DB tables (`clinicians`), API routes (`/api/clinicians/*`, `getOrCreateClinician`), and hooks (`useClinicians`) keep their current names. Data-layer rename is touch-many-files, breaks every URL/query-key, and pays for nothing today. If "interviewee" sticks as product vocabulary for 2–3 months, do the data-layer rename as a focused cleanup PR then.

### Label changes in [src/pages/NewInterview.jsx](src/pages/NewInterview.jsx)
| Line | Today | Change to |
|------|-------|-----------|
| 208 | "Who are we interviewing?" | unchanged (already neutral) |
| 209 | "Enter the clinician's full name" | "Enter the interviewee's full name" |
| 215 | Label "Clinician Name" | Label "Interviewee Name" |
| 218 | Placeholder "e.g. Dr. Michael Quasney" | unchanged |
| 226 | "If this clinician has been interviewed before, they'll be linked to their existing profile." | "If this person has been interviewed before, they'll be linked to their existing profile." |

Local state `clinicianName` → `intervieweeName`.

Also audit the dashboard, transcript view, and content-piece byline for generic uses of "clinician." Swap to "interviewee" or "speaker" where the role isn't actually clinician-specific. Tag any nuanced cases as TODO in the PR.

### Autofill from Clerk

```js
const defaultIntervieweeName =
  user?.fullName ||
  [user?.firstName, user?.lastName].filter(Boolean).join(' ') ||
  ''

const [intervieweeName, setIntervieweeName] = useState(defaultIntervieweeName)
```

**Behavior:**
- Field is **prefilled, not locked**. Standard `<Input>` semantics — fully editable, clearable.
- Inline hint below the input, **only when the field still matches the autofill**: *"Autofilled from your account · clear to enter someone else's name."* Disappears the moment the user types/clears.
- Subtle "↻" reset icon at the right edge of the input, **only when** the current value ≠ `defaultIntervieweeName` and `defaultIntervieweeName` is non-empty. Restores the autofilled name.
- Empty `defaultIntervieweeName` (no Clerk name): field starts empty, no hint — matches today's behavior.

### Edge cases
- **Existing-interviewee match:** `getOrCreateClinician` already does name-based matching. Autofilling "Michael Quasney" hits Dr. Q's existing record on subsequent interviews. No change needed.
- **Title prefixes ("Dr."):** Clerk stores no title. User types "Dr. " once on the first interview, the record is created as "Dr. Michael Quasney." On subsequent interviews the autofill is still "Michael Quasney"; existing match logic resolves it to the existing record. Acceptable for v1; revisit if multiple users complain.
- **Clinician using their login for a patient interview:** types over the autofilled name with the patient's name. Reset icon restores the autofill if they fat-finger. The interview's *owner* is still bound to `user.id` separately from the interviewee identity — no cross-wiring.

### Bundling
Bundle into the Feature 1 PR — both touch `NewInterview.jsx` in overlapping ways. ~1 day of incremental work on top of Feature 1.

---

## Rollout order

1. **Feature 3 — per-location voice modifier** (~3 days). Independent, smallest, immediately useful for the three live workspaces. Ship first.
2. **Feature 1 — infer + chip strip + rename + autofill** (~3 days, bundled). Depends on Feature 3 so the inference call can pick `locationId`. Ship second.
3. **Feature 2 — lens regeneration** (~1.5 weeks). Parallel with Phase 1 approval workflow; shares its version-switcher UI vocabulary.

## What this does *not* change
- Pre-interview screen still has one mandatory input (topic) + one prefilled input (interviewee name). The zero-config 80% path goal is preserved.
- No new pre-interview decisions are added.
- Workspace JSONB columns (`tone_modifiers`, `patient_context`, `interview_context`) unchanged.
- Schema additions are minimal: 1 column on `workspace_locations`, 1 table + 1 column for versions.
- Data model `clinicians` is unchanged; only UI labels move to "interviewee."

## Decisions locked during planning
- Inference fires on **Start Interview** click, not while typing (cost + race-condition reasons).
- Chip strip lives on the **interview page**, not the pre-interview screen.
- Lens regeneration is **blocked** on approved/published pieces. User must un-approve first.
- `workspace_locations.voice_modifier` is **plain text**, not JSONB. Structure later if patterns emerge.
- Rename is **UI-only**. Data model stays as `clinicians`.

## Open follow-ups (not blocking)
- Should we write a corrected display name (e.g. with "Dr." prefix) back to a per-user preference so future autofills include the title? Drafted as no for v1.
- The admin warning for empty `tone_modifiers` entries (so regenerated pieces actually shift) is a separate small PR — file when Feature 2 ships.
- Data-layer rename `clinicians` → `interviewees` deferred until product vocabulary stabilizes (~2–3 months).

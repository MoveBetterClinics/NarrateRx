# NarrateRx — Development Roadmap, Phase 5

_Created 2026-05-23. Status-refreshed 2026-05-24 after discovering Feature #1 had shipped under a parallel session._

_Sequenced from the May 22 strategic review (`memory/project_strategic_review_2026_05_22.md`) and the relationship-moat thesis (`memory/project_relationship_moat_thesis.md`)._

## Status legend
- ✅ **Shipped** — code in `main`, behind workspace flag where relevant, iterating on quality
- 🚧 **In progress** — worktree exists, partial implementation
- 📋 **Queued** — designed, not started

## North star (unchanged)

The only end-to-end staff storytelling → clinical content pipeline. Phase 5 deepens the moat in the direction the strategic review pointed: real-time capture, voice fidelity, and content that amplifies real patient relationships — without crossing the HIPAA / EHR-integration line.

## What's on this phase, what's off

**On:** Real-time voice interview, persistent practice memory, clinician voice clone, post-visit patient handouts, consent-gated outcome-tied case studies.

**Off (deliberately):**
- EHR / MCP integrations (Jane App, SimplePractice, etc.) — the HIPAA surface area is a category-changing commitment and stays off the table for now.
- Public content mining (podcasts, YouTube, courses by others). See `memory/project_no_content_mining_boundary.md`.
- Broadening to non-clinical verticals. See `memory/project_relationship_moat_thesis.md` — narrow + deep wins.

## Sequencing rationale

```
1. Phone-call mode ─────► ✅ SHIPPED (PR #772 + 8 follow-ups) — iterating on quality
                       │
2. Practice memory ────► 🚧 IN PROGRESS (practice-memory-hot worktree)
                       │
3. Voice clone     ────► 📋 needs the corpus that memory + interviews are building
                       │
4. Patient handouts ───► 📋 inherits voice clone + memory; ties product to patient care
                       │
5. Outcome case studies ► 📋 biggest workflow + consent surface; benefits from all four
```

Each feature stands on its own — but every feature gets better as the one above it lands. That's the compound thesis from the review.

---

## Feature 1 — Phone-call mode (real-time duplex voice) ✅ SHIPPED

**Status:** ✅ Shipped over the weekend of May 23–24 via a parallel session. Iterating on quality. 9 merged PRs to date — spike + integration + 7 quality fixes.

### What shipped

Replaced the turn-based STT→AI→TTS rhythm with a **continuous duplex audio stream** via OpenAI's GPT-4o Realtime API over WebRTC. The AI (named **"Bernard"** in code) can backchannel, listen while speaking, and never closes a turn on a thinking pause.

### As-built architecture

| Piece | File | Notes |
|---|---|---|
| Ephemeral session endpoint | `api/realtime-session.js` | Mints a short-lived `client_secret` via OpenAI Realtime sessions API; Clerk-auth + workspace-scoped |
| Phone-call page | `src/pages/PhoneCall.jsx` | Standalone page (not an InterviewSession variant). Big mic button UI, mute, end-call. Uses WebRTC (not raw WebSocket) for browser audio I/O |
| Workspace flag | Migration `069_realtime_voice_workspace_flag.sql` | `workspaces.realtime_voice_enabled` boolean; tile only shows when true |
| Capture mode | Same migration | Extends `interviews_capture_mode_check` to accept `'realtime_voice'` — distinguishes realtime interviews in Stories + analytics |
| Capture Picker tile | `src/pages/CapturePicker.jsx` | 4th tile "Phone Call" — gated on the workspace flag |
| Live partial transcript | Parallel Web Speech API alongside OpenAI Realtime | PRs #777 + #782 — gives the user a live "what you just said" overlay while Bernard processes |
| `[INTERVIEW_COMPLETE]` detection | In-page handler in PhoneCall.jsx | Same token convention as turn-based interviews; triggers existing completion → blog generation path |
| Patience prompt addendum | PhoneCall.jsx — prepended to system prompt | Realtime-lane-only override that tames the chat prompt's "brief acknowledgment" behavior, which reads as "impatient interrupter" on a live voice call |

### Cost (validated)

OpenAI GPT-4o Realtime — ~$0.06/min input + $0.24/min output. A 15-min interview ≈ $5. Tracked via existing `enforceLimit('ai')` bucket.

### Quality work since spike (the 7 follow-up PRs)

| PR | Issue |
|---|---|
| #774 | Bernard's pace + voice (added British-style patience); end-call now auto-generates blog |
| #776 | Bernard was talking to silence (filling pauses) + inferring details not stated |
| #777 | Live partial user transcript while speaking — pre-Web-Speech parallel pass |
| #778 | Swapped to `gpt-4o-mini-transcribe` for streaming partial deltas |
| #781 | Temporary unconditional event logging (debug aid) |
| #782 | Parallel Web Speech API for true live interim transcript |
| #784 | Pause Web Speech while Bernard talks (kill mic-echo capture); dedup assistant turns |
| (in-flight) | Restart Web Speech on `output_audio_buffer.stopped` not `response.done` — fixes tail-end mic capture of Bernard's last words |

### Known remaining quality work

- **iOS Safari smoke** — not yet validated. Per memory entries `feedback_ios_audio_element_per_element_unlock.md` + `feedback_ios_speech_synthesis_gesture_priming.md`, expect to need gesture-prime + element-sharing.
- **Disconnect/reconnect** — current handling not yet verified; sessions don't gracefully resume by default.
- **Per-workspace minute cap** — not yet implemented; Move Better is the only enabled workspace so risk is bounded.
- **Promotion criteria** — tile remains gated behind `realtime_voice_enabled` until Move Better completes 5 successful real interviews on it. After that, consider promoting from "Beta" to the default, and retiring the turn-based path.

-- **Status: shipped, iterating**

---

## Feature 2 — Persistent practice memory ("second brain")

**Status:** 🚧 In progress. Worktree `practice-memory-hot` exists; early implementation. No API files (`api/practice-memory*`) committed to `main` yet. Design below describes the target architecture; the in-flight branch should be the source of truth for as-built decisions.

### What changes

Today every interview starts cold. Each prompt knows about: the workspace's static `patient_context` + `interview_context` JSONB, the clinician's `voice_notes` text, ~8 recent voice phrases, and the current interview's messages. The clinician's prior interviews, prior approved blog posts, prior social pieces — all invisible to the AI at generation time.

Practice memory makes all of it available. Mid-interview, mid-generation, mid-handout, mid-anything — the AI can reference "you said three months ago that progressive loading matters more than rest for tendon repair; this story sounds like a sequel."

### Architecture

**Two-tier retrieval:**

1. **Hot context** (always injected, ~5–10k tokens) — last 30 days of approved content from this clinician, last 5 interviews summarized, current voice phrases.
2. **On-demand retrieval** (RAG, only when a query needs it) — embeddings on every interview turn, every content_item body, every voice phrase. Vector search via Supabase pgvector (already an option) keyed on the current conversation's most recent turn. Returns top-K relevant snippets with their provenance.

**Why hybrid:** A 2M-token Gemini window is tempting ("just stuff everything in"), but cost scales linearly with input. For a clinician with 100+ interviews, that's ~$0.50/turn — too expensive for the realtime conversation. Hot context covers the common case; RAG handles the long tail.

**New tables:**
- `practice_memory_chunks` — `{ id, workspace_id, clinician_id, source_type, source_id, text, embedding, created_at }`. One row per chunk (interview turn, content paragraph, voice phrase).
- Background job (cron, hourly) chunks + embeds new content as it lands.

**New API:**
- `api/practice-memory/context.js` — POST `{ clinicianId, query, maxTokens }` → returns the merged hot+RAG context block ready to drop into a system prompt.

**Integration points:**
- `getInterviewSystemPrompt` — pulls hot context at session start.
- `getBlogPostSystemPrompt` — pulls hot + RAG (RAG seeded by transcript) at generation.
- Realtime phone-call mode — RAG runs in the background each turn; results passed via `session.update` to bias the next response.
- Handouts, social batch, regenerate — all read from the same source.

### Cost

- Embeddings (OpenAI `text-embedding-3-small`): ~$0.02 per 1M tokens. A 100-interview workspace bootstrap: ~$1. Ongoing: pennies/month.
- pgvector retrieval: free (Supabase Pro tier already includes it).
- Larger system prompts (5–10k tokens vs. ~2k today): ~3× model cost on each call. Material but not crushing.

### Effort

- Schema + embedding pipeline: 3–4 days.
- Retrieval API + prompt integrations: 3–4 days.
- Tuning (chunk size, top-K, recency weighting): 2–3 days of iteration with real workspace data.

**Est. Claude Cost:** $30–60 (architecture decisions in Opus, implementation in Sonnet).

-- **Opus + Sonnet mix, Large**

---

## Feature 3 — Clinician voice clone (ElevenLabs v3)

**Status:** 📋 Queued. Target window: ~3 weeks after phone-call mode lands.

### What changes

After ~5 completed interviews, the clinician has enough clean audio that ElevenLabs v3 can clone their voice with podcast-grade fidelity. From that point on, any TTS output — blog post audio summary, social audio, handout narration, drive-time briefs — renders in the clinician's actual voice instead of the current generic ElevenLabs voice.

### Architecture

**Workflow:**
1. After 5 approved interviews, surface a one-time consent modal on the Clinician Profile → Voice tab: "Want NarrateRx to clone your voice? You'll get audio that sounds like you, not a stock voice. You can revoke any time and we delete the clone."
2. On consent: background job pulls ~5 minutes of clean audio from past interviews (filters out long pauses, cross-talk, low-confidence STT segments), uploads to ElevenLabs Voice Cloning API, stores returned `voice_id` on `clinicians.eleven_voice_id`.
3. Existing TTS call sites (`src/lib/tts.js`, `api/tts.js`) check for a clone first, fall back to `TTS_DEFAULT_VOICE_ID` if absent or consent revoked.

**New columns:**
- `clinicians.eleven_voice_id text` — the cloned voice ID, null until consented + generated.
- `clinicians.voice_clone_consent_at timestamptz` — null until consented.
- `clinicians.voice_clone_revoked_at timestamptz` — null unless revoked. On revoke, we DELETE the ElevenLabs voice and null out `eleven_voice_id` but keep the revoked_at timestamp.

**New API:**
- `api/voice-clone/create.js` — POST `{ clinicianId }`. Auth + consent check, audio aggregation, ElevenLabs upload, DB write.
- `api/voice-clone/revoke.js` — DELETE. Removes from ElevenLabs + nulls clone columns.
- `api/voice-clone/preview.js` — POST `{ clinicianId, text }`. Returns a 5-second audio preview before the user commits.

**UI:**
- Voice tab on Clinician Profile (already exists per `memory/project_clinician_profile_redesign.md`) gets a "Your voice" section. States:
  - Not enough audio yet: "5 interviews until your voice clone is ready (3 done)."
  - Ready, not enabled: "We have enough audio. Want a voice clone? [Preview] [Enable]"
  - Enabled: "Clone active. Used in [X] published pieces. [Re-preview] [Revoke]"

### Cost

- ElevenLabs Pro: $99/mo (includes voice cloning, generous character allowance).
- ElevenLabs Scale ($330/mo) needed if NarrateRx grows past ~10 cloned voices with heavy usage. Not an immediate concern.

### Effort

- ~3 days for the API + workflow.
- ~2 days for the consent + Voice-tab UI.
- ~1 day for audio aggregation + quality filtering.

**Est. Claude Cost:** $10–20 (mostly Sonnet — ElevenLabs is a well-documented integration).

-- **Sonnet, Medium**

---

## Feature 4 — Post-visit patient handouts

**Status:** 📋 Queued. Target window: ~5 weeks after phone-call mode lands.

### What changes

After a patient encounter, the clinician taps an "After visit" button on their phone, does a 60-second voice memo ("I saw Karen today, post-op shoulder, gave her three exercises and want her resting her arm at night"), and NarrateRx generates a branded, personalized handout in their exact voice — printable in-clinic before the patient leaves, or emailed to the patient via the clinician's existing email.

This is the relationship thesis made concrete: content marketing gets the patient in; a personalized handout that sounds like the clinician keeps them.

### Architecture

**New capture mode:** `interviews.capture_mode = 'patient_handout'`. Builds on the voice-memo lane (already shipped — see `api/voice-memo.js`, `src/pages/VoiceMemo.jsx`, `src/pages/CaptureReview.jsx`).

**New prompt:** `getPatientHandoutSystemPrompt(workspace, clinician, transcript, handoutContext)` — takes the voice memo + clinician's voice phrases + workspace branding + handout-specific instructions. Output: a structured handout with sections (What we did today / Exercises / What to watch for / When to come back).

**New output template:** Branded HTML handout — workspace logo, clinician name + headshot, body text in clinician's voice, optional QR back to the clinic. Rendered to PDF via existing print path or server-side via Puppeteer.

**New delivery surfaces:**
- "Print" → opens a print-ready view in the browser.
- "Email" → SendGrid or Resend, from the clinician's authenticated email (or a NarrateRx-on-behalf-of).
- "Text" (later) — Twilio SMS with a link to the handout.

**New schema:**
- `patient_handouts` table — `{ id, workspace_id, clinician_id, interview_id, body_html, body_text, recipient_email, sent_at, archetype_label, created_at }`.
- Or: extend `content_items.kind` with `'patient_handout'` — simpler, reuses existing infra.

**No PHI stored:** Recipient name is captured at print/email time only — never persisted. The body is generalized ("After your visit today, here's…") and the clinician fills in the specific name at the print step or types it into the email subject.

**Compounds with:**
- Voice clone (#3): handout can include a short audio version in the clinician's voice — "Listen to your aftercare instructions" link.
- Practice memory (#2): the system already knows this clinician's approach to shoulder rehab; the handout draws from that.

### Effort

- Voice memo + review pipeline already exists — saves ~3 days.
- New prompt + handout template: 3–4 days.
- Delivery (print + email): 2 days.
- Workflow polish + clinician-facing UI: 2 days.

**Est. Claude Cost:** $15–25.

-- **Sonnet, Medium**

---

## Feature 5 — Outcome-tied case study generator (consent-gated)

**Status:** 📋 Queued. Target window: ~8 weeks after phone-call mode lands.

### What changes

At discharge or a milestone visit, a consent form goes out to the patient (email or QR in-clinic). With consent: NarrateRx stitches the clinician's interview content about that condition type + the patient's outcome into a narrative case study. No PHI — generalized to archetype — but tethered to a real measurable result.

"Patient like you got better here" is the strongest content in healthcare. Every competitor avoids it because the consent workflow is hard. NarrateRx already owns the capture workflow and the voice corpus; adding consent + outcome is the missing third leg.

### Architecture

**New schema:**
- `patient_outcomes` table — `{ id, workspace_id, clinician_id, condition_archetype, intake_state, outcome_state, sessions_count, consent_status ('pending'|'granted'|'denied'|'revoked'), consent_token, consent_granted_at, created_at }`.
- `condition_archetype` is a controlled vocabulary per workspace (defined in workspace settings — "post-op shoulder," "chronic LBP," "athletic neck strain," etc.). Never a free-text patient identifier.
- `intake_state` and `outcome_state` are structured JSONB — pain scale, function scale, return-to-activity, etc. Schema per archetype, configurable per workspace.

**Consent flow:**
- Clinician clicks "Send outcome form" at end of treatment → email or QR with one-time consent_token.
- Patient lands on a NarrateRx-hosted page (no login), reviews exactly what will be used, grants or denies.
- On grant: outcome form fields appear, patient submits.
- On revoke (anytime): row marked revoked, any generated case studies linked to it auto-unpublish.

**Generation:**
- New prompt: `getCaseStudySystemPrompt(workspace, clinician, archetype, outcomeData, priorContentOnArchetype)` — pulls the clinician's prior interview content + approved blog posts on this archetype (via practice memory), weaves the structured outcome into a narrative arc.
- Output: a case-study content_item that flows through the standard approval workflow.

**Anonymization invariants** (enforced at prompt + post-gen validation):
- No real names — replaced with archetype label ("a runner in her late 30s," "a desk worker post-op").
- No specific dates — abstracted to ranges ("six weeks ago," "two months in").
- No identifying conditions outside the controlled vocabulary.
- Geographic detail capped at city-level, never neighborhood.

**Compounds with:**
- Practice memory (#2): the AI knows everything the clinician has said about this condition; the case study reflects their actual approach.
- Voice clone (#3): audio version of the case study in the clinician's voice.
- Handouts (#4): patient who's about to get a case study often gets a handout first — shared archetype + voice infrastructure.

### Risks

- **PHI leakage** — the biggest risk. Mitigations: enforce archetype labels in the prompt + post-generation regex validation + clinician must approve before publish + per-workspace audit log of every generated case study.
- **Consent revocation race** — if a case study is published and then consent revoked, every distribution channel (website, social) must be revertable. Build the un-publish path before the publish path.
- **Workspace setup burden** — defining archetypes + outcome schemas per workspace is real work. Mitigate with sensible defaults per specialty (chiro, PT, OT, etc.).

### Effort

- Schema + consent flow: 5–7 days.
- Outcome form (per-archetype dynamic schema): 4–5 days.
- Generation prompt + anonymization layer: 4–5 days.
- Approval workflow integration + audit log: 3 days.
- Per-specialty archetype defaults + workspace settings UI: 3–4 days.

**Est. Claude Cost:** $60–100 (Opus for architecture + consent + anonymization; Sonnet for the rest).

-- **Opus + Sonnet mix, Max**

---

## Summary table

| # | Feature | Status | Effort | Est. Claude Cost | Compounds with |
|---|---|---|---|---|---|
| 1 | Phone-call mode | ✅ Shipped (May 23–24) | ~Done | ~Spent | Foundation |
| 2 | Practice memory | 🚧 In progress | 8–11 days | $30–60 | Substrate for 3/4/5 |
| 3 | Voice clone | 📋 Queued | 5–6 days | $10–20 | Audio for 4/5 |
| 4 | Patient handouts | 📋 Queued | 7–9 days | $15–25 | Builds on 2/3 |
| 5 | Outcome case studies | 📋 Queued | 19–24 days | $60–100 | Builds on 2/3 |

**Phase 5 progress (as of 2026-05-24):** Feature 1 of 5 shipped. Feature 2 in active development. Three to go.

**Remaining Claude cost estimate:** ~$115–205 for features 2–5.

---

## What this phase deliberately doesn't try to do

- **Catch up to Outset/Listen Labs on interview-engine depth.** Their $30M Series B isn't the moat to chase. The moat is everything that happens around the interview.
- **Compete on scheduling/analytics infrastructure.** Still Buffer's domain.
- **Become a general-purpose content tool.** Every step toward general-purpose is a step away from the defensible clinical vertical.
- **Pre-build for a SaaS-first future.** The clinician-first framing applies — every Phase 5 feature is justified by Move Better's own use, regardless of external tenant demand. External tenants benefit; they're not the validation gate.

---

## Validation per feature

| # | Validation question | Pass criteria |
|---|---|---|
| 1 | Does phone-call mode reduce interview clunk? | Move Better completes 5 interviews on it within 1 week; reports "feels like a phone call, not a tool" in any form |
| 2 | Does practice memory make output noticeably more "them"? | Clinician notices the AI referencing prior content in 50%+ of generations; edit volume on blog posts drops 20%+ |
| 3 | Is the voice clone usable? | Clone passes the "fool a coworker" test — someone who knows the clinician can't tell on first listen |
| 4 | Do patients keep the handouts? | Track open/save rate via emailed-handout analytics; aim for 60%+ within 24 hrs |
| 5 | Are case studies actually publishable? | Clinician publishes the first three generated case studies without major edits; consent rate ≥40% of patients asked |

The validation isn't external — it's Move Better. If the features don't pass Move Better's own bar, they don't ship to external tenants.

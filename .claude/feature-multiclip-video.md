# Feature: Multi-clip video — one long source → many posts

Status: **Spec + Phase-0 (buy-vs-build) complete. v1 = BUILD, ready to scope.**
Authored 2026-05-29 (came out of the V-series video-render smoke test).

## Problem
One long recording (seminar, talk, voice-memo video) currently becomes **one** post.
It should become **many**. This is the core NarrateRx thesis (content multiplication)
and is especially apt for Move Better, which records monthly seminars — hours of A/V
that should turn into dozens of clips. Aligns with existing principles:
`project_app_serves_interview_principle` (long-form → spawn pieces, don't truncate)
and `project_seminar_capture_opportunity`.

## Why now
The single-clip render path was just made bounded + reliable:
- `pending_broll` status constraint fixed (mig 104).
- Large sources downscaled-on-ingest from the URL (PR #967).
- Rendering moved off the request path — async + 202 + Slate polling (PR #969).
- Render duration capped to 60s (PR #972) + ultrafast proxy (PR #973).

Capping to 60s fixed the timeout but throws away the rest of a long source.
**Segmenting** it is the value-capturing version. Also: the 60s-cap timing test showed
extreme 4K masters (2.3GB+) are decode/fetch-heavy even for 60s — exactly the sources
segmentation should own (pick the moments) rather than single-clip render.

## The core insight
**The hard part is selection, not cutting.** Naive time-slicing makes clips that start
mid-sentence with no standalone point. The value is identifying *coherent, standalone
moments* — a complete thought, a demonstrable technique, a quotable line.

## Proposed flow (builds on existing Whisper + render pipeline + Slate review)
1. Transcribe the source (Whisper — already in `api/_lib/brandRenderVideo.js`), timestamped.
2. LLM proposes N segments: `{ start, end, hook, why_it_stands_alone }`, each ≤60s, with
   voice-faithful clinical framing (reuse the workspace voice/tone context).
3. Clinician reviews proposed segments on the Slate and picks which to keep
   (NOT auto-publish — review step is mandatory, matches the Story Director model).
4. Each kept segment → its own story package, rendered via the now-capped pipeline using
   `-ss <start> -t <len>` against the source.

## Phase 0 — buy-vs-build eval (DONE 2026-05-29)

Decision hinge: NarrateRx's differentiation is its **own** brand render + voice-faithful
caption, so a vendor is only wanted for moment **detection (timestamps)** — never one that
bakes its own captions/styling.

| Candidate | Layer | Returns | Verdict |
|---|---|---|---|
| Opus Clip | Render-forced app | Rendered clips + brand-templates; **API closed-beta, gated to Business/high-volume annual** | ❌ Wrong layer + gated |
| Vizard | Render-forced app | Rendered `videoUrl` (captions baked in) + transcript + `viralScore`; no clean source start/end to self-render | ❌ Wrong layer — fights our render |
| AssemblyAI | Detection-only API | Timestamped chapters/highlights, **transcript-based only**. $0.15/hr (+$0.07/hr medical) | ⚠️ Redundant — we already run Whisper |
| Twelve Labs | Detection-only API | Highlights/search w/ start-end seconds, **multimodal (visual + audio)**. ~$0.042/min index + $0.021/min (~$3.80/hr source); 600 free min | ✅ Only additive buy |

**Decision: BUILD the core; buy only the visual lever.**
- **v1 — BUILD** transcript segmentation on the existing Whisper pipeline. We already own the
  expensive half (transcription) and the differentiation (voice-faithful framing). One LLM
  pass over the timestamped transcript ≈ $0.05/source. Seminars are speech-heavy, so spoken
  moments cover the dominant case. (AssemblyAI eliminated: only gives what we already have.)
- **v2 — BUY Twelve Labs *only if* transcript-only misses visual gold.** It finds *visual*
  moments — a clinician demonstrating a movement with little narration — which transcript
  selection can't. For a movement clinic that's the point. Returns timestamps (render stays
  ours); 600 free minutes = zero-cost pilot. Enhancement, not a v1 dependency.
- **Opus/Vizard: do not adopt** — render-forced; using either means discarding our brand render.

## Phasing
| Phase | Scope | Est. Days | Est. Claude Cost |
|---|---|---|---|
| 0 — Buy-vs-build eval | ✅ DONE — build core, Twelve Labs as optional visual v2 | — | done |
| 1 — Own transcript segmentation | Whisper → LLM segment proposals (`{start,end,hook,why}`, ≤60s) → store as draft segments on the source asset | 2–3d | $10–18 (Sonnet) |
| 2 — Slate review UX | Segment picker on the source asset; keep/discard → each kept → story package rendered with `-ss/-t` | 1.5–2d | $6–12 |
| v2 (optional) — Visual moments | Pilot Twelve Labs (600 free min) for visually-driven segments; add only if v1 misses them | 1–2d + pilot | $4–8 + usage |

## Open product questions (for the owner)
- (a) Auto-propose on upload of a long source, or clinician-triggered ("find clips")?
- (b) Cap segments-per-source (e.g. top 8) to avoid review fatigue?
- (c) Does v1 also cover long **audio** (seminar voice memos → audiograms), or video-only first?

## Build-v1 entry points (for the spawned session)
- Transcription + render: `api/_lib/brandRenderVideo.js` (Whisper via `transcribeToSrt`, ffmpeg with `-ss`/`-t`).
- Shared render-and-patch: `api/_lib/renderPackageChannels.js` (each segment → one package render).
- Package creation pattern + status lifecycle: `api/editorial/generate-package.js` (status `generating` → `complete`; `story_packages` row shape; `MAX_RENDER_SECONDS=60` cap already in place).
- Slate review surfaces: `src/pages/Slate.jsx`, `src/components/slate/PackageCard.jsx`, `CoveragePanel.jsx`.
- Voice/tone context for framing: workspace `brand_voice` / tone descriptors (see `getSuggestedTopics` usage).
- Migrations: `supabase/multitenant/migrations/` (bundle `GRANT ... TO service_role` inline if adding a `video_segments` table).

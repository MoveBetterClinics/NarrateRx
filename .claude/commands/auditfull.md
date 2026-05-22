---
description: Full-codebase multi-agent deep audit of NarrateRx — bug-hunter + tenant-isolation-auditor + ui-reviewer review the entire codebase (no since-last scoping), then synthesize a prioritized punch list and spawn fix-task chips for P0s. Higher cost and time than /audit; use before a release or for a quarterly baseline.
---

Run a structured multi-agent **full-codebase** audit and produce a prioritized punch list. Identical to `/audit` except all three agents sweep the entire codebase — no `.last-audit` scoping. Use this when you want a baseline (before a release, after a long autonomous sprint, or when you suspect a previous since-last run missed something).

## Scope

| Agent | Scope |
|---|---|
| `bug-hunter` | Full sweep — every file under `src/` and `api/`, skipping `node_modules`, `dist`, `.claude/worktrees` |
| `tenant-isolation-auditor` | Every file under `api/` recursively |
| `ui-reviewer` | Full app, all major screens |

Approx time: ~20 min. Approx cost: $8–15.

For routine cadence (since-last scoping, cheaper), use `/audit` instead.

---

## Phase 1 — Static gates (blocking, fast)

Run from the repo root:

```bash
npm run typecheck && npm run lint && npm run build && npm run verify-bundles
```

If any of these fail, **stop the audit** and surface the failure to the user. Auto-fix scope is identical to `/checkup` Layer 1 (unused imports, trivial lint warnings); if you can't auto-fix in <2 minutes, stop and report.

If test files have changed since the last `main` push, also run:

```bash
npm test
```

---

## Phase 2 — Parallel agent review

Send a single message with **three concurrent Agent tool calls** so they run in parallel. Each agent gets a self-contained prompt: it doesn't see this conversation.

**Scoping prep** (informational only — this is a full sweep, no diff range needed):

```bash
git log --oneline origin/main..HEAD 2>/dev/null | head -50 || echo "(on main, no diff to show)"
```

Then dispatch the three agents in one message:

### Agent 1 — bug-hunter
- **Scope**: full sweep — every file under `src/` and `api/`, skipping `node_modules`, `dist`, `.claude/worktrees`
- **Prompt template**:
  > Hunt for bugs across the entire NarrateRx codebase. Look for logic errors, edge cases, race conditions, state bugs, and unsafe assumptions. Do NOT report style or formatting issues.
  >
  > Scope: full sweep — every file under `src/` and `api/`, skipping `node_modules`, `dist`, `.claude/worktrees`. Walk the codebase systematically; don't try to read every file but use `grep` for common bug patterns.
  >
  > Context: this is a multi-tenant SaaS (see CLAUDE.md "Multi-tenant SaaS"). Common bug shapes in this codebase:
  > - useEffect deps that cause double-billing of expensive ops
  > - 401/403 branches checked on err.message string match instead of err.status
  > - Background fetch streams that buffer entire files into memory
  > - Mutation race conditions where saveMessages and updateInterview both PATCH the same row
  > - Stale closures in useCallback over messages/interview refs
  >
  > Output as Markdown with sections P0 (data loss / crashes / security), P1 (broken UX / wrong behavior), P2 (resilience / future-bug). Each finding: `file:line — problem — suggested fix`. Cap at top 20 findings (higher than /audit's 15 since this is a baseline run).

### Agent 2 — tenant-isolation-auditor
- **Scope**: every file under `api/` recursively
- **Prompt template**:
  > Audit every NarrateRx API handler for tenant-isolation gaps. Cross-workspace data leaks are 🔴 critical — this is enforced at the API layer (no RLS), so every handler that reads or writes a tenant-scoped table MUST call `workspaceContext(req)` (or `workspaceById(id)` for background paths) and filter by `workspace_id`.
  >
  > Scope: every file under `api/` recursively. Audit each handler — do not skip files just because they look familiar; this is a baseline pass.
  >
  > Reference patterns: see `api/_lib/segmentInterview.js` (single-table CRUD) and `api/collections/items.js` (junction with verifyScope on both sides). See `reference_tenant_isolation_canonical_pattern.md` in memory for the audit baseline.
  >
  > Output as Markdown. For each handler audited: green (filter present + correct) / yellow (filter present but possibly bypassable) / red (missing filter — cross-tenant leak risk). List EVERY handler with its verdict (not just yellow/red) so the next baseline can diff against this one. File:line for any non-green.

### Agent 3 — ui-reviewer
- **Scope**: full app, all major screens (same as `/audit` — visual drift is always cumulative)
- **Prompt template**:
  > Review the NarrateRx UI screen-by-screen against `.claude/development-roadmap.md` and the competitor-UI memory notes (reference_ui_research_2026_05.md). Focus on usability, visual hierarchy, hover/empty states, brand-color consistency, and the cross-page coherence issues called out in CLAUDE.md "Brand-color refresh checklist".
  >
  > Major screens: Home (`/`), Stories (`/stories`), StoryDetail (`/stories/:id`), Library / MediaHub, Settings (workspace, brand kit, channels, locations), Account, New Interview, Interview Session.
  >
  > Output as Markdown with P0 (broken / unusable), P1 (confusing or off-brand), P2 (polish). Each finding: `<screen> — <issue> — <suggested fix>`. Cap at top 20 findings (higher than /audit's 15 since this is a baseline run).

---

## Phase 3 — Synthesis

After all three agents return:

1. **Compose the punch list**. Interleave findings by priority across agents — all P0s first (regardless of source agent), then P1s, then P2s. Tag each finding with its source `[bug]`, `[tenant]`, `[ui]`.

2. **Write the report** to `.claude/audit-history/<YYYY-MM-DD-HHMM>-full.md` (note the `-full` suffix so it doesn't collide with `/audit` reports of the same minute):
   ```
   # Audit Report — <date> (FULL SWEEP)
   Mode: full
   Range: full codebase
   Branch: <git branch> @ <short sha>
   Static gates: ✓ all green

   ## Punch list (priority order)
   ### P0 — Ship-blocking
   1. [tenant] api/clinicians.js:42 — missing workspace_id filter — add `&workspace_id=eq.${ws.id}` to the select
   …

   ### P1 — Important
   …

   ### P2 — Nice-to-have
   …

   ## Agent reports (raw)
   <Collapsed/inlined verbatim from each agent for traceability>
   ```

3. **Update the last-audit pointer**:
   ```bash
   git rev-parse HEAD > .claude/audit-history/.last-audit
   ```
   This sets the baseline for the next `/audit` since-last run.

4. **Console summary** — print to chat:
   - One-line per priority tier (e.g. "P0: 2 findings (both tenant). P1: 5 findings. P2: 8 findings.")
   - Link to the markdown report
   - Top 3 P0/P1 inlined as bullets

---

## Phase 4 — Spawn fix-task chips

For each **P0 finding** (and optionally each P1 if there are ≤3 P0s), call `mcp__ccd_session__spawn_task` to surface a one-click chip the user can use to spin up a worktree session to fix it.

Chip prompt template:

```
Fix the P0 audit finding from <audit report path>:

<verbatim finding text from the punch list>

Context: spawned by /auditfull on <date>. Start by cd-ing into a fresh worktree:
  cd "/Users/qbook/Claude Projects/NarrateRx" && bash scripts/new-session-worktree.sh fix-<short-slug>
Then make the change, commit, push, and open a PR with auto-merge.
```

Title: under 60 chars, action phrase ("Fix tenant filter in api/clinicians.js").
TLDR: 1-2 sentences plain-English summary for the chip tooltip.

Do NOT spawn chips for P2 findings.

---

## When to stop and surface

- Phase 1 static gates fail — abort, surface the lint/build/typecheck error
- A tenant-isolation 🔴 finding lands — flag immediately at the top of the report and in the spawn chip title (security issue, user needs to know now)
- An agent times out or errors — note it in the report, continue with the other two, don't fail the whole audit

---

## Notes

- **Run this sparingly.** Monthly cadence is sensible; before a release is required. Use `/audit` for the routine weekly pass.
- **The last-audit pointer is shared with `/audit`**. Running `/auditfull` resets the baseline for the next `/audit` since-last run.
- **Agent prompts must be self-contained.** Each agent starts fresh with no conversation context.

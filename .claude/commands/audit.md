---
description: Multi-agent deep audit of the NarrateRx codebase scoped to commits since the last audit — static gates + parallel runs of bug-hunter, tenant-isolation-auditor, and ui-reviewer. Synthesizes a prioritized punch list and spawns fix-task chips for P0s. For a full-codebase sweep (no scoping), use /auditfull instead.
---

Run a structured multi-agent audit scoped to commits **since the last audit**, and produce a prioritized punch list. Composes three specialized agents in parallel with the static-check stack. Sister command to `/checkup` (procedural health pass) and `/auditfull` (full-codebase deep audit, no scoping).

## Scope

| Agent | Scope |
|---|---|
| `bug-hunter` | Files changed in the diff range below |
| `tenant-isolation-auditor` | API handlers (`api/**/*.js`) in the diff range |
| `ui-reviewer` | Full sweep — visual drift is cumulative, an old PR's color choice can read as inconsistent only when a new page lands |

Approx time: ~10 min. Approx cost: $3–6.

**Diff range**: read `.claude/audit-history/.last-audit` (a single-line file containing the SHA of the last audit's HEAD). The audit reviews commits in `<.last-audit>..HEAD`. If the file is missing or unreadable, fall back to `origin/main~20..HEAD` (last 20 commits on main).

For a **full-codebase sweep** instead, run `/auditfull` (no diff scoping; reviews everything).

---

## Phase 1 — Static gates (blocking, fast)

Run from the repo root (project root or any worktree):

```bash
npm run typecheck && npm run lint && npm run build && npm run verify-bundles
```

If any of these fail, **stop the audit** and surface the failure to the user. No point burning agent tokens on a tree that doesn't compile. Auto-fix scope here is identical to `/checkup` Layer 1 (unused imports, trivial lint warnings); if you can't auto-fix in <2 minutes, stop and report.

If `npm test` is needed to validate recent test additions, run it too — but skip if no test files changed in the diff range.

---

## Phase 2 — Parallel agent review

This is the heart of `/audit`. Send a single message with **three concurrent Agent tool calls** so they run in parallel. Each agent gets a self-contained prompt: it doesn't see this conversation.

**Scoping prep** (run first):

```bash
LAST_AUDIT_SHA="$(cat .claude/audit-history/.last-audit 2>/dev/null || git rev-parse origin/main~20)"
COMMIT_RANGE="${LAST_AUDIT_SHA}..HEAD"
CHANGED_FILES="$(git diff --name-only $COMMIT_RANGE)"
git log --oneline $COMMIT_RANGE 2>/dev/null | head -50
```

Then dispatch the three agents in one message:

### Agent 1 — bug-hunter
- **Scope**: only the files in `$CHANGED_FILES`
- **Prompt template**:
  > Hunt for bugs in the NarrateRx codebase. Look for logic errors, edge cases, race conditions, state bugs, and unsafe assumptions. Do NOT report style or formatting issues.
  >
  > Scope: `<CHANGED_FILES>`
  >
  > Context: this is a multi-tenant SaaS (see CLAUDE.md "Multi-tenant SaaS"). Common bug shapes in this codebase:
  > - useEffect deps that cause double-billing of expensive ops
  > - 401/403 branches checked on err.message string match instead of err.status
  > - Background fetch streams that buffer entire files into memory
  > - Mutation race conditions where saveMessages and updateInterview both PATCH the same row
  > - Stale closures in useCallback over messages/interview refs
  >
  > Output as Markdown with sections P0 (data loss / crashes / security), P1 (broken UX / wrong behavior), P2 (resilience / future-bug). Each finding: `file:line — problem — suggested fix`. Cap at top 15 findings.

### Agent 2 — tenant-isolation-auditor
- **Scope**: only the files in `$CHANGED_FILES` that match `api/**/*.js`
- **Prompt template**:
  > Audit NarrateRx API handlers for tenant-isolation gaps. Cross-workspace data leaks are 🔴 critical — this is enforced at the API layer (no RLS), so every handler that reads or writes a tenant-scoped table MUST call `workspaceContext(req)` (or `workspaceById(id)` for background paths) and filter by `workspace_id`.
  >
  > Scope: `<changed api/* files>`
  >
  > Reference patterns: see `api/_lib/segmentInterview.js` (single-table CRUD) and `api/collections/items.js` (junction with verifyScope on both sides). See `reference_tenant_isolation_canonical_pattern.md` in memory for the audit baseline.
  >
  > Output as Markdown. For each handler audited: green (filter present + correct) / yellow (filter present but possibly bypassable) / red (missing filter — cross-tenant leak risk). Report ONLY yellow + red findings with file:line.

### Agent 3 — ui-reviewer
- **Scope**: always full sweep — visual drift is cumulative; an old PR's color choice may only show as inconsistent when a new page lands.
- **Prompt template**:
  > Review the NarrateRx UI screen-by-screen against `.claude/development-roadmap.md` and the competitor-UI memory notes (reference_ui_research_2026_05.md). Focus on usability, visual hierarchy, hover/empty states, brand-color consistency, and the cross-page coherence issues called out in CLAUDE.md "Brand-color refresh checklist".
  >
  > Major screens: Home (`/`), Stories (`/stories`), StoryDetail (`/stories/:id`), Library / MediaHub, Settings (workspace, brand kit, channels, locations), Account, New Interview, Interview Session.
  >
  > Output as Markdown with P0 (broken / unusable), P1 (confusing or off-brand), P2 (polish). Each finding: `<screen> — <issue> — <suggested fix>`. Cap at top 15 findings.

---

## Phase 3 — Synthesis

After all three agents return:

1. **Compose the punch list**. Interleave findings by priority across agents — all P0s first (regardless of source agent), then P1s, then P2s. Tag each finding with its source `[bug]`, `[tenant]`, `[ui]`.

2. **Write the report** to `.claude/audit-history/<YYYY-MM-DD-HHMM>.md` with this structure:
   ```
   # Audit Report — <date>
   Mode: since-last
   Range: <commit range>
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

4. **Console summary** — print to chat:
   - One-line per priority tier (e.g. "P0: 2 findings (both tenant). P1: 5 findings. P2: 8 findings.")
   - Link to the markdown report
   - Top 3 P0/P1 inlined as bullets

---

## Phase 4 — Spawn fix-task chips

For each **P0 finding** (and optionally each P1 if there are ≤3 P0s), call `mcp__ccd_session__spawn_task` to surface a one-click chip the user can use to spin up a worktree session to fix it. Use the worktree helper from PR #716 so each fix lands in its own isolated branch.

Chip prompt template:

```
Fix the P0 audit finding from <audit report path>:

<verbatim finding text from the punch list>

Context: spawned by /audit on <date>. Start by cd-ing into a fresh worktree:
  cd "/Users/qbook/Claude Projects/NarrateRx" && bash scripts/new-session-worktree.sh fix-<short-slug>
Then make the change, commit, push, and open a PR with auto-merge.
```

Title: under 60 chars, action phrase ("Fix tenant filter in api/clinicians.js").
TLDR: 1-2 sentences plain-English summary for the chip tooltip.

If `cwd` makes sense for a different repo (rare — almost always NarrateRx), set it; otherwise leave unset.

Do NOT spawn chips for P2 findings — those should be triaged in a manual pass, not auto-actioned.

---

## When to stop and surface

Same fail-fast rules as `/checkup`, plus:

- Phase 1 static gates fail — abort, surface the lint/build/typecheck error
- A tenant-isolation 🔴 finding lands — flag immediately at the top of the report and in the spawn chip title (security issue, user needs to know now)
- An agent times out or errors — note it in the report, continue with the other two, don't fail the whole audit

---

## Notes

- **Do not run on every commit.** This is a deep audit, billable in agent tokens. Run weekly, or before a release.
- **Pair with `/schedule`** if you want it to run automatically each Monday morning: `/schedule create "Weekly audit" cron="0 9 * * 1" "/audit"`.
- **The since-last pointer is a single SHA** in `.claude/audit-history/.last-audit`. To "reset" the audit baseline manually: `git rev-parse HEAD > .claude/audit-history/.last-audit` from the project root.
- **Agent prompts must be self-contained.** Each agent starts fresh with no conversation context — paste in the relevant CLAUDE.md / memory references inline.

---
description: Capture an out-of-scope idea for future review (appends to .claude/ideas.md)
---

Capture an idea in `.claude/ideas.md`. This is a parking lot, not a roadmap — entries are things to *evaluate later*, not commitments.

**Two modes — detect which one applies from the user's arguments:**

### Mode 1: No arguments (`/idea`)
The user wants you to scan **this conversation** for ideas that surfaced but weren't acted on. Look for phrases like "we could also...", "later we might...", "interesting alternative would be...", "if X happens, then Y". Identify 1–5 genuine candidates (be strict — most casual mentions are not real ideas). For each, propose an entry using the structure below, then ask the user which to keep before appending.

### Mode 2: With a one-liner (`/idea <text>`)
The user gave you a seed. Flesh it out using surrounding session context — what files were touched, what triggered the idea, what the natural revisit-condition would be. Confirm the entry with the user before appending.

---

## Entry structure

Append to `.claude/ideas.md` using this exact format. Status defaults to `Parked`. Date is today's date in YYYY-MM-DD.

```markdown
## Idea: <short title>
- **Surfaced:** YYYY-MM-DD (<session-context phrase, ~5 words>)
- **Area:** <files / system / area touched>
- **TLDR:** <1–2 sentences — what's the idea, what does it replace or add>
- **Effort:** <rough estimate: ~30 min / ~3 hours / ~1 day / ~1 week>
- **Trigger to revisit:** <the "if/then" — what user-visible signal would make this worth doing>
- **Status:** Parked
```

The **Trigger to revisit** field is the most important. Force the user (and yourself) to name a concrete condition — "clinicians complain about X" or "engagement drops below Y" or "we ship feature Z." Aspirational ideas without triggers rot in the file; ideas with triggers become actionable when the signal hits.

---

## Be strict, not aspirational

Skip ideas that are:
- **Already in `CLAUDE.md` or memory** — those have a home; don't duplicate.
- **Already on the roadmap** (`.claude/development-roadmap.md`) — those are committed, not parking-lot.
- **Tiny enough to just do** — if it's a 10-minute fix, suggest doing it now instead.
- **Vague vibes** — "make UI better" isn't an idea. "Add thumbnail preview before Compose so clinicians know what they're getting" is.
- **Already an open GitHub issue** — check with `gh issue list --label idea` (or any related label) before adding duplicates.

If you scan the conversation and find nothing genuinely worth parking, say so: **"No ideas worth parking — everything mentioned was either acted on, already documented, or too vague."** Don't pad.

---

## After appending

- Read the file back briefly to confirm the new entry is in place.
- If you notice existing entries that have been **resolved** by recent work (shipped, killed, promoted to roadmap), surface them to the user with a one-line suggestion to update their status. Don't auto-update — let the user confirm.
- One-sentence summary of what you added. No fanfare.

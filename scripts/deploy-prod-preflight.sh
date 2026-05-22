#!/usr/bin/env bash
# deploy-prod-preflight.sh — guard `npm run deploy:prod` against shipping
# the wrong working tree.
#
# Refuses to proceed unless ALL of these are true:
#   1. The cwd is the project root (not a worktree under it).
#   2. The current branch is `main`.
#   3. HEAD equals origin/main (no local commits, fully fast-forwarded).
#   4. The working tree has no staged or unstaged modifications to tracked
#      files. Untracked files are allowed (notes, mockups, etc.).
#
# Direct cause: the 2026-05-22 close-call where another agent silently
# switched the project root onto a feature branch with an unmerged commit;
# the next `vercel deploy --prod` shipped that branch's working tree.
# Coincidentally consistent with main only because the other session's PR
# merged in parallel — would otherwise have shipped unreviewed code.
#
# Override (rarely): set DEPLOY_PROD_BYPASS_PREFLIGHT=1 to skip checks.
# Only use when you understand the risk (e.g. emergency rollback from a
# known-good commit that isn't yet on main).

set -euo pipefail

if [[ "${DEPLOY_PROD_BYPASS_PREFLIGHT:-}" == "1" ]]; then
  echo "⚠️  Preflight bypassed via DEPLOY_PROD_BYPASS_PREFLIGHT=1"
  exit 0
fi

PROJECT_ROOT="$(git rev-parse --show-toplevel)"
TOP_LEVEL_DIR="$(basename "$PROJECT_ROOT")"
if [[ "$TOP_LEVEL_DIR" != "NarrateRx" ]]; then
  echo "✗ Refusing to deploy: top-level dir is \"$TOP_LEVEL_DIR\", expected \"NarrateRx\"." >&2
  echo "  Production deploys must run from the project root, not a worktree." >&2
  exit 1
fi

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$CURRENT_BRANCH" != "main" ]]; then
  echo "✗ Refusing to deploy: on branch \"$CURRENT_BRANCH\", expected \"main\"." >&2
  echo "  Run: git checkout main && git pull --ff-only origin main" >&2
  exit 1
fi

echo "→ Fetching origin to verify main is current..."
git fetch origin main --quiet

LOCAL_HEAD="$(git rev-parse HEAD)"
REMOTE_HEAD="$(git rev-parse origin/main)"
if [[ "$LOCAL_HEAD" != "$REMOTE_HEAD" ]]; then
  echo "✗ Refusing to deploy: local main ($LOCAL_HEAD) differs from origin/main ($REMOTE_HEAD)." >&2
  AHEAD="$(git rev-list --count origin/main..HEAD)"
  BEHIND="$(git rev-list --count HEAD..origin/main)"
  if [[ "$AHEAD" -gt 0 ]]; then
    echo "  Local is $AHEAD commit(s) ahead of origin/main — push or reset first." >&2
  fi
  if [[ "$BEHIND" -gt 0 ]]; then
    echo "  Local is $BEHIND commit(s) behind origin/main — run: git pull --ff-only origin main" >&2
  fi
  exit 1
fi

# `git status --porcelain` lists tracked changes (staged or unstaged) as M/A/D
# and untracked files as ??. Allow untracked (notes, mockups, .env.local)
# since those don't ship in the vercel upload anyway — exclude lines that
# start with ?? from the modification check.
DIRTY="$(git status --porcelain | grep -v '^?? ' || true)"
if [[ -n "$DIRTY" ]]; then
  echo "✗ Refusing to deploy: working tree has uncommitted modifications:" >&2
  echo "$DIRTY" | sed 's/^/    /' >&2
  echo "  Commit, stash, or reset before deploying." >&2
  exit 1
fi

echo "✓ Preflight passed — on main @ $LOCAL_HEAD, working tree clean."

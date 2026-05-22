#!/usr/bin/env bash
# new-session-worktree.sh — spin up an isolated worktree for a new Claude session.
#
# Why: when multiple Claude sessions share the project root, they collide on
# branches and the working tree. One agent's WIP blocks the other's `git
# checkout`, and prod deploys can't run until both are committed. Worktrees
# give each session its own checkout so the project root stays clean for
# `main`-tracking ops (pull, deploy).
#
# Usage:
#   scripts/new-session-worktree.sh <session-name> [base-branch]
#
# Examples:
#   scripts/new-session-worktree.sh post-interview-ux
#   scripts/new-session-worktree.sh feat-export origin/main
#
# Produces:
#   ../NarrateRx-worktrees/<session-name>/   — fresh worktree off base
#   .env.local copied in (Sensitive vars stay on disk, not git)
#   .vercel/ copied in so `vercel deploy` knows the project
#
# Conventions:
#   - Branch is named the same as the worktree dir: <session-name>
#   - Base defaults to origin/main (always rebase before starting work)
#   - Project root (this directory) stays on `main` and is NEVER used for
#     session work — only for pulls + prod deploys

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <session-name> [base-branch]" >&2
  echo "Example: $0 post-interview-ux" >&2
  exit 1
fi

NAME="$1"
BASE="${2:-origin/main}"

# Sanity-check session name (no spaces, no slashes — used as both a dir name
# and a branch name)
if [[ ! "$NAME" =~ ^[a-zA-Z0-9._-]+$ ]]; then
  echo "Session name must match [a-zA-Z0-9._-]+ — got: $NAME" >&2
  exit 1
fi

PROJECT_ROOT="$(git rev-parse --show-toplevel)"
WORKTREE_PARENT="$(dirname "$PROJECT_ROOT")/NarrateRx-worktrees"
WORKTREE_PATH="$WORKTREE_PARENT/$NAME"

if [[ -e "$WORKTREE_PATH" ]]; then
  echo "Worktree already exists: $WORKTREE_PATH" >&2
  echo "Remove it first: git worktree remove \"$WORKTREE_PATH\"" >&2
  exit 1
fi

# Pull latest base ref before branching so the new worktree is current.
echo "→ Fetching origin..."
git -C "$PROJECT_ROOT" fetch origin --quiet

mkdir -p "$WORKTREE_PARENT"

echo "→ Creating worktree at $WORKTREE_PATH on branch $NAME (off $BASE)"
git -C "$PROJECT_ROOT" worktree add -b "$NAME" "$WORKTREE_PATH" "$BASE"

# Sensitive env vars + Vercel link don't live in git — copy them so the new
# worktree can run `npm run dev`, `vercel env pull`, etc. without setup.
for f in .env.local .env .vercel; do
  if [[ -e "$PROJECT_ROOT/$f" ]]; then
    cp -R "$PROJECT_ROOT/$f" "$WORKTREE_PATH/$f"
    echo "→ Copied $f"
  fi
done

# Reuse the same node_modules via symlink to avoid a fresh `npm install`
# every time. If you ever need an isolated install (e.g. testing a dep
# upgrade), `rm node_modules && npm install` inside the worktree.
if [[ -d "$PROJECT_ROOT/node_modules" && ! -e "$WORKTREE_PATH/node_modules" ]]; then
  ln -s "$PROJECT_ROOT/node_modules" "$WORKTREE_PATH/node_modules"
  echo "→ Linked node_modules from project root"
fi

cat <<EOF

✓ Worktree ready: $WORKTREE_PATH
  Branch: $NAME (tracking origin/main implicitly via base)

Next steps:
  cd "$WORKTREE_PATH"
  # ...do work, commit, push, PR as usual...

When done (after PR is merged):
  git worktree remove "$WORKTREE_PATH"

The project root ($PROJECT_ROOT) stays on \`main\` and is reserved for:
  - git pull origin main
  - npm run deploy:prod
EOF

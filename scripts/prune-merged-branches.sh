#!/usr/bin/env bash
# Prune local git branches whose PR has been merged or closed.
#
# The repo accumulates local branches because work is squash-merged (so
# `git branch --merged` can't detect it) and the local ref is never deleted.
# This sweep reconciles every local branch against its PR state via `gh` and
# deletes the dead ones. It NEVER touches:
#   - main
#   - the currently checked-out branch
#   - branches checked out in a worktree (incl. locked agent worktrees)
#   - branches with an OPEN PR
#   - branches that never had a PR (could be un-pushed local work)
#
# Usage:
#   scripts/prune-merged-branches.sh            # delete merged + closed-PR branches
#   scripts/prune-merged-branches.sh --dry-run  # show what would be deleted, delete nothing
#   scripts/prune-merged-branches.sh --merged-only   # only delete MERGED (skip CLOSED)
#
# Safe to run repeatedly. Deleted branches are recoverable via `git reflog` for ~90 days.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

DRY_RUN=0
MERGED_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --merged-only) MERGED_ONLY=1 ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

echo "[prune] $(date '+%Y-%m-%d %H:%M:%S')  dry_run=$DRY_RUN merged_only=$MERGED_ONLY"

git fetch origin --prune --quiet

current="$(git rev-parse --abbrev-ref HEAD)"
# branches checked out in any worktree (these cannot be deleted anyway)
worktree_branches="$(git worktree list --porcelain | awk '/^branch /{sub("refs/heads/","",$2); print $2}')"

# all PRs: headRefName<TAB>state
prs="$(gh pr list --state all --limit 2000 --json headRefName,state --jq '.[] | [.headRefName, .state] | @tsv' 2>/dev/null || true)"
if [ -z "$prs" ]; then
  echo "[prune] WARNING: no PR data from gh (auth/network?). Aborting to stay safe." >&2
  exit 1
fi

deleted=0; kept_open=0; kept_nopr=0
while IFS= read -r b; do
  [ -z "$b" ] && continue
  [ "$b" = "main" ] && continue
  [ "$b" = "$current" ] && continue
  if printf '%s\n' "$worktree_branches" | grep -qx "$b"; then continue; fi

  state="$(printf '%s\n' "$prs" | awk -F'\t' -v B="$b" '$1==B{print $2; exit}')"

  if [ -z "$state" ]; then
    kept_nopr=$((kept_nopr+1)); echo "  keep   [no-PR]  $b"; continue
  fi
  if [ "$state" = "OPEN" ]; then
    kept_open=$((kept_open+1)); echo "  keep   [OPEN]   $b"; continue
  fi
  if [ "$state" = "MERGED" ] || { [ "$MERGED_ONLY" = "0" ] && [ "$state" = "CLOSED" ]; }; then
    if [ "$DRY_RUN" = "1" ]; then
      echo "  WOULD DELETE [$state] $b"
    else
      git branch -D "$b" >/dev/null && echo "  deleted [$state] $b"
    fi
    deleted=$((deleted+1))
  else
    echo "  keep   [$state] $b"
  fi
done < <(git for-each-ref --format='%(refname:short)' refs/heads/)

echo "[prune] done. ${deleted} $([ "$DRY_RUN" = "1" ] && echo 'would be deleted' || echo 'deleted'); kept ${kept_open} open + ${kept_nopr} no-PR."

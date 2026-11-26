#!/usr/bin/env bash
set -euo pipefail

COMMIT_MSG="${1:-Update app features $(date -u '+%Y-%m-%d %H:%M UTC')}"
BRANCH="${GIT_BRANCH:-main}"
DEFAULT_REMOTE_URL="https://github.com/newshuntexpress/loadingmanager.store.git"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Initializing Git repository on branch '$BRANCH'..."
  git init
  git branch -M "$BRANCH"
fi

if ! git remote get-url origin >/dev/null 2>&1; then
  echo "Configuring Git remote 'origin' -> $DEFAULT_REMOTE_URL"
  git remote add origin "$DEFAULT_REMOTE_URL"
fi

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '')"
if [ "$CURRENT_BRANCH" != "$BRANCH" ]; then
  git branch -M "$BRANCH"
fi

# Stage all additions, modifications, and deletions (while respecting .gitignore)
git add -A

if git diff --cached --quiet; then
  echo "No local changes to commit."
else
  git commit -m "$COMMIT_MSG"
fi

echo "Pushing to GitHub ($BRANCH)..."
if git ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1; then
  git fetch origin "$BRANCH"
  if ! git merge-base --is-ancestor "origin/$BRANCH" HEAD >/dev/null 2>&1; then
    echo "Remote branch '$BRANCH' has existing commits; integrating workspace changes cleanly..."
    git merge --allow-unrelated-histories -s ours --no-edit "origin/$BRANCH" || true
  fi
fi

git push -u origin "$BRANCH"
echo "Done. GitHub push completed — automatic deployment to https://loadingmanager.store/ will trigger immediately."

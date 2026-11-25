#!/usr/bin/env bash
set -euo pipefail

COMMIT_MSG="${1:-Update app features $(date -u '+%Y-%m-%d %H:%M UTC')}"
BRANCH="${GIT_BRANCH:-main}"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Error: Git repository is not initialized yet."
  echo "Run: git init && git branch -M main && git remote add origin https://github.com/newshuntexpress/loadingmanager.store.git"
  exit 1
fi

if ! git remote get-url origin >/dev/null 2>&1; then
  echo "Error: Git remote 'origin' is not configured."
  echo "Run: git remote add origin https://github.com/newshuntexpress/loadingmanager.store.git"
  exit 1
fi

# Stage all additions, modifications, and deletions (while respecting .gitignore)
git add -A

if git diff --cached --quiet; then
  echo "No local changes to commit."
else
  git commit -m "$COMMIT_MSG"
fi

echo "Pushing to GitHub ($BRANCH)..."
git push -u origin "$BRANCH"
echo "Done. GitHub push completed — automatic deployment to https://loadingmanager.store/ will trigger immediately."

#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/gatepass}"
BRANCH="${DEPLOY_BRANCH:-main}"

echo "Deploying GatePass & Loading Slip Manager in $APP_DIR (branch: $BRANCH)..."
cd "$APP_DIR"

if [ ! -d ".git" ]; then
  echo "Error: $APP_DIR is not a git repository."
  exit 1
fi

# Mirror exact tracked additions, edits, and deletions from GitHub without touching .env or data/
git fetch origin "$BRANCH"
git reset --hard "origin/$BRANCH"

if [ -f "package-lock.json" ]; then
  npm ci
else
  npm install
fi

# Rebuilds dist/ completely (Vite cleans removed assets automatically)
npm run build

# Start or restart single-writer PM2 process while preserving environment
if command -v pm2 >/dev/null 2>&1; then
  if pm2 describe gatepass-dispatch >/dev/null 2>&1; then
    pm2 restart ecosystem.config.cjs --update-env
  else
    pm2 start ecosystem.config.cjs
  fi
  pm2 save
else
  echo "Warning: pm2 not found; please restart the Node.js process manager manually."
fi

echo "Deployment complete."

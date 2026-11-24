#!/usr/bin/env bash
#
# One-command deploy: publish this dashboard to GitHub Pages.
#
#   npm run deploy
#
# Needs: git, gh (authenticated), and a public GitHub repo (created if missing).
# The site is fully static; there is no server to provision and no secret to set.
set -euo pipefail

REPO_SLUG="${TASKMARKET_VIZ_REPO:-aazh2026/taskmarket-market-visualizer}"
BASE_BRANCH="${TASKMARKET_VIZ_BRANCH:-main}"

say() { printf '\033[1;35m→\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

command -v git >/dev/null || die "git is required"
command -v gh  >/dev/null || die "gh (GitHub CLI) is required and must be authenticated"
gh auth status >/dev/null 2>&1 || die "gh is not authenticated. Run: gh auth login"

OWNER="${REPO_SLUG%%/*}"
NAME="${REPO_SLUG##*/}"

say "Refreshing market data"
node scripts/fetch.mjs

say "Ensuring repository $REPO_SLUG exists"
if ! gh repo view "$REPO_SLUG" >/dev/null 2>&1; then
  gh repo create "$REPO_SLUG" --public --description "A live, read-only dashboard of the Taskmarket market." --add-readme=false
else
  say "Repository already exists"
fi

git init -q 2>/dev/null || true
git checkout -B "$BASE_BRANCH" 2>/dev/null || true
git add -A
if git diff --cached --quiet; then
  say "Nothing to commit"
else
  git commit -q -m "feat: Taskmarket market visualizer (live data, hourly refresh, Pages deploy)"
fi

if ! git remote get-url origin >/dev/null 2>&1; then
  git remote add origin "https://github.com/$REPO_SLUG.git"
fi

say "Pushing to $BASE_BRANCH"
git push -u origin "$BASE_BRANCH"

say "Enabling GitHub Pages"
# Pages from the branch root: simplest possible one-command deploy.
gh api --method POST "repos/$REPO_SLUG/pages" \
  -f source[branch]="$BASE_BRANCH" -f source[path]=/ \
  --jq '.html_url' 2>/dev/null \
  || gh api --method PUT "repos/$REPO_SLUG/pages" \
       -f source[branch]="$BASE_BRANCH" -f source[path]=/ \
       --jq '.html_url' 2>/dev/null \
  || say "Pages settings left as-is (may already be configured)"

URL="https://${OWNER}.github.io/${NAME}/"
say "Done. The dashboard will be live at: $URL"
say "The first build takes a couple of minutes. After that, data refreshes hourly on its own."

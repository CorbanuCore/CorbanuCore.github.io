#!/usr/bin/env bash
set -euo pipefail

nav_root=/home/postfiat/repos/navstrategies
site_root=/home/postfiat/repos/corbanucore.github.io
lock_path=/run/user/$(id -u)/corbanu-market-lens-refresh.lock

exec 9>"$lock_path"
flock -n 9 || { echo "another Market Lens refresh is running" >&2; exit 75; }

cd "$site_root"
if [[ -n "$(git status --porcelain)" ]]; then
  echo "site worktree is dirty; refusing an automated commit" >&2
  exit 76
fi

git fetch origin main
if [[ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]]; then
  echo "local main differs from origin/main; refusing an automated update" >&2
  exit 77
fi

cd "$nav_root"
.venv/bin/python scripts/update_coverage_total_return_indices.py

cd "$site_root"
python3 scripts/refresh_onchain_spot_catalog.py
python3 scripts/refresh_earnings_options.py --symbol AAPL
"$nav_root/.venv/bin/python" scripts/build_market_pages.py

python3 scripts/validate_market_lens.py

mapfile -t market_pages < <(python3 -c 'import json; u=json.load(open("assets/market-data/universe.json")); print("\n".join("{}/index.html".format(row["slug"]) for row in u["instruments"]))')
git add assets/market-data/*.json "${market_pages[@]}"
if git diff --cached --quiet; then
  echo "Market Lens is already current"
  exit 0
fi

git commit -m "data: refresh Market Lens $(date -u +%F)"
git push origin main

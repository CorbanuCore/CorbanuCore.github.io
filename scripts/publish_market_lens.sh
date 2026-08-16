#!/usr/bin/env bash
set -euo pipefail

export PYTHONDONTWRITEBYTECODE=1

nav_root=${NAVSTRATEGIES_ROOT:-/home/postfiat/repos/navstrategies}
publisher_root=${CORBANU_MARKET_LENS_PUBLISH_ROOT:-/home/postfiat/var/corbanu-market-lens-publisher}
remote_url=https://github.com/CorbanuCore/CorbanuCore.github.io.git
lock_path=/run/user/$(id -u)/corbanu-market-lens-refresh.lock

exec 9>"$lock_path"
flock -n 9 || { echo "another Market Lens refresh is running" >&2; exit 75; }

# Production code must be the exact published navstrategies revision.  Untracked
# research files are harmless and intentionally ignored here.
git -C "$nav_root" fetch origin master
if ! git -C "$nav_root" diff --quiet || ! git -C "$nav_root" diff --cached --quiet; then
  echo "navstrategies has tracked local changes; refusing a production refresh" >&2
  exit 76
fi
if [[ "$(git -C "$nav_root" rev-parse HEAD)" != "$(git -C "$nav_root" rev-parse origin/master)" ]]; then
  echo "navstrategies master differs from origin/master; refusing a production refresh" >&2
  exit 77
fi

# The automation clone is isolated from the human development checkout.  A
# normal interrupted run can leave it ahead of origin; retry that push before
# fetching new data.  Failed pre-commit generation can leave tracked outputs
# dirty; preserve that clone for diagnosis and replace it with a clean clone.
quarantine_publisher() {
  local reason=$1
  local quarantine_path="${publisher_root}.quarantine.$(date -u +%Y%m%dT%H%M%SZ).$$"
  echo "quarantining publisher checkout ($reason) at $quarantine_path" >&2
  mv "$publisher_root" "$quarantine_path"
}

mkdir -p "$(dirname "$publisher_root")"
if [[ -e "$publisher_root" && ! -d "$publisher_root/.git" ]]; then
  quarantine_publisher "incomplete clone"
fi
if [[ ! -d "$publisher_root/.git" ]]; then
  git clone --branch main --single-branch "$remote_url" "$publisher_root"
fi
if [[ "$(git -C "$publisher_root" remote get-url origin)" != "$remote_url" ]]; then
  echo "publisher origin is not the expected Corbanu repository" >&2
  exit 78
fi
if [[ -n "$(git -C "$publisher_root" status --porcelain)" ]]; then
  quarantine_publisher "residual generated files from a failed run"
  git clone --branch main --single-branch "$remote_url" "$publisher_root"
fi

git -C "$publisher_root" fetch origin main
local_head=$(git -C "$publisher_root" rev-parse HEAD)
remote_head=$(git -C "$publisher_root" rev-parse origin/main)
merge_base=$(git -C "$publisher_root" merge-base HEAD origin/main)
if [[ "$local_head" != "$remote_head" ]]; then
  if [[ "$merge_base" == "$local_head" ]]; then
    git -C "$publisher_root" merge --ff-only origin/main
  elif [[ "$merge_base" == "$remote_head" ]]; then
    echo "retrying interrupted Market Lens push at $local_head"
    git -C "$publisher_root" push origin main
    git -C "$publisher_root" fetch origin main
  else
    echo "publisher main and origin/main diverged; refusing an automated update" >&2
    exit 80
  fi
fi
if [[ "$(git -C "$publisher_root" rev-parse HEAD)" != "$(git -C "$publisher_root" rev-parse origin/main)" ]]; then
  echo "publisher did not reconcile with origin/main" >&2
  exit 81
fi

cd "$nav_root"
.venv/bin/python scripts/update_coverage_total_return_indices.py

cd "$publisher_root"
python3 scripts/refresh_onchain_spot_catalog.py
python3 scripts/refresh_earnings_options.py --max-workers 4
"$nav_root/.venv/bin/python" scripts/build_market_pages.py

node --check assets/js/market-lens.js
node tests/live_perp_client_test.mjs
"$nav_root/.venv/bin/python" scripts/validate_market_lens.py

mapfile -t market_pages < <(python3 -c 'import json; u=json.load(open("assets/market-data/universe.json")); print("\n".join("{}/index.html".format(row["slug"]) for row in u["instruments"]))')
git add assets/market-data/*.json "${market_pages[@]}"
if git diff --cached --quiet; then
  echo "Market Lens is already current at $(git rev-parse HEAD)"
  exit 0
fi

git commit -m "data: refresh Market Lens $(date -u '+%F %H:%M UTC')"
git push origin main
git fetch origin main
if [[ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]]; then
  echo "published commit did not reconcile with origin/main" >&2
  exit 82
fi
echo "published Market Lens commit $(git rev-parse HEAD)"

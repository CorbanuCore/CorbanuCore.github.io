# corbanu.com

Public content for [corbanu.com](https://corbanu.com), served by GitHub Pages
from `main`.

This repository holds published content only: market pages, posts, the
[/health](https://corbanu.com/health/) production dashboard, the
[/terminal](https://corbanu.com/terminal/) product page, JS/CSS assets, and
provider-free JS tests. Market data and generated pages are refreshed by an
automated publisher; edits to generated files are overwritten on the next
publish.

Data attributions on market pages name public sources only. See
[/disclaimer](https://corbanu.com/disclaimer/) and
[/compliance](https://corbanu.com/compliance/) for publication policies.

## Tests

```bash
node --check assets/js/market-lens.js
node tests/live_perp_client_test.mjs
node tests/corbanu_index_contract_test.mjs
```

The `/indexes/` builder uses `https://api.corbanu.com/v2/indexes`: load catalog,
submit an authenticated preview, poll its durable job, review holdings and
exclusions, then confirm the exact preview hash before locking. A preview link
can be reopened with the owner's API key. Keys and pending request bodies stay
in memory; retries in the same tab reuse the request ID. The basket view receives
the key in memory when opened from the builder. No frontend action places a trade.

Browser regression checks use synthetic API responses and never accept terms,
spend model credits or place orders on a real account:

```sh
corepack pnpm exec playwright install chromium
corepack pnpm test:index-browser
```

MetaMask can connect from the initial index builder using EIP-6963 discovery. The selected account stays in memory across the preview-to-basket handoff; account changes invalidate ownership signing. Connecting alone does not authorize a transaction. Felix brokerage authentication, firm quotes and execution are still required for buying.

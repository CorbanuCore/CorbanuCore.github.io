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

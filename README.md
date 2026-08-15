# Corbanu

Static organization site for [CorbanuCore](https://github.com/CorbanuCore), published with GitHub Pages.

The site is intentionally dependency-free: edit `index.html`, commit, and push to `main`.

Market Lens pages are generated from the local navstrategies spot/perp index
artifacts. Refresh the verified on-chain wrapper catalog and direct venue market
data first, then rebuild the pages. The refresh reads Binance and LBank order
books and Meteora pool state; order-book depth is dollar notional within 2% of
mid, while pool TVL remains a separate metric:

```bash
python3 scripts/refresh_onchain_spot_catalog.py

/home/postfiat/repos/navstrategies/.venv/bin/python \
  scripts/build_market_pages.py
```

# Corbanu

Static organization site for [CorbanuCore](https://github.com/CorbanuCore), published with GitHub Pages.

The site is intentionally dependency-free: edit `index.html`, commit, and push to `main`.

The 37 Market Lens pages are generated from the locked local navstrategies
spot/perp index artifacts. Every page contains the cash-reference total-return
line, the funding-inclusive Hyperliquid perp candlesticks, the perp/spot ratio,
1-day and 7-day long-funding forecasts, and discovered on-chain spot wrappers.
Supported US equities also display the next-earnings probability distribution,
an ATM straddle, and the two liquid calls and puts with the highest average
historical payout. Supported index, commodity, BTC, and ETH pages display
selectable ATM straddles for the listed expiries closest to 30 and 90 days.
BTC uses IBIT options; ETH selects the live liquidity leader from ETHA, ETHE,
FETH, and ETHW on every refresh.
Refresh the verified wrapper catalog and direct venue market data first, then
rebuild the pages. The refresh reads Binance and LBank order
books, Meteora pool state, direct PancakeSwap V3/USDT pool quotes on BNB Chain,
official multiplier-adjusted Robinhood reference quotes, and direct Uniswap
V3/USDG quoter depth where a simple pool exists on Robinhood Chain. PancakeSwap
pool identity, quotes, and depth are verified on-chain; 24-hour pool volume and
TVL use an indexed event snapshot. Robinhood custom Uniswap/Pleiades routes are
labeled unmeasured when the adapter cannot quote them, never zero-liquidity.
Underlying share volume is excluded from direct venue turnover; order-book and
quoted V3 depth use a 2% execution band, while pool TVL remains a separate
metric:

```bash
python3 scripts/refresh_onchain_spot_catalog.py

/home/postfiat/repos/navstrategies/.venv/bin/python \
  scripts/build_market_pages.py
```

`corbanu-market-lens-refresh.timer` runs the complete source refresh, validation,
commit, and GitHub Pages push daily after the 16:00 New York close. It fails
closed when the site worktree is dirty or local `main` differs from
`origin/main`.

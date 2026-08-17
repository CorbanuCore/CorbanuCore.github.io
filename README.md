# Corbanu

Static organization site for [CorbanuCore](https://github.com/CorbanuCore), published with GitHub Pages.

The site is intentionally dependency-free: edit `index.html`, commit, and push to `main`.

The 37 Market Lens pages are generated from the locked local navstrategies
spot/perp index artifacts. Each history is terminal-anchored to its own latest
raw USD close, so the chart remains in recognizable price levels while prior
spot points retain gross dividends and prior perp candles retain realized
funding. Every page contains the cash-reference total-return line, the
funding-inclusive Hyperliquid perp candlesticks, the perp/spot ratio,
1-day and 7-day long-funding forecasts, and discovered on-chain spot wrappers.
The persistent header opens one public browser-to-Hyperliquid WebSocket using
the payload's `rawSymbol` and displays the live perp mid, previous-day change,
and connection state. A public `allMids` REST snapshot is the degraded-mode
fallback; no Corbanu server or credential sits in the live-price path.
Supported US equities also display the next-earnings probability distribution,
an ATM straddle, and the two liquid calls and puts with the highest average
historical payout. Supported index, commodity, BTC, and ETH pages display
selectable ATM straddles for the listed expiries closest to 30 and 90 days.
Every options chart can center the same option-implied percentage distribution
on either the terminal spot price or terminal perp price.
All 35 TradeXYZ pages display a dashed weighted peer line and a plain table of
hedge, peer weights, three-run consensus support, and rationale. The line
uses daily-rebalanced spot total returns back to 2015 where the target and at
least three peers exist. Pre-listing peers are omitted and the remaining Kimi
weights are renormalized. A five-second TradeXYZ `allMids` snapshot extends the
latest peer cash close with current perp returns. Commodities, ETFs, and
indices use cross-asset peers and a primary risk hedge rather than the
single-stock index-hedge restriction. Every selected chart range rebases the
peer basket to the target at its first shared date so split-adjusted long
histories remain visually comparable. SP500 and XYZ100 use SPY and QQQ as
listed total-return proxies, but express those return paths on the matching-date
perp index-point scale. This preserves the proxy returns while avoiding an
ETF-dollar versus index-point axis mismatch; payloads retain both raw proxy
prices and the exact display scale.
The mapping is frozen by `moonshotai/kimi-k3` at temperature zero from three
validated blocks per instrument; every prompt receives the complete 35-contract
TradeXYZ core with names, asset classes, and live 24-hour perp liquidity. The
daily publisher refreshes the spot backfill, cash-close splice inputs, and peer
performance without rerunning the model.
BTC uses IBIT options; ETH selects the live liquidity leader from ETHA, ETHE,
FETH, and ETHW on every refresh. Listed-options coverage spans 34 of 37 pages.
The three explicit exclusions are copper, whose CPER chain currently lacks two
distinct liquid paired ATM expiries, CXMT, and Samsung common. The latter two
have no usable exact listed-options chain through the production broker bridge.
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

## Automated publication protocol

`corbanu-market-lens-refresh.timer` runs the complete source refresh,
validation, commit, and GitHub Pages push daily after the 16:00 New York close.
The publisher uses `/home/postfiat/var/corbanu-market-lens-publisher`, an
isolated automation clone, so development work in this repository cannot block
the daily update.

Each run follows one ordered protocol:

1. Acquire a host lock and require the checked-out navstrategies code to match
   `origin/master`. Untracked research artifacts are outside the publication
   boundary.
2. Fast-forward the isolated publisher clone to `origin/main`. If the preceding
   run committed locally but lost its push connection, retry that exact commit.
   Residual pre-commit output is moved to a timestamped quarantine clone before
   recovery; a true branch divergence stops the run for operator review.
3. Refresh Bloomberg/Tiingo/Bitfinex spot history, Hyperliquid candles and
   realized funding, forward-funding forecasts, direct on-chain venues, and
   listed-options inputs.
4. Rebuild all 37 static Market Lens payloads and pages, then run JavaScript
   syntax, live-price-client, terminal-anchor, options, and venue validation.
5. Stage only generated Market Lens JSON and page HTML. Publish one timestamped
   commit to `main`, then verify the local and remote commit IDs match.

Install or refresh the checked-in user units with:

```bash
install -Dm644 ops/systemd/corbanu-market-lens-refresh.service \
  /home/postfiat/.config/systemd/user/corbanu-market-lens-refresh.service
install -Dm644 ops/systemd/corbanu-market-lens-refresh.timer \
  /home/postfiat/.config/systemd/user/corbanu-market-lens-refresh.timer
systemctl --user daemon-reload
systemctl --user enable --now corbanu-market-lens-refresh.timer
```

A manual production refresh uses the same path:

```bash
systemctl --user start corbanu-market-lens-refresh.service
journalctl --user -u corbanu-market-lens-refresh.service -n 100 --no-pager
```

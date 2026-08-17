#!/usr/bin/env python3
"""Publish static Corbanu market pages from navstrategies index artifacts."""

from __future__ import annotations

import argparse
import hashlib
import html
import json
from pathlib import Path
from typing import Any

import pandas as pd

from navstrategies.coverage_universe.tradexyz_peers import (
    build_live_peer_splice_inputs,
    build_weighted_peer_total_return_history,
)


SITE_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_NAV_ROOT = Path("/home/postfiat/repos/navstrategies")
NAMES = {
    "AAPL": "Apple",
    "AMD": "Advanced Micro Devices",
    "AMZN": "Amazon",
    "BE": "Bloom Energy",
    "BTC": "Bitcoin",
    "BRENTOIL": "Brent crude oil",
    "CBRS": "Cerebras Systems",
    "CL": "WTI crude oil",
    "COIN": "Coinbase",
    "COPPER": "Copper",
    "CRCL": "Circle Internet Group",
    "CXMT": "CXMT Corp. Class A",
    "DRAM": "Roundhill Memory ETF",
    "EWY": "iShares MSCI South Korea ETF",
    "ETH": "Ethereum",
    "GOLD": "Gold",
    "GOOGL": "Alphabet",
    "INTC": "Intel",
    "META": "Meta Platforms",
    "MRVL": "Marvell Technology",
    "MSTR": "Strategy",
    "MSFT": "Microsoft",
    "MU": "Micron Technology",
    "NATGAS": "Natural gas",
    "NBIS": "Nebius Group",
    "NVDA": "NVIDIA",
    "PLTR": "Palantir Technologies",
    "SILVER": "Silver",
    "SKHX": "SK hynix common",
    "SKHY": "SK hynix ADR",
    "SMSN": "Samsung Electronics",
    "SNDK": "Sandisk",
    "SOXL": "Direxion Daily Semiconductor Bull 3X Shares",
    "SP500": "S&P 500",
    "SPCX": "SpaceX",
    "TSLA": "Tesla",
    "XYZ100": "Nasdaq-100",
}


def _atomic_text(path: Path, value: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(value)
    temporary.replace(path)


def _json_value(value: Any, digits: int = 6) -> float | None:
    parsed = pd.to_numeric(value, errors="coerce")
    return round(float(parsed), digits) if pd.notna(parsed) else None


def _date(value: Any) -> str:
    return pd.Timestamp(value).date().isoformat()


def _timestamp(value: Any) -> str | None:
    if value is None or pd.isna(value):
        return None
    return pd.Timestamp(value).isoformat().replace("+00:00", "Z")


def _page_html(
    *,
    slug: str,
    symbol: str,
    spot_symbol: str,
    name: str,
    asset_version: str,
    options_payload: dict[str, Any] | None,
    peer_mapping: dict[str, Any] | None,
) -> str:
    continuous_spot = symbol in {"BTC", "ETH", "GOLD"}
    options_enabled = options_payload is not None
    options_mode = str((options_payload or {}).get("mode") or "")
    options_underlier = str((options_payload or {}).get("underlierSymbol") or symbol)
    options_legend = (
        '\n              <span class="legend-item"><i class="legend-range" aria-hidden="true"></i>listed-options implied probability fan</span>\n              <span class="legend-item"><i class="legend-payoff" aria-hidden="true"></i><span id="selected-structure-label">selected structure payout</span></span>'
        if options_enabled
        else ""
    )
    peer_legend = (
        '\n              <span class="legend-item"><i class="legend-peer" aria-hidden="true"></i>Weighted peers · spot history + live TradeXYZ perps</span>'
        if peer_mapping
        else ""
    )
    if peer_mapping:
        hedge = dict(peer_mapping["primary_index_hedge"])
        peer_rows = "".join(
            "<tr>"
            f"<td><strong>{html.escape(str(peer['ticker']))}</strong><span>{html.escape(str(peer['name']))}</span></td>"
            f"<td>{float(peer['weight']) * 100:.1f}%</td>"
            f"<td>${float(peer['liquidity_24h_usd_millions']):,.3f}M</td>"
            f"<td>{int(peer['replicate_support'])}/3</td>"
            f"<td>{html.escape(str(peer['reason']))}</td>"
            "</tr>"
            for peer in peer_mapping["peers"]
        )
        peer_panel = f'''
        <section class="peer-panel" aria-labelledby="peer-panel-title">
          <header class="peer-panel-head">
            <div>
              <span>Kimi K3 · intra-TradeXYZ</span>
              <h2 id="peer-panel-title">{symbol} Weighted Peer Basket</h2>
            </div>
            <small>Spot-return history · live TradeXYZ perp marks · {html.escape(str(peer_mapping["model"]))}</small>
          </header>
          <div class="peer-hedge-row">
            <span>Primary index hedge</span>
            <strong>{html.escape(str(hedge["ticker"]))} · {html.escape(str(hedge["name"]))} · ${float(hedge["liquidity_24h_usd_millions"]):,.3f}M 24h</strong>
            <p>{html.escape(str(hedge["reason"]))}</p>
          </div>
          <div class="peer-table-scroll" tabindex="0" role="region" aria-label="Weighted single-stock TradeXYZ peers">
            <table class="peer-table">
              <thead><tr><th>Peer</th><th>Weight</th><th>24h liquidity</th><th>Consensus</th><th>Rationale</th></tr></thead>
              <tbody>{peer_rows}</tbody>
            </table>
          </div>
          <p class="peer-justification">{html.escape(str(peer_mapping["justification"]))}</p>
        </section>'''
    else:
        peer_panel = ""
    distribution_center_controls = (
        '''
        <div class="distribution-center-controls" role="group" aria-label="Options distribution center">
          <span>Distribution center</span>
          <button type="button" data-distribution-center="spot" aria-pressed="true">Center distribution for Spot</button>
          <button type="button" data-distribution-center="perp" aria-pressed="false">Center distribution for Perp</button>
        </div>'''
        if options_enabled
        else ""
    )
    if not options_enabled:
        options_panel = ""
    elif options_mode == "term_straddles":
        options_panel = f"""
        <section class="earnings-options-panel" aria-labelledby="earnings-options-title">
          <header class="earnings-options-head">
            <div>
              <span class="earnings-options-kicker">Listed options · term structure</span>
              <h2 id="earnings-options-title">{symbol} 1- and 3-Month ATM Straddle Targets</h2>
              <p>{options_underlier} listed-options proxy · select a term to display its implied distribution and payout.</p>
            </div>
            <span id="earnings-options-asof" class="earnings-options-asof">Loading chain…</span>
          </header>
          <section class="historical-plays" aria-labelledby="historical-plays-title">
            <header>
              <div><span>Liquid ATM structures</span><h3 id="historical-plays-title">Select a term to display its payout on the chart</h3></div>
            </header>
            <div class="historical-table-scroll" tabindex="0" role="region" aria-label="Selectable one-month and three-month ATM option straddles">
              <table class="historical-structure-table">
                <thead><tr><th>Term</th><th>What you buy</th><th>Total ask</th><th>Volume</th><th>Open interest</th><th>Implied move</th><th>Lower BE</th><th>Upper BE</th><th>Listed days</th></tr></thead>
                <tbody id="historical-structure-rows"><tr><td colspan="9">Loading ATM straddles…</td></tr></tbody>
              </table>
            </div>
          </section>
          <div class="earnings-options-summary">
            <div><small>Options underlier</small><strong id="options-underlier">—</strong><span>Listed proxy used for the distribution</span></div>
            <div><small>1-month target</small><strong id="options-term-one">—</strong><span id="options-term-one-days">—</span></div>
            <div><small>3-month target</small><strong id="options-term-three">—</strong><span id="options-term-three-days">—</span></div>
            <div><small>Chain quote</small><strong id="options-chain-quote-date">—</strong><span>Current Schwab listed-options snapshot</span></div>
          </div>
          <p id="options-method-note" class="options-method-note">Term structure loading…</p>
        </section>"""
    else:
        options_panel = f"""
        <section class="earnings-options-panel" aria-labelledby="earnings-options-title">
          <header class="earnings-options-head">
            <div>
              <span class="earnings-options-kicker">Listed options · event distribution</span>
              <h2 id="earnings-options-title">{symbol} Earnings Probability and Historical Payouts</h2>
              <p>Current risk-neutral distribution plus volume-screened structures replayed around prior earnings.</p>
            </div>
            <span id="earnings-options-asof" class="earnings-options-asof">Loading chain…</span>
          </header>
          <section class="historical-plays" aria-labelledby="historical-plays-title">
            <header>
              <div><span>Highest historical payouts</span><h3 id="historical-plays-title">Select a trade to display its payout on the chart</h3></div>
            </header>
            <div class="historical-table-scroll" tabindex="0" role="region" aria-label="Selectable earnings option structures and historical payouts">
              <table class="historical-structure-table">
                <thead><tr><th>Trade</th><th>What you buy</th><th>Total ask</th><th>Volume</th><th>Profitable / recent</th><th>Avg payout</th><th>Avg winner</th><th>Max payout</th><th>Full history</th></tr></thead>
                <tbody id="historical-structure-rows"><tr><td colspan="9">Replaying prior earnings…</td></tr></tbody>
              </table>
            </div>
          </section>
          <div class="earnings-options-summary">
            <div><small>Next earnings</small><strong id="options-earnings-date">—</strong><span id="options-earnings-timing">—</span></div>
            <div><small>Implied 68% move</small><strong id="options-implied-move">—</strong><span id="options-event-range">—</span></div>
            <div><small>Chain used</small><strong id="options-chain-expiry">—</strong><span>First liquid expiry after the event</span></div>
            <div><small>Historical replay</small><strong id="options-history-count">—</strong><span id="options-history-window">—</span></div>
          </div>
          <p id="options-method-note" class="options-method-note">Historical replay loading…</p>
        </section>"""
    ratio_subtitle = (
        f"1.00 = equal return since shared anchor · {spot_symbol} sampled on the same seven-day New York session"
        if continuous_spot
        else "1.00 = equal return since shared anchor · spot held at its last close between cash sessions"
    )
    if symbol == "GOLD":
        chart_disclosure = "Perp candlesticks and XAUT spot run seven days a week. XAUT closes use Bitfinex 30-minute spot candles aligned to 09:30–16:00 New York; the on-chain section reports executable Ethereum Uniswap V3 PAXG and XAUT quotes and depth. Each history is scaled to its own latest raw USD close: prior XAUT levels include spot total return and prior perp levels include realized hourly funding. Solid candles use exact 09:30–16:00 30-minute bars; an outlined final candle is the current live partial session through its displayed cutoff; faded candles use the 09:00 hourly open and exact 16:00 close."
    elif continuous_spot:
        chart_disclosure = f"Perp candlesticks and {spot_symbol} spot run seven days a week. Spot closes use Bitfinex 30-minute candles aligned to 09:30–16:00 New York. Each history is scaled to its own latest raw USD close: prior spot levels include spot total return and prior perp levels include realized hourly funding. Solid candles use exact 09:30–16:00 30-minute bars; an outlined final candle is the current live partial session through its displayed cutoff; faded candles use the 09:00 hourly open and exact 16:00 close."
    else:
        chart_disclosure = "Perp candlesticks run seven days a week. Each history is scaled to its own latest raw USD close: prior spot levels include gross dividends and prior perp levels include realized hourly funding. Solid candles use exact 09:30–16:00 30-minute bars; an outlined final candle is the current live partial session through its displayed cutoff; faded candles use the 09:00 hourly open and exact 16:00 close. Spot remains at its last available cash close between sessions."
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="Compare {symbol} spot total return with Hyperliquid perpetual-swap total return, including realized funding.">
  <meta name="theme-color" content="#030403">
  <meta property="og:title" content="{symbol} Spot and Swap Total Return — Corbanu">
  <meta property="og:description" content="{name} terminal-anchored spot and funding-inclusive perpetual-swap price history.">
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://corbanu.com/{slug}/">
  <link rel="canonical" href="https://corbanu.com/{slug}/">
  <link rel="icon" href="/assets/favicon.png" type="image/png">
  <link rel="stylesheet" href="/assets/css/market-lens.css?v={asset_version}">
  <title>{symbol} Spot and Swap Total Return — Corbanu</title>
</head>
<body data-market-slug="{slug}" data-market-version="{asset_version}">
  <a class="skip" href="#main">Skip to chart</a>
  <header class="site-header">
    <a class="brand" href="/" aria-label="Corbanu home"><img src="/assets/corbanu-logo.webp" width="45" height="45" alt="">Corbanu</a>
    <nav class="site-nav" aria-label="Primary navigation">
      <a href="/">Home</a><a href="/terminal/">Terminal</a><a href="/#newsletter">Weekly research</a>
    </nav>
    <div class="header-market-tools">
      <div id="live-perp-module" class="live-perp is-connecting" role="group" aria-label="{symbol} Hyperliquid perpetual mid price">
        <div class="live-perp-status">
          <span class="live-perp-dot" aria-hidden="true"></span>
          <span class="live-perp-feed">
            <span class="live-perp-label">Perp mid</span>
            <span id="live-perp-state" class="live-perp-state">Connecting</span>
          </span>
        </div>
        <data id="live-perp-price" class="live-perp-price" value="">—</data>
        <span id="live-perp-change" class="live-perp-change">—</span>
        <time id="live-perp-time" class="live-perp-time">—</time>
      </div>
      <div class="instrument-picker">
        <label for="instrument-select">Instrument</label>
        <select id="instrument-select" aria-label="Choose a perpetual market"></select>
      </div>
    </div>
    <p id="live-perp-announcer" class="sr-only" aria-live="polite" aria-atomic="true"></p>
  </header>

  <main id="main">
    <section class="chart-section" aria-labelledby="chart-title">
      <div class="chart-frame">
        <header class="chart-head">
          <div>
            <div class="chart-title-row"><h1 id="chart-title">{symbol} Spot and Perp Total Returns</h1></div>
            <div class="legend" aria-label="Chart legend">
              <span class="legend-item"><i class="legend-candle" aria-hidden="true"></i>{symbol} perp total return · long · seven-day</span>
              <span class="legend-item"><i class="legend-line" aria-hidden="true"></i>{spot_symbol} spot total return</span>{peer_legend}{options_legend}
            </div>
          </div>
          <div class="range-controls" role="group" aria-label="Chart window">
            <button type="button" data-range="3M" aria-pressed="false">3M</button>
            <button type="button" data-range="6M" aria-pressed="true">6M</button>
            <button type="button" data-range="YTD" aria-pressed="false">YTD</button>
            <button type="button" data-range="MAX" aria-pressed="false">MAX</button>
          </div>
        </header>
        <p class="mobile-scroll-note">Swipe chart horizontally · use arrow keys to inspect dates</p>
        <div class="chart-scroll">
          <div id="market-chart-stage" class="chart-stage" tabindex="0" role="region" aria-label="Interactive total-return price chart" aria-describedby="chart-disclosure">
            <div class="chart-loading">Loading spot and swap history…</div>
          </div>
        </div>{distribution_center_controls}
        <p id="chart-live" class="sr-only" aria-live="polite"></p>{peer_panel}{options_panel}
        <section class="funding-forecast" aria-labelledby="funding-forecast-title">
          <header class="funding-forecast-head">
            <div>
              <h2 id="funding-forecast-title">Predicted Perp Long Funding APY</h2>
              <span>Forward mean hourly funding · positive means the long earns</span>
            </div>
            <span id="funding-forecast-asof" class="funding-forecast-asof">—</span>
          </header>
          <div class="funding-forecast-grid">
            <div class="funding-horizon">
              <small>Next 1 day</small>
              <strong id="funding-forecast-1d">—</strong>
              <span id="funding-forecast-1d-direction">—</span>
            </div>
            <div class="funding-horizon">
              <small>Next 7 days</small>
              <strong id="funding-forecast-7d">—</strong>
              <span id="funding-forecast-7d-direction">—</span>
            </div>
            <p>Existing walk-forward funding model · simple annualized cash yield before fees and slippage</p>
          </div>
        </section>
        <section class="ratio-panel" aria-labelledby="ratio-title">
          <header class="ratio-head">
            <div>
              <h2 id="ratio-title">{symbol} Perp Long / {spot_symbol} Spot Long Total Return Ratio</h2>
              <span>{ratio_subtitle}</span>
            </div>
            <strong id="ratio-latest">—</strong>
          </header>
          <div class="chart-scroll">
            <div id="ratio-chart-stage" class="ratio-stage" tabindex="0" role="region" aria-label="Interactive perp long divided by spot long total-return ratio chart" aria-describedby="chart-disclosure">
              <div class="chart-loading">Loading return ratio…</div>
            </div>
          </div>
          <p id="ratio-live" class="sr-only" aria-live="polite"></p>
        </section>
        <section class="onchain-panel" aria-labelledby="onchain-title">
          <header class="onchain-head">
            <div>
              <h2 id="onchain-title">On-chain Spot Markets</h2>
              <span id="onchain-subtitle">Issuer wrappers ranked by measured venue and verified-pool turnover</span>
            </div>
            <div class="onchain-status">
              <strong id="onchain-preferred">Determining preferred wrapper…</strong>
              <span id="onchain-live-stamp" class="onchain-live-stamp">Loading direct venue books…</span>
            </div>
          </header>
          <div id="onchain-table" class="onchain-table" role="table" aria-label="On-chain spot wrappers, contracts, and direct venue market data">
            <div class="onchain-table-head" role="row">
              <span role="columnheader">Token and structure</span><span role="columnheader">Networks</span><span role="columnheader">Primary contract</span><span role="columnheader">Direct 24h</span><span role="columnheader">Venue coverage</span>
            </div>
            <div id="onchain-market-rows" class="onchain-market-rows" role="rowgroup">
              <div class="onchain-loading">Loading verified contracts…</div>
            </div>
          </div>
          <p id="onchain-note" class="onchain-note"><strong>Preferred</strong> marks the wrapper with the highest summed measured 24-hour turnover. Order-book depth is resting dollar notional within 2% of mid; ≥ means the returned book ended before the full band. Ethereum Uniswap V3 and PancakeSwap V3 price and depth come directly from factory-verified pools and quoter calls; PancakeSwap 24-hour volume and TVL are indexed pool-event statistics. Robinhood bid and ask are official multiplier-adjusted reference prices. A Robinhood route marked unmeasured means the custom Uniswap/Pleiades route exists but its executable depth and turnover are unavailable to this adapter; it does not mean zero liquidity. Underlying share volume is excluded. AMM TVL is shown separately from executable depth. Issuer, custody, redemption, eligibility, fees, slippage, and venue risk differ.</p>
        </section>
      </div>
      <p class="chart-disclosure" id="chart-disclosure">{chart_disclosure}</p>
    </section>
  </main>

  <footer>
    <div class="foot-links"><a href="/">Corbanu</a><a href="/terminal/">Terminal</a><a href="https://x.com/corbanuAI">X</a><a href="https://github.com/CorbanuCore">GitHub</a></div>
    <div>Corbanu · 2026</div>
    <div class="footnote">Research visualization. No offer to buy or sell any security or digital asset. Derived spot and perpetual-swap indices can differ from executable prices. Funding, liquidity, fees, slippage, and venue risk remain material.</div>
  </footer>
  <script src="/assets/js/market-lens.js?v={asset_version}"></script>
</body>
</html>
"""


def build(nav_root: Path) -> None:
    source = nav_root / "var/production/coverage_total_return_indices/latest"
    spot = pd.read_parquet(source / "spot_ohlc.parquet")
    perp = pd.read_parquet(source / "perp_ohlc.parquet")
    funding_forecasts = pd.read_parquet(source / "funding_forecasts.parquet")
    metadata_path = source / "metadata.json"
    metadata = json.loads(metadata_path.read_text())
    peer_manifest_path = (
        nav_root
        / "navstrategies/strategy_definitions/tradexyz_kimi_k3_peers_v1.json"
    )
    peer_manifest = (
        json.loads(peer_manifest_path.read_text())
        if peer_manifest_path.exists()
        else {"targets": {}}
    )
    peer_targets = dict(peer_manifest.get("targets") or {})
    catalog_path = SITE_ROOT / "assets" / "market-data" / "onchain-spot-catalog.json"
    onchain_catalog = json.loads(catalog_path.read_text()) if catalog_path.exists() else {"generatedAt": None, "instruments": {}}
    options_paths = sorted((SITE_ROOT / "assets" / "market-data").glob("*-options.json"))
    earnings_options = {
        str(payload["symbol"]).upper(): payload
        for payload in (json.loads(path.read_text()) for path in options_paths)
    }
    asset_fingerprint = hashlib.sha256()
    for path in (
        metadata_path,
        peer_manifest_path,
        catalog_path,
        *options_paths,
        SITE_ROOT / "assets" / "js" / "market-lens.js",
        SITE_ROOT / "assets" / "css" / "market-lens.css",
    ):
        if path.exists():
            asset_fingerprint.update(path.read_bytes())
    asset_version = asset_fingerprint.hexdigest()[:12]
    instruments: list[dict[str, Any]] = []

    for raw_symbol in sorted(set(spot["raw_symbol"]) & set(perp["raw_symbol"])):
        symbol = str(raw_symbol).split(":")[-1]
        slug = symbol.lower()
        name = NAMES.get(symbol, symbol)
        spot_group = spot.loc[spot["raw_symbol"].eq(raw_symbol)].sort_values("date").copy()
        spot_symbol = str(spot_group.iloc[0].get("spot_reference_symbol") or symbol)
        spot_source = str(spot_group.iloc[-1].get("return_source") or "unknown")
        perp_group = perp.loc[perp["raw_symbol"].eq(raw_symbol)].sort_values("date").copy()
        shared_dates = sorted(set(spot_group["date"]) & set(perp_group["date"]))
        if not shared_dates:
            raise RuntimeError(f"missing shared spot/perp anchor for {raw_symbol}")
        anchor_date = shared_dates[0]
        spot_anchor = float(
            spot_group.loc[spot_group["date"].eq(anchor_date), "close_index"].iloc[0]
        )
        perp_anchor = float(
            perp_group.loc[perp_group["date"].eq(anchor_date), "long_close_index"].iloc[0]
        )
        spot_terminal_index = float(spot_group.iloc[-1]["close_index"])
        perp_terminal_index = float(perp_group.iloc[-1]["long_close_index"])
        spot_terminal_price = float(spot_group.iloc[-1]["price_close_usd"])
        perp_terminal_price = float(perp_group.iloc[-1]["price_close"])
        if min(
            spot_anchor,
            perp_anchor,
            spot_terminal_index,
            perp_terminal_index,
            spot_terminal_price,
            perp_terminal_price,
        ) <= 0:
            raise RuntimeError(f"invalid terminal total-return anchor for {raw_symbol}")
        spot_scale = spot_terminal_price / spot_terminal_index
        perp_scale = perp_terminal_price / perp_terminal_index
        peer_block = peer_targets.get(symbol)
        peer_rows: list[dict[str, Any]] = []
        peer_mapping: dict[str, Any] | None = None
        if peer_block:
            peer_history = build_weighted_peer_total_return_history(spot, peer_block)
            peer_start = pd.Timestamp(peer_history.iloc[0]["date"])
            target_start_rows = spot_group.loc[spot_group["date"].eq(peer_start)]
            if target_start_rows.empty:
                raise RuntimeError(f"peer-history start is absent from target spot history for {raw_symbol}")
            target_start_level = float(target_start_rows.iloc[0]["close_index"]) * spot_scale
            peer_rows = [
                {
                    "d": _date(row.date),
                    "c": _json_value(target_start_level * row.basket_factor),
                    "n": int(row.peer_count),
                }
                for row in peer_history.itertuples(index=False)
            ]
            live_splice_inputs = build_live_peer_splice_inputs(spot, peer_block)
            peer_mapping = {
                **peer_block,
                "model": peer_manifest["model"],
                "temperature": peer_manifest["temperature"],
                "promptVersion": peer_manifest["prompt_version"],
                "replicatesPerTarget": peer_manifest["replicates_per_target"],
                "historyStart": peer_rows[0]["d"],
                "historyEnd": peer_rows[-1]["d"],
                "historyMethod": "daily-rebalanced peer spot total returns using the fixed Kimi weights; unavailable pre-listing peers are omitted and remaining weights renormalized once at least three peers exist; basket rebased to the target spot level at the first overlapping date",
                "liveSplice": {
                    "dex": "xyz",
                    "baseDate": peer_rows[-1]["d"],
                    "baseLevel": peer_rows[-1]["c"],
                    "inputs": live_splice_inputs,
                    "method": "current TradeXYZ perp mid divided by each peer's latest USD cash close; available Kimi weights renormalized and applied as a one-period return from the published peer spot close",
                },
            }

        spot_rows = [
            {
                "d": _date(row.date),
                "c": _json_value(row.close_index * spot_scale),
                "r": _json_value(row.close_index / spot_anchor, 9),
            }
            for row in spot_group.itertuples(index=False)
        ]
        perp_rows = [
            {
                "d": _date(row.date),
                "o": _json_value(row.long_open_index * perp_scale),
                "h": _json_value(row.long_high_index * perp_scale),
                "l": _json_value(row.long_low_index * perp_scale),
                "c": _json_value(row.long_close_index * perp_scale),
                "r": _json_value(row.long_close_index / perp_anchor, 9),
                "f": _json_value(row.funding_rate_paid_by_long_to_close, 9),
                "p": (
                    "partial"
                    if str(getattr(row, "session_status", "complete")) == "live_partial"
                    else "exact"
                    if str(row.price_boundary_precision).startswith("exact_30m")
                    else "hourly"
                ),
                "s": str(getattr(row, "session_status", "complete")),
                "t": _timestamp(getattr(row, "observed_through_utc", None)),
            }
            for row in perp_group.itertuples(index=False)
        ]
        exact = perp_group.loc[
            perp_group["price_boundary_precision"].eq("exact_30m_0930_open_and_1600_close")
        ]
        latest_spot = float(spot_rows[-1]["c"])
        latest_perp = float(perp_rows[-1]["c"])
        spot_return_since_anchor = spot_terminal_index / spot_anchor - 1.0
        perp_return_since_anchor = perp_terminal_index / perp_anchor - 1.0
        symbol_forecasts = funding_forecasts.loc[
            funding_forecasts["raw_symbol"].eq(raw_symbol)
        ].set_index("horizon_hours")
        missing_horizons = {24, 168} - set(symbol_forecasts.index)
        if missing_horizons:
            raise RuntimeError(
                f"missing funding forecast horizons for {raw_symbol}: {sorted(missing_horizons)}"
            )
        one_day_forecast = symbol_forecasts.loc[24]
        seven_day_forecast = symbol_forecasts.loc[168]
        payload = {
            "version": 2,
            "generatedAt": metadata["finished_at_utc"],
            "symbol": symbol,
            "rawSymbol": raw_symbol,
            "name": name,
            "spotReferenceSymbol": spot_symbol,
            "spotReturnSource": spot_source,
            "spotStart": spot_rows[0]["d"],
            "perpStart": perp_rows[0]["d"],
            "anchorDate": _date(anchor_date),
            "exactStart": _date(exact["date"].min()) if not exact.empty else None,
            "endDate": max(spot_rows[-1]["d"], perp_rows[-1]["d"]),
            "basis": "each funding- or dividend-inclusive history is scaled to its own latest raw USD close",
            "terminalAnchors": {
                "spot": {
                    "price": _json_value(spot_terminal_price),
                    "date": spot_rows[-1]["d"],
                    "symbol": spot_symbol,
                },
                "perp": {
                    "price": _json_value(perp_terminal_price),
                    "date": perp_rows[-1]["d"],
                    "observedThrough": perp_rows[-1]["t"],
                    "symbol": raw_symbol,
                },
            },
            "spot": spot_rows,
            "perp": perp_rows,
            "summary": {
                "spotReturnSinceAnchorPct": _json_value(spot_return_since_anchor * 100.0),
                "perpReturnSinceAnchorPct": _json_value(perp_return_since_anchor * 100.0),
                "totalReturnSpreadPct": _json_value(
                    ((1.0 + perp_return_since_anchor) / (1.0 + spot_return_since_anchor) - 1.0)
                    * 100.0
                ),
                "latestFundingPct": _json_value(float(perp_rows[-1]["f"]) * 100.0, 6),
            },
            "fundingForecast": {
                "asOf": _timestamp(one_day_forecast["as_of_funding_timestamp"]),
                "model": str(one_day_forecast["model"]),
                "sevenDayModel": str(seven_day_forecast["model"]),
                "displaySign": "positive is earned by a perp long; negative is paid by a perp long",
                "oneDayLongApyPct": _json_value(
                    one_day_forecast["predicted_long_funding_apy"] * 100.0, 4
                ),
                "sevenDayLongApyPct": _json_value(
                    seven_day_forecast["predicted_long_funding_apy"] * 100.0, 4
                ),
                "oneDayTrainingDays": int(one_day_forecast["training_observations"]),
                "sevenDayTrainingDays": int(seven_day_forecast["training_observations"]),
            },
            "onchainSpot": {
                "generatedAt": onchain_catalog.get("generatedAt"),
                "preferenceBasis": onchain_catalog.get("preferenceBasis"),
                "volumeSource": onchain_catalog.get("volumeSource"),
                "liquiditySource": onchain_catalog.get("liquiditySource"),
                "cexMarkets": onchain_catalog.get("cexMarkets", {}).get(slug, []),
                "markets": onchain_catalog.get("instruments", {}).get(slug, []),
                "venueSplit": True,
            },
        }
        if peer_mapping:
            payload["peerMapping"] = peer_mapping
            payload["peer"] = peer_rows
        if symbol in earnings_options:
            payload["earningsOptions"] = earnings_options[symbol]
        _atomic_text(
            SITE_ROOT / "assets/market-data" / f"{slug}.json",
            json.dumps(payload, separators=(",", ":"), allow_nan=False) + "\n",
        )
        _atomic_text(
            SITE_ROOT / slug / "index.html",
            _page_html(
                slug=slug,
                symbol=symbol,
                spot_symbol=spot_symbol,
                name=name,
                asset_version=asset_version,
                options_payload=earnings_options.get(symbol),
                peer_mapping=peer_mapping,
            ),
        )
        instruments.append(
            {
                "slug": slug,
                "symbol": symbol,
                "name": name,
                "spotReferenceSymbol": spot_symbol,
                "spotStart": spot_rows[0]["d"],
                "perpStart": perp_rows[0]["d"],
                "endDate": max(spot_rows[-1]["d"], perp_rows[-1]["d"]),
                "peerMapped": bool(peer_mapping),
            }
        )

    universe = {
        "generatedAt": metadata["finished_at_utc"],
        "peerModel": peer_manifest.get("model"),
        "peerTargetCount": int(peer_manifest.get("stock_target_count") or 0),
        "instruments": instruments,
    }
    _atomic_text(
        SITE_ROOT / "assets/market-data/universe.json",
        json.dumps(universe, separators=(",", ":"), allow_nan=False) + "\n",
    )
    print(f"published {len(instruments)} market pages from {source}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--navstrategies-root", type=Path, default=DEFAULT_NAV_ROOT)
    args = parser.parse_args()
    build(args.navstrategies_root.resolve())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

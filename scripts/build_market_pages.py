#!/usr/bin/env python3
"""Publish static Corbanu market pages from navstrategies index artifacts."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

import pandas as pd


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
        chart_disclosure = "Perp candlesticks and XAUT spot run seven days a week. XAUT closes use Bitfinex 30-minute spot candles aligned to 09:30–16:00 New York; the on-chain section reports executable Ethereum Uniswap V3 PAXG and XAUT quotes and depth. The perp includes realized hourly funding. Both series close at 100 on their first shared session. Solid candles use exact 09:30–16:00 30-minute bars; an outlined final candle is the current live partial session through its displayed cutoff; faded candles use the 09:00 hourly open and exact 16:00 close."
    elif continuous_spot:
        chart_disclosure = f"Perp candlesticks and {spot_symbol} spot run seven days a week. Spot closes use Bitfinex 30-minute candles aligned to 09:30–16:00 New York. The perp includes realized hourly funding. Both series close at 100 on their first shared session. Solid candles use exact 09:30–16:00 30-minute bars; an outlined final candle is the current live partial session through its displayed cutoff; faded candles use the 09:00 hourly open and exact 16:00 close."
    else:
        chart_disclosure = "Perp candlesticks run seven days a week and include realized hourly funding. Both series close at 100 on their first shared session. Solid candles use exact 09:30–16:00 30-minute bars; an outlined final candle is the current live partial session through its displayed cutoff; faded candles use the 09:00 hourly open and exact 16:00 close. Spot remains at its last available cash close between sessions."
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="Compare {symbol} spot total return with Hyperliquid perpetual-swap total return, including realized funding.">
  <meta name="theme-color" content="#030403">
  <meta property="og:title" content="{symbol} Spot and Swap Total Return — Corbanu">
  <meta property="og:description" content="{name} spot and funding-inclusive perpetual-swap return history on one anchored scale.">
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
              <span class="legend-item"><i class="legend-line" aria-hidden="true"></i>{spot_symbol} spot total return</span>{options_legend}
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
          <div id="market-chart-stage" class="chart-stage" tabindex="0" role="region" aria-label="Interactive total-return chart" aria-describedby="chart-disclosure">
            <div class="chart-loading">Loading spot and swap history…</div>
          </div>
        </div>
        <p id="chart-live" class="sr-only" aria-live="polite"></p>{options_panel}
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
        spot_anchor = spot_group.loc[spot_group["date"].eq(anchor_date), "close_index"]
        perp_anchor = perp_group.loc[perp_group["date"].eq(anchor_date), "long_close_index"]
        spot_scale = 100.0 / float(spot_anchor.iloc[0])
        perp_scale = 100.0 / float(perp_anchor.iloc[0])

        spot_rows = [
            {"d": _date(row.date), "c": _json_value(row.close_index * spot_scale)}
            for row in spot_group.itertuples(index=False)
        ]
        perp_rows = [
            {
                "d": _date(row.date),
                "o": _json_value(row.long_open_index * perp_scale),
                "h": _json_value(row.long_high_index * perp_scale),
                "l": _json_value(row.long_low_index * perp_scale),
                "c": _json_value(row.long_close_index * perp_scale),
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
            "version": 1,
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
            "basis": "both series close at 100 on the first shared session",
            "spot": spot_rows,
            "perp": perp_rows,
            "summary": {
                "spotReturnSinceAnchorPct": _json_value(latest_spot - 100.0),
                "perpReturnSinceAnchorPct": _json_value(latest_perp - 100.0),
                "totalReturnSpreadPct": _json_value((latest_perp / latest_spot - 1.0) * 100.0),
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
            }
        )

    universe = {"generatedAt": metadata["finished_at_utc"], "instruments": instruments}
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

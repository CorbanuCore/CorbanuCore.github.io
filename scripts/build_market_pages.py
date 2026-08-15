#!/usr/bin/env python3
"""Publish static Corbanu market pages from navstrategies index artifacts."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import pandas as pd


SITE_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_NAV_ROOT = Path("/home/postfiat/repos/navstrategies")
NAMES = {
    "AAPL": "Apple",
    "AMD": "Advanced Micro Devices",
    "CRCL": "Circle Internet Group",
    "CXMT": "CXMT Corp. Class A",
    "GOOGL": "Alphabet",
    "INTC": "Intel",
    "META": "Meta Platforms",
    "MRVL": "Marvell Technology",
    "MSFT": "Microsoft",
    "MU": "Micron Technology",
    "NVDA": "NVIDIA",
    "SKHX": "SK hynix",
    "SMSN": "Samsung Electronics",
    "SNDK": "Sandisk",
    "SPCX": "SpaceX",
    "TSLA": "Tesla",
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


def _page_html(*, slug: str, symbol: str, name: str) -> str:
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
  <link rel="stylesheet" href="/assets/css/market-lens.css">
  <title>{symbol} Spot and Swap Total Return — Corbanu</title>
</head>
<body data-market-slug="{slug}">
  <a class="skip" href="#main">Skip to chart</a>
  <header class="site-header">
    <a class="brand" href="/" aria-label="Corbanu home"><img src="/assets/corbanu-logo.webp" width="45" height="45" alt="">Corbanu</a>
    <nav class="site-nav" aria-label="Primary navigation">
      <a href="/">Home</a><a href="/terminal/">Terminal</a><a href="/#newsletter">Weekly research</a>
    </nav>
    <div class="instrument-picker">
      <label for="instrument-select">Instrument</label>
      <select id="instrument-select" aria-label="Choose an equity perpetual"></select>
    </div>
  </header>

  <main id="main">
    <section class="chart-section" aria-labelledby="chart-title">
      <div class="chart-frame">
        <header class="chart-head">
          <div>
            <div class="chart-title-row"><h1 id="chart-title">{symbol} Spot and Perp Total Returns</h1></div>
            <div class="legend" aria-label="Chart legend">
              <span class="legend-item"><i class="legend-candle" aria-hidden="true"></i>Perp total return · long</span>
              <span class="legend-item"><i class="legend-line" aria-hidden="true"></i>Spot total return</span>
            </div>
          </div>
          <div class="range-controls" role="group" aria-label="Chart window">
            <button type="button" data-range="3M" aria-pressed="false">3M</button>
            <button type="button" data-range="6M" aria-pressed="false">6M</button>
            <button type="button" data-range="YTD" aria-pressed="false">YTD</button>
            <button type="button" data-range="MAX" aria-pressed="true">MAX</button>
          </div>
        </header>
        <p class="mobile-scroll-note">Swipe chart horizontally · use arrow keys to inspect dates</p>
        <div class="chart-scroll">
          <div id="market-chart-stage" class="chart-stage" tabindex="0" role="region" aria-label="Interactive total-return chart" aria-describedby="chart-disclosure">
            <div class="chart-loading">Loading spot and swap history…</div>
          </div>
        </div>
        <p id="chart-live" class="sr-only" aria-live="polite"></p>
        <div class="chart-foot" aria-label="Data availability">
          <div><small>Spot begins</small><strong id="spot-start">—</strong></div>
          <div><small>Swap begins</small><strong id="perp-start">—</strong></div>
          <div><small>Shared 100 anchor</small><strong id="anchor-date">—</strong></div>
          <div><small>Exact 30-minute sessions</small><strong id="exact-start">—</strong></div>
        </div>
        <section class="ratio-panel" aria-labelledby="ratio-title">
          <header class="ratio-head">
            <div>
              <h2 id="ratio-title">Perp Long / Spot Long Total Return Ratio</h2>
              <span>1.00 = equal return since shared anchor</span>
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
              <span>Contracts and major-quote DEX pools</span>
            </div>
            <span id="onchain-live-stamp" class="onchain-live-stamp">Loading live liquidity…</span>
          </header>
          <div class="onchain-table" role="table" aria-label="On-chain spot token contracts and liquidity">
            <div class="onchain-table-head" role="row">
              <span role="columnheader">Token</span><span role="columnheader">Networks</span><span role="columnheader">Primary contract</span><span role="columnheader">DEX liquidity</span><span role="columnheader">24h volume</span>
            </div>
            <div id="onchain-market-rows" class="onchain-market-rows" role="rowgroup">
              <div class="onchain-loading">Loading verified contracts…</div>
            </div>
          </div>
          <p class="onchain-note">Liquidity is reported pool TVL, not executable depth. Major-quote pools only.</p>
        </section>
      </div>
      <p class="chart-disclosure" id="chart-disclosure">Perp candlesticks include realized hourly funding. Both series close at 100 on their first shared session. Solid candles use exact 09:30–16:00 30-minute bars; faded candles use the 09:00 hourly open and exact 16:00 close.</p>
    </section>
  </main>

  <footer>
    <div class="foot-links"><a href="/">Corbanu</a><a href="/terminal/">Terminal</a><a href="https://x.com/corbanuAI">X</a><a href="https://github.com/CorbanuCore">GitHub</a></div>
    <div>Corbanu · 2026</div>
    <div class="footnote">Research visualization. No offer to buy or sell any security or digital asset. Derived spot and perpetual-swap indices can differ from executable prices. Funding, liquidity, fees, slippage, and venue risk remain material.</div>
  </footer>
  <script src="/assets/js/market-lens.js"></script>
</body>
</html>
"""


def build(nav_root: Path) -> None:
    source = nav_root / "var/production/coverage_total_return_indices/latest"
    spot = pd.read_parquet(source / "spot_ohlc.parquet")
    perp = pd.read_parquet(source / "perp_ohlc.parquet")
    metadata = json.loads((source / "metadata.json").read_text())
    catalog_path = SITE_ROOT / "assets" / "market-data" / "onchain-spot-catalog.json"
    onchain_catalog = json.loads(catalog_path.read_text()) if catalog_path.exists() else {"generatedAt": None, "instruments": {}}
    instruments: list[dict[str, Any]] = []

    for raw_symbol in sorted(set(spot["raw_symbol"]) & set(perp["raw_symbol"])):
        symbol = str(raw_symbol).split(":")[-1]
        slug = symbol.lower()
        name = NAMES.get(symbol, symbol)
        spot_group = spot.loc[spot["raw_symbol"].eq(raw_symbol)].sort_values("date").copy()
        perp_group = perp.loc[perp["raw_symbol"].eq(raw_symbol)].sort_values("date").copy()
        anchor_date = perp_group["date"].min()
        spot_anchor = spot_group.loc[spot_group["date"].eq(anchor_date), "close_index"]
        if spot_anchor.empty:
            raise RuntimeError(f"missing shared spot anchor for {raw_symbol} {anchor_date}")
        spot_scale = 100.0 / float(spot_anchor.iloc[0])
        perp_scale = 100.0 / float(perp_group.iloc[0]["long_close_index"])

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
                "p": "exact" if str(row.price_boundary_precision).startswith("exact_30m") else "hourly",
            }
            for row in perp_group.itertuples(index=False)
        ]
        exact = perp_group.loc[
            perp_group["price_boundary_precision"].eq("exact_30m_0930_open_and_1600_close")
        ]
        latest_spot = float(spot_rows[-1]["c"])
        latest_perp = float(perp_rows[-1]["c"])
        payload = {
            "version": 1,
            "generatedAt": metadata["finished_at_utc"],
            "symbol": symbol,
            "rawSymbol": raw_symbol,
            "name": name,
            "spotStart": spot_rows[0]["d"],
            "perpStart": perp_rows[0]["d"],
            "anchorDate": _date(anchor_date),
            "exactStart": _date(exact["date"].min()) if not exact.empty else None,
            "endDate": spot_rows[-1]["d"],
            "basis": "both series close at 100 on the first shared session",
            "spot": spot_rows,
            "perp": perp_rows,
            "summary": {
                "spotReturnSinceAnchorPct": _json_value(latest_spot - 100.0),
                "perpReturnSinceAnchorPct": _json_value(latest_perp - 100.0),
                "totalReturnSpreadPct": _json_value((latest_perp / latest_spot - 1.0) * 100.0),
                "latestFundingPct": _json_value(float(perp_rows[-1]["f"]) * 100.0, 6),
            },
            "onchainSpot": {
                "generatedAt": onchain_catalog.get("generatedAt"),
                "markets": onchain_catalog.get("instruments", {}).get(slug, []),
            },
        }
        _atomic_text(
            SITE_ROOT / "assets/market-data" / f"{slug}.json",
            json.dumps(payload, separators=(",", ":"), allow_nan=False) + "\n",
        )
        _atomic_text(SITE_ROOT / slug / "index.html", _page_html(slug=slug, symbol=symbol, name=name))
        instruments.append(
            {
                "slug": slug,
                "symbol": symbol,
                "name": name,
                "spotStart": spot_rows[0]["d"],
                "perpStart": perp_rows[0]["d"],
                "endDate": spot_rows[-1]["d"],
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

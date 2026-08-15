#!/usr/bin/env python3
"""Validate generated Market Lens payloads before publication."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


SITE_ROOT = Path(__file__).resolve().parents[1]
DATA_ROOT = SITE_ROOT / "assets" / "market-data"
EXPECTED_CEX_VENUES = {"Binance", "Bitget", "Bybit", "OKX"}
DEX_KINDS = {"ammPool", "ammQuoteDepth", "aggregatorQuote"}


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


def main() -> int:
    universe = load_json(DATA_ROOT / "universe.json")
    instruments = universe.get("instruments", [])
    if len(instruments) != 35:
        raise AssertionError(f"expected 35 instruments, found {len(instruments)}")

    listed_cex_markets = 0
    contract_backed_dex_routes = 0
    for instrument in instruments:
        slug = str(instrument["slug"])
        payload = load_json(DATA_ROOT / f"{slug}.json")
        onchain = payload["onchainSpot"]
        if onchain.get("venueSplit") is not True:
            raise AssertionError(f"{slug}: CEX/DEX split is disabled")

        cex_rows = onchain.get("cexMarkets", [])
        venues = {str(row.get("venue")) for row in cex_rows}
        if venues != EXPECTED_CEX_VENUES:
            raise AssertionError(
                f"{slug}: expected {sorted(EXPECTED_CEX_VENUES)}, found {sorted(venues)}"
            )
        listed = [
            row
            for row in cex_rows
            if row.get("listed") and row.get("kind") == "orderBook"
        ]
        leaders = [row for row in listed if row.get("marketLeader")]
        if len(leaders) != (1 if listed else 0):
            raise AssertionError(f"{slug}: invalid CEX market-leader assignment")
        listed_cex_markets += len(listed)

        for market in onchain.get("markets", []):
            for venue in market.get("directVenues", []):
                if venue.get("kind") == "orderBook":
                    raise AssertionError(
                        f"{slug}: CEX order book leaked into DEX wrapper data"
                    )
                if venue.get("kind") not in DEX_KINDS:
                    continue
                token_contract = venue.get("assetContract") or market.get(
                    "primaryDeployment", {}
                ).get("address")
                route_contract = venue.get("poolAddress") or venue.get(
                    "routeContracts"
                )
                if not token_contract or not route_contract:
                    raise AssertionError(
                        f"{slug}: {venue.get('venue')} lacks token or route contract"
                    )
                contract_backed_dex_routes += 1

        if not (SITE_ROOT / slug / "index.html").exists():
            raise AssertionError(f"{slug}: generated page is missing")

    print(
        f"validated {len(instruments)} Market Lens pages: "
        f"{listed_cex_markets} listed CEX markets, "
        f"{contract_backed_dex_routes} contract-backed DEX routes"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

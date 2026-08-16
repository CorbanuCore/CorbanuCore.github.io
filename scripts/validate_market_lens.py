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
    validated_option_contracts = 0
    validated_historical_structures = 0
    for instrument in instruments:
        slug = str(instrument["slug"])
        payload = load_json(DATA_ROOT / f"{slug}.json")
        page_path = SITE_ROOT / slug / "index.html"
        if not page_path.exists():
            raise AssertionError(f"{slug}: generated page is missing")
        page_markup = page_path.read_text()
        if 'class="chart-foot"' in page_markup:
            raise AssertionError(f"{slug}: obsolete data-availability box remains")
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

        if slug == "aapl":
            options = payload.get("earningsOptions")
            if not options:
                raise AssertionError("aapl: earnings options payload is missing")
            earnings_date = str(options["earnings"]["date"])
            expiration = str(options["chain"]["expiration"])
            if expiration < earnings_date:
                raise AssertionError("aapl: selected option expiry precedes earnings")
            probabilities = [float(row["probability"]) for row in options.get("fan", [])]
            if probabilities != [0.10, 0.16, 0.25, 0.50, 0.75, 0.84, 0.90]:
                raise AssertionError(f"aapl: invalid probability fan {probabilities}")
            contracts = options.get("contracts", [])
            if len(contracts) != int(options["chain"]["liquidContractsUsed"]):
                raise AssertionError("aapl: liquid contract count does not match table")
            maximum_spread = float(options["liquidityFilter"]["maxBidAskSpreadPct"])
            for contract in contracts:
                if not (float(contract["bid"]) > 0 and float(contract["ask"]) > float(contract["bid"])):
                    raise AssertionError("aapl: option row lacks a two-sided executable quote")
                if float(contract["spreadPct"]) > maximum_spread:
                    raise AssertionError("aapl: option row violates the published spread gate")
            historical = options.get("historicalAnalysis") or {}
            if int(historical.get("availableEvents") or 0) < 12:
                raise AssertionError("aapl: fewer than 12 comparable earnings events")
            structures = historical.get("structures") or []
            if len(structures) != 5:
                raise AssertionError("aapl: expected exactly five concise historical structures")
            structure_kinds = [str(row.get("structure")) for row in structures]
            if (
                structure_kinds.count("long straddle") != 1
                or structure_kinds.count("long call") != 2
                or structure_kinds.count("long put") != 2
            ):
                raise AssertionError("aapl: expected one ATM straddle, two long calls, and two long puts")
            for structure in structures:
                if int(structure.get("minimumLegVolume") or 0) < 25:
                    raise AssertionError("aapl: historical structure violates the per-leg volume gate")
                recent = structure.get("trailing12") or {}
                if int(recent.get("events") or 0) != 12:
                    raise AssertionError("aapl: historical structure does not use exactly 12 recent events")
                if len(recent.get("outcomes") or []) != 12:
                    raise AssertionError("aapl: historical payout tape is incomplete")
            if 'id="historical-structure-rows"' not in page_markup:
                raise AssertionError("aapl: selectable historical structure table is missing")
            if page_markup.index('class="earnings-options-summary"') < page_markup.index('class="historical-table-scroll"'):
                raise AssertionError("aapl: earnings summary must follow the options table")
            if "historical-play-card" in page_markup:
                raise AssertionError("aapl: obsolete historical payout cards remain")
            validated_option_contracts = len(contracts)
            validated_historical_structures = len(structures)

    print(
        f"validated {len(instruments)} Market Lens pages: "
        f"{listed_cex_markets} listed CEX markets, "
        f"{contract_backed_dex_routes} contract-backed DEX routes, "
        f"{validated_option_contracts} liquid AAPL option inputs and "
        f"{validated_historical_structures} historical structures"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
